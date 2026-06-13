-- Phase 4: F2F (Friend-to-Friend) sharing.
--
-- Builds on the existing `f2f_links` table (created in 0001) with two new tables:
--   invites — short-lived tokens for Telegram deep-link invitations
--   shares  — per-resource ACL ('owner shares resource_id of resource_type with friend')

create table invites (
  token text primary key,
  owner_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  consumed_by uuid references profiles(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table invites enable row level security;
create index on invites (expires_at);

create table shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  friend_id uuid not null references profiles(id) on delete cascade,
  resource_type text not null check (resource_type in ('list', 'task', 'bubble', 'reminder')),
  resource_id uuid not null,
  permission text not null default 'read' check (permission in ('read', 'comment', 'write')),
  created_at timestamptz not null default now(),
  unique (owner_id, friend_id, resource_type, resource_id)
);

alter table shares enable row level security;
create index shares_friend_type_idx on shares (friend_id, resource_type);
create index shares_owner_idx on shares (owner_id);
create index shares_resource_idx on shares (resource_type, resource_id);
