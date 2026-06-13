-- Phase 6: substrate for agents. The events table is the audit trail that
-- every later analysis (timeline, anti-chaos, conditional reminders, snapshots)
-- reads from. Every user interaction, every mutation, and every proactive
-- message gets one row.
--
-- Design notes:
-- - `payload` is loose jsonb so callers can shape the event per-kind without
--   schema churn. Downstream consumers must tolerate missing keys.
-- - `related_entity` is a soft pointer like {"type":"task","id":"<uuid>"};
--   not a foreign key (entities outlive events and vice versa).
-- - We expect this table to grow fast. The two indexes cover the only two
--   read patterns: "events for this user, most recent first" and "events of
--   kind X for this user".

create table events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  source text not null default 'system'
    check (source in ('user', 'system', 'agent', 'integration')),
  payload jsonb not null default '{}'::jsonb,
  related_entity jsonb,
  occurred_at timestamptz not null default now()
);

alter table events enable row level security;

create index events_owner_time_idx on events (owner_id, occurred_at desc);
create index events_owner_kind_time_idx on events (owner_id, kind, occurred_at desc);
