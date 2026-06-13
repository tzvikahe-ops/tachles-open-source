import type { SupabaseClient } from "@supabase/supabase-js";
import { getFileLink } from "../telegram.ts";
import { ocrImage, summarizePdf } from "../integrations/claude_vision.ts";
import { embed } from "../integrations/embeddings.ts";
import { type BubbleSummary, type BubbleType, createBubble } from "./memories.ts";

// End-to-end flow: Telegram media → storage upload → file row → bubble row
// (with OCR / summary content + embedding). Returns the saved bubble plus its
// attached file row id. Caller is responsible for sending a confirmation.

const BUCKET = "memory-trunk";

export interface CapturedFile {
  bubble: BubbleSummary;
  fileId: string;
  filename: string;
  mimeType: string;
}

interface DownloadResult {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

async function downloadFromTelegram(
  telegramFileId: string,
  fallbackName: string,
  fallbackMime: string,
): Promise<DownloadResult> {
  const url = await getFileLink(telegramFileId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Telegram file download ${res.status}: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") ?? fallbackMime;
  const path = new URL(url).pathname; // e.g. /file/bot.../photos/file_42.jpg
  const filename = path.split("/").pop() || fallbackName;
  return { bytes: buf, mimeType: mime, filename };
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function storeBytes(
  supabase: SupabaseClient,
  ownerId: string,
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ fileRowId: string; storagePath: string }> {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "bin";
  const storagePath = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const { data, error } = await supabase
    .from("files")
    .insert({
      owner_id: ownerId,
      bucket: BUCKET,
      storage_path: storagePath,
      filename,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    // Best-effort cleanup so we don't leak storage on a DB failure.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`files insert failed: ${error?.message ?? "no row"}`);
  }
  return { fileRowId: data.id, storagePath };
}

export interface CaptureInput {
  ownerId: string;
  telegramFileId: string;
  caption: string | null;
  kind: "photo" | "document";
  declaredMimeType?: string | null;
  declaredFilename?: string | null;
}

export interface UploadedCaptureInput {
  ownerId: string;
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  caption?: string | null;
}

function deriveBubbleType(_mimeType: string): BubbleType {
  // Default everything to "knowledge"; user can re-classify with the buttons.
  return "knowledge";
}

async function captureBytesToBubble(
  supabase: SupabaseClient,
  input: UploadedCaptureInput,
): Promise<CapturedFile> {
  const { bytes, mimeType, filename } = input;
  const { fileRowId } = await storeBytes(supabase, input.ownerId, filename, mimeType, bytes);

  let extracted = "";
  try {
    if (mimeType.startsWith("image/")) {
      extracted = await ocrImage(base64FromBytes(bytes), mimeType);
    } else if (mimeType === "application/pdf") {
      extracted = await summarizePdf(base64FromBytes(bytes));
    }
  } catch (err) {
    console.error("vision extraction failed (continuing with caption only):", err);
  }

  const parts = [input.caption?.trim(), extracted?.trim()].filter(Boolean) as string[];
  const content = parts.length > 0 ? parts.join("\n\n") : filename;

  const embedding = await embed(content);

  const bubble = await createBubble(supabase, {
    ownerId: input.ownerId,
    content,
    type: deriveBubbleType(mimeType),
    tags: [],
    sourceUrl: null,
  });

  // Patch in the file link + embedding (createBubble doesn't take these yet).
  const patch: Record<string, unknown> = { attached_file_id: fileRowId };
  if (embedding) patch.embedding = embedding;
  const { error: updErr } = await supabase
    .from("memory_bubbles")
    .update(patch)
    .eq("id", bubble.id);
  if (updErr) console.error("bubble post-update failed:", updErr);

  return { bubble, fileId: fileRowId, filename, mimeType };
}

export function captureUploadedFileToBubble(
  supabase: SupabaseClient,
  input: UploadedCaptureInput,
): Promise<CapturedFile> {
  return captureBytesToBubble(supabase, input);
}

export async function captureFileToBubble(
  supabase: SupabaseClient,
  input: CaptureInput,
): Promise<CapturedFile> {
  const dl = await downloadFromTelegram(
    input.telegramFileId,
    input.declaredFilename ?? "file",
    input.declaredMimeType ?? "application/octet-stream",
  );
  return captureBytesToBubble(supabase, {
    ownerId: input.ownerId,
    bytes: dl.bytes,
    mimeType: input.declaredMimeType ?? dl.mimeType,
    filename: input.declaredFilename ?? dl.filename,
    caption: input.caption,
  });
}
