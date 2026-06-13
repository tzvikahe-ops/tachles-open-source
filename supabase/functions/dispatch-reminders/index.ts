import { createServiceClient } from "../_shared/supabase.ts";
import { requireHeaderSecret } from "../_shared/request_auth.ts";
import { sendMessage } from "../_shared/telegram.ts";
import { nextOccurrence } from "../_shared/rrule.ts";
import { collectContext, llmSummary } from "../_shared/integrations/daily_summary.ts";
import { syncDaily } from "../_shared/integrations/obsidian.ts";
import { logEvent } from "../_shared/events.ts";
import {
  listWebPushSubscriptions,
  notificationBody,
  sendWebPush,
  type WebPushSubscriptionRow,
} from "../_shared/integrations/web_push.ts";
import {
  type ConditionParams,
  type ConditionType,
  shouldFire,
} from "../_shared/conditional_eval.ts";
import type { Profile } from "../_shared/profiles.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ReminderRow {
  id: string;
  owner_id: string;
  title: string;
  body: string | null;
  kind: "static" | "dynamic" | "conditional";
  dynamic_handler: string | null;
  dynamic_params: Record<string, unknown>;
  schedule_type: "once" | "recurring";
  rrule: string | null;
  timezone: string;
  condition_type: ConditionType | null;
  condition_params: ConditionParams | null;
  profiles: Profile | null;
}

interface HandlerCtx {
  supabase: SupabaseClient;
  profile: Profile;
}
type DynamicHandler = (
  params: Record<string, unknown>,
  ctx: HandlerCtx,
) => Promise<string>;

// Registry of dynamic-reminder content builders. Add new ones here.
const DYNAMIC_HANDLERS: Record<string, DynamicHandler> = {
  daily_calendar_summary: async (_params, { supabase, profile }) => {
    const ctx = await collectContext(supabase, profile);
    const text = await llmSummary(ctx);
    // Best-effort export to the user's Obsidian vault (no-op if disabled).
    await syncDaily(supabase, profile.id, ctx.date, text);
    return text;
  },
};

// Snooze controls, offered only on plain static reminders. Dynamic (daily
// summary) and conditional reminders re-arm themselves, so a snooze copy there
// would be meaningless. callback_data stays well under Telegram's 64-byte cap:
// "snz:morning:" + a uuid is ~48 chars.
function snoozeKeyboard(reminderId: string) {
  return {
    inline_keyboard: [[
      { text: "⏰ +10 דק׳", callback_data: `snz:10:${reminderId}` },
      { text: "⏰ +שעה", callback_data: `snz:60:${reminderId}` },
      { text: "🌅 בוקר", callback_data: `snz:morning:${reminderId}` },
    ]],
  };
}

async function buildBody(
  reminder: ReminderRow,
  ctx: HandlerCtx,
): Promise<string> {
  if (reminder.kind === "dynamic" && reminder.dynamic_handler) {
    const handler = DYNAMIC_HANDLERS[reminder.dynamic_handler];
    if (handler) return await handler(reminder.dynamic_params ?? {}, ctx);
  }
  return [reminder.title, reminder.body].filter(Boolean).join("\n");
}

async function claim(
  supabase: SupabaseClient,
  id: string,
  now: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("reminders")
    .update({ status: "firing", last_fired_at: now })
    .eq("id", id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  return data !== null;
}

async function finalize(
  supabase: SupabaseClient,
  reminder: ReminderRow,
  now: Date,
): Promise<void> {
  // Conditional reminders re-arm: bump run_at by 24h so the predicate is
  // re-evaluated tomorrow.
  if (reminder.kind === "conditional") {
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("reminders")
      .update({ status: "active", run_at: next })
      .eq("id", reminder.id);
    return;
  }
  if (reminder.schedule_type === "recurring" && reminder.rrule) {
    const next = nextOccurrence(reminder.rrule, now, reminder.timezone);
    if (next) {
      await supabase.from("reminders")
        .update({ status: "active", run_at: next.toISOString() })
        .eq("id", reminder.id);
      return;
    }
  }
  await supabase.from("reminders").update({ status: "done" }).eq(
    "id",
    reminder.id,
  );
}

Deno.serve(async (req: Request) => {
  const expectedSecret = Deno.env.get("DISPATCH_SECRET");
  const authError = requireHeaderSecret(
    expectedSecret,
    req.headers.get("x-dispatch-secret"),
  );
  if (authError) return authError;

  const supabase = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: due, error } = await supabase
    .from("reminders")
    .select(
      "id, owner_id, title, body, kind, dynamic_handler, dynamic_params, schedule_type, rrule, timezone, condition_type, condition_params, profiles(id, telegram_user_id, display_name, role, locale, timezone, active_list_id, active_task_id)",
    )
    .eq("status", "active")
    .lte("run_at", nowIso)
    .limit(100)
    .returns<ReminderRow[]>();

  if (error) {
    console.error("fetch due reminders failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  let sent = 0;
  const ownerIds = [
    ...new Set((due ?? []).map((reminder) => reminder.owner_id)),
  ];
  let pushRows: WebPushSubscriptionRow[] = [];
  try {
    pushRows = await listWebPushSubscriptions(supabase, ownerIds);
  } catch (error) {
    console.error("web push subscriptions unavailable:", error);
  }
  const pushByOwner = new Map<string, WebPushSubscriptionRow[]>();
  for (const row of pushRows) {
    const ownerRows = pushByOwner.get(row.owner_id) ?? [];
    ownerRows.push(row);
    pushByOwner.set(row.owner_id, ownerRows);
  }

  for (const reminder of due ?? []) {
    const profile = reminder.profiles;
    if (!profile) continue;
    const ownerPush = pushByOwner.get(reminder.owner_id) ?? [];
    if (!profile.telegram_user_id && ownerPush.length === 0) continue;

    // Conditional reminders: evaluate predicate before claiming. If the
    // condition isn't met, push run_at forward 24h and skip silently.
    if (
      reminder.kind === "conditional" && reminder.condition_type &&
      reminder.condition_params
    ) {
      const fire = await shouldFire(
        supabase,
        reminder.owner_id,
        reminder.condition_type,
        reminder.condition_params,
      );
      if (!fire) {
        const nextCheck = new Date(now.getTime() + 24 * 60 * 60 * 1000)
          .toISOString();
        await supabase.from("reminders").update({ run_at: nextCheck }).eq(
          "id",
          reminder.id,
        );
        continue;
      }
    }

    if (!(await claim(supabase, reminder.id, nowIso))) continue;

    try {
      const body = await buildBody(reminder, { supabase, profile });
      let telegramSent = false;
      if (profile.telegram_user_id) {
        try {
          const extra = reminder.kind === "static"
            ? { reply_markup: snoozeKeyboard(reminder.id) }
            : {};
          await sendMessage(profile.telegram_user_id, body, extra);
          telegramSent = true;
        } catch (error) {
          console.error(
            `telegram delivery failed for reminder ${reminder.id}:`,
            error,
          );
        }
      }
      const pushResult = await sendWebPush(supabase, ownerPush, {
        title: reminder.title || "תזכורת מתכלס",
        body: notificationBody(body, reminder.title),
        url: "/?view=reminders",
        tag: `reminder-${reminder.id}`,
      });
      if (!telegramSent && pushResult.sent === 0) {
        throw new Error("no reminder delivery channel succeeded");
      }
      sent++;
      const isDailySummary = reminder.dynamic_handler === "daily_calendar_summary";
      await logEvent(supabase, profile.id, {
        kind: isDailySummary ? "summary_sent" : "reminder_fired",
        source: "system",
        payload: {
          title: reminder.title,
          kind: reminder.kind,
          telegram: telegramSent,
          web_push: pushResult.sent,
        },
        relatedEntity: { type: "reminder", id: reminder.id },
      });
      await finalize(supabase, reminder, now);
    } catch (err) {
      console.error(`reminder ${reminder.id} failed, releasing claim:`, err);
      await supabase.from("reminders").update({ status: "active" }).eq(
        "id",
        reminder.id,
      );
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
