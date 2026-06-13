import { assertEquals } from "jsr:@std/assert@1";
import { parseAllowedEmails } from "./web_access.ts";

Deno.test("parseAllowedEmails normalizes and removes empty entries", () => {
  assertEquals(
    [...parseAllowedEmails(" Owner@Example.com, friend@example.com, ")],
    ["owner@example.com", "friend@example.com"],
  );
});

Deno.test("parseAllowedEmails leaves self-hosted installs open by default", () => {
  assertEquals(parseAllowedEmails(undefined).size, 0);
});
