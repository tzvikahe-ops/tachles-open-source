import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { registerAgent } from "./registry.ts";
import { listActiveFacts } from "./fact_extractor.ts";
import { loadLatestSnapshot } from "../snapshots.ts";
import { listOwnerEventsBetween } from "../integrations/calendar_sync.ts";
import { averageLast7Days } from "../health/metrics.ts";

// Smart Morning: the single daily "hook" — one message at the start of the day
// that is genuinely worth opening Telegram for. It consolidates what used to be
// split between the /summary dynamic reminder (calendar + reminders + tasks)
// and a low-stakes greeting:
//   1. A concrete orientation brief: today's events, reminders, the task that
//      matters, last night's sleep if recorded.
//   2. ONE short proactive nudge grounded in the user's stated priorities/goals
//      (user_facts) or a notable trend in the latest snapshot — or nothing.
// It always speaks (this is the daily anchor), capped to 1/day, skips in quiet
// hours. It is NOT the analytical "chief of staff" — keep it concrete and warm.

export const SYSTEM_PROMPT = `אתה הסוכן של 'בוקר טוב' — ההודעה היומית הקבועה שפותחת למשתמש את היום.
המטרה: שתהיה לו סיבה אחת טובה לפתוח את הטלגרם כל בוקר.

מבנה ההודעה (עברית מדוברת, חמה, 3-5 שורות, בלי לחזור על מספרים):
- שורה ראשונה: ברכת בוקר + הקריאה הכי בולטת של היום (הפגישה הראשונה / המשימה הדחופה).
- אוריינטציה קצרה: כמה פגישות יש, תזכורות חשובות להיום, והמשימה האחת שהכי שווה לקדם.
- אם רשום: כמה ישנת אתמול (רק אם זה חריג או שווה ציון).
- שורה אחת אחרונה — נדנוד פרואקטיבי **אחד בלבד**: חיבור בין מה שהמשתמש הצהיר שחשוב לו (priorities/goals) לבין מה שמופיע היום, או מגמה בולטת מה-snapshot. אם אין משהו אמיתי — ותר עליו לגמרי.

מה לא לעשות:
- אל תנתח דפוסים לעומק ואל תיתן הרצאות — זה לא ראש מטה.
- אל תזכיר את עצמך ("כסוכן...").
- אל תמציא נתונים שלא נמסרו לך. אם אין אירועים/משימות — ברכה קצרה כללית מספיקה.
- אל תחזור על אותו מספר פעמיים.

confidence: 0.8 כברירת מחדל. אם אין שום אירוע/משימה/תזכורת — 0.6 וברכה כללית.
תמיד שלח (send_message), אלא אם השעה כבר אחרי 10:00 — אז זה כבר לא בוקר, שלח noop.`;

async function loadContext(
  supabase: SupabaseClient,
  profile: Profile,
  _state: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const now = new Date();
  const nowIso = now.toISOString();
  const endLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: profile.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const endIso = new Date(`${endLocal}T23:59:59Z`).toISOString();

  const events = await listOwnerEventsBetween(
    supabase,
    profile.id,
    nowIso,
    endIso,
  );

  // Today's remaining static reminders (now → end of local day). This is the
  // content the retired daily_calendar_summary used to surface.
  const { data: reminders } = await supabase
    .from("reminders")
    .select("title, run_at")
    .eq("owner_id", profile.id)
    .eq("status", "active")
    .eq("kind", "static")
    .gte("run_at", nowIso)
    .lte("run_at", endIso)
    .order("run_at", { ascending: true })
    .limit(10);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("title, priority")
    .eq("owner_id", profile.id)
    .neq("status", "done")
    .is("parent_task_id", null)
    .order("priority", { ascending: false })
    .limit(3);

  // What the user said matters — used for the single proactive nudge.
  let facts: { type: string; predicate: string; object: unknown }[] = [];
  try {
    const active = await listActiveFacts(supabase, profile.id, [
      "priority",
      "goal",
    ]);
    facts = active.map((f) => ({
      type: f.fact_type,
      predicate: f.predicate,
      object: f.object,
    }));
  } catch (_) { /* swallow */ }

  let snapshot: Record<string, unknown> | null = null;
  try {
    snapshot = await loadLatestSnapshot(supabase, profile.id) as
      | Record<string, unknown>
      | null;
  } catch (_) { /* swallow */ }

  // Sleep last night = most recent sleep entry in the last 24h.
  let sleep_last_night: number | null = null;
  try {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { data } = await supabase
      .from("health_metrics")
      .select("value")
      .eq("owner_id", profile.id)
      .eq("metric", "sleep_hours")
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ value: number }>();
    sleep_last_night = data?.value ?? null;
  } catch (_) { /* swallow */ }

  let sleep_avg_7d: number | null = null;
  try {
    sleep_avg_7d = await averageLast7Days(supabase, profile.id, "sleep_hours");
  } catch (_) { /* swallow */ }

  return {
    today_events: events.map((e) => ({
      title: e.title,
      start: e.start_at,
      all_day: e.all_day,
    })),
    today_reminders: (reminders ?? []).map((r) => ({
      title: r.title,
      at: r.run_at,
    })),
    top_open_tasks: tasks ?? [],
    stated_priorities: facts,
    snapshot,
    sleep_last_night,
    sleep_avg_7d,
  };
}

// Quick-action buttons appended above the 👍/👎 feedback row. These reuse the
// existing `menu:<key>` callbacks the webhook already routes, so a tap jumps
// straight into the full day / task / focus view without any typing.
function actionKeyboard(): { text: string; callback_data: string }[][] {
  return [[
    { text: "📅 כל היום", callback_data: "menu:today" },
    { text: "✅ משימות", callback_data: "menu:tasks" },
    { text: "🎯 פוקוס", callback_data: "menu:focus" },
  ]];
}

registerAgent("smart_morning", {
  systemPrompt: SYSTEM_PROMPT,
  loadContext,
  actionKeyboard,
});
