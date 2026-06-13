import type { SupabaseClient } from "@supabase/supabase-js";

// Invite tokens — written by the inviter, consumed by the invitee through
// the bot's deep-link /start. On consume we create an accepted f2f_link
// between both profiles.

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CreatedInvite {
  token: string;
  expires_at: string;
}

export async function createInvite(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<CreatedInvite> {
  const token = randomToken();
  const { data, error } = await supabase
    .from("invites")
    .insert({ token, owner_id: ownerId })
    .select("token, expires_at")
    .single<CreatedInvite>();
  if (error || !data) throw new Error(`createInvite failed: ${error?.message ?? "no row"}`);
  return data;
}

export interface ConsumeResult {
  ownerId: string; // profile id of the inviter
}

export async function consumeInvite(
  supabase: SupabaseClient,
  token: string,
  invitedProfileId: string,
): Promise<ConsumeResult | null> {
  // Mark invite consumed atomically (only if still valid + not yet consumed).
  const { data: row } = await supabase
    .from("invites")
    .update({ consumed_by: invitedProfileId, consumed_at: new Date().toISOString() })
    .eq("token", token)
    .is("consumed_by", null)
    .gt("expires_at", new Date().toISOString())
    .select("owner_id")
    .maybeSingle<{ owner_id: string }>();
  if (!row) return null;
  if (row.owner_id === invitedProfileId) return null; // self-invite: harmless no-op

  // Establish the friendship (idempotent on the unique constraint).
  const { error: linkErr } = await supabase
    .from("f2f_links")
    .upsert({
      owner_id: row.owner_id,
      friend_profile_id: invitedProfileId,
      status: "accepted",
    }, { onConflict: "owner_id,friend_profile_id" });
  if (linkErr) throw new Error(`f2f_links upsert failed: ${linkErr.message}`);
  return { ownerId: row.owner_id };
}
