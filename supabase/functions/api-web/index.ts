import { createServiceClient } from "../_shared/supabase.ts";
import { getOrCreateProfileFromAuth, type Profile } from "../_shared/profiles.ts";
import { consumeProfileLinkCode, ProfileLinkError } from "../_shared/profile_linking.ts";
import {
  addProjectResource,
  createProject,
  getOwnedProject,
  listProjectResources,
  listProjects,
  updateProject,
} from "../_shared/bridge/projects.ts";
import { createTask, listProjectTasks, listTopTasks, updateTask } from "../_shared/bridge/tasks.ts";
import {
  type CaptureStatus,
  createCapture,
  listCaptures,
  setCaptureStatus,
} from "../_shared/bridge/captures.ts";
import { cancelReminder, listActiveReminders } from "../_shared/bridge/reminders.ts";
import { planTasks } from "../_shared/bridge/planner.ts";
import {
  approveProjectPlan,
  generateProjectPlan,
  saveProjectPlanProposal,
} from "../_shared/bridge/project_plans.ts";
import {
  deleteLocalEvent,
  getOwnedEvent,
  listOwnerEventsBetween,
  syncGoogleCalendar,
  upsertLocalGoogleEvent,
} from "../_shared/integrations/calendar_sync.ts";
import { researchWeb } from "../_shared/integrations/web_research.ts";
import {
  deleteBubbleExport,
  disableObsidian,
  enableObsidian,
  fullResync,
  syncBubble,
} from "../_shared/integrations/obsidian.ts";
import {
  buildAuthorizeUrl,
  createEvent,
  deleteEvent,
  ensureFreshToken,
  getEvent,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_DRIVE_SCOPES,
  updateEvent,
} from "../_shared/integrations/google.ts";
import { createOAuthState, getToken } from "../_shared/integrations/oauth.ts";
import { logEvent } from "../_shared/events.ts";
import {
  type BubbleType,
  createBubble,
  deleteBubble,
  getOwnedBubble,
  listRecentBubbles,
  searchBubbles,
  updateBubble,
} from "../_shared/wellspring/memories.ts";
import { captureUploadedFileToBubble } from "../_shared/wellspring/file_capture.ts";
import { AudioTooLargeError, transcribeUploadedAudio } from "../_shared/transcription.ts";
import { routeAndDispatchAssistantText } from "../_shared/assistant_dispatch.ts";
import { webEmailAllowed } from "../_shared/web_access.ts";
import {
  getVapidPublicKey,
  listWebPushSubscriptions,
  sendWebPush,
} from "../_shared/integrations/web_push.ts";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const DEFAULT_ORIGIN = "http://localhost:4173";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function allowedOrigins(): string[] {
  const origins = [DEFAULT_ORIGIN];
  const configured = Deno.env.get("WEB_APP_URL");
  if (configured) {
    try {
      origins.unshift(new URL(configured).origin);
    } catch {
      // Ignore malformed configuration and retain the local development origin.
    }
  }
  return [...new Set(origins)];
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();
  const selected = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": selected,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function withCors(response: Response, cors: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function routeSegments(pathname: string): string[] {
  let segments = pathname.split("/").filter(Boolean);
  while (segments[0] === "functions" || segments[0] === "v1") {
    segments = segments.slice(1);
  }
  if (segments[0] === "api-web") segments = segments.slice(1);
  return segments;
}

async function authenticate(
  supabase: SupabaseClient,
  req: Request,
): Promise<{ user: User; profile: Profile } | Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "unauthorized" }, 401);

  const { data: { user }, error } = await supabase.auth.getUser(match[1]);
  if (error || !user) return json({ error: "unauthorized" }, 401);
  if (!webEmailAllowed(user.email)) {
    return json({ error: "account_not_allowed" }, 403);
  }

  const metadata = user.user_metadata as Record<string, unknown>;
  const fullName = typeof metadata.full_name === "string"
    ? metadata.full_name
    : typeof metadata.name === "string"
    ? metadata.name
    : null;
  const locale = typeof metadata.locale === "string" ? metadata.locale : null;
  const profile = await getOrCreateProfileFromAuth(supabase, user.id, {
    email: user.email,
    fullName,
    locale,
  });
  return { user, profile };
}

async function listIdentities(
  supabase: SupabaseClient,
  profileId: string,
): Promise<Array<{ id: string; provider: string; created_at: string }>> {
  const { data, error } = await supabase
    .from("profile_identities")
    .select("id, provider, created_at")
    .eq("profile_id", profileId)
    .order("created_at");
  if (error) throw new Error(`identity list failed: ${error.message}`);
  return data ?? [];
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const supabase = createServiceClient();
    const authenticated = await authenticate(supabase, req);
    if (authenticated instanceof Response) return withCors(authenticated, cors);

    const { user, profile } = authenticated;
    const url = new URL(req.url);
    const [resource, id, sub] = routeSegments(url.pathname);
    const hasBody = req.method === "POST" || req.method === "PATCH";
    const isMultipart = req.headers.get("content-type")?.includes("multipart/form-data") ?? false;
    const form = hasBody && isMultipart ? await req.formData() : null;
    const body = hasBody && !isMultipart
      ? await req.json().catch(() => ({} as Record<string, unknown>))
      : ({} as Record<string, unknown>);

    if (req.method === "GET" && resource === "me") {
      return withCors(
        json({
          id: profile.id,
          display_name: profile.display_name,
          locale: profile.locale,
          timezone: profile.timezone,
          identities: await listIdentities(supabase, profile.id),
        }),
        cors,
      );
    }

    if (req.method === "GET" && resource === "account" && id === "identities") {
      return withCors(
        json({
          identities: await listIdentities(supabase, profile.id),
        }),
        cors,
      );
    }

    if (resource === "push") {
      if (req.method === "GET" && !id) {
        const { count, error } = await supabase
          .from("web_push_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", profile.id);
        if (error) throw new Error(`push subscription count failed: ${error.message}`);
        return withCors(
          json({
            available: Boolean(getVapidPublicKey()),
            public_key: getVapidPublicKey(),
            subscriptions: count ?? 0,
          }),
          cors,
        );
      }

      if (req.method === "POST" && id === "test") {
        const subscriptions = await listWebPushSubscriptions(supabase, [profile.id]);
        const result = await sendWebPush(supabase, subscriptions, {
          title: "תכלס מחוברת",
          body: "התראות Push פועלות במכשיר הזה.",
          url: "/?view=reminders",
          tag: "tachles-push-test",
        });
        return withCors(
          result.sent > 0
            ? json({ ok: true, sent: result.sent })
            : json({ error: "push_not_delivered" }, 409),
          cors,
        );
      }

      if (req.method === "POST" && !id) {
        const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
        const keys = typeof body.keys === "object" && body.keys !== null
          ? body.keys as Record<string, unknown>
          : {};
        const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
        const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
        if (!endpoint.startsWith("https://") || !p256dh || !auth) {
          return withCors(json({ error: "invalid_push_subscription" }, 400), cors);
        }
        const expirationTime = typeof body.expiration_time === "number" &&
            Number.isFinite(body.expiration_time)
          ? Math.trunc(body.expiration_time)
          : null;
        const { error } = await supabase.from("web_push_subscriptions").upsert(
          {
            owner_id: profile.id,
            endpoint,
            expiration_time: expirationTime,
            p256dh,
            auth,
            user_agent: req.headers.get("user-agent"),
          },
          { onConflict: "endpoint" },
        );
        if (error) throw new Error(`push subscription save failed: ${error.message}`);
        return withCors(json({ ok: true }), cors);
      }

      if (req.method === "DELETE" && !id) {
        const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
        if (!endpoint) {
          return withCors(json({ error: "push_endpoint_required" }, 400), cors);
        }
        const { error } = await supabase
          .from("web_push_subscriptions")
          .delete()
          .eq("owner_id", profile.id)
          .eq("endpoint", endpoint);
        if (error) throw new Error(`push subscription delete failed: ${error.message}`);
        return withCors(json({ ok: true }), cors);
      }
    }

    if (resource === "assistant" && req.method === "POST") {
      if (id === "text") {
        const rawText = String(body.text ?? "").trim();
        if (!rawText) {
          return withCors(json({ error: "text_required" }, 400), cors);
        }
        const mode = String(body.mode ?? "smart");
        const prefixes: Record<string, string> = {
          task: "משימה: ",
          memory: "שמור בזיכרון: ",
          reminder: "תזכיר לי ",
          event: "תוסיף ליומן: ",
          list: "תוסיף לרשימה: ",
        };
        const text = mode === "smart" ? rawText : `${prefixes[mode] ?? ""}${rawText}`;
        const actions = await routeAndDispatchAssistantText(
          supabase,
          profile,
          text,
          "text",
        );
        return withCors(json({ actions }), cors);
      }

      if (id === "file") {
        const uploaded = form?.get("file");
        if (!(uploaded instanceof File)) {
          return withCors(json({ error: "file_required" }, 400), cors);
        }
        if (uploaded.size === 0 || uploaded.size > MAX_UPLOAD_BYTES) {
          return withCors(
            json({ error: "file_too_large", max_bytes: MAX_UPLOAD_BYTES }, 413),
            cors,
          );
        }
        const bytes = new Uint8Array(await uploaded.arrayBuffer());
        const result = await captureUploadedFileToBubble(supabase, {
          ownerId: profile.id,
          bytes,
          filename: uploaded.name || "file",
          mimeType: uploaded.type || "application/octet-stream",
          caption: String(form?.get("caption") ?? "").trim() || null,
        });
        await syncBubble(
          supabase,
          profile.id,
          result.bubble,
          result.bubble.created_at,
        );
        await logEvent(supabase, profile.id, {
          kind: "media_in",
          payload: {
            filename: result.filename,
            mime_type: result.mimeType,
            size_bytes: uploaded.size,
          },
          relatedEntity: { type: "bubble", id: result.bubble.id },
        });
        return withCors(
          json({
            message: `שמרתי את ${result.filename} בזיכרון.`,
            memory: result.bubble,
            file_id: result.fileId,
          }, 201),
          cors,
        );
      }

      if (id === "voice") {
        const recording = form?.get("audio");
        if (!(recording instanceof File)) {
          return withCors(json({ error: "audio_required" }, 400), cors);
        }
        let transcript: string;
        try {
          transcript = await transcribeUploadedAudio(recording);
        } catch (err) {
          if (err instanceof AudioTooLargeError) {
            return withCors(
              json({ error: "audio_too_large", bytes: err.bytes }, 413),
              cors,
            );
          }
          throw err;
        }
        if (!transcript) {
          return withCors(json({ error: "empty_transcript" }, 422), cors);
        }
        await logEvent(supabase, profile.id, {
          kind: "voice_in",
          payload: { transcript_preview: transcript.slice(0, 200) },
        });
        const actions = await routeAndDispatchAssistantText(
          supabase,
          profile,
          transcript,
          "voice",
        );
        return withCors(json({ transcript, actions }), cors);
      }
    }

    if (resource === "integrations" && id === "obsidian") {
      if (req.method === "GET") {
        const [{ data: settings }, token, { count: exportedCount }] = await Promise.all([
          supabase
            .from("user_settings")
            .select("obsidian_enabled, obsidian_drive_folder_id")
            .eq("owner_id", profile.id)
            .maybeSingle<{
              obsidian_enabled: boolean;
              obsidian_drive_folder_id: string | null;
            }>(),
          getToken(supabase, profile.id, "google"),
          supabase
            .from("obsidian_exports")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", profile.id),
        ]);
        const folderId = settings?.obsidian_drive_folder_id ?? null;
        return withCors(
          json({
            enabled: settings?.obsidian_enabled ?? false,
            google_connected: Boolean(token),
            folder_url: folderId ? `https://drive.google.com/drive/folders/${folderId}` : null,
            exported_count: exportedCount ?? 0,
          }),
          cors,
        );
      }
      if (req.method === "POST" && sub === "connect") {
        const webAppUrl = Deno.env.get("WEB_APP_URL");
        if (!webAppUrl) {
          return withCors(json({ error: "web_app_url_missing" }, 503), cors);
        }
        const returnUrl = new URL(webAppUrl).origin;
        const state = await createOAuthState(
          supabase,
          profile.id,
          "google",
          null,
          GOOGLE_DRIVE_SCOPES,
          returnUrl,
          "obsidian",
        );
        return withCors(
          json({ url: buildAuthorizeUrl(state, GOOGLE_DRIVE_SCOPES) }),
          cors,
        );
      }
      if (req.method === "POST" && sub === "enable") {
        const result = await enableObsidian(supabase, profile.id);
        return withCors(
          json({
            enabled: true,
            folder_url: `https://drive.google.com/drive/folders/${result.folderId}`,
          }),
          cors,
        );
      }
      if (req.method === "POST" && sub === "sync") {
        const result = await fullResync(supabase, profile.id);
        await logEvent(supabase, profile.id, {
          kind: "obsidian_synced",
          payload: result,
          source: "user",
        });
        return withCors(json({ ok: true, ...result }), cors);
      }
      if (req.method === "POST" && sub === "disable") {
        await disableObsidian(supabase, profile.id);
        return withCors(json({ enabled: false }), cors);
      }
    }

    if (resource === "calendar") {
      if (req.method === "GET" && id === "status") {
        const token = await getToken(supabase, profile.id, "google");
        const connected = Boolean(
          token?.scopes.some((scope) =>
            scope === "https://www.googleapis.com/auth/calendar.events" ||
            scope === "https://www.googleapis.com/auth/calendar"
          ),
        );
        return withCors(json({ connected }), cors);
      }
      if (req.method === "POST" && id === "connect") {
        const webAppUrl = Deno.env.get("WEB_APP_URL");
        if (!webAppUrl) {
          return withCors(json({ error: "web_app_url_missing" }, 503), cors);
        }
        const returnUrl = new URL(webAppUrl).origin;
        const state = await createOAuthState(
          supabase,
          profile.id,
          "google",
          null,
          GOOGLE_CALENDAR_SCOPES,
          returnUrl,
          "calendar",
        );
        return withCors(
          json({ url: buildAuthorizeUrl(state, GOOGLE_CALENDAR_SCOPES) }),
          cors,
        );
      }
      if (req.method === "POST" && id === "sync") {
        const result = await syncGoogleCalendar(supabase, profile.id);
        return withCors(json({ ok: true, ...result }), cors);
      }
      if (id === "events") {
        if (req.method === "GET" && !sub) {
          const from = url.searchParams.get("from") ?? "";
          const to = url.searchParams.get("to") ?? "";
          if (!from || !to) {
            return withCors(json({ error: "range_required" }, 400), cors);
          }
          return withCors(
            json({
              events: await listOwnerEventsBetween(
                supabase,
                profile.id,
                from,
                to,
              ),
            }),
            cors,
          );
        }
        if (req.method === "POST" && !sub) {
          const title = String(body.title ?? "").trim();
          const startIso = String(body.start_at ?? "");
          const endIso = String(body.end_at ?? "");
          if (
            !title || !startIso || !endIso ||
            Date.parse(endIso) <= Date.parse(startIso)
          ) {
            return withCors(json({ error: "invalid_event" }, 400), cors);
          }
          const stored = await getToken(supabase, profile.id, "google");
          if (!stored) {
            return withCors(json({ error: "google_not_connected" }, 409), cors);
          }
          const token = await ensureFreshToken(supabase, profile.id, stored);
          const remote = await createEvent(token, {
            title,
            description: typeof body.description === "string" ? body.description : null,
            location: typeof body.location === "string" ? body.location : null,
            startIso,
            endIso,
            allDay: body.all_day === true,
            timezone: profile.timezone,
          });
          const event = await upsertLocalGoogleEvent(
            supabase,
            profile.id,
            "primary",
            remote,
          );
          await logEvent(supabase, profile.id, {
            kind: "calendar_event_created",
            relatedEntity: { type: "calendar_event", id: event.id },
            payload: { title: event.title },
          });
          return withCors(json({ event }, 201), cors);
        }
        if (req.method === "PATCH" && sub) {
          const existing = await getOwnedEvent(supabase, profile.id, sub);
          if (!existing) {
            return withCors(json({ error: "not_found" }, 404), cors);
          }
          const stored = await getToken(supabase, profile.id, "google");
          if (!stored) {
            return withCors(json({ error: "google_not_connected" }, 409), cors);
          }
          const token = await ensureFreshToken(supabase, profile.id, stored);
          const current = await getEvent(
            token,
            existing.calendar_id,
            existing.external_id,
          );
          if (!current) {
            await deleteLocalEvent(supabase, profile.id, existing.id);
            return withCors(json({ error: "not_found" }, 404), cors);
          }
          const expectedEtag = typeof body.expected_etag === "string" ? body.expected_etag : null;
          if (expectedEtag && current.etag && expectedEtag !== current.etag) {
            const latest = await upsertLocalGoogleEvent(
              supabase,
              profile.id,
              existing.calendar_id,
              current,
            );
            return withCors(
              json({ error: "calendar_conflict", event: latest }, 409),
              cors,
            );
          }
          const startIso = typeof body.start_at === "string" ? body.start_at : undefined;
          const endIso = typeof body.end_at === "string" ? body.end_at : undefined;
          if (typeof body.title === "string" && !body.title.trim()) {
            return withCors(json({ error: "title_required" }, 400), cors);
          }
          if (
            (startIso && !endIso) || (!startIso && endIso) ||
            (startIso && endIso && Date.parse(endIso) <= Date.parse(startIso))
          ) {
            return withCors(json({ error: "invalid_event" }, 400), cors);
          }
          const remote = await updateEvent(
            token,
            existing.calendar_id,
            existing.external_id,
            {
              title: typeof body.title === "string" ? body.title.trim() : undefined,
              description: typeof body.description === "string" ||
                  body.description === null
                ? body.description as string | null
                : undefined,
              location: typeof body.location === "string" || body.location === null
                ? body.location as string | null
                : undefined,
              startIso,
              endIso,
              allDay: body.all_day === true,
              timezone: profile.timezone,
            },
          );
          const event = await upsertLocalGoogleEvent(
            supabase,
            profile.id,
            existing.calendar_id,
            remote,
          );
          await logEvent(supabase, profile.id, {
            kind: "calendar_event_updated",
            relatedEntity: { type: "calendar_event", id: event.id },
            payload: { title: event.title },
          });
          return withCors(json({ event }), cors);
        }
        if (req.method === "DELETE" && sub) {
          const existing = await getOwnedEvent(supabase, profile.id, sub);
          if (!existing) {
            return withCors(json({ error: "not_found" }, 404), cors);
          }
          const stored = await getToken(supabase, profile.id, "google");
          if (!stored) {
            return withCors(json({ error: "google_not_connected" }, 409), cors);
          }
          const token = await ensureFreshToken(supabase, profile.id, stored);
          await deleteEvent(token, existing.calendar_id, existing.external_id);
          await deleteLocalEvent(supabase, profile.id, existing.id);
          await logEvent(supabase, profile.id, {
            kind: "calendar_event_deleted",
            relatedEntity: { type: "calendar_event", id: existing.id },
            payload: { title: existing.title },
          });
          return withCors(json({ ok: true }), cors);
        }
      }
    }

    if (resource === "memories") {
      const validTypes = new Set<BubbleType>([
        "knowledge",
        "inspiration",
        "reflection",
      ]);
      if (req.method === "GET" && !id) {
        const query = (url.searchParams.get("q") ?? "").trim();
        const rawType = url.searchParams.get("type");
        const type = rawType && validTypes.has(rawType as BubbleType)
          ? rawType as BubbleType
          : undefined;
        const limit = Math.min(
          Math.max(Number(url.searchParams.get("limit") ?? 30), 1),
          100,
        );
        let memories = query
          ? await searchBubbles(supabase, profile.id, query, limit)
          : await listRecentBubbles(supabase, profile.id, limit, type);
        if (query && type) {
          memories = memories.filter((memory) => memory.type === type);
        }
        return withCors(json({ memories }), cors);
      }
      if (req.method === "POST" && !id) {
        const content = String(body.content ?? "").trim();
        const type = validTypes.has(body.type as BubbleType)
          ? body.type as BubbleType
          : "knowledge";
        if (!content) {
          return withCors(json({ error: "content_required" }, 400), cors);
        }
        const memory = await createBubble(supabase, {
          ownerId: profile.id,
          content,
          type,
          title: typeof body.title === "string" ? body.title.trim() || null : null,
          tags: Array.isArray(body.tags)
            ? body.tags.map(String).map((tag: string) => tag.trim()).filter(
              Boolean,
            )
            : [],
          sourceUrl: typeof body.source_url === "string" ? body.source_url.trim() || null : null,
        });
        await syncBubble(supabase, profile.id, memory, memory.created_at);
        await logEvent(supabase, profile.id, {
          kind: "bubble_created",
          relatedEntity: { type: "bubble", id: memory.id },
          payload: { type: memory.type },
        });
        return withCors(json({ memory }, 201), cors);
      }
      if (req.method === "PATCH" && id) {
        const existing = await getOwnedBubble(supabase, profile.id, id);
        if (!existing) return withCors(json({ error: "not_found" }, 404), cors);
        const rawType = body.type;
        if (rawType !== undefined && !validTypes.has(rawType as BubbleType)) {
          return withCors(json({ error: "invalid_type" }, 400), cors);
        }
        if (typeof body.content === "string" && !body.content.trim()) {
          return withCors(json({ error: "content_required" }, 400), cors);
        }
        const memory = await updateBubble(supabase, profile.id, id, {
          title: typeof body.title === "string" || body.title === null
            ? (body.title as string | null)?.trim() || null
            : undefined,
          content: typeof body.content === "string" ? body.content.trim() : undefined,
          type: rawType as BubbleType | undefined,
          tags: Array.isArray(body.tags)
            ? body.tags.map(String).map((tag: string) => tag.trim()).filter(
              Boolean,
            )
            : undefined,
          sourceUrl: typeof body.source_url === "string" || body.source_url === null
            ? (body.source_url as string | null)?.trim() || null
            : undefined,
        });
        if (!memory) return withCors(json({ error: "not_found" }, 404), cors);
        await syncBubble(supabase, profile.id, memory, memory.created_at);
        await logEvent(supabase, profile.id, {
          kind: "bubble_updated",
          relatedEntity: { type: "bubble", id: memory.id },
          payload: { type: memory.type },
        });
        return withCors(json({ memory }), cors);
      }
      if (req.method === "DELETE" && id) {
        const existing = await getOwnedBubble(supabase, profile.id, id);
        if (!existing) return withCors(json({ error: "not_found" }, 404), cors);
        await deleteBubble(supabase, profile.id, id);
        await deleteBubbleExport(supabase, profile.id, id);
        await logEvent(supabase, profile.id, {
          kind: "bubble_deleted",
          relatedEntity: { type: "bubble", id },
          payload: { type: existing.type },
        });
        return withCors(json({ ok: true }), cors);
      }
    }

    if (req.method === "POST" && resource === "account" && id === "link") {
      const code = typeof body.code === "string" ? body.code : "";
      try {
        const linkedProfile = await consumeProfileLinkCode(
          supabase,
          user.id,
          code,
        );
        return withCors(
          json({
            ok: true,
            profile: {
              id: linkedProfile.id,
              display_name: linkedProfile.display_name,
              locale: linkedProfile.locale,
              timezone: linkedProfile.timezone,
            },
            identities: await listIdentities(supabase, linkedProfile.id),
          }),
          cors,
        );
      } catch (err) {
        if (err instanceof ProfileLinkError) {
          const status = err.code === "invalid_or_expired"
            ? 400
            : err.code === "already_linked"
            ? 409
            : err.code === "profile_has_data"
            ? 409
            : 400;
          return withCors(json({ error: err.code }, status), cors);
        }
        throw err;
      }
    }

    if (resource === "projects") {
      if (req.method === "GET" && !id) {
        return withCors(
          json({
            projects: await listProjects(
              supabase,
              profile.id,
              url.searchParams.get("archived") === "1",
            ),
          }),
          cors,
        );
      }
      if (req.method === "POST" && !id) {
        const title = String(body.title ?? "").trim();
        if (!title) {
          return withCors(json({ error: "title_required" }, 400), cors);
        }
        const project = await createProject(supabase, profile.id, {
          title,
          goal: typeof body.goal === "string" ? body.goal : null,
          targetDate: typeof body.target_date === "string" ? body.target_date : null,
          nextStep: typeof body.next_step === "string" ? body.next_step : null,
        });
        await logEvent(supabase, profile.id, {
          kind: "project_created",
          relatedEntity: { type: "project", id: project.id },
          payload: { title: project.title },
        });
        return withCors(json({ project }, 201), cors);
      }
      if (req.method === "GET" && id && !sub) {
        const project = await getOwnedProject(supabase, profile.id, id);
        if (!project) return withCors(json({ error: "not_found" }, 404), cors);
        const [tasks, resources] = await Promise.all([
          listProjectTasks(supabase, profile.id, id),
          listProjectResources(supabase, profile.id, id),
        ]);
        return withCors(json({ project, tasks, resources }), cors);
      }
      if (req.method === "PATCH" && id && !sub) {
        const project = await updateProject(supabase, profile.id, id, {
          title: typeof body.title === "string" ? body.title : undefined,
          goal: typeof body.goal === "string" || body.goal === null
            ? body.goal as string | null
            : undefined,
          status: typeof body.status === "string"
            ? body.status as "active" | "paused" | "done" | "archived"
            : undefined,
          target_date: typeof body.target_date === "string" || body.target_date === null
            ? body.target_date as string | null
            : undefined,
          current_summary: typeof body.current_summary === "string" ||
              body.current_summary === null
            ? body.current_summary as string | null
            : undefined,
          next_step: typeof body.next_step === "string" || body.next_step === null
            ? body.next_step as string | null
            : undefined,
        });
        return withCors(
          project ? json({ project }) : json({ error: "not_found" }, 404),
          cors,
        );
      }
      if (req.method === "POST" && id && sub === "resources") {
        const resourceType = String(body.resource_type ?? "");
        if (!["memory", "file", "url", "note"].includes(resourceType)) {
          return withCors(json({ error: "invalid_resource_type" }, 400), cors);
        }
        const projectResource = await addProjectResource(
          supabase,
          profile.id,
          id,
          {
            resource_type: resourceType as "memory" | "file" | "url" | "note",
            resource_id: typeof body.resource_id === "string" ? body.resource_id : null,
            title: typeof body.title === "string" ? body.title : null,
            url: typeof body.url === "string" ? body.url : null,
            content: typeof body.content === "string" ? body.content : null,
            metadata: typeof body.metadata === "object" && body.metadata !== null
              ? body.metadata as Record<string, unknown>
              : {},
          },
        );
        return withCors(json({ resource: projectResource }, 201), cors);
      }
      if (req.method === "POST" && id && sub === "plan") {
        const project = await getOwnedProject(supabase, profile.id, id);
        if (!project) return withCors(json({ error: "not_found" }, 404), cors);
        const plan = await generateProjectPlan(
          project,
          typeof body.context === "string" ? body.context : "",
        );
        const proposal = await saveProjectPlanProposal(
          supabase,
          profile.id,
          id,
          plan,
        );
        await logEvent(supabase, profile.id, {
          kind: "project_plan_proposed",
          relatedEntity: { type: "project", id },
          payload: { proposal_id: proposal.id },
          source: "agent",
        });
        return withCors(json({ proposal }, 201), cors);
      }
      if (req.method === "GET" && id && sub === "timeline") {
        const project = await getOwnedProject(supabase, profile.id, id);
        if (!project) return withCors(json({ error: "not_found" }, 404), cors);
        const tasks = await listProjectTasks(supabase, profile.id, id);
        return withCors(
          json({
            project: {
              id: project.id,
              title: project.title,
              status: project.status,
              current_summary: project.current_summary,
              next_step: project.next_step,
              target_date: project.target_date,
            },
            stages: {
              completed: tasks.filter((task) => task.status === "done"),
              current: tasks.filter((task) => task.status === "doing"),
              waiting: tasks.filter((task) => task.status === "waiting"),
              upcoming: tasks.filter((task) => task.status === "todo"),
            },
          }),
          cors,
        );
      }
    }

    if (
      req.method === "POST" && resource === "plans" && id && sub === "approve"
    ) {
      const created = await approveProjectPlan(supabase, profile.id, id);
      await logEvent(supabase, profile.id, {
        kind: "project_plan_approved",
        relatedEntity: { type: "project_plan", id },
        payload: { tasks_created: created },
      });
      return withCors(json({ ok: true, tasks_created: created }), cors);
    }

    if (resource === "reminders") {
      if (req.method === "GET" && !id) {
        return withCors(
          json({ reminders: await listActiveReminders(supabase, profile.id) }),
          cors,
        );
      }
      if (req.method === "DELETE" && id) {
        const cancelled = await cancelReminder(supabase, profile.id, id);
        return withCors(
          cancelled ? json({ ok: true }) : json({ error: "reminder_not_found" }, 404),
          cors,
        );
      }
    }

    if (resource === "tasks") {
      if (req.method === "GET" && !id) {
        return withCors(
          json({ tasks: await listTopTasks(supabase, profile.id) }),
          cors,
        );
      }
      if (req.method === "POST" && !id) {
        const title = String(body.title ?? "").trim();
        if (!title) {
          return withCors(json({ error: "title_required" }, 400), cors);
        }
        const task = await createTask(supabase, profile.id, title, null, {
          projectId: typeof body.project_id === "string" ? body.project_id : null,
          dueAt: typeof body.due_at === "string" ? body.due_at : null,
          estimatedMinutes: Number.isInteger(body.estimated_minutes)
            ? Number(body.estimated_minutes)
            : null,
          energyLevel: ["low", "medium", "high"].includes(String(body.energy_level))
            ? body.energy_level as "low" | "medium" | "high"
            : null,
        });
        await logEvent(supabase, profile.id, {
          kind: "task_created",
          relatedEntity: { type: "task", id: task.id },
          payload: { title: task.title, project_id: task.project_id },
        });
        return withCors(json({ task }, 201), cors);
      }
      if (req.method === "PATCH" && id) {
        const task = await updateTask(supabase, profile.id, id, {
          title: typeof body.title === "string" ? body.title : undefined,
          status: ["todo", "doing", "waiting", "done"].includes(String(body.status))
            ? body.status as "todo" | "doing" | "waiting" | "done"
            : undefined,
          priority: Number.isInteger(body.priority) ? Number(body.priority) : undefined,
          project_id: typeof body.project_id === "string" || body.project_id === null
            ? body.project_id as string | null
            : undefined,
          due_at: typeof body.due_at === "string" || body.due_at === null
            ? body.due_at as string | null
            : undefined,
          estimated_minutes: Number.isInteger(body.estimated_minutes) ||
              body.estimated_minutes === null
            ? body.estimated_minutes as number | null
            : undefined,
          waiting_for: typeof body.waiting_for === "string" || body.waiting_for === null
            ? body.waiting_for as string | null
            : undefined,
          waiting_reason: typeof body.waiting_reason === "string" ||
              body.waiting_reason === null
            ? body.waiting_reason as string | null
            : undefined,
          follow_up_at: typeof body.follow_up_at === "string" || body.follow_up_at === null
            ? body.follow_up_at as string | null
            : undefined,
        });
        return withCors(
          task ? json({ task }) : json({ error: "not_found" }, 404),
          cors,
        );
      }
    }

    if (resource === "captures") {
      if (req.method === "GET" && !id) {
        const rawStatus = url.searchParams.get("status") ?? "inbox";
        const status = ["inbox", "processed", "dismissed"].includes(rawStatus)
          ? rawStatus as CaptureStatus
          : "inbox";
        return withCors(
          json({ captures: await listCaptures(supabase, profile.id, status) }),
          cors,
        );
      }
      if (req.method === "POST" && !id) {
        const capture = await createCapture(supabase, profile.id, {
          source: body.source === "web_share" ? "web_share" : "manual",
          projectId: typeof body.project_id === "string" ? body.project_id : null,
          title: typeof body.title === "string" ? body.title : null,
          text: typeof body.text === "string" ? body.text : null,
          url: typeof body.url === "string" ? body.url : null,
        });
        await logEvent(supabase, profile.id, {
          kind: "capture_created",
          relatedEntity: { type: "capture", id: capture.id },
          payload: { source: capture.source },
        });
        return withCors(json({ capture }, 201), cors);
      }
      if (req.method === "PATCH" && id) {
        const status = String(body.status);
        if (!["inbox", "processed", "dismissed"].includes(status)) {
          return withCors(json({ error: "invalid_status" }, 400), cors);
        }
        const capture = await setCaptureStatus(
          supabase,
          profile.id,
          id,
          status as CaptureStatus,
        );
        return withCors(
          capture ? json({ capture }) : json({ error: "not_found" }, 404),
          cors,
        );
      }
    }

    if (req.method === "POST" && resource === "planner" && id === "preview") {
      const start = typeof body.start === "string" ? body.start : "";
      const end = typeof body.end === "string" ? body.end : "";
      if (!start || !end) {
        return withCors(json({ error: "planning_range_required" }, 400), cors);
      }
      const [tasks, events] = await Promise.all([
        listTopTasks(supabase, profile.id),
        listOwnerEventsBetween(supabase, profile.id, start, end),
      ]);
      const proposal = planTasks(
        tasks
          .filter((task) => task.schedule_mode === "flexible" && !task.scheduled_start)
          .map((task) => ({
            id: task.id,
            title: task.title,
            priority: task.priority,
            dueAt: task.due_at,
            estimatedMinutes: task.estimated_minutes,
          })),
        events.map((event) => ({ start: event.start_at, end: event.end_at })),
        { start, end },
      );
      return withCors(json(proposal), cors);
    }

    if (resource === "research") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("research_briefs")
          .select("id, project_id, query, answer, sources, model, created_at")
          .eq("owner_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(30);
        if (error) throw new Error(`research list failed: ${error.message}`);
        return withCors(json({ research: data ?? [] }), cors);
      }
      if (req.method === "POST") {
        const query = String(body.query ?? "").trim();
        if (!query) {
          return withCors(json({ error: "query_required" }, 400), cors);
        }
        const projectId = typeof body.project_id === "string" ? body.project_id : null;
        if (
          projectId && !await getOwnedProject(supabase, profile.id, projectId)
        ) {
          return withCors(json({ error: "project_not_found" }, 404), cors);
        }
        const allowedDomains = Array.isArray(body.allowed_domains)
          ? (body.allowed_domains as unknown[]).map((value) => String(value).trim()).filter(Boolean)
          : [];
        const result = await researchWeb(query, allowedDomains);
        const { data: brief, error } = await supabase
          .from("research_briefs")
          .insert({
            owner_id: profile.id,
            project_id: projectId,
            query,
            answer: result.answer,
            sources: result.sources,
            model: result.model,
          })
          .select("id, project_id, query, answer, sources, model, created_at")
          .single<{ id: string } & Record<string, unknown>>();
        if (error || !brief) {
          throw new Error(
            `research save failed: ${error?.message ?? "no row returned"}`,
          );
        }
        if (projectId) {
          await addProjectResource(supabase, profile.id, projectId, {
            resource_type: "note",
            resource_id: null,
            title: `מחקר: ${query}`,
            url: null,
            content: result.answer,
            metadata: { research_id: brief.id, sources: result.sources },
          });
        }
        await logEvent(supabase, profile.id, {
          kind: "research_completed",
          relatedEntity: { type: "research", id: brief.id },
          payload: {
            project_id: projectId,
            source_count: result.sources.length,
          },
          source: "agent",
        });
        return withCors(json({ research: brief }, 201), cors);
      }
    }

    return withCors(json({ error: "not found" }, 404), cors);
  } catch (err) {
    console.error("api-web error:", err);
    return withCors(json({ error: "internal error" }, 500), cors);
  }
});
