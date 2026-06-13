import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { sendMessage } from "../telegram.ts";
import { logEvent } from "../events.ts";
import {
  listWebPushSubscriptions,
  notificationBody,
  sendWebPush,
} from "../integrations/web_push.ts";

// Generic runner for proactive agents. Each agent provides a system_prompt +
// a context-loader. The runner:
//   1. Loads context (from agent.context() if available, else minimal).
//   2. Calls Claude with the system prompt + context + per-user agent_state +
//      a small set of tools (send_message / noop / update_state).
//   3. Applies output_policy guards (max_per_day, quiet_hours, dedupe).
//   4. Sends the message (or noops) and records the run.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

// Shared guidance prepended to every proactive agent's system prompt. Kept here
// (not duplicated per agent) so behaviour stays consistent; it rides along
// inside each agent's per-agent cached prefix (the shared+tools prefix alone is
// under sonnet-4-6's 1024-token cache minimum, so no separate cross-agent cache
// entry exists). Lets agents surface a capability gap when they spot one —
// sparingly, under the same restraint rules.
const SHARED_GUIDELINES = `הנחיות משותפות לכל הסוכנים הפרואקטיביים:
- אם אתה מזהה צורך חוזר של המשתמש שאינך יכול למלא בגלל יכולת חסרה (אינטגרציה / כלי / שרת MCP / הרשאה),
  מותר לך *מדי פעם* להציע אותה — בניסוח קצר וקונקרטי: "אם הייתה לי גישה ל-X, יכולתי לעשות עבורך Y".
- הצע רק כשזה מבוסס על משהו שראית בפועל בנתונים/בבקשות של המשתמש — לא הצעה גנרית, ולא יותר מלעיתים רחוקות.
  זה נספר במכסת ההודעות שלך ואותם כללי ריסון חלים: עדיף noop על פני הצעה חלשה.`;

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  schedule_cron: string | null;
  channel: string;
  enabled: boolean;
  output_policy: OutputPolicy;
}

export interface OutputPolicy {
  max_per_day?: number;
  quiet_hours?: [string, string]; // ["22:00", "07:00"]
  dedupe_window_minutes?: number;
  min_confidence_to_send?: number;
}

export interface AgentRunResult {
  status: "sent" | "noop" | "error";
  message_text?: string;
  state_update?: Record<string, unknown>;
  error?: string;
}

export interface AgentContextLoader {
  (
    supabase: SupabaseClient,
    profile: Profile,
    state: Record<string, unknown>,
  ): Promise<
    Record<string, unknown>
  >;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

// Optional per-agent provider of quick-action button rows. Rendered above the
// 👍/👎 feedback row on a sent message. Buttons should use callback_data the
// webhook already routes (e.g. "menu:today"). Receives the loaded context so an
// agent can tailor buttons to what it surfaced.
export interface AgentActionKeyboard {
  (
    profile: Profile,
    context: Record<string, unknown>,
  ): InlineButton[][] | undefined;
}

const DEFAULT_TOOLS = [
  {
    name: "send_message",
    description:
      "Send a Telegram message to the user. Use sparingly — only when there is something important and timely. Markdown HTML allowed (<b>, <i>, <code>). Keep under 600 chars unless the user explicitly asked for length.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The message body (Hebrew)." },
        confidence: {
          type: "number",
          description: "0-1, how confident you are this is worth sending.",
        },
        state_update: {
          type: "object",
          description: "Patch to merge into the per-user agent_state.",
        },
      },
      required: ["text", "confidence"],
    },
  },
  {
    name: "noop",
    description:
      "Skip — there is nothing important to say right now. Preferred over a weak message.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        state_update: { type: "object" },
      },
    },
  },
] as const;

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
}

function nowInTz(tz: string): { hhmm: string; date: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function inQuietHours(now: string, quiet?: [string, string]): boolean {
  if (!quiet) return false;
  const [start, end] = quiet;
  // window may wrap midnight (e.g. 22:00 .. 07:00).
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}

async function countSentToday(
  supabase: SupabaseClient,
  agentId: string,
  ownerId: string,
  todayDate: string,
): Promise<number> {
  const start = `${todayDate}T00:00:00Z`;
  const end = `${todayDate}T23:59:59Z`;
  const { count } = await supabase
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("owner_id", ownerId)
    .eq("status", "sent")
    .gte("finished_at", start)
    .lte("finished_at", end);
  return count ?? 0;
}

async function lastSentText(
  supabase: SupabaseClient,
  agentId: string,
  ownerId: string,
  windowMinutes: number,
): Promise<string | null> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { data } = await supabase
    .from("agent_runs")
    .select("sent_message_text")
    .eq("agent_id", agentId)
    .eq("owner_id", ownerId)
    .eq("status", "sent")
    .gte("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ sent_message_text: string | null }>();
  return data?.sent_message_text ?? null;
}

export async function loadState(
  supabase: SupabaseClient,
  agentId: string,
  ownerId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("agent_state")
    .select("state")
    .eq("agent_id", agentId)
    .eq("owner_id", ownerId)
    .maybeSingle<{ state: Record<string, unknown> }>();
  return data?.state ?? {};
}

async function saveState(
  supabase: SupabaseClient,
  agentId: string,
  ownerId: string,
  state: Record<string, unknown>,
): Promise<void> {
  await supabase.from("agent_state").upsert({
    agent_id: agentId,
    owner_id: ownerId,
    state,
    updated_at: new Date().toISOString(),
  });
}

// Loads the per-user override of enabled flag + policy. enabled=false short-
// circuits the run; policy_override is a sparse patch merged on top of the
// agent's default output_policy (used by the feedback loop to bump confidence).
async function loadUserOverride(
  supabase: SupabaseClient,
  agentId: string,
  ownerId: string,
): Promise<{ enabled: boolean; policyOverride: Partial<OutputPolicy> }> {
  const { data } = await supabase
    .from("user_agent_settings")
    .select("enabled, policy_override")
    .eq("agent_id", agentId)
    .eq("owner_id", ownerId)
    .maybeSingle<
      { enabled: boolean; policy_override: Partial<OutputPolicy> | null }
    >();
  return {
    enabled: data ? data.enabled : true,
    policyOverride: data?.policy_override ?? {},
  };
}

export async function runAgent(
  supabase: SupabaseClient,
  agent: AgentDef,
  profile: Profile,
  contextLoader: AgentContextLoader,
  actionKeyboard?: AgentActionKeyboard,
): Promise<AgentRunResult> {
  const override = await loadUserOverride(supabase, agent.id, profile.id);
  if (!override.enabled) return { status: "noop" };

  const policy: OutputPolicy = {
    ...(agent.output_policy ?? {}),
    ...override.policyOverride,
  };
  const { hhmm, date } = nowInTz(profile.timezone);
  if (inQuietHours(hhmm, policy.quiet_hours)) return { status: "noop" };

  if (policy.max_per_day && policy.max_per_day > 0) {
    const sent = await countSentToday(supabase, agent.id, profile.id, date);
    if (sent >= policy.max_per_day) return { status: "noop" };
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { status: "noop", error: "no anthropic key" };
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;

  // Start the run row early so we can finalize at the end.
  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({
      agent_id: agent.id,
      owner_id: profile.id,
      started_at: new Date().toISOString(),
      status: "running",
    })
    .select("id")
    .single<{ id: string }>();
  const runId = runRow?.id;

  let state: Record<string, unknown> = {};
  let contextPayload: Record<string, unknown> = {};
  try {
    state = await loadState(supabase, agent.id, profile.id);
    contextPayload = await contextLoader(supabase, profile, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "error",
        error: msg,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
    }
    return { status: "error", error: msg };
  }

  const userTurn = JSON.stringify({
    now_local: hhmm,
    date_local: date,
    timezone: profile.timezone,
    agent_state: state,
    context: contextPayload,
  });

  let result: AgentRunResult = { status: "noop" };
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: [
          { type: "text", text: SHARED_GUIDELINES },
          {
            type: "text",
            text: agent.system_prompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: DEFAULT_TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: userTurn }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { content?: AnthropicBlock[] };
    const useBlock = data.content?.find((b) => b.type === "tool_use");
    if (!useBlock) return { status: "noop" };
    const input = (useBlock.input ?? {}) as Record<string, unknown>;
    const stateUpdate = (input.state_update as Record<string, unknown>) ??
      undefined;
    if (stateUpdate) {
      const merged = { ...state, ...stateUpdate };
      await saveState(supabase, agent.id, profile.id, merged);
    }
    if (useBlock.name === "send_message") {
      const text = String(input.text ?? "").trim();
      const confidence = Number(input.confidence ?? 0);
      const minConfidence = policy.min_confidence_to_send ?? 0.6;
      if (!text || confidence < minConfidence) {
        result = { status: "noop" };
      } else if (
        policy.dedupe_window_minutes &&
        (await lastSentText(
            supabase,
            agent.id,
            profile.id,
            policy.dedupe_window_minutes,
          )) === text
      ) {
        result = { status: "noop" };
      } else {
        const rows: InlineButton[][] = [];
        if (actionKeyboard) {
          try {
            const actionRows = actionKeyboard(profile, contextPayload);
            if (actionRows) rows.push(...actionRows);
          } catch (_) { /* action buttons are best-effort */ }
        }
        if (runId) {
          rows.push([
            { text: "👍 מועיל", callback_data: `agentfb:${runId}:useful` },
            { text: "👎 רעש", callback_data: `agentfb:${runId}:noisy` },
          ]);
        }
        const replyMarkup = rows.length ? { inline_keyboard: rows } : undefined;
        let telegramSent = false;
        if (profile.telegram_user_id !== null) {
          try {
            await sendMessage(
              profile.telegram_user_id,
              text,
              replyMarkup ? { reply_markup: replyMarkup } : {},
            );
            telegramSent = true;
          } catch (error) {
            console.error(
              `agent Telegram delivery failed for ${profile.id}:`,
              error,
            );
          }
        }
        const subscriptions = await listWebPushSubscriptions(supabase, [
          profile.id,
        ]);
        const pushResult = await sendWebPush(supabase, subscriptions, {
          title: agent.role || "תכלס",
          body: notificationBody(text, agent.role || "תכלס"),
          url: "/?view=agents",
          tag: `agent-${agent.name}`,
        });
        if (!telegramSent && pushResult.sent === 0) {
          result = { status: "noop", error: "no delivery channel" };
        } else {
          await logEvent(supabase, profile.id, {
            kind: "proactive_sent",
            source: "agent",
            payload: {
              agent: agent.name,
              text_preview: text.slice(0, 120),
              telegram: telegramSent,
              web_push: pushResult.sent,
            },
          });
          result = {
            status: "sent",
            message_text: text,
            state_update: stateUpdate,
          };
        }
      }
    } else {
      // noop tool
      await logEvent(supabase, profile.id, {
        kind: "agent_noop",
        source: "agent",
        payload: { agent: agent.name, reason: String(input.reason ?? "") },
      });
      result = { status: "noop" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { status: "error", error: msg };
  }

  if (runId) {
    await supabase.from("agent_runs").update({
      status: result.status,
      sent_message_text: result.message_text ?? null,
      output: result.state_update ? { state_update: result.state_update } : null,
      error: result.error ?? null,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }
  return result;
}
