import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureFreshToken } from "./google.ts";
import { getToken } from "./oauth.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  size?: string;
}

interface DriveListResponse {
  files?: DriveFile[];
}

export async function searchDrive(
  supabase: SupabaseClient,
  ownerId: string,
  query: string,
  limit = 10,
): Promise<DriveFile[]> {
  const stored = await getToken(supabase, ownerId, "google");
  if (!stored) throw new Error("Google not connected");
  const token = await ensureFreshToken(supabase, ownerId, stored);
  // Drive's "fullText contains" needs single-quoted string and quote-escaping.
  const safe = query.replace(/['"\\]/g, " ");
  const q = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
  const params = new URLSearchParams({
    q,
    pageSize: String(limit),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok) throw new Error(`Drive search ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as DriveListResponse;
  return data.files ?? [];
}

export function mimeEmoji(mimeType: string): string {
  if (mimeType.includes("folder")) return "📁";
  if (mimeType.includes("document")) return "📄";
  if (mimeType.includes("spreadsheet")) return "📊";
  if (mimeType.includes("presentation")) return "🖼️";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📕";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  return "📎";
}
