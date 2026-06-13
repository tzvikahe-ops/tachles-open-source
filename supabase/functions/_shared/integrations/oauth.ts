import type { SupabaseClient } from "@supabase/supabase-js";

// Shared helpers for the OAuth dance and token storage. Token rows live in the
// `integration_tokens` table (created in 0001); short-lived state rows live in
// `oauth_states` (created in 0005).

export type Provider = "google" | "microsoft";

export interface StoredToken {
  access_token: string;
  refresh_token: string | null;
  expires_at: string; // ISO 8601
  scopes: string[];
}

export function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createOAuthState(
  supabase: SupabaseClient,
  ownerId: string,
  provider: Provider,
  chatId: number | null,
  scopes: string[],
  returnUrl: string | null = null,
  intent: "calendar" | "obsidian" | null = null,
): Promise<string> {
  const state = generateState();
  const { error } = await supabase.from("oauth_states").insert({
    state,
    owner_id: ownerId,
    provider,
    chat_id: chatId,
    scopes,
    return_url: returnUrl,
    intent,
  });
  if (error) throw new Error(`createOAuthState failed: ${error.message}`);
  return state;
}

export interface ConsumedState {
  owner_id: string;
  provider: Provider;
  chat_id: number | null;
  scopes: string[];
  return_url: string | null;
  intent: "calendar" | "obsidian" | null;
}

export async function consumeOAuthState(
  supabase: SupabaseClient,
  state: string,
): Promise<ConsumedState | null> {
  const { data } = await supabase
    .from("oauth_states")
    .delete()
    .eq("state", state)
    .gt("expires_at", new Date().toISOString())
    .select("owner_id, provider, chat_id, scopes, return_url, intent")
    .maybeSingle<ConsumedState>();
  return data ?? null;
}

export async function upsertToken(
  supabase: SupabaseClient,
  ownerId: string,
  provider: Provider,
  token: StoredToken,
): Promise<void> {
  const { error } = await supabase.from("integration_tokens").upsert({
    owner_id: ownerId,
    provider,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: token.expires_at,
    scopes: token.scopes,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id,provider" });
  if (error) throw new Error(`upsertToken failed: ${error.message}`);
}

export async function getToken(
  supabase: SupabaseClient,
  ownerId: string,
  provider: Provider,
): Promise<StoredToken | null> {
  const { data } = await supabase
    .from("integration_tokens")
    .select("access_token, refresh_token, expires_at, scopes")
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .maybeSingle<StoredToken>();
  return data ?? null;
}

export async function deleteToken(
  supabase: SupabaseClient,
  ownerId: string,
  provider: Provider,
): Promise<boolean> {
  const { data } = await supabase
    .from("integration_tokens")
    .delete()
    .eq("owner_id", ownerId)
    .eq("provider", provider)
    .select("id")
    .maybeSingle();
  return data !== null;
}

// Listing all owners with a particular provider connected — used by sync jobs.
export async function listOwnersWithProvider(
  supabase: SupabaseClient,
  provider: Provider,
): Promise<{ owner_id: string }[]> {
  const { data, error } = await supabase
    .from("integration_tokens")
    .select("owner_id")
    .eq("provider", provider)
    .returns<{ owner_id: string }[]>();
  if (error) throw new Error(`listOwnersWithProvider failed: ${error.message}`);
  return data ?? [];
}
