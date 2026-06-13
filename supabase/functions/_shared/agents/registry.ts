import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import type { AgentActionKeyboard, AgentContextLoader, AgentDef } from "./runner.ts";

// Maps agent.name → its context loader. This is the only place we wire a
// new agent module into the dispatcher. The agent row + cron schedule live
// in the DB; the prompt logic + context query live in the loader.

export interface AgentModule {
  systemPrompt: string;
  loadContext: AgentContextLoader;
  // Optional: quick-action buttons appended to a sent message (e.g. smart_morning).
  actionKeyboard?: AgentActionKeyboard;
}

const REGISTRY: Record<string, AgentModule> = {};

export function registerAgent(name: string, mod: AgentModule): void {
  REGISTRY[name] = mod;
}

export function getAgentModule(name: string): AgentModule | null {
  return REGISTRY[name] ?? null;
}

// Fetches all enabled agents from the DB. Caller decides which are due to fire.
export async function listEnabledAgents(
  supabase: SupabaseClient,
): Promise<AgentDef[]> {
  const { data, error } = await supabase
    .from("agents")
    .select(
      "id, name, role, system_prompt, schedule_cron, channel, enabled, output_policy",
    )
    .eq("enabled", true)
    .returns<AgentDef[]>();
  if (error) throw new Error(`listEnabledAgents failed: ${error.message}`);
  return data ?? [];
}

export async function listProfiles(
  supabase: SupabaseClient,
): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, telegram_user_id, display_name, role, locale, timezone, active_list_id, active_task_id",
    )
    .returns<Profile[]>();
  if (error) throw new Error(`listProfiles failed: ${error.message}`);
  return data ?? [];
}

// Minimal cron evaluator: handles "M H * * D" with "*" or integers. Supports
// comma-lists (e.g. "0 8,19 * * *") and ranges (e.g. "0 9-17 * * 1-5"). No
// step values, no day-of-month combos. Good enough for our agents.
export function cronDue(
  expr: string,
  now: Date,
  lastRun: Date | null,
  tz: string,
): boolean {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const minute = Number(map.minute);
  const hour = Number(map.hour) % 24;
  const day = Number(map.day);
  const month = Number(map.month);
  // Telegram-style: Sunday = 0. en-CA weekday gives short name; map it.
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = dowMap[map.weekday as string] ?? 0;
  if (!matchCronField(m, minute)) return false;
  if (!matchCronField(h, hour)) return false;
  if (!matchCronField(dom, day)) return false;
  if (!matchCronField(mon, month)) return false;
  if (!matchCronField(dow, weekday)) return false;
  // Debounce within the same minute: if we already ran this minute, skip.
  if (lastRun) {
    const sinceMs = now.getTime() - lastRun.getTime();
    if (sinceMs < 55_000) return false;
  }
  return true;
}

function matchCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (value >= a && value <= b) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

export async function lastRunAt(
  supabase: SupabaseClient,
  agentId: string,
  ownerId: string,
): Promise<Date | null> {
  const { data } = await supabase
    .from("agent_runs")
    .select("finished_at")
    .eq("agent_id", agentId)
    .eq("owner_id", ownerId)
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ finished_at: string | null }>();
  return data?.finished_at ? new Date(data.finished_at) : null;
}

// Ad-hoc trigger: open tasks above threshold AND anti_chaos hasn't run in 24h.
// Returns true when the agent should fire even though its cron window passed.
export async function needsAntiChaosAdHoc(
  supabase: SupabaseClient,
  ownerId: string,
  lastRun: Date | null,
  threshold = 10,
): Promise<boolean> {
  if (lastRun && Date.now() - lastRun.getTime() < 24 * 3_600_000) return false;
  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .neq("status", "done");
  return (count ?? 0) > threshold;
}

// Ad-hoc trigger: a run of `streakDays` consecutive UTC days with at least one
// health_metrics entry AND health_intelligence hasn't run in the last 7 days.
export async function needsHealthAdHoc(
  supabase: SupabaseClient,
  ownerId: string,
  lastRun: Date | null,
  streakDays = 7,
): Promise<boolean> {
  if (lastRun && Date.now() - lastRun.getTime() < 7 * 86_400_000) return false;
  const since = new Date(Date.now() - streakDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from("health_metrics")
    .select("occurred_at")
    .eq("owner_id", ownerId)
    .gte("occurred_at", since)
    .returns<{ occurred_at: string }[]>();
  if (!data || data.length < streakDays) return false;
  const days = new Set(data.map((r) => r.occurred_at.slice(0, 10)));
  // Require entries on each of the last `streakDays` UTC days (today inclusive).
  for (let i = 0; i < streakDays; i++) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    if (!days.has(d)) return false;
  }
  return true;
}
