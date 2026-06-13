import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { registerAgent } from "./registry.ts";
import { listActiveFacts } from "./fact_extractor.ts";
import { loadLatestSnapshot } from "../snapshots.ts";
import { listOwnerEventsBetween } from "../integrations/calendar_sync.ts";
import { listPinnedBubbles } from "../wellspring/memories.ts";

// Chief of Staff: glance at the user's whole situation twice a day. Mostly
// stays quiet. When it speaks, picks the ONE thing that matters.

export const SYSTEM_PROMPT =
  `אתה ראש מטה אישי של המשתמש. תפקידך לראות תמונה רחבה ולומר דבר אחד חשוב — או לשתוק.

עקרונות:
- **שתוק כברירת מחדל.** קרא ל-noop אלא אם יש משהו ש**באמת** מחייב התייחסות עכשיו.
- שיחה אנושית, חמה אבל לא חנפנית. עברית מדוברת.
- 1-3 שורות. אל תפרט פלאון. אל תחזור על מה שהמשתמש כבר יודע.
- אל תזכיר את עצמך ("בתור ראש מטה...") — דבר ישירות.

דברים שראויים להעלות:
- חוסר התאמה בין מה שאמר שחשוב לו לבין מה שעשה השבוע.
- משימה אחת בעדיפות גבוהה שתקועה זמן רב.
- ארוע יומן קרוב שעלול לתפוס אותו לא מוכן.
- streak שנשבר על משהו שהוא הצהיר עליו (בריאות, התקשרות לקרובים).

דברים שלא ראויים:
- "תהיה לך יום מעולה".
- אישור כללי.
- "שמתי לב ש...".
- חזרה על נתונים בלי תובנה.

אם אתה שולח — צרף confidence (אמיתי, בין 0 ל-1). אם פחות מ-0.7 — שלח noop.`;

async function loadContext(
  supabase: SupabaseClient,
  profile: Profile,
  _state: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshot = await loadLatestSnapshot(supabase, profile.id);

  const facts = await listActiveFacts(supabase, profile.id, [
    "priority",
    "goal",
    "value",
    "constraint",
  ]);

  // Calendar window: now → end of today.
  const now = new Date();
  const endLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: profile.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const endIso = new Date(`${endLocal}T23:59:59Z`).toISOString();
  const events = await listOwnerEventsBetween(supabase, profile.id, now.toISOString(), endIso);

  // Top 5 open tasks.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, priority, updated_at")
    .eq("owner_id", profile.id)
    .neq("status", "done")
    .is("parent_task_id", null)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: true })
    .limit(5);

  const pinned = await listPinnedBubbles(supabase, profile.id);

  return {
    snapshot: snapshot ?? null,
    facts: facts.map((f) => ({
      type: f.fact_type,
      predicate: f.predicate,
      object: f.object,
      since: f.valid_from,
    })),
    pinned_principles: pinned.map((b) => b.content),
    today_events: events.map((e) => ({
      title: e.title,
      start: e.start_at,
      all_day: e.all_day,
    })),
    top_open_tasks: tasks ?? [],
  };
}

registerAgent("chief_of_staff", { systemPrompt: SYSTEM_PROMPT, loadContext });
