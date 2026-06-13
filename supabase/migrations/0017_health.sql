-- Phase 7: health metrics ingest. Each row is one observation. The Health
-- Intelligence agent reads windows of this table and correlates metrics.

create table health_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  metric text not null check (metric in (
    'sleep_hours', 'mood_1_10', 'workout_minutes',
    'meds_taken', 'water_ml', 'weight_kg', 'pain_1_10', 'steps'
  )),
  value numeric not null,
  unit text,
  occurred_at timestamptz not null default now(),
  source text not null default 'manual'
    check (source in ('manual', 'voice', 'integration')),
  note text
);

alter table health_metrics enable row level security;

create index health_metrics_owner_metric_time_idx
  on health_metrics (owner_id, metric, occurred_at desc);
