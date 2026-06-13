import type { SupabaseClient } from "@supabase/supabase-js";

export type HealthMetric =
  | "sleep_hours"
  | "mood_1_10"
  | "workout_minutes"
  | "meds_taken"
  | "water_ml"
  | "weight_kg"
  | "pain_1_10"
  | "steps";

export const HEALTH_METRICS: HealthMetric[] = [
  "sleep_hours",
  "mood_1_10",
  "workout_minutes",
  "meds_taken",
  "water_ml",
  "weight_kg",
  "pain_1_10",
  "steps",
];

export const METRIC_LABELS: Record<HealthMetric, string> = {
  sleep_hours: "😴 שינה (שעות)",
  mood_1_10: "🙂 מצב רוח (1-10)",
  workout_minutes: "💪 אימון (דקות)",
  meds_taken: "💊 תרופות",
  water_ml: '💧 מים (מ"ל)',
  weight_kg: '⚖️ משקל (ק"ג)',
  pain_1_10: "🤕 כאב (1-10)",
  steps: "👟 צעדים",
};

const METRIC_ALIASES: Record<string, HealthMetric> = {
  sleep: "sleep_hours",
  שינה: "sleep_hours",
  ישנתי: "sleep_hours",
  mood: "mood_1_10",
  "מצב רוח": "mood_1_10",
  מצב_רוח: "mood_1_10",
  workout: "workout_minutes",
  אימון: "workout_minutes",
  כושר: "workout_minutes",
  meds: "meds_taken",
  תרופות: "meds_taken",
  תרופה: "meds_taken",
  water: "water_ml",
  מים: "water_ml",
  weight: "weight_kg",
  משקל: "weight_kg",
  pain: "pain_1_10",
  כאב: "pain_1_10",
  steps: "steps",
  צעדים: "steps",
};

export function normalizeMetric(input: string): HealthMetric | null {
  const k = input.trim().toLowerCase();
  if (HEALTH_METRICS.includes(k as HealthMetric)) return k as HealthMetric;
  return METRIC_ALIASES[k] ?? null;
}

export interface HealthRecord {
  id: string;
  metric: HealthMetric;
  value: number;
  unit: string | null;
  occurred_at: string;
  note: string | null;
}

export async function logMetric(
  supabase: SupabaseClient,
  ownerId: string,
  metric: HealthMetric,
  value: number,
  opts: { unit?: string; source?: "manual" | "voice" | "integration"; note?: string } = {},
): Promise<string> {
  const { data, error } = await supabase
    .from("health_metrics")
    .insert({
      owner_id: ownerId,
      metric,
      value,
      unit: opts.unit ?? null,
      source: opts.source ?? "manual",
      note: opts.note ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`logMetric failed: ${error?.message ?? "no row"}`);
  return data.id;
}

export async function averageLast7Days(
  supabase: SupabaseClient,
  ownerId: string,
  metric: HealthMetric,
): Promise<number | null> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("health_metrics")
    .select("value")
    .eq("owner_id", ownerId)
    .eq("metric", metric)
    .gte("occurred_at", since)
    .returns<{ value: number }[]>();
  if (error) throw new Error(`averageLast7Days failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  return data.reduce((a, r) => a + Number(r.value), 0) / data.length;
}

export async function listRecentMetrics(
  supabase: SupabaseClient,
  ownerId: string,
  windowDays = 14,
  limit = 200,
): Promise<HealthRecord[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("health_metrics")
    .select("id, metric, value, unit, occurred_at, note")
    .eq("owner_id", ownerId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(limit)
    .returns<HealthRecord[]>();
  if (error) throw new Error(`listRecentMetrics failed: ${error.message}`);
  return data ?? [];
}
