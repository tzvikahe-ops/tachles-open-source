import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  generateLinkCode,
  hashLinkCode,
  normalizeLinkCode,
  ProfileLinkError,
} from "./profile_linking.ts";

Deno.test("generateLinkCode creates an unambiguous grouped code", () => {
  const code = generateLinkCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
  assertEquals(code, "2345-6789");
});

Deno.test("normalizeLinkCode tolerates spaces and lowercase", () => {
  assertEquals(normalizeLinkCode(" 2a4b - 6c8d "), "2A4B6C8D");
});

Deno.test("hashLinkCode is stable after normalization", async () => {
  const a = await hashLinkCode("2A4B-6C8D", "x".repeat(32));
  const b = await hashLinkCode("2a4b 6c8d", "x".repeat(32));
  assertEquals(a, b);
});

Deno.test("hashLinkCode rejects malformed codes", async () => {
  await assertRejects(
    () => hashLinkCode("short", "x".repeat(32)),
    ProfileLinkError,
    "invalid link code",
  );
});
