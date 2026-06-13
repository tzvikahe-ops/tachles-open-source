import { AudioTooLargeError, transcribeUploadedAudio } from "./transcription.ts";
import { assertRejects } from "jsr:@std/assert@1";

Deno.test("transcribeUploadedAudio rejects oversized recordings before provider access", async () => {
  const oversized = new File(
    [new Uint8Array(24 * 1024 * 1024 + 1)],
    "recording.webm",
    { type: "audio/webm" },
  );

  await assertRejects(
    () => transcribeUploadedAudio(oversized),
    AudioTooLargeError,
  );
});
