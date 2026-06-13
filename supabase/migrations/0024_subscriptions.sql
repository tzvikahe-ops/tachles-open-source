-- Tachles → SaaS Phase A: subscriptions schema
--
-- Single-owner mode is preserved by grandfathering ALL existing profiles as
-- `plan='founder'`, `status='active'`. Trial creation for brand-new profiles
-- happens in code (_shared/profiles.ts), not via a DB default, because the
-- 7-day window needs to be anchored to insert-time in app code (and we want
-- the trial only on truly new users, not on every backfilled row).

create type plan_tier as enum ('trial', 'basic', 'pro', 'founder');
create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  plan plan_tier not null,
  status subscription_status not null,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  trial_ends_at timestamptz,
  -- Cardcom integration columns (populated by cardcom-webhook in Phase B)
  cardcom_token text,
  cardcom_terminal text,
  cardcom_low_profile_code text,
  cardcom_invoice_number text,
  last_payment_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most ONE non-terminal subscription per owner. Canceled/expired rows are
-- kept for history; a new sub overwrites only when the prior one is terminal.
create unique index subscriptions_one_active_per_owner
  on subscriptions (owner_id)
  where status in ('trialing', 'active', 'past_due');

create index subscriptions_owner_idx on subscriptions (owner_id);
create index subscriptions_status_idx on subscriptions (status);

create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

alter table subscriptions enable row level security;
-- no policies: service-role only, ownership enforced in code (CLAUDE.md pattern)

-- Idempotency for Cardcom webhook (Phase B). Cardcom retries on non-2xx, so we
-- dedupe by their LowProfileCode (unique per transaction).
create table cardcom_webhook_events (
  low_profile_code text primary key,
  owner_id uuid references profiles(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);
alter table cardcom_webhook_events enable row level security;

-- Grandfather: every existing profile gets a permanent founder subscription so
-- nothing breaks for current users (including the bot owner) when paywall
-- middleware lands in Phase C. New profiles after this migration go through
-- the code path in getOrCreateProfile that creates a 7-day trial.
insert into subscriptions (owner_id, plan, status, current_period_start, current_period_end)
select id, 'founder'::plan_tier, 'active'::subscription_status, now(), '2099-12-31T00:00:00Z'::timestamptz
from profiles
where not exists (
  select 1 from subscriptions s where s.owner_id = profiles.id
);
