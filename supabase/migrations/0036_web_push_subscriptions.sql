-- Web Push subscriptions for the standalone PWA. A profile may register
-- multiple devices; endpoints are globally unique and removed automatically
-- when a push service reports that they expired.

create table web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  expiration_time bigint,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index web_push_subscriptions_owner_idx
  on web_push_subscriptions (owner_id, updated_at desc);

create trigger trg_web_push_subscriptions_updated
  before update on web_push_subscriptions
  for each row execute function set_updated_at();

alter table web_push_subscriptions enable row level security;
