-- Phase 6.3: agent registry, per-user state, and run history.
--
-- agents: global definitions seeded in migration 0018. Each row is a persona
--   with a schedule and an output policy. The runner loads context per-user
--   and lets the LLM decide whether to send anything.
-- agent_runs: append-only history of every invocation (for dedupe, /agents
--   stats, and debugging).
-- agent_state: per-user memory the agent itself maintains across runs
--   (e.g. "last time I nudged about calling אמא: 2026-05-25").

create table agents (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,             -- e.g. 'chief_of_staff'
  role text not null,                    -- human-readable label
  system_prompt text not null,
  schedule_cron text,                    -- null = trigger-only (not scheduled)
  channel text not null default 'telegram',
  enabled boolean not null default true,
  output_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table agents enable row level security;
create trigger trg_agents_updated before update on agents
  for each row execute function set_updated_at();

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'sent', 'noop', 'error')),
  output jsonb,
  error text,
  sent_message_text text,
  created_at timestamptz not null default now()
);

alter table agent_runs enable row level security;

create index agent_runs_owner_finished_idx
  on agent_runs (owner_id, agent_id, finished_at desc);
create index agent_runs_pending_idx
  on agent_runs (status, scheduled_for)
  where status in ('queued', 'running');

create table agent_state (
  agent_id uuid not null references agents(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (agent_id, owner_id)
);

alter table agent_state enable row level security;
create trigger trg_agent_state_updated before update on agent_state
  for each row execute function set_updated_at();

-- Per-user per-agent enable flag (defaults to enabled). Lets users disable
-- a single agent without touching the global registry.
create table user_agent_settings (
  owner_id uuid not null references profiles(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  enabled boolean not null default true,
  overrides jsonb not null default '{}'::jsonb,
  primary key (owner_id, agent_id)
);

alter table user_agent_settings enable row level security;
