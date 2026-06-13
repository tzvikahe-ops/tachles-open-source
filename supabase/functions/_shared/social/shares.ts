import type { SupabaseClient } from "@supabase/supabase-js";

export type ResourceType = "list" | "task" | "bubble" | "reminder";

export interface SharedResource {
  id: string;
  resource_type: ResourceType;
  resource_id: string;
  permission: string;
  owner_id: string;
  friend_id: string;
  owner_display_name: string | null;
  resource_title: string | null;
  created_at: string;
}

const TYPE_TABLE: Record<ResourceType, { table: string; titleColumn: string }> = {
  list: { table: "lists", titleColumn: "name" },
  task: { table: "tasks", titleColumn: "title" },
  bubble: { table: "memory_bubbles", titleColumn: "content" },
  reminder: { table: "reminders", titleColumn: "title" },
};

export async function shareResource(
  supabase: SupabaseClient,
  ownerId: string,
  friendId: string,
  type: ResourceType,
  resourceId: string,
  permission: "read" | "comment" | "write" = "read",
): Promise<void> {
  // Verify the owner actually owns this resource.
  const meta = TYPE_TABLE[type];
  const { data: owned } = await supabase
    .from(meta.table)
    .select("id")
    .eq("id", resourceId)
    .eq("owner_id", ownerId)
    .maybeSingle<{ id: string }>();
  if (!owned) throw new Error("resource not found or not owned");

  const { error } = await supabase.from("shares").upsert({
    owner_id: ownerId,
    friend_id: friendId,
    resource_type: type,
    resource_id: resourceId,
    permission,
  }, { onConflict: "owner_id,friend_id,resource_type,resource_id" });
  if (error) throw new Error(`shareResource failed: ${error.message}`);
}

export async function unshareResource(
  supabase: SupabaseClient,
  ownerId: string,
  shareId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("shares")
    .delete()
    .eq("id", shareId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  return data !== null;
}

// Inbox: resources shared *with* the given user.
export async function inbox(
  supabase: SupabaseClient,
  friendId: string,
): Promise<SharedResource[]> {
  const { data, error } = await supabase
    .from("shares")
    .select(
      "id, resource_type, resource_id, permission, owner_id, friend_id, created_at, owner:profiles!shares_owner_id_fkey(display_name)",
    )
    .eq("friend_id", friendId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`inbox failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    resource_type: ResourceType;
    resource_id: string;
    permission: string;
    owner_id: string;
    friend_id: string;
    created_at: string;
    owner: { display_name: string | null } | { display_name: string | null }[] | null;
  }>;
  return await Promise.all(rows.map(async (r) => {
    const owner = Array.isArray(r.owner) ? r.owner[0] : r.owner;
    return {
      id: r.id,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      permission: r.permission,
      owner_id: r.owner_id,
      friend_id: r.friend_id,
      owner_display_name: owner?.display_name ?? null,
      resource_title: await fetchTitle(supabase, r.resource_type, r.resource_id),
      created_at: r.created_at,
    };
  }));
}

// Outbox: resources I shared with others.
export async function outbox(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<SharedResource[]> {
  const { data, error } = await supabase
    .from("shares")
    .select(
      "id, resource_type, resource_id, permission, owner_id, friend_id, created_at, friend:profiles!shares_friend_id_fkey(display_name)",
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`outbox failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    resource_type: ResourceType;
    resource_id: string;
    permission: string;
    owner_id: string;
    friend_id: string;
    created_at: string;
    friend: { display_name: string | null } | { display_name: string | null }[] | null;
  }>;
  return await Promise.all(rows.map(async (r) => {
    const friend = Array.isArray(r.friend) ? r.friend[0] : r.friend;
    return {
      id: r.id,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      permission: r.permission,
      owner_id: r.owner_id,
      friend_id: r.friend_id,
      owner_display_name: friend?.display_name ?? null, // here this stores the friend (recipient)
      resource_title: await fetchTitle(supabase, r.resource_type, r.resource_id),
      created_at: r.created_at,
    };
  }));
}

async function fetchTitle(
  supabase: SupabaseClient,
  type: ResourceType,
  resourceId: string,
): Promise<string | null> {
  const meta = TYPE_TABLE[type];
  const { data } = await supabase
    .from(meta.table)
    .select(meta.titleColumn)
    .eq("id", resourceId)
    .maybeSingle();
  if (!data) return null;
  const raw = (data as unknown as Record<string, unknown>)[meta.titleColumn];
  if (typeof raw !== "string") return null;
  return raw.length > 60 ? raw.slice(0, 59) + "…" : raw;
}

// Authorization helper: can this user read this resource (own it or have it shared with them)?
export async function canAccess(
  supabase: SupabaseClient,
  userId: string,
  type: ResourceType,
  resourceId: string,
): Promise<boolean> {
  const meta = TYPE_TABLE[type];
  const { data: own } = await supabase
    .from(meta.table)
    .select("id")
    .eq("id", resourceId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (own) return true;
  const { data: shared } = await supabase
    .from("shares")
    .select("id")
    .eq("resource_type", type)
    .eq("resource_id", resourceId)
    .eq("friend_id", userId)
    .maybeSingle();
  return !!shared;
}
