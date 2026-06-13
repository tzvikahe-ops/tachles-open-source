import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRRuleString } from "../rrule.ts";
import { nextLocalTime, parseHHMM } from "../tz.ts";

// Manages the single per-owner daily-summary reminder. It is a recurring
// dynamic reminder (kind=dynamic, dynamic_handler=daily_calendar_summary)
// scheduled at the user's chosen local time. We always keep at most one row
// per owner — upsert by (owner_id, dynamic_handler).

const HANDLER = "daily_calendar_summary";
const TITLE = "סיכום יומי 🌅";

interface ExistingRow {
  id: string;
}

async function findExisting(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<ExistingRow | null> {
  const { data } = await supabase
    .from("reminders")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("kind", "dynamic")
    .eq("dynamic_handler", HANDLER)
    .neq("status", "done")
    .maybeSingle<ExistingRow>();
  return data ?? null;
}

export async function enableDailySummary(
  supabase: SupabaseClient,
  ownerId: string,
  timezone: string,
  hhmm: string,
): Promise<{ runAt: Date }> {
  const parsed = parseHHMM(hhmm);
  if (!parsed) throw new Error(`bad time: ${hhmm}`);
  const runAt = nextLocalTime(timezone, parsed.hour, parsed.minute);
  const rrule = buildRRuleString(runAt, "FREQ=DAILY");

  const existing = await findExisting(supabase, ownerId);
  const row = {
    owner_id: ownerId,
    title: TITLE,
    kind: "dynamic" as const,
    dynamic_handler: HANDLER,
    dynamic_params: {},
    schedule_type: "recurring" as const,
    run_at: runAt.toISOString(),
    rrule,
    timezone,
    status: "active" as const,
  };
  if (existing) {
    const { error } = await supabase.from("reminders").update(row).eq("id", existing.id);
    if (error) throw new Error(`update daily summary failed: ${error.message}`);
  } else {
    const { error } = await supabase.from("reminders").insert(row);
    if (error) throw new Error(`insert daily summary failed: ${error.message}`);
  }
  return { runAt };
}

export async function disableDailySummary(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<boolean> {
  const existing = await findExisting(supabase, ownerId);
  if (!existing) return false;
  await supabase.from("reminders").update({ status: "cancelled" }).eq("id", existing.id);
  return true;
}
