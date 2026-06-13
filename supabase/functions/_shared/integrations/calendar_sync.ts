import type { SupabaseClient } from "@supabase/supabase-js";
import { getToken } from "./oauth.ts";
import {
  ensureFreshToken,
  type GoogleCalendarEvent,
  listCalendars,
  listEvents,
  normalizeEvent,
} from "./google.ts";

// Syncs Google Calendar events for a single owner into our calendar_events
// table. Window: today minus 1 day .. today plus 14 days (covers daily summary
// + "this week" queries with a safety margin).

const WINDOW_BACK_DAYS = 1;
const WINDOW_FORWARD_DAYS = 14;

export interface SyncResult {
  upserted: number;
  removed: number;
  calendars: number;
}

export async function syncGoogleCalendar(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<SyncResult> {
  const stored = await getToken(supabase, ownerId, "google");
  if (!stored) throw new Error("Google not connected");
  const token = await ensureFreshToken(supabase, ownerId, stored);

  const now = new Date();
  const fromIso = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000).toISOString();
  const toIso = new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000).toISOString();

  const calendars = await listCalendars(token);
  const seenIds = new Set<string>();
  let upserted = 0;

  for (const cal of calendars) {
    const events = await listEvents(token, cal.id, fromIso, toIso);
    const rows = events
      .map((e) => normalizeEvent(e, cal.id))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({ ...r, owner_id: ownerId, provider: "google", synced_at: now.toISOString() }));
    if (rows.length === 0) continue;
    const { error } = await supabase.from("calendar_events").upsert(
      rows,
      { onConflict: "owner_id,provider,external_id" },
    );
    if (error) throw new Error(`upsert calendar_events failed: ${error.message}`);
    upserted += rows.length;
    for (const r of rows) seenIds.add(r.external_id);
  }

  // Remove rows in the window that we no longer saw (deleted upstream).
  const { data: existing } = await supabase
    .from("calendar_events")
    .select("external_id")
    .eq("owner_id", ownerId)
    .eq("provider", "google")
    .gte("start_at", fromIso)
    .lte("start_at", toIso)
    .returns<{ external_id: string }[]>();
  const toRemove = (existing ?? []).filter((r) => !seenIds.has(r.external_id));
  if (toRemove.length > 0) {
    await supabase
      .from("calendar_events")
      .delete()
      .eq("owner_id", ownerId)
      .eq("provider", "google")
      .in("external_id", toRemove.map((r) => r.external_id));
  }

  return { upserted, removed: toRemove.length, calendars: calendars.length };
}

export interface StoredEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  google_etag: string | null;
  google_updated_at: string | null;
  html_link: string | null;
}

export async function listOwnerEventsBetween(
  supabase: SupabaseClient,
  ownerId: string,
  fromIso: string,
  toIso: string,
): Promise<StoredEvent[]> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, start_at, end_at, all_day, google_etag, google_updated_at, html_link",
    )
    .eq("owner_id", ownerId)
    .lt("start_at", toIso)
    .gt("end_at", fromIso)
    .order("start_at", { ascending: true })
    .returns<StoredEvent[]>();
  if (error) throw new Error(`listOwnerEventsBetween failed: ${error.message}`);
  return data ?? [];
}

// A stored event plus the identifiers needed to act on it upstream.
export interface OwnedEvent extends StoredEvent {
  provider: string;
  calendar_id: string;
  external_id: string;
}

export async function getOwnedEvent(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
): Promise<OwnedEvent | null> {
  const { data } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, start_at, end_at, all_day, google_etag, google_updated_at, html_link, provider, calendar_id, external_id",
    )
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle<OwnedEvent>();
  return data ?? null;
}

export async function upsertLocalGoogleEvent(
  supabase: SupabaseClient,
  ownerId: string,
  calendarId: string,
  event: GoogleCalendarEvent,
): Promise<OwnedEvent> {
  const normalized = normalizeEvent(event, calendarId);
  if (!normalized) throw new Error("Google event is missing start or end");
  const { data, error } = await supabase
    .from("calendar_events")
    .upsert({
      ...normalized,
      owner_id: ownerId,
      provider: "google",
      synced_at: new Date().toISOString(),
    }, { onConflict: "owner_id,provider,external_id" })
    .select(
      "id, title, description, location, start_at, end_at, all_day, google_etag, google_updated_at, html_link, provider, calendar_id, external_id",
    )
    .single<OwnedEvent>();
  if (error || !data) {
    throw new Error(`upsertLocalGoogleEvent failed: ${error?.message ?? "no row returned"}`);
  }
  return data;
}

// Mirror an upstream edit/delete onto our cached row so /events and /today stay
// in sync without waiting for the next half-hourly sync.
export async function updateLocalEventTimes(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  await supabase
    .from("calendar_events")
    .update({ start_at: startIso, end_at: endIso, synced_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", ownerId);
}

export async function deleteLocalEvent(
  supabase: SupabaseClient,
  ownerId: string,
  id: string,
): Promise<void> {
  await supabase.from("calendar_events").delete().eq("id", id).eq("owner_id", ownerId);
}
