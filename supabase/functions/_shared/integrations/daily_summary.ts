import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { listOwnerEventsBetween, type StoredEvent } from "./calendar_sync.ts";

// Composes a personalized Hebrew "good morning" summary using Claude. Inputs:
// today's calendar events, upcoming reminders (next 24h), open tasks. Output:
// a short Telegram-friendly HTML message. Falls back to a deterministic
// non-LLM template when no Anthropic key is configured.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

interface ReminderRow {
  id: string;
  title: string;
  run_at: string;
}
interface TaskRow {
  id: string;
  title: string;
  priority: number;
  status: string;
  due_at: string | null;
}

export interface DailySummaryContext {
  events: StoredEvent[];
  reminders: ReminderRow[];
  tasks: TaskRow[];
  date: string; // local YYYY-MM-DD
  timezone: string;
}

function dayBounds(timezone: string, daysAhead = 0): { fromIso: string; toIso: string } {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${local}T00:00:00`);
  start.setDate(start.getDate() + daysAhead);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export async function collectContext(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<DailySummaryContext> {
  const { fromIso, toIso } = dayBounds(profile.timezone, 0);
  const events = await listOwnerEventsBetween(supabase, profile.id, fromIso, toIso);

  const { data: reminders } = await supabase
    .from("reminders")
    .select("id, title, run_at")
    .eq("owner_id", profile.id)
    .eq("status", "active")
    .eq("kind", "static") // exclude the dynamic summary reminder itself
    .gte("run_at", fromIso)
    .lt("run_at", toIso)
    .order("run_at", { ascending: true })
    .returns<ReminderRow[]>();

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, priority, status, due_at")
    .eq("owner_id", profile.id)
    .neq("status", "done")
    .is("parent_task_id", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10)
    .returns<TaskRow[]>();

  return {
    events,
    reminders: reminders ?? [],
    tasks: tasks ?? [],
    date: new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone }).format(new Date()),
    timezone: profile.timezone,
  };
}

function formatLocalTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function deterministicSummary(ctx: DailySummaryContext): string {
  const lines = [`<b>בוקר טוב 🌅 — סיכום ליום ${ctx.date}</b>`, ""];
  if (ctx.events.length > 0) {
    lines.push("<b>📅 ביומן היום:</b>");
    for (const e of ctx.events) {
      const time = e.all_day ? "כל היום" : formatLocalTime(e.start_at, ctx.timezone);
      lines.push(`• ${time} — ${escapeHtml(e.title)}`);
    }
    lines.push("");
  }
  if (ctx.reminders.length > 0) {
    lines.push("<b>⏰ תזכורות להיום:</b>");
    for (const r of ctx.reminders) {
      lines.push(`• ${formatLocalTime(r.run_at, ctx.timezone)} — ${escapeHtml(r.title)}`);
    }
    lines.push("");
  }
  if (ctx.tasks.length > 0) {
    lines.push("<b>✅ משימות פתוחות:</b>");
    for (const t of ctx.tasks) {
      const p = t.priority >= 2 ? "🔴 " : t.priority === 1 ? "🟡 " : "";
      lines.push(`• ${p}${escapeHtml(t.title)}`);
    }
    lines.push("");
  }
  if (ctx.events.length + ctx.reminders.length + ctx.tasks.length === 0) {
    lines.push("יומך נראה פנוי. יום מעולה ✨");
  }
  return lines.join("\n").trim();
}

const SYSTEM = `אתה עוזר אישי בעברית שמייצר סיכום יומי קצר וחם בבוקר עבור המשתמש בטלגרם.
מקבל הקשר מובנה (אירועי יומן, תזכורות, משימות פתוחות) ומחזיר HTML של Telegram (תגי <b>, <i>, <code> בלבד).
הנחיות:
- פתח בברכת בוקר אישית קצרה (אמוג'י אחד או שניים, לא יותר).
- הצג את היומן ככותרת עם רשימת bullet (•).
- ציין את הזמן (HH:MM) או "כל היום" ליד כל ארוע.
- אם יש 0 אירועים/תזכורות/משימות — אמור משהו קצר ומעודד.
- שמור על אורך של עד 12 שורות.
- אל תוסיף קריאה לפעולה כללית כמו "תהיה לך יום מעולה" יותר מפעם אחת.
- אל תזכיר נתונים שלא קיבלת.`;

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export async function llmSummary(ctx: DailySummaryContext): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return deterministicSummary(ctx);
  const model = Deno.env.get("LLM_MODEL") ?? DEFAULT_MODEL;

  const userTurn = JSON.stringify({
    date: ctx.date,
    timezone: ctx.timezone,
    events: ctx.events.map((e) => ({
      title: e.title,
      start: e.start_at,
      end: e.end_at,
      all_day: e.all_day,
      location: e.location,
    })),
    reminders: ctx.reminders.map((r) => ({ title: r.title, at: r.run_at })),
    tasks: ctx.tasks.map((t) => ({ title: t.title, priority: t.priority })),
  });

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
        max_tokens: 600,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userTurn }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: AnthropicContentBlock[] };
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("no text block in Anthropic response");
    return text.trim();
  } catch (err) {
    console.error("llmSummary failed, using deterministic fallback:", err);
    return deterministicSummary(ctx);
  }
}
