// REST API for the Tachles Telegram Mini App. Authenticated by the signed
// `X-Telegram-InitData` header (verified per request), NOT by a Supabase JWT —
// deploy this function with `--no-verify-jwt`. Every handler reuses the same
// `_shared/` services the Telegram bot uses, so there is no duplicated logic.
//
// Calendar *writes* (create/update/delete events) are intentionally not exposed
// yet — they require the Google client flow and will land with the Mini App
// calendar screen. Everything else is full CRUD over the local stores.

import { createServiceClient } from "../_shared/supabase.ts";
import { getOrCreateProfile, type Profile } from "../_shared/profiles.ts";
import { verifyInitData } from "../_shared/init_data.ts";
import { localParts, utcForLocalWallTime } from "../_shared/tz.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cancelReminder,
  createReminder,
  listActiveReminders,
  snoozeReminder,
} from "../_shared/bridge/reminders.ts";
import {
  addItems,
  deleteItem,
  getListItems,
  getOrCreateList,
  getOwnedList,
  listLists,
  toggleItem,
} from "../_shared/bridge/lists.ts";
import {
  createTask,
  cycleTaskPriority,
  cycleTaskStatus,
  getSubtasks,
  listTopTasks,
} from "../_shared/bridge/tasks.ts";
import {
  type BubbleType,
  createBubble,
  deleteBubble,
  listRecentBubbles,
  searchBubbles,
} from "../_shared/wellspring/memories.ts";
import { listOwnerEventsBetween } from "../_shared/integrations/calendar_sync.ts";
import { listRecentEvents } from "../_shared/events.ts";
import { routeMessage } from "../_shared/router.ts";
import { getToken } from "../_shared/integrations/oauth.ts";

// CORS allowlist. Defense-in-depth only — the real auth gate is the signed
// initData, not the Origin. The deployed Mini App origin can be overridden via
// the MINI_APP_URL secret (e.g. a custom domain); the Vercel URL is the default.
const DEFAULT_ORIGIN = "http://localhost:5173";

function allowedOrigins(): string[] {
  const origins = [DEFAULT_ORIGIN];
  const fromEnv = Deno.env.get("MINI_APP_URL");
  if (fromEnv) {
    try {
      origins.unshift(new URL(fromEnv).origin);
    } catch {
      // Ignore a malformed MINI_APP_URL and fall back to the default.
    }
  }
  return origins;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();
  const allow = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-telegram-initdata, x-client-info, apikey, content-type",
  };
}

function withCors(res: Response, cors: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

const BUBBLE_FILTERS: Record<string, BubbleType> = {
  knowledge: "knowledge",
  inspiration: "inspiration",
  reflection: "reflection",
};

// Resource path segments, with the function name ("api") and any Supabase
// routing prefix stripped.
function routeSegments(pathname: string): string[] {
  let segs = pathname.split("/").filter(Boolean);
  while (segs.length && (segs[0] === "functions" || segs[0] === "v1")) {
    segs = segs.slice(1);
  }
  if (segs[0] === "api") segs = segs.slice(1);
  return segs;
}

async function handle(
  supabase: SupabaseClient,
  profile: Profile,
  req: Request,
  segs: string[],
): Promise<Response> {
  const method = req.method;
  const owner = profile.id;
  const [resource, id, sub] = segs;
  const url = new URL(req.url);
  const body = method === "POST" || method === "PATCH"
    ? await req.json().catch(() => ({} as Record<string, unknown>))
    : ({} as Record<string, unknown>);

  switch (resource) {
    case "me": {
      if (method === "GET") {
        const google = await getToken(supabase, owner, "google");
        return json({
          id: profile.id,
          display_name: profile.display_name,
          timezone: profile.timezone,
          role: profile.role,
          google_connected: Boolean(google),
        });
      }
      break;
    }

    case "home": {
      const now = new Date();
      const lp = localParts(profile.timezone, now);
      const dayStart = utcForLocalWallTime(
        profile.timezone,
        lp.year,
        lp.month,
        lp.day,
        0,
        0,
      );
      const dayEnd = utcForLocalWallTime(
        profile.timezone,
        lp.year,
        lp.month,
        lp.day + 1,
        0,
        0,
      );
      const [events, reminders, tasks, inbox] = await Promise.all([
        listOwnerEventsBetween(
          supabase,
          owner,
          dayStart.toISOString(),
          dayEnd.toISOString(),
        ),
        listActiveReminders(supabase, owner),
        listTopTasks(supabase, owner),
        listRecentEvents(supabase, owner, 5),
      ]);
      return json({
        display_name: profile.display_name,
        events_today: events,
        reminders_next: reminders.slice(0, 3),
        tasks_open: tasks.length,
        inbox,
      });
    }

    case "reminders": {
      if (method === "GET" && !id) {
        return json({ reminders: await listActiveReminders(supabase, owner) });
      }
      if (method === "POST" && !id) {
        const title = String(body.title ?? "").trim();
        const runAtRaw = String(body.run_at ?? "");
        const runAt = new Date(runAtRaw);
        if (!title || isNaN(runAt.getTime())) {
          return fail(400, "title and a valid run_at are required");
        }
        const scheduleType = body.schedule_type === "recurring" ? "recurring" : "once";
        const newId = await createReminder(supabase, {
          ownerId: owner,
          title,
          body: typeof body.body === "string" ? body.body : null,
          scheduleType,
          runAt,
          recurrence: typeof body.recurrence === "string" ? body.recurrence : null,
          timezone: profile.timezone,
        });
        return json({ id: newId }, 201);
      }
      if (method === "POST" && id && sub === "snooze") {
        const minutes = Number(body.minutes);
        const runAt = typeof body.run_at === "string" ? new Date(body.run_at) : new Date(
          Date.now() + (Number.isFinite(minutes) ? minutes : 60) * 60_000,
        );
        if (isNaN(runAt.getTime())) {
          return fail(400, "minutes or run_at required");
        }
        const res = await snoozeReminder(supabase, owner, id, runAt);
        return res ? json(res) : fail(404, "reminder not found");
      }
      if (method === "DELETE" && id) {
        const ok = await cancelReminder(supabase, owner, id);
        return ok ? json({ ok: true }) : fail(404, "reminder not found");
      }
      break;
    }

    case "lists": {
      if (method === "GET" && !id) {
        return json({ lists: await listLists(supabase, owner) });
      }
      if (method === "GET" && id) {
        const list = await getOwnedList(supabase, owner, id);
        if (!list) return fail(404, "list not found");
        return json({ list, items: await getListItems(supabase, id) });
      }
      if (method === "POST" && !id) {
        const name = String(body.name ?? "").trim();
        if (!name) return fail(400, "name is required");
        return json({ id: await getOrCreateList(supabase, owner, name) }, 201);
      }
      if (method === "POST" && id && sub === "items") {
        const list = await getOwnedList(supabase, owner, id);
        if (!list) return fail(404, "list not found");
        const items = Array.isArray(body.items)
          ? body.items.map((x: unknown) => String(x).trim()).filter(Boolean)
          : [];
        if (items.length === 0) return fail(400, "items array is required");
        const added = await addItems(supabase, id, items, "text");
        return json({ added }, 201);
      }
      break;
    }

    case "items": {
      if (method === "PATCH" && id) {
        const listId = await toggleItem(supabase, owner, id);
        return listId ? json({ list_id: listId }) : fail(404, "item not found");
      }
      if (method === "DELETE" && id) {
        const listId = await deleteItem(supabase, owner, id);
        return listId ? json({ list_id: listId }) : fail(404, "item not found");
      }
      break;
    }

    case "memories": {
      if (method === "GET" && !id) {
        const q = url.searchParams.get("q")?.trim();
        const filter = url.searchParams.get("filter") ?? "";
        const type = BUBBLE_FILTERS[filter];
        const bubbles = q
          ? await searchBubbles(supabase, owner, q)
          : await listRecentBubbles(supabase, owner, 30, type);
        return json({ memories: bubbles });
      }
      if (method === "POST" && !id) {
        const content = String(body.content ?? "").trim();
        if (!content) return fail(400, "content is required");
        const type = BUBBLE_FILTERS[String(body.type ?? "")];
        const tags = Array.isArray(body.tags) ? body.tags.map(String) : undefined;
        const bubble = await createBubble(supabase, {
          ownerId: owner,
          content,
          type,
          tags,
        });
        return json({ memory: bubble }, 201);
      }
      if (method === "DELETE" && id) {
        const ok = await deleteBubble(supabase, owner, id);
        return ok ? json({ ok: true }) : fail(404, "memory not found");
      }
      break;
    }

    case "tasks": {
      if (method === "GET" && !id) {
        const tasks = await listTopTasks(supabase, owner);
        return json({ tasks });
      }
      if (method === "GET" && id) {
        const subtasks = await getSubtasks(supabase, owner, id);
        return json({ subtasks });
      }
      if (method === "POST" && !id) {
        const title = String(body.title ?? "").trim();
        if (!title) return fail(400, "title is required");
        const parent = typeof body.parent_task_id === "string" ? body.parent_task_id : null;
        return json(
          { task: await createTask(supabase, owner, title, parent) },
          201,
        );
      }
      if (method === "PATCH" && id) {
        const action = String(body.action ?? "");
        const updated = action === "priority"
          ? await cycleTaskPriority(supabase, owner, id)
          : action === "status"
          ? await cycleTaskStatus(supabase, owner, id)
          : null;
        if (!updated && action !== "status" && action !== "priority") {
          return fail(400, "action must be 'status' or 'priority'");
        }
        return updated ? json({ task: updated }) : fail(404, "task not found");
      }
      break;
    }

    case "events": {
      if (method === "GET" && !id) {
        const now = new Date();
        const from = url.searchParams.get("from") ?? now.toISOString();
        const to = url.searchParams.get("to") ??
          new Date(now.getTime() + 7 * 86_400_000).toISOString();
        return json({
          events: await listOwnerEventsBetween(supabase, owner, from, to),
        });
      }
      break;
    }

    case "agents": {
      if (method === "GET" && !id) {
        const { data: agents } = await supabase
          .from("agents")
          .select("id, name, role, schedule_cron, enabled")
          .order("name");
        const { data: settings } = await supabase
          .from("user_agent_settings")
          .select("agent_id, enabled")
          .eq("owner_id", owner);
        const overrides = new Map(
          (settings ?? []).map((
            s,
          ) => [s.agent_id as string, s.enabled as boolean]),
        );
        const list = (agents ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          schedule_cron: a.schedule_cron,
          enabled: (a.enabled as boolean) &&
            (overrides.get(a.id as string) ?? true),
        }));
        return json({ agents: list });
      }
      if (method === "PATCH" && id) {
        const enabled = Boolean(body.enabled);
        await supabase
          .from("user_agent_settings")
          .upsert({ owner_id: owner, agent_id: id, enabled });
        return json({ ok: true, enabled });
      }
      break;
    }

    case "inbox": {
      if (method === "GET") {
        return json({ events: await listRecentEvents(supabase, owner, 50) });
      }
      break;
    }

    case "timeline": {
      if (method === "GET") {
        const since = url.searchParams.get("since") ?? undefined;
        return json({
          events: await listRecentEvents(supabase, owner, 200, since),
        });
      }
      break;
    }

    case "route": {
      if (method === "POST") {
        const text = String(body.text ?? "").trim();
        if (!text) return fail(400, "text is required");
        const routed = await routeMessage(
          text,
          new Date().toISOString(),
          profile.timezone,
        );
        return json({ routed });
      }
      break;
    }
  }

  return fail(404, "not found");
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const initData = req.headers.get("x-telegram-initdata") ?? "";
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const verified = await verifyInitData(initData, botToken);
  if (!verified.valid || !verified.user) {
    return withCors(fail(401, verified.reason ?? "unauthorized"), cors);
  }

  const supabase = createServiceClient();
  const profile = await getOrCreateProfile(supabase, {
    id: verified.user.id,
    is_bot: false,
    first_name: verified.user.first_name,
    last_name: verified.user.last_name,
    username: verified.user.username,
  });

  try {
    const res = await handle(
      supabase,
      profile,
      req,
      routeSegments(new URL(req.url).pathname),
    );
    return withCors(res, cors);
  } catch (err) {
    console.error("api handler error:", err);
    return withCors(fail(500, "internal error"), cors);
  }
});
