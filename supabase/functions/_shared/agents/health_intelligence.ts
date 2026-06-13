import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../profiles.ts";
import { registerAgent } from "./registry.ts";
import { listRecentMetrics } from "../health/metrics.ts";

// Health Intelligence: weekly Sunday morning. Looks at 14 days of metrics and
// surfaces ONE correlation or trend. Stays silent when data is sparse.

export const SYSTEM_PROMPT =
  `אתה סוכן בריאות אישי. תפקידך לזהות דפוס אחד שווה אזכור מתוך נתוני 14 הימים האחרונים.

עקרונות:
- אל תמציא מתאמים. אם יש פחות מ-7 נקודות נתונים לכל מטריקה — קרא ל-noop.
- חפש דפוס פשוט: "שינה < 6 שעות → מצב רוח יורד למחרת", "אימון מעל 30 דק → שינה ארוכה יותר".
- 2-4 שורות, ניסוח אישי ("שמתי לב ש...", "לפי הנתונים שלך...").
- אל תיתן עצה רפואית. רק תיאור אמפירי + הצעת ניסוי קטן.
- confidence >= 0.7 לשליחה.

מטריקות אפשריות: sleep_hours, mood_1_10, workout_minutes, water_ml, weight_kg, pain_1_10, steps.`;

async function loadContext(
  supabase: SupabaseClient,
  profile: Profile,
  _state: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const records = await listRecentMetrics(supabase, profile.id, 14, 500);
  // Group by metric for the LLM.
  const byMetric: Record<string, Array<{ value: number; at: string }>> = {};
  for (const r of records) {
    if (!byMetric[r.metric]) byMetric[r.metric] = [];
    byMetric[r.metric].push({ value: r.value, at: r.occurred_at });
  }
  return {
    window_days: 14,
    metrics: byMetric,
    totals: Object.fromEntries(
      Object.entries(byMetric).map(([k, v]) => [k, v.length]),
    ),
  };
}

registerAgent("health_intelligence", { systemPrompt: SYSTEM_PROMPT, loadContext });
