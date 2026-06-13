import type { SupabaseClient } from "@supabase/supabase-js";

// Evaluates a conditional reminder's predicate against the events table. The
// dispatcher calls `shouldFire(...)` for each active conditional reminder
// each tick (every minute). True → fire it normally (send + bump run_at).

export type ConditionType = "inactivity" | "streak_break" | "threshold";

export interface InactivityCondition {
  event_kind: string;
  payload_match?: Record<string, unknown>;
  window_days: number;
}

export interface StreakBreakCondition {
  event_kind: string;
  payload_match?: Record<string, unknown>;
  gap_days: number;
}

export interface ThresholdCondition {
  event_kind: string;
  payload_match?: Record<string, unknown>;
  agg: "count" | "sum_value";
  window_days: number;
  limit: number;
  direction?: "above" | "below";
}

export type ConditionParams =
  | InactivityCondition
  | StreakBreakCondition
  | ThresholdCondition;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function lastMatchingEvent(
  supabase: SupabaseClient,
  ownerId: string,
  eventKind: string,
  payloadMatch?: Record<string, unknown>,
): Promise<string | null> {
  let q = supabase
    .from("events")
    .select("occurred_at")
    .eq("owner_id", ownerId)
    .eq("kind", eventKind)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (payloadMatch && Object.keys(payloadMatch).length > 0) {
    q = q.contains("payload", payloadMatch);
  }
  const { data } = await q.maybeSingle<{ occurred_at: string }>();
  return data?.occurred_at ?? null;
}

async function countMatching(
  supabase: SupabaseClient,
  ownerId: string,
  eventKind: string,
  sinceIso: string,
  payloadMatch?: Record<string, unknown>,
): Promise<number> {
  let q = supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", eventKind)
    .gte("occurred_at", sinceIso);
  if (payloadMatch && Object.keys(payloadMatch).length > 0) {
    q = q.contains("payload", payloadMatch);
  }
  const { count } = await q;
  return count ?? 0;
}

async function sumValueMatching(
  supabase: SupabaseClient,
  ownerId: string,
  eventKind: string,
  sinceIso: string,
  payloadMatch?: Record<string, unknown>,
): Promise<number> {
  // Loads matching events and sums payload.value. Fine for the scale we expect
  // (<= a few hundred rows per window per user).
  let q = supabase
    .from("events")
    .select("payload")
    .eq("owner_id", ownerId)
    .eq("kind", eventKind)
    .gte("occurred_at", sinceIso);
  if (payloadMatch && Object.keys(payloadMatch).length > 0) {
    q = q.contains("payload", payloadMatch);
  }
  const { data } = await q.returns<{ payload: Record<string, unknown> }[]>();
  let total = 0;
  for (const r of data ?? []) {
    const v = r.payload?.value;
    if (typeof v === "number") total += v;
  }
  return total;
}

export async function shouldFire(
  supabase: SupabaseClient,
  ownerId: string,
  conditionType: ConditionType,
  params: ConditionParams,
): Promise<boolean> {
  if (conditionType === "inactivity") {
    const p = params as InactivityCondition;
    const last = await lastMatchingEvent(supabase, ownerId, p.event_kind, p.payload_match);
    if (!last) return true; // never happened → fire (e.g. "if I haven't called אמא in 7d")
    const ageMs = Date.now() - new Date(last).getTime();
    return ageMs >= p.window_days * 86_400_000;
  }
  if (conditionType === "streak_break") {
    const p = params as StreakBreakCondition;
    const last = await lastMatchingEvent(supabase, ownerId, p.event_kind, p.payload_match);
    if (!last) return false; // no streak existed → nothing to break
    const ageMs = Date.now() - new Date(last).getTime();
    return ageMs >= p.gap_days * 86_400_000;
  }
  if (conditionType === "threshold") {
    const p = params as ThresholdCondition;
    const since = daysAgoIso(p.window_days);
    const value = p.agg === "sum_value"
      ? await sumValueMatching(supabase, ownerId, p.event_kind, since, p.payload_match)
      : await countMatching(supabase, ownerId, p.event_kind, since, p.payload_match);
    return p.direction === "below" ? value < p.limit : value > p.limit;
  }
  return false;
}
