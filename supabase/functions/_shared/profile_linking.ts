import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./profiles.ts";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const DEFAULT_TTL_MINUTES = 10;

export class ProfileLinkError extends Error {
  constructor(
    readonly code:
      | "misconfigured"
      | "invalid_or_expired"
      | "profile_has_data"
      | "already_linked"
      | "conflict"
      | "storage_failed",
    message: string,
  ) {
    super(message);
    this.name = "ProfileLinkError";
  }
}

export function generateLinkCode(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  if (bytes.length < CODE_LENGTH) {
    throw new Error(`generateLinkCode requires ${CODE_LENGTH} random bytes`);
  }
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeLinkCode(raw: string): string {
  return raw.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "");
}

export async function hashLinkCode(rawCode: string, secret: string): Promise<string> {
  const normalized = normalizeLinkCode(rawCode);
  if (normalized.length !== CODE_LENGTH) {
    throw new ProfileLinkError("invalid_or_expired", "invalid link code");
  }
  const bytes = new TextEncoder().encode(`${secret}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function linkSecret(): string {
  const secret = Deno.env.get("PROFILE_LINK_SECRET");
  if (!secret || secret.length < 32) {
    throw new ProfileLinkError(
      "misconfigured",
      "PROFILE_LINK_SECRET must contain at least 32 characters",
    );
  }
  return secret;
}

export interface CreatedProfileLinkCode {
  code: string;
  expiresAt: string;
}

export async function createProfileLinkCode(
  supabase: SupabaseClient,
  profileId: string,
  ttlMinutes = DEFAULT_TTL_MINUTES,
): Promise<CreatedProfileLinkCode> {
  const secret = linkSecret();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  await supabase
    .from("profile_link_codes")
    .delete()
    .eq("profile_id", profileId)
    .is("consumed_at", null);

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateLinkCode();
    const codeHash = await hashLinkCode(code, secret);
    const { error } = await supabase.from("profile_link_codes").insert({
      profile_id: profileId,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (!error) return { code, expiresAt };
    if (error.code !== "23505") {
      throw new ProfileLinkError("storage_failed", `link code insert failed: ${error.message}`);
    }
  }

  throw new ProfileLinkError("storage_failed", "could not allocate a unique link code");
}

export async function consumeProfileLinkCode(
  supabase: SupabaseClient,
  authSubject: string,
  rawCode: string,
): Promise<Profile> {
  const codeHash = await hashLinkCode(rawCode, linkSecret());
  const { data, error } = await supabase
    .rpc("consume_profile_link_code", {
      p_code_hash: codeHash,
      p_auth_subject: authSubject,
    })
    .single<Profile>();

  if (!error && data) return data;

  const message = error?.message ?? "profile link failed";
  if (message.includes("invalid_or_expired_link_code")) {
    throw new ProfileLinkError("invalid_or_expired", message);
  }
  if (message.includes("source_profile_has_data")) {
    throw new ProfileLinkError("profile_has_data", message);
  }
  if (message.includes("target_already_linked")) {
    throw new ProfileLinkError("already_linked", message);
  }
  throw new ProfileLinkError("conflict", message);
}
