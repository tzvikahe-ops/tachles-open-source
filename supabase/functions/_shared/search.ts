import type { SupabaseClient } from "@supabase/supabase-js";
import { type BubbleSummary, searchBubbles } from "./wellspring/memories.ts";
import type { TaskStatus } from "./bridge/tasks.ts";

// Unified search across the three surfaces the roadmap calls out: המעיין
// (bubbles) + הגשר's lists + tasks. Bubbles reuse the semantic/trigram search;
// list items and tasks use trigram-backed ilike. Each surface is owner-scoped.

export interface ListItemHit {
  id: string;
  content: string;
  is_done: boolean;
  list_name: string;
}

export interface TaskHit {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
}

export interface UnifiedResults {
  bubbles: BubbleSummary[];
  listItems: ListItemHit[];
  tasks: TaskHit[];
}

interface ListItemRow {
  id: string;
  content: string;
  is_done: boolean;
  lists: { name: string } | null;
}

function likeNeedle(query: string): string {
  return `%${query.replace(/[%_]/g, " ")}%`;
}

async function searchListItems(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  limit: number,
): Promise<ListItemHit[]> {
  const { data, error } = await supabase
    .from("list_items")
    .select("id, content, is_done, lists!inner(name, owner_id)")
    .eq("lists.owner_id", ownerId)
    .ilike("content", likeNeedle(query))
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<ListItemRow[]>();
  if (error) throw new Error(`searchListItems failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    content: r.content,
    is_done: r.is_done,
    list_name: r.lists?.name ?? "",
  }));
}

async function searchTasks(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  limit: number,
): Promise<TaskHit[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, priority")
    .eq("owner_id", ownerId)
    .ilike("title", likeNeedle(query))
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<TaskHit[]>();
  if (error) throw new Error(`searchTasks failed: ${error.message}`);
  return data ?? [];
}

export async function unifiedSearch(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  perKind = 5,
): Promise<UnifiedResults> {
  const [bubbles, listItems, tasks] = await Promise.all([
    searchBubbles(supabase, ownerId, query, perKind),
    searchListItems(supabase, ownerId, query, perKind),
    searchTasks(supabase, ownerId, query, perKind),
  ]);
  return { bubbles, listItems, tasks };
}
