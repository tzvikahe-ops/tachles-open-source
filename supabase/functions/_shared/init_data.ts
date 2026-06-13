// Verification of Telegram Mini App `initData` (the signed query string Telegram
// hands the webview). The Mini App sends it on every request via the
// `X-Telegram-InitData` header; `api/` verifies it instead of a Supabase JWT.
//
// Algorithm (per Telegram's "Validating data received via the Mini App"):
//   data_check_string = all fields except `hash`, sorted by key, joined "key=value\n"
//   secret_key        = HMAC_SHA256(key="WebAppData", msg=bot_token)
//   expected_hash     = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
// then compare expected_hash to the received `hash`, and reject stale auth_date.

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface VerifiedInitData {
  valid: boolean;
  user?: InitDataUser;
  auth_date?: number;
  reason?: string;
}

const encoder = new TextEncoder();

async function hmacSha256(
  key: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string compare to avoid leaking the hash via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): Promise<VerifiedInitData> {
  if (!initData) return { valid: false, reason: "missing init data" };
  if (!botToken) return { valid: false, reason: "missing bot token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { valid: false, reason: "missing hash" };

  // Build the data-check-string from every field except `hash`, sorted by key.
  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(encoder.encode("WebAppData"), botToken);
  const expectedHash = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!timingSafeEqual(expectedHash, hash.toLowerCase())) {
    return { valid: false, reason: "bad hash" };
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) {
    return { valid: false, reason: "missing auth_date" };
  }
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds) {
    return { valid: false, reason: "expired", auth_date: authDate };
  }

  let user: InitDataUser | undefined;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as InitDataUser;
    } catch {
      return { valid: false, reason: "bad user json", auth_date: authDate };
    }
  }

  return { valid: true, user, auth_date: authDate };
}
