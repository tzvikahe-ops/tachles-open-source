import type { SupabaseClient } from "@supabase/supabase-js";
import { type StoredToken, upsertToken } from "./oauth.ts";

// Google OAuth + Calendar API client. Tokens are refreshed on demand and
// re-stored. Scopes are minimal: read-only calendar by default.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  // Full read/write of calendar events (not calendar lifecycle / ACL — those
  // require the broader "calendar" scope which we deliberately avoid).
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
];

export const GOOGLE_DRIVE_SCOPES = [
  // .file = read+write of files our app created (used for Obsidian export).
  "https://www.googleapis.com/auth/drive.file",
  // .readonly = read all files (used for /drive search across the user's vault).
  "https://www.googleapis.com/auth/drive.readonly",
];

function clientId(): string {
  const v = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!v) throw new Error("Missing GOOGLE_CLIENT_ID");
  return v;
}

function clientSecret(): string {
  const v = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!v) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  return v;
}

function redirectUri(): string {
  const v = Deno.env.get("OAUTH_REDIRECT_URI");
  if (!v) throw new Error("Missing OAUTH_REDIRECT_URI");
  return v;
}

export function buildAuthorizeUrl(state: string, scopes: string[]): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

function tokenFromResponse(
  data: GoogleTokenResponse,
  fallbackRefresh: string | null,
): StoredToken {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? fallbackRefresh,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scopes: data.scope ? data.scope.split(/\s+/) : [],
  };
}

export async function exchangeCode(code: string): Promise<StoredToken> {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as GoogleTokenResponse;
  return tokenFromResponse(data, null);
}

export async function refreshAccessToken(refreshToken: string): Promise<StoredToken> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as GoogleTokenResponse;
  return tokenFromResponse(data, refreshToken);
}

export async function ensureFreshToken(
  supabase: SupabaseClient,
  ownerId: string,
  current: StoredToken,
): Promise<StoredToken> {
  const expiresAt = new Date(current.expires_at).getTime();
  // Refresh 60s before actual expiry to absorb clock skew.
  if (expiresAt - Date.now() > 60_000) return current;
  if (!current.refresh_token) {
    throw new Error("Token expired and no refresh_token available — user must reconnect.");
  }
  const refreshed = await refreshAccessToken(current.refresh_token);
  if (refreshed.scopes.length === 0) refreshed.scopes = current.scopes;
  await upsertToken(supabase, ownerId, "google", refreshed);
  return refreshed;
}

export interface GoogleCalendarEvent {
  id: string;
  etag?: string;
  updated?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
}

export interface CalendarListEntry {
  id: string;
  primary?: boolean;
  summary: string;
}

export async function listCalendars(token: StoredToken): Promise<CalendarListEntry[]> {
  const res = await fetch(`${CALENDAR_API}/users/me/calendarList`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok) throw new Error(`listCalendars failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items?: CalendarListEntry[] };
  return data.items ?? [];
}

export async function listEvents(
  token: StoredToken,
  calendarId: string,
  fromIso: string,
  toIso: string,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: fromIso,
    timeMax: toIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok) throw new Error(`listEvents failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items?: GoogleCalendarEvent[] };
  return data.items ?? [];
}

export async function getEvent(
  token: StoredToken,
  calendarId: string,
  eventId: string,
): Promise<GoogleCalendarEvent | null> {
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${
    encodeURIComponent(eventId)
  }`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`getEvent failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleCalendarEvent;
}

export interface CreateEventInput {
  calendarId?: string; // defaults to "primary"
  title: string;
  description?: string | null;
  location?: string | null;
  startIso: string; // ISO 8601 with offset, e.g. 2026-05-27T09:00:00+03:00
  endIso: string; // ISO 8601 with offset
  allDay?: boolean;
  timezone?: string; // IANA, e.g. Asia/Jerusalem
}

export async function createEvent(
  token: StoredToken,
  input: CreateEventInput,
): Promise<GoogleCalendarEvent> {
  const calId = input.calendarId ?? "primary";
  const start = input.allDay
    ? { date: input.startIso.slice(0, 10) }
    : { dateTime: input.startIso, timeZone: input.timezone };
  const end = input.allDay
    ? { date: input.endIso.slice(0, 10) }
    : { dateTime: input.endIso, timeZone: input.timezone };
  const body = {
    summary: input.title,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start,
    end,
  };
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createEvent failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleCalendarEvent;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  startIso?: string;
  endIso?: string;
  allDay?: boolean;
  timezone?: string;
}

// PATCH only the supplied fields (Google merges the rest). start/end must be
// sent together with the same shape (timed vs all-day) to stay consistent.
export async function updateEvent(
  token: StoredToken,
  calendarId: string,
  eventId: string,
  patch: UpdateEventInput,
): Promise<GoogleCalendarEvent> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.description !== undefined) body.description = patch.description ?? null;
  if (patch.location !== undefined) body.location = patch.location ?? null;
  if (patch.startIso !== undefined) {
    body.start = patch.allDay
      ? { date: patch.startIso.slice(0, 10) }
      : { dateTime: patch.startIso, timeZone: patch.timezone };
  }
  if (patch.endIso !== undefined) {
    body.end = patch.allDay
      ? { date: patch.endIso.slice(0, 10) }
      : { dateTime: patch.endIso, timeZone: patch.timezone };
  }
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${
    encodeURIComponent(eventId)
  }`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`updateEvent failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleCalendarEvent;
}

// Delete an event. 404/410 mean it's already gone upstream — treat as success
// so the local row gets cleaned up either way.
export async function deleteEvent(
  token: StoredToken,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${
    encodeURIComponent(eventId)
  }`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`deleteEvent failed: ${res.status} ${await res.text()}`);
  }
}

// Normalizes a Google event into our calendar_events row shape (without owner_id/provider).
export function normalizeEvent(
  e: GoogleCalendarEvent,
  calendarId: string,
): {
  external_id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  status: string;
  google_etag: string | null;
  google_updated_at: string | null;
  html_link: string | null;
} | null {
  const startIso = e.start.dateTime ?? (e.start.date ? `${e.start.date}T00:00:00Z` : null);
  const endIso = e.end.dateTime ?? (e.end.date ? `${e.end.date}T00:00:00Z` : null);
  if (!startIso || !endIso) return null;
  return {
    external_id: e.id,
    calendar_id: calendarId,
    title: e.summary ?? "(ללא כותרת)",
    description: e.description ?? null,
    location: e.location ?? null,
    start_at: startIso,
    end_at: endIso,
    all_day: !e.start.dateTime,
    status: e.status ?? "confirmed",
    google_etag: e.etag ?? null,
    google_updated_at: e.updated ?? null,
    html_link: e.htmlLink ?? null,
  };
}
