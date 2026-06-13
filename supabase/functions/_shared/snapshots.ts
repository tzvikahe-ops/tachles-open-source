import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./profiles.ts";
import { listOwnerEventsBetween } from "./integrations/calendar_sync.ts";

// Computes and persists one row in state_snapshots per user per day. Designed
// to be idempotent (upsert) so we can re-run for backfill or in tests.

export interface DailySnapshot {
  open_tasks: number;
  done_tasks_week: number;
  bubbles_added_week: number;
  reminders_fired_week: number;
  proactive_sent_week: number;
  summary_sent_today: number;
  events_total_today: number;
  // populated when Phase 7 health table exists; safe-default 0 here.
  sleep_hours_avg_7d: number | null;
  mood_avg_7d: number | null;
  workout_minutes_week: number | null;
  // null when no calendar is connected for the user.
  calendar_load_hours_week: number | null;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function todayLocalStartIso(timezone: string): string {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // Convert local YYYY-MM-DD into the UTC instant for that local 00:00.
  // Cheap proxy: just treat as UTC; the snapshot date label uses local anyway,
  // and per-day aggregates are tolerant of an hour-or-two shift.
  return `${local}T00:00:00Z`;
}

function localDate(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

async function countEvents(
  supabase: SupabaseClient,
  ownerId: string,
  kind: string,
  sinceIso: string,
): Promise<number> {
  const { count } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .gte("occurred_at", sinceIso);
  return count ?? 0;
}

async function averageHealthMetric(
  supabase: SupabaseClient,
  ownerId: string,
  metric: string,
  sinceIso: string,
): Promise<number | null> {
  // health_metrics may not exist yet (Phase 7); swallow not-found.
  try {
    const { data } = await supabase
      .from("health_metrics")
      .select("value")
      .eq("owner_id", ownerId)
      .eq("metric", metric)
      .gte("occurred_at", sinceIso)
      .returns<{ value: number }[]>();
    if (!data || data.length === 0) return null;
    const sum = data.reduce((a, r) => a + Number(r.value), 0);
    return sum / data.length;
  } catch {
    return null;
  }
}

async function sumHealthMetric(
  supabase: SupabaseClient,
  ownerId: string,
  metric: string,
  sinceIso: string,
): Promise<number | null> {
  try {
    const { data } = await supabase
      .from("health_metrics")
      .select("value")
      .eq("owner_id", ownerId)
      .eq("metric", metric)
      .gte("occurred_at", sinceIso)
      .returns<{ value: number }[]>();
    if (!data || data.length === 0) return null;
    return data.reduce((a, r) => a + Number(r.value), 0);
  } catch {
    return null;
  }
}

export async function buildSnapshot(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<DailySnapshot> {
  const weekAgo = isoDaysAgo(7);
  const todayStart = todayLocalStartIso(profile.timezone);

  const { count: openTasksCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", profile.id)
    .neq("status", "done");
  const open_tasks = openTasksCount ?? 0;

  const { count: doneWeekCount } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", profile.id)
    .eq("status", "done")
    .gte("updated_at", weekAgo);
  const done_tasks_week = doneWeekCount ?? 0;

  const { count: bubblesAddedWeekCount } = await supabase
    .from("memory_bubbles")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", profile.id)
    .gte("created_at", weekAgo);
  const bubbles_added_week = bubblesAddedWeekCount ?? 0;
  const reminders_fired_week = await countEvents(supabase, profile.id, "reminder_fired", weekAgo);
  const proactive_sent_week = await countEvents(supabase, profile.id, "proactive_sent", weekAgo);
  const summary_sent_today = await countEvents(supabase, profile.id, "summary_sent", todayStart);
  const events_total_today = await countEvents(supabase, profile.id, "message_in", todayStart);

  const sleep_hours_avg_7d = await averageHealthMetric(
    supabase,
    profile.id,
    "sleep_hours",
    weekAgo,
  );
  const mood_avg_7d = await averageHealthMetric(supabase, profile.id, "mood_1_10", weekAgo);
  const workout_minutes_week = await sumHealthMetric(
    supabase,
    profile.id,
    "workout_minutes",
    weekAgo,
  );

  // Sum scheduled calendar hours over the past 7 days. Skip all-day events
  // (they'd skew the total). Returns null when no rows exist — distinguishes
  // "no calendar connected" from "0 hours booked".
  let calendar_load_hours_week: number | null = null;
  try {
    const weekFwd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const events = await listOwnerEventsBetween(supabase, profile.id, weekAgo, weekFwd);
    if (events.length > 0) {
      const hours = events.reduce((sum, e) => {
        if (e.all_day) return sum;
        const ms = new Date(e.end_at).getTime() - new Date(e.start_at).getTime();
        if (!Number.isFinite(ms) || ms <= 0) return sum;
        return sum + ms / 3_600_000;
      }, 0);
      calendar_load_hours_week = Math.round(hours * 10) / 10;
    }
  } catch (err) {
    console.error("calendar_load_hours_week aggregate failed:", err);
  }

  return {
    open_tasks,
    done_tasks_week,
    bubbles_added_week,
    reminders_fired_week,
    proactive_sent_week,
    summary_sent_today,
    events_total_today,
    sleep_hours_avg_7d,
    mood_avg_7d,
    workout_minutes_week,
    calendar_load_hours_week,
  };
}

export async function persistSnapshot(
  supabase: SupabaseClient,
  profile: Profile,
  snapshot: DailySnapshot,
): Promise<void> {
  await supabase.from("state_snapshots").upsert({
    owner_id: profile.id,
    snapshot_date: localDate(profile.timezone),
    snapshot,
  });
}

export async function loadLatestSnapshot(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DailySnapshot | null> {
  const { data } = await supabase
    .from("state_snapshots")
    .select("snapshot")
    .eq("owner_id", ownerId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ snapshot: DailySnapshot }>();
  return data?.snapshot ?? null;
}

export interface DatedSnapshot {
  snapshot_date: string;
  snapshot: DailySnapshot;
}

export async function listRecentSnapshots(
  supabase: SupabaseClient,
  ownerId: string,
  limit = 14,
): Promise<DatedSnapshot[]> {
  const { data, error } = await supabase
    .from("state_snapshots")
    .select("snapshot_date, snapshot")
    .eq("owner_id", ownerId)
    .order("snapshot_date", { ascending: false })
    .limit(limit)
    .returns<DatedSnapshot[]>();
  if (error) throw new Error(`listRecentSnapshots failed: ${error.message}`);
  return data ?? [];
}
