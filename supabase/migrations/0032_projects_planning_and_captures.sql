-- Personal projects connect Bridge actions with Wellspring knowledge.

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  goal text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'done', 'archived')),
  target_date date,
  current_summary text,
  next_step text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_status_idx
  on projects (owner_id, status, updated_at desc);

alter table projects enable row level security;

create trigger trg_projects_updated before update on projects
  for each row execute function set_updated_at();

-- One project can draw context from existing memories/files and lightweight
-- URL or note resources without copying ownership-sensitive domain rows.
create table project_resources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  resource_type text not null
    check (resource_type in ('memory', 'file', 'url', 'note')),
  resource_id uuid,
  title text,
  url text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (resource_type in ('memory', 'file') and resource_id is not null)
    or
    (resource_type = 'url' and url is not null)
    or
    (resource_type = 'note' and content is not null)
  )
);

create index project_resources_project_idx
  on project_resources (project_id, created_at desc);

alter table project_resources enable row level security;

-- Shared text/URL intake from the PWA. Captures remain an inbox until the user
-- deliberately turns them into a memory, task, or project resource.
create table captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  source text not null default 'manual'
    check (source in ('manual', 'web_share', 'telegram')),
  title text,
  text text,
  url text,
  status text not null default 'inbox'
    check (status in ('inbox', 'processed', 'dismissed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  check (coalesce(nullif(trim(title), ''), nullif(trim(text), ''), nullif(trim(url), '')) is not null)
);

create index captures_owner_status_idx
  on captures (owner_id, status, created_at desc);

alter table captures enable row level security;

-- Extend tasks for project context, automatic scheduling, and the explicit
-- "waiting for someone" state. Existing task rows retain their current shape.
alter table tasks
  drop constraint if exists tasks_status_check;

alter table tasks
  add constraint tasks_status_check
    check (status in ('todo', 'doing', 'waiting', 'done')),
  add column project_id uuid references projects(id) on delete set null,
  add column estimated_minutes integer
    check (estimated_minutes is null or estimated_minutes between 5 and 1440),
  add column energy_level text
    check (energy_level is null or energy_level in ('low', 'medium', 'high')),
  add column schedule_mode text not null default 'flexible'
    check (schedule_mode in ('flexible', 'fixed')),
  add column scheduled_start timestamptz,
  add column scheduled_end timestamptz,
  add column waiting_for text,
  add column waiting_reason text,
  add column follow_up_at timestamptz,
  add constraint tasks_scheduled_window_check
    check (
      (scheduled_start is null and scheduled_end is null)
      or
      (scheduled_start is not null and scheduled_end is not null and scheduled_end > scheduled_start)
    ),
  add constraint tasks_waiting_context_check
    check (
      status <> 'waiting'
      or coalesce(nullif(trim(waiting_for), ''), nullif(trim(waiting_reason), '')) is not null
    );

create index tasks_project_status_idx
  on tasks (project_id, status, priority desc, created_at);

create index tasks_follow_up_idx
  on tasks (follow_up_at)
  where status = 'waiting' and follow_up_at is not null;
