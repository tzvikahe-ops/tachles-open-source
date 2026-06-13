import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramUser } from "./types.ts";

export interface Profile {
  id: string;
  telegram_user_id: number | null;
  display_name: string | null;
  role: "owner" | "friend";
  locale: string;
  timezone: string;
  active_list_id: string | null;
  active_task_id: string | null;
}

const SELECT =
  "id, telegram_user_id, display_name, role, locale, timezone, active_list_id, active_task_id";

// Map a Telegram user to a Tachles profile, creating it on first contact.
// Ownership throughout the app is keyed on the returned profile id.
export async function getOrCreateProfile(
  supabase: SupabaseClient,
  from: TelegramUser,
): Promise<Profile> {
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ") ||
    from.username || null;

  const { data, error } = await supabase
    .rpc("resolve_or_create_profile_identity", {
      p_provider: "telegram",
      p_subject: String(from.id),
      p_display_name: displayName,
      p_locale: "he",
      p_timezone: "Asia/Jerusalem",
    })
    .single<Profile>();

  if (error || !data) {
    throw new Error(`profile identity resolution failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export interface AuthProfileClaims {
  email?: string | null;
  fullName?: string | null;
  locale?: string | null;
}

export async function getOrCreateProfileFromAuth(
  supabase: SupabaseClient,
  authUserId: string,
  claims: AuthProfileClaims = {},
): Promise<Profile> {
  const displayName = claims.fullName?.trim() || claims.email?.trim() || null;
  const { data, error } = await supabase
    .rpc("resolve_or_create_profile_identity", {
      p_provider: "supabase_auth",
      p_subject: authUserId,
      p_display_name: displayName,
      p_locale: claims.locale?.trim() || "he",
      p_timezone: "Asia/Jerusalem",
    })
    .single<Profile>();

  if (error || !data) {
    throw new Error(`auth profile resolution failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export async function getProfileById(
  supabase: SupabaseClient,
  id: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle<Profile>();
  return data ?? null;
}
