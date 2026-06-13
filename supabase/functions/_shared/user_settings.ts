import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserSettings {
  owner_id: string;
  daily_summary_enabled: boolean;
  daily_summary_time: string; // HH:MM:SS
  daily_summary_chat_id: number | null;
  daily_summary_last_sent_on: string | null; // YYYY-MM-DD
}

const SELECT =
  "owner_id, daily_summary_enabled, daily_summary_time, daily_summary_chat_id, daily_summary_last_sent_on";

export async function getSettings(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<UserSettings | null> {
  const { data } = await supabase
    .from("user_settings")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .maybeSingle<UserSettings>();
  return data ?? null;
}

export async function ensureSettings(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<UserSettings> {
  const existing = await getSettings(supabase, ownerId);
  if (existing) return existing;
  const { data, error } = await supabase
    .from("user_settings")
    .insert({ owner_id: ownerId })
    .select(SELECT)
    .single<UserSettings>();
  if (error || !data) {
    throw new Error(`ensureSettings failed: ${error?.message ?? "no row"}`);
  }
  return data;
}

export async function setDailySummary(
  supabase: SupabaseClient,
  ownerId: string,
  enabled: boolean,
  time: string | null,
  chatId: number | null,
): Promise<UserSettings> {
  await ensureSettings(supabase, ownerId);
  const patch: Record<string, unknown> = { daily_summary_enabled: enabled };
  if (time !== null) patch.daily_summary_time = time;
  if (chatId !== null) patch.daily_summary_chat_id = chatId;
  const { data, error } = await supabase
    .from("user_settings")
    .update(patch)
    .eq("owner_id", ownerId)
    .select(SELECT)
    .single<UserSettings>();
  if (error || !data) {
    throw new Error(`setDailySummary failed: ${error?.message ?? "no row"}`);
  }
  return data;
}
