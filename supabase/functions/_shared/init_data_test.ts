import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyInitData } from "./init_data.ts";

const BOT_TOKEN = "123456:TEST_TOKEN_abcDEF";
const encoder = new TextEncoder();

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  msg: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, encoder.encode(msg)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Independently sign a field map into an initData query string (mirrors the
// Telegram spec, separate from the production implementation under test).
async function signInitData(
  fields: Record<string, string>,
  token: string,
): Promise<string> {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = await hmac(encoder.encode("WebAppData"), token);
  const hash = hex(await hmac(secret, dcs));
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

function freshFields(): Record<string, string> {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAEtest",
    user: JSON.stringify({ id: 42, first_name: "צביקה", username: "tzvika" }),
  };
}

Deno.test("verifyInitData accepts a correctly signed payload", async () => {
  const initData = await signInitData(freshFields(), BOT_TOKEN);
  const res = await verifyInitData(initData, BOT_TOKEN);
  assertEquals(res.valid, true);
  assertEquals(res.user?.id, 42);
  assertEquals(res.user?.username, "tzvika");
});

Deno.test("verifyInitData rejects a tampered field", async () => {
  const fields = freshFields();
  const initData = await signInitData(fields, BOT_TOKEN);
  // Swap the user id after signing — the hash no longer matches.
  const tampered = initData.replace(
    encodeURIComponent(JSON.stringify({ id: 42, first_name: "צביקה", username: "tzvika" })),
    encodeURIComponent(JSON.stringify({ id: 99, first_name: "צביקה", username: "tzvika" })),
  );
  const res = await verifyInitData(tampered, BOT_TOKEN);
  assertEquals(res.valid, false);
  assertEquals(res.reason, "bad hash");
});

Deno.test("verifyInitData rejects a stale auth_date", async () => {
  const fields = freshFields();
  fields.auth_date = String(Math.floor(Date.now() / 1000) - 90_000); // > 24h old
  const initData = await signInitData(fields, BOT_TOKEN);
  const res = await verifyInitData(initData, BOT_TOKEN);
  assertEquals(res.valid, false);
  assertEquals(res.reason, "expired");
});

Deno.test("verifyInitData rejects a wrong bot token", async () => {
  const initData = await signInitData(freshFields(), BOT_TOKEN);
  const res = await verifyInitData(initData, "999999:OTHER_TOKEN");
  assertEquals(res.valid, false);
  assertEquals(res.reason, "bad hash");
});

Deno.test("verifyInitData rejects missing hash", async () => {
  const res = await verifyInitData("auth_date=123&user=%7B%7D", BOT_TOKEN);
  assertEquals(res.valid, false);
  assertEquals(res.reason, "missing hash");
});
