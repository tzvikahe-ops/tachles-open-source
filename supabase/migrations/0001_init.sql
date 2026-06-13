-- Tachles — initial schema
-- Two layers: "המעיין" (Wellspring / memory) and "הגשר" (Bridge / action).

create extension if not exists "vector";
create extension if not exists "pg_trgm";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Owners and (later) friends. Not tied to auth.users: the bot identifies a
-- person by their Telegram id and upserts a profile row. An auth link can be
-- added later if a direct web/mobile client is introduced.
create table profiles (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint unique not null,
  display_name text,
  role text not null default 'owner' check (role in ('owner', 'friend')),
  locale text not null default 'he',
  timezone text not null default 'Asia/Jerusalem',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Friend-to-friend links (Phase 4).
create table f2f_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  friend_profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, friend_profile_id)
);

-- הגשר / Bridge — reminders.
-- 'static' = fixed title/body; 'dynamic' = content composed at fire time by a
-- named handler (e.g. daily_calendar_summary). Recurrence is stored as an iCal
-- RRULE string and re-materialized into run_at after each fire.
create table reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  kind text not null default 'static' check (kind in ('static', 'dynamic')),
  dynamic_handler text,
  dynamic_params jsonb not null default '{}'::jsonb,
  schedule_type text not null default 'once' check (schedule_type in ('once', 'recurring')),
  run_at timestamptz,
  rrule text,
  timezone text not null default 'Asia/Jerusalem',
  -- 'firing' is a transient claim state used by the dispatcher for idempotency.
  status text not null default 'active' check (status in ('active', 'firing', 'done', 'cancelled')),
  last_fired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_due_idx on reminders (run_at) where status = 'active';

-- הגשר / Bridge — lists.
create table lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  kind text not null default 'checklist' check (kind in ('checklist', 'note', 'shopping')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  content text not null,
  is_done boolean not null default false,
  position integer not null default 0,
  source text not null default 'text' check (source in ('text', 'voice')),
  source_audio_file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index list_items_list_idx on list_items (list_id, position);

-- המעיין / Wellspring — memory bubbles.
create table memory_bubbles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  type text not null default 'knowledge' check (type in ('knowledge', 'inspiration', 'reflection')),
  title text,
  content text not null,
  tags text[] not null default '{}',
  source_url text,
  embedding vector(1536),
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Hebrew full-text is weak in Postgres; trigram + (later) vector search carry recall.
create index memory_bubbles_content_trgm on memory_bubbles using gin (content gin_trgm_ops);
create index memory_bubbles_tags_idx on memory_bubbles using gin (tags);

-- הגשר / Bridge — tasks with subtasks.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  parent_task_id uuid references tasks(id) on delete cascade,
  title text not null,
  notes text,
  priority smallint not null default 0,
  due_at timestamptz,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  position integer not null default 0,
  board text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_parent_idx on tasks (parent_task_id);

-- ארגז הזיכרון / Memory Trunk — file metadata (bytes live in Storage). Phase 3.
create table files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  bucket text not null default 'memory-trunk',
  storage_path text not null,
  filename text,
  mime_type text,
  size_bytes bigint,
  is_encrypted boolean not null default false,
  encryption_meta jsonb not null default '{}'::jsonb,
  linked_entity jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table list_items
  add constraint list_items_audio_fk
  foreign key (source_audio_file_id) references files(id) on delete set null;

-- OAuth tokens for calendar / workspace integrations (Phase 2+).
-- Tokens must be encrypted at rest (Supabase Vault / pgsodium) before storing real values.
create table integration_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  scopes text[] not null default '{}',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();
create trigger trg_f2f_links_updated before update on f2f_links
  for each row execute function set_updated_at();
create trigger trg_reminders_updated before update on reminders
  for each row execute function set_updated_at();
create trigger trg_lists_updated before update on lists
  for each row execute function set_updated_at();
create trigger trg_list_items_updated before update on list_items
  for each row execute function set_updated_at();
create trigger trg_memory_bubbles_updated before update on memory_bubbles
  for each row execute function set_updated_at();
create trigger trg_tasks_updated before update on tasks
  for each row execute function set_updated_at();
create trigger trg_files_updated before update on files
  for each row execute function set_updated_at();
create trigger trg_integration_tokens_updated before update on integration_tokens
  for each row execute function set_updated_at();

-- RLS is enabled on every table. With no policies, the anon and authenticated
-- roles are denied; the bot uses the service-role key, which bypasses RLS, and
-- enforces ownership in code (telegram_user_id -> profile). Owner/share policies
-- are added in Phase 4 when a direct (non-bot) client needs row access.
alter table profiles enable row level security;
alter table f2f_links enable row level security;
alter table reminders enable row level security;
alter table lists enable row level security;
alter table list_items enable row level security;
alter table memory_bubbles enable row level security;
alter table tasks enable row level security;
alter table files enable row level security;
alter table integration_tokens enable row level security;
