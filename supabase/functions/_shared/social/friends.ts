import type { SupabaseClient } from "@supabase/supabase-js";

// Friend graph: builds on f2f_links (created in 0001). The graph is symmetric
// once accepted — we store one row keyed (owner_id, friend_profile_id) but
// helpers below treat it as undirected.

export interface FriendSummary {
  profile_id: string;
  display_name: string | null;
  telegram_user_id: number | null;
  since: string;
}

export async function listFriends(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<FriendSummary[]> {
  // Find rows where I'm either side and status accepted.
  const { data, error } = await supabase
    .from("f2f_links")
    .select(
      "owner_id, friend_profile_id, status, updated_at, ow:profiles!f2f_links_owner_id_fkey(id, display_name, telegram_user_id), fr:profiles!f2f_links_friend_profile_id_fkey(id, display_name, telegram_user_id)",
    )
    .eq("status", "accepted")
    .or(`owner_id.eq.${ownerId},friend_profile_id.eq.${ownerId}`);
  if (error) throw new Error(`listFriends failed: ${error.message}`);
  type Side = {
    id: string;
    display_name: string | null;
    telegram_user_id: number | null;
  };
  const rows = (data ?? []) as unknown as Array<{
    owner_id: string;
    friend_profile_id: string;
    updated_at: string;
    ow: Side | Side[] | null;
    fr: Side | Side[] | null;
  }>;
  const out: FriendSummary[] = [];
  for (const r of rows) {
    const ow = Array.isArray(r.ow) ? r.ow[0] : r.ow;
    const fr = Array.isArray(r.fr) ? r.fr[0] : r.fr;
    const otherSide = r.owner_id === ownerId ? fr : ow;
    if (!otherSide) continue;
    out.push({
      profile_id: otherSide.id,
      display_name: otherSide.display_name,
      telegram_user_id: otherSide.telegram_user_id,
      since: r.updated_at,
    });
  }
  return out;
}

export async function findFriendByUsername(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
): Promise<FriendSummary | null> {
  const trimmed = query.replace(/^@/, "").trim().toLowerCase();
  const friends = await listFriends(supabase, ownerId);
  for (const f of friends) {
    if (f.display_name && f.display_name.toLowerCase().includes(trimmed)) {
      return f;
    }
  }
  return null;
}

export async function unfriend(
  supabase: SupabaseClient,
  ownerId: string,
  friendProfileId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("f2f_links")
    .delete()
    .or(
      `and(owner_id.eq.${ownerId},friend_profile_id.eq.${friendProfileId}),and(owner_id.eq.${friendProfileId},friend_profile_id.eq.${ownerId})`,
    )
    .select("id");
  return (data?.length ?? 0) > 0;
}
