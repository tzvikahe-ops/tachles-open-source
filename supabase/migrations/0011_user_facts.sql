-- Phase 6.2: structured long-term facts about the user. Distinct from
-- memory_bubbles (which are free-form rich text). user_facts capture stable
-- statements the system can reason over: priorities, goals, preferences,
-- routines, relationships, values, constraints.
--
-- Slowly-changing-dimension pattern: a new fact with the same (owner, type,
-- subject, predicate) closes the previous one (valid_to = now()) and inserts
-- a new row that supersedes it. Queries asking "what is true now" filter on
-- valid_to is null.

create table user_facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  fact_type text not null check (fact_type in (
    'priority', 'goal', 'preference', 'relationship',
    'routine', 'value', 'constraint', 'meta'
  )),
  subject text not null default 'user',
  predicate text not null,
  object jsonb not null,
  confidence numeric(3,2) not null default 0.7
    check (confidence >= 0 and confidence <= 1),
  source_event_id uuid references events(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  supersedes_id uuid references user_facts(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table user_facts enable row level security;

-- Active-facts lookup (most common: "what does this user prioritize?").
create index user_facts_active_idx
  on user_facts (owner_id, fact_type, predicate)
  where valid_to is null;

-- Full history for one fact (drift detection).
create index user_facts_history_idx
  on user_facts (owner_id, fact_type, subject, predicate, valid_from desc);
