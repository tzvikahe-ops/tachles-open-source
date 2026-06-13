import { assertEquals } from "jsr:@std/assert@1";
import { requireHeaderSecret } from "./request_auth.ts";

Deno.test("requireHeaderSecret fails closed when the server secret is missing", async () => {
  const response = requireHeaderSecret(undefined, "provided");

  assertEquals(response?.status, 500);
  assertEquals(await response?.text(), "server misconfigured");
});

Deno.test("requireHeaderSecret rejects a missing or incorrect request secret", () => {
  assertEquals(requireHeaderSecret("expected", null)?.status, 403);
  assertEquals(requireHeaderSecret("expected", "wrong")?.status, 403);
});

Deno.test("requireHeaderSecret accepts an exact match", () => {
  assertEquals(requireHeaderSecret("expected", "expected"), null);
});
