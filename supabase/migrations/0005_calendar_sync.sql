-- Phase 2: external calendar sync (Google / Outlook) + dynamic daily summary.
--
-- Tokens are stored in the existing `integration_tokens` table (0001). This
-- migration adds:
--   oauth_states     — short-lived CSRF + identity tokens for the OAuth dance
--   calendar_events  — pulled events from the user's external calendars
--   user_settings    — per-user preferences (daily summary toggle/time/chat)

create table oauth_states (
  state text primary key,
  owner_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  chat_id bigint not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

alter table oauth_states enable row level security;
create index on oauth_states (expires_at);

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  calendar_id text not null,
  external_id text not null,
  title text not null,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  status text not null default 'confirmed',
  synced_at timestamptz not null default now(),
  unique (owner_id, provider, external_id)
);

alter table calendar_events enable row level security;
create index calendar_events_owner_start_idx on calendar_events (owner_id, start_at);
create index calendar_events_owner_end_idx on calendar_events (owner_id, end_at);

create table user_settings (
  owner_id uuid primary key references profiles(id) on delete cascade,
  daily_summary_enabled boolean not null default false,
  daily_summary_time time not null default '07:00',
  daily_summary_chat_id bigint,
  daily_summary_last_sent_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create trigger trg_user_settings_updated before update on user_settings
  for each row execute function set_updated_at();
