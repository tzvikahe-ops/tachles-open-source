-- Phase 6.5: daily per-user state snapshot. A single jsonb row per day per
-- owner captures aggregated counts so Chief of Staff / Anti-Chaos / Goal
-- Drift / Passive Intelligence don't have to re-aggregate every run.

create table state_snapshots (
  owner_id uuid not null references profiles(id) on delete cascade,
  snapshot_date date not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, snapshot_date)
);

alter table state_snapshots enable row level security;
create index state_snapshots_owner_recent_idx
  on state_snapshots (owner_id, snapshot_date desc);
