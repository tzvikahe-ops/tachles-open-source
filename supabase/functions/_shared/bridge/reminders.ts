import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRRuleString } from "../rrule.ts";

export interface CreateReminderInput {
  ownerId: string;
  title: string;
  body?: string | null;
  scheduleType: "once" | "recurring";
  runAt: Date; // first/only fire time
  recurrence?: string | null; // RRULE body without DTSTART (recurring only)
  timezone: string;
}

export interface ReminderSummary {
  id: string;
  title: string;
  run_at: string | null;
  schedule_type: "once" | "recurring";
}

export async function createReminder(
  supabase: SupabaseClient,
  input: CreateReminderInput,
): Promise<string> {
  const rrule = input.scheduleType === "recurring" && input.recurrence
    ? buildRRuleString(input.runAt, input.recurrence)
    : null;

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      owner_id: input.ownerId,
      title: input.title,
      body: input.body ?? null,
      schedule_type: input.scheduleType,
      run_at: input.runAt.toISOString(),
      rrule,
      timezone: input.timezone,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`createReminder failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id as string;
}

export async function listActiveReminders(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<ReminderSummary[]> {
  const { data, error } = await supabase
    .from("reminders")
    .select("id, title, run_at, schedule_type")
    .eq("owner_id", ownerId)
    .in("status", ["active", "firing"])
    .order("run_at", { ascending: true })
    .limit(50)
    .returns<ReminderSummary[]>();

  if (error) throw new Error(`listActiveReminders failed: ${error.message}`);
  return data ?? [];
}

// Snooze: create a fresh one-time reminder that re-sends the original's
// title/body at `runAt`. The original (which may already be `done`, or a still
// recurring series) is left untouched, so snoozing never disturbs a series.
// Returns the copied title, or null if the source reminder isn't owned.
export async function snoozeReminder(
  supabase: SupabaseClient,
  ownerId: string,
  reminderId: string,
  runAt: Date,
): Promise<{ id: string; title: string } | null> {
  const { data: source } = await supabase
    .from("reminders")
    .select("title, body, timezone")
    .eq("id", reminderId)
    .eq("owner_id", ownerId)
    .maybeSingle<{ title: string; body: string | null; timezone: string }>();
  if (!source) return null;

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      owner_id: ownerId,
      title: source.title,
      body: source.body,
      kind: "static",
      schedule_type: "once",
      run_at: runAt.toISOString(),
      timezone: source.timezone,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`snoozeReminder failed: ${error?.message ?? "no row returned"}`);
  }
  return { id: data.id as string, title: source.title };
}

// Cancel a reminder, but only if it belongs to ownerId and is still live.
// Returns true when a row was actually cancelled.
export async function cancelReminder(
  supabase: SupabaseClient,
  ownerId: string,
  reminderId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("reminders")
    .update({ status: "cancelled" })
    .eq("id", reminderId)
    .eq("owner_id", ownerId)
    .in("status", ["active", "firing"])
    .select("id")
    .maybeSingle();
  return data !== null;
}
