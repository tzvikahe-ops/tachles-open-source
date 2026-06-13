import type { SupabaseClient } from "@supabase/supabase-js";

export type CaptureSource = "manual" | "web_share" | "telegram";
export type CaptureStatus = "inbox" | "processed" | "dismissed";

export interface Capture {
  id: string;
  project_id: string | null;
  source: CaptureSource;
  title: string | null;
  text: string | null;
  url: string | null;
  status: CaptureStatus;
  created_at: string;
  processed_at: string | null;
}

const SELECT = "id, project_id, source, title, text, url, status, created_at, processed_at";

export async function createCapture(
  supabase: SupabaseClient,
  ownerId: string,
  input: {
    source?: CaptureSource;
    projectId?: string | null;
    title?: string | null;
    text?: string | null;
    url?: string | null;
  },
): Promise<Capture> {
  const title = input.title?.trim() || null;
  const text = input.text?.trim() || null;
  const url = input.url?.trim() || null;
  if (!title && !text && !url) throw new Error("capture content is required");
  const { data, error } = await supabase
    .from("captures")
    .insert({
      owner_id: ownerId,
      project_id: input.projectId ?? null,
      source: input.source ?? "manual",
      title,
      text,
      url,
    })
    .select(SELECT)
    .single<Capture>();
  if (error || !data) {
    throw new Error(`createCapture failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

export async function listCaptures(
  supabase: SupabaseClient,
  ownerId: string,
  status: CaptureStatus = "inbox",
): Promise<Capture[]> {
  const { data, error } = await supabase
    .from("captures")
    .select(SELECT)
    .eq("owner_id", ownerId)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .returns<Capture[]>();
  if (error) throw new Error(`listCaptures failed: ${error.message}`);
  return data ?? [];
}

export async function setCaptureStatus(
  supabase: SupabaseClient,
  ownerId: string,
  captureId: string,
  status: CaptureStatus,
): Promise<Capture | null> {
  const { data, error } = await supabase
    .from("captures")
    .update({
      status,
      processed_at: status === "inbox" ? null : new Date().toISOString(),
    })
    .eq("owner_id", ownerId)
    .eq("id", captureId)
    .select(SELECT)
    .maybeSingle<Capture>();
  if (error) throw new Error(`setCaptureStatus failed: ${error.message}`);
  return data ?? null;
}
