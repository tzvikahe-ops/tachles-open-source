import type { SupabaseClient } from "@supabase/supabase-js";
import { embed } from "../integrations/embeddings.ts";

// המעיין / Wellspring — the memory layer. Bubbles capture knowledge, inspiration
// and reflections. Search runs semantic (pgvector via match_bubbles RPC) when
// an OPENAI_API_KEY is configured; falls back to trigram/ilike otherwise.

export type BubbleType = "knowledge" | "inspiration" | "reflection";

export interface BubbleSummary {
  id: string;
  type: BubbleType;
  title: string | null;
  content: string;
  tags: string[];
  source_url: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

const SELECT = "id, type, title, content, tags, source_url, pinned, created_at, updated_at";

export interface CreateBubbleInput {
  ownerId: string;
  content: string;
  type?: BubbleType;
  title?: string | null;
  tags?: string[];
  sourceUrl?: string | null;
}

export async function createBubble(
  supabase: SupabaseClient,
  input: CreateBubbleInput,
): Promise<BubbleSummary> {
  const embedding = await embed(input.content);
  const insertRow: Record<string, unknown> = {
    owner_id: input.ownerId,
    content: input.content,
    type: input.type ?? "knowledge",
    title: input.title ?? null,
    tags: input.tags ?? [],
    source_url: input.sourceUrl ?? null,
  };
  if (embedding) insertRow.embedding = embedding;
  const { data, error } = await supabase
    .from("memory_bubbles")
    .insert(insertRow)
    .select(SELECT)
    .single();
  if (error || !data) {
    throw new Error(
      `createBubble failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return data as BubbleSummary;
}

export async function getOwnedBubble(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
): Promise<BubbleSummary | null> {
  const { data } = await supabase
    .from("memory_bubbles")
    .select(SELECT)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle<BubbleSummary>();
  return data ?? null;
}

export async function setBubbleType(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
  type: BubbleType,
): Promise<BubbleSummary | null> {
  const { data } = await supabase
    .from("memory_bubbles")
    .update({ type })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select(SELECT)
    .maybeSingle<BubbleSummary>();
  return data ?? null;
}

export interface UpdateBubbleInput {
  title?: string | null;
  content?: string;
  type?: BubbleType;
  tags?: string[];
  sourceUrl?: string | null;
}

export async function updateBubble(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
  patch: UpdateBubbleInput,
): Promise<BubbleSummary | null> {
  const updateRow: Record<string, unknown> = {};
  if (patch.title !== undefined) updateRow.title = patch.title;
  if (patch.content !== undefined) {
    updateRow.content = patch.content;
    updateRow.embedding = await embed(patch.content);
  }
  if (patch.type !== undefined) updateRow.type = patch.type;
  if (patch.tags !== undefined) updateRow.tags = patch.tags;
  if (patch.sourceUrl !== undefined) updateRow.source_url = patch.sourceUrl;
  if (Object.keys(updateRow).length === 0) {
    return getOwnedBubble(supabase, ownerId, id);
  }
  const { data, error } = await supabase
    .from("memory_bubbles")
    .update(updateRow)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select(SELECT)
    .maybeSingle<BubbleSummary>();
  if (error) throw new Error(`updateBubble failed: ${error.message}`);
  return data ?? null;
}

export async function deleteBubble(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("memory_bubbles")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  return data !== null;
}

export async function listRecentBubbles(
  supabase: SupabaseClient,
  ownerId: string,
  limit = 20,
  type?: BubbleType,
): Promise<BubbleSummary[]> {
  let q = supabase
    .from("memory_bubbles")
    .select(SELECT)
    .eq("owner_id", ownerId);
  if (type) q = q.eq("type", type);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<BubbleSummary[]>();
  if (error) throw new Error(`listRecentBubbles failed: ${error.message}`);
  return data ?? [];
}

export async function searchBubbles(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  limit = 20,
): Promise<BubbleSummary[]> {
  const queryEmbedding = await embed(query);
  if (queryEmbedding) {
    const { data, error } = await supabase.rpc("match_bubbles", {
      query_embedding: queryEmbedding,
      owner: ownerId,
      match_count: limit,
      similarity_threshold: 0.25,
    });
    if (!error && data) {
      const ids = (data as Array<{ id: string }>).map((bubble) => bubble.id);
      if (ids.length === 0) return [];
      const { data: full, error: fullError } = await supabase
        .from("memory_bubbles")
        .select(SELECT)
        .eq("owner_id", ownerId)
        .in("id", ids)
        .returns<BubbleSummary[]>();
      if (!fullError && full) {
        const order = new Map(ids.map((id, index) => [id, index]));
        return full.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      }
    }
    if (error) {
      console.error(
        "match_bubbles RPC failed, falling back to ilike:",
        error.message,
      );
    }
  }
  const needle = `%${query.replace(/[%_]/g, " ")}%`;
  const { data, error } = await supabase
    .from("memory_bubbles")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .ilike("content", needle)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<BubbleSummary[]>();
  if (error) throw new Error(`searchBubbles failed: ${error.message}`);
  return data ?? [];
}

// Pinned bubbles surface on /board and feed into the Chief of Staff context.
// Capped to 10 per user to keep prompts cheap; older pins must be unpinned
// before a new pin succeeds (enforced in setPinned).

export async function setPinned(
  supabase: SupabaseClient,
  ownerId: string,
  bubbleId: string,
  pinned: boolean,
): Promise<boolean> {
  if (pinned) {
    const { count } = await supabase
      .from("memory_bubbles")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("pinned", true);
    if ((count ?? 0) >= 10) return false;
  }
  const { data } = await supabase
    .from("memory_bubbles")
    .update({ pinned })
    .eq("id", bubbleId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  return data !== null;
}

export async function listPinnedBubbles(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<BubbleSummary[]> {
  const { data, error } = await supabase
    .from("memory_bubbles")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .eq("pinned", true)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<BubbleSummary[]>();
  if (error) throw new Error(`listPinnedBubbles failed: ${error.message}`);
  return data ?? [];
}

// Pure helpers (unit-tested) used when capturing free text into a bubble.

export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

export function extractTags(text: string): string[] {
  const matches = [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);
  return [...new Set(matches)];
}
