-- Obsidian-via-Drive integration. Tachles pushes bubbles / tasks / daily
-- summaries as markdown files into a "Tachles" folder in the user's Google
-- Drive. The user syncs that folder locally (Google Drive Desktop) and
-- points Obsidian at it as a vault.
--
-- Two pieces of state per user:
--   obsidian_enabled            bool
--   obsidian_drive_folder_id    text  (root "Tachles" folder created on enable)
-- And a mapping table so we can update / delete the right file when a tachles
-- entity changes (instead of stacking duplicates).

alter table user_settings
  add column if not exists obsidian_enabled boolean not null default false,
  add column if not exists obsidian_drive_folder_id text,
  add column if not exists obsidian_subfolders jsonb not null default '{}'::jsonb;

create table obsidian_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  entity_type text not null check (entity_type in ('bubble', 'task', 'daily')),
  entity_id text not null,
  drive_file_id text not null,
  last_synced_at timestamptz not null default now(),
  unique (owner_id, entity_type, entity_id)
);

alter table obsidian_exports enable row level security;
create index obsidian_exports_owner_idx on obsidian_exports (owner_id, entity_type);
