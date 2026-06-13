import type { SupabaseClient } from "@supabase/supabase-js";

export interface ListSummary {
  id: string;
  name: string;
  item_count: number;
}

export interface ListItem {
  id: string;
  content: string;
  is_done: boolean;
  position: number;
}

interface ListWithCountRow {
  id: string;
  name: string;
  list_items: { count: number }[];
}

interface ItemOwnerRow {
  id: string;
  is_done: boolean;
  list_id: string;
  lists: { owner_id: string };
}

export async function getOrCreateList(
  supabase: SupabaseClient,
  ownerId: string,
  name: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("lists")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", name)
    .eq("archived", false)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await supabase
    .from("lists")
    .insert({ owner_id: ownerId, name })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`getOrCreateList failed: ${error?.message ?? "no row returned"}`);
  }
  return data.id as string;
}

export async function getOwnedList(
  supabase: SupabaseClient,
  ownerId: string,
  listId: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from("lists")
    .select("id, name")
    .eq("id", listId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

export async function listLists(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<ListSummary[]> {
  const { data, error } = await supabase
    .from("lists")
    .select("id, name, list_items(count)")
    .eq("owner_id", ownerId)
    .eq("archived", false)
    .order("created_at", { ascending: true })
    .returns<ListWithCountRow[]>();
  if (error) throw new Error(`listLists failed: ${error.message}`);
  return (data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    item_count: l.list_items?.[0]?.count ?? 0,
  }));
}

export async function getListItems(
  supabase: SupabaseClient,
  listId: string,
): Promise<ListItem[]> {
  const { data, error } = await supabase
    .from("list_items")
    .select("id, content, is_done, position")
    .eq("list_id", listId)
    .order("position", { ascending: true })
    .returns<ListItem[]>();
  if (error) throw new Error(`getListItems failed: ${error.message}`);
  return data ?? [];
}

export async function addItems(
  supabase: SupabaseClient,
  listId: string,
  contents: string[],
  source: "text" | "voice",
): Promise<number> {
  if (contents.length === 0) return 0;

  const { data: last } = await supabase
    .from("list_items")
    .select("position")
    .eq("list_id", listId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  let pos = ((last?.position as number | undefined) ?? -1) + 1;
  const rows = contents.map((content) => ({ list_id: listId, content, position: pos++, source }));

  const { error } = await supabase.from("list_items").insert(rows);
  if (error) throw new Error(`addItems failed: ${error.message}`);
  return rows.length;
}

// Toggle done state; returns the parent list id, or null if not owned by ownerId.
export async function toggleItem(
  supabase: SupabaseClient,
  ownerId: string,
  itemId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("list_items")
    .select("id, is_done, list_id, lists!inner(owner_id)")
    .eq("id", itemId)
    .maybeSingle<ItemOwnerRow>();
  if (!data || data.lists?.owner_id !== ownerId) return null;

  await supabase.from("list_items").update({ is_done: !data.is_done }).eq("id", itemId);
  return data.list_id;
}

// Delete an item; returns the parent list id, or null if not owned by ownerId.
export async function deleteItem(
  supabase: SupabaseClient,
  ownerId: string,
  itemId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("list_items")
    .select("id, is_done, list_id, lists!inner(owner_id)")
    .eq("id", itemId)
    .maybeSingle<ItemOwnerRow>();
  if (!data || data.lists?.owner_id !== ownerId) return null;

  await supabase.from("list_items").delete().eq("id", itemId);
  return data.list_id;
}

export async function setActiveList(
  supabase: SupabaseClient,
  ownerId: string,
  listId: string,
): Promise<void> {
  await supabase.from("profiles").update({ active_list_id: listId }).eq("id", ownerId);
}
