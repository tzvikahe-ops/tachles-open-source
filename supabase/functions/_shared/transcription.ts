import { getFileLink } from "./telegram.ts";

// OpenAI's audio endpoint rejects files >25MB. Refuse with a clear error type
// so callers can render a Hebrew tip about splitting recordings.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export class AudioTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`audio too large: ${bytes} bytes`);
    this.name = "AudioTooLargeError";
    this.bytes = bytes;
  }
}

async function transcribeAudioBlob(blob: Blob, filename: string): Promise<string> {
  if (blob.size > MAX_AUDIO_BYTES) throw new AudioTooLargeError(blob.size);
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("Missing OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "gpt-4o-transcribe";

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", model);
  form.append("language", "he");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export function transcribeUploadedAudio(file: File): Promise<string> {
  return transcribeAudioBlob(file, file.name || "recording.webm");
}

// Speech-to-text for Telegram voice notes. Provider is swappable; the default is
// OpenAI (accepts Telegram's OGG/Opus directly, so no transcoding is needed).
// A self-hosted Hebrew model (e.g. ivrit.ai) can replace this behind the same call.
export async function transcribeVoice(fileId: string): Promise<string> {
  const link = await getFileLink(fileId);
  const audioRes = await fetch(link);
  if (!audioRes.ok) throw new Error(`download audio failed: ${audioRes.status}`);

  // Cheap pre-flight: refuse before consuming the body if the server advertised
  // a content-length over the cap.
  const advertised = Number(audioRes.headers.get("content-length") ?? "0");
  if (advertised > MAX_AUDIO_BYTES) {
    await audioRes.body?.cancel().catch(() => {});
    throw new AudioTooLargeError(advertised);
  }

  const blob = await audioRes.blob();
  return transcribeAudioBlob(blob, "voice.ogg");
}

// Split a dictated utterance into discrete list items on explicit separators
// (newlines, commas, semicolons). Conjunctions are left intact to avoid
// breaking Hebrew words that start with a prefixed letter.
export function splitDictation(text: string): string[] {
  return text
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
