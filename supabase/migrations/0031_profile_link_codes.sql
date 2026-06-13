-- One-time codes for linking a Supabase Auth identity to an existing profile.
-- Only a keyed SHA-256 hash is stored; the raw human-readable code is returned
-- once by the server and expires after ten minutes.

create table profile_link_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_identity_id uuid references profile_identities(id) on delete set null,
  created_at timestamptz not null default now()
);

create index profile_link_codes_profile_active_idx
  on profile_link_codes (profile_id, expires_at desc)
  where consumed_at is null;

alter table profile_link_codes enable row level security;

-- Check every FK that targets profiles rather than maintaining a fragile list
-- of user-data tables. Identity and link-code rows are intentionally excluded:
-- they are the rows being moved/consumed by the linking transaction itself.
create or replace function profile_has_linkable_data(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fk record;
  v_exists boolean;
begin
  for v_fk in
    select
      ns.nspname as schema_name,
      tbl.relname as table_name,
      att.attname as column_name
    from pg_constraint con
    join pg_class tbl on tbl.oid = con.conrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    join unnest(con.conkey) with ordinality as keys(attnum, ord) on true
    join pg_attribute att
      on att.attrelid = con.conrelid
      and att.attnum = keys.attnum
    where con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and array_length(con.conkey, 1) = 1
      and tbl.relname not in ('profile_identities', 'profile_link_codes')
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name
    )
    into v_exists
    using p_profile_id;

    if v_exists then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- Consume a code and attach the authenticated identity to the target profile.
-- If login already created a provisional web-only profile, it is removed only
-- when it has no data and no second identity. Otherwise the function refuses
-- to merge and the caller must offer a deliberate conflict-resolution flow.
create or replace function consume_profile_link_code(
  p_code_hash text,
  p_auth_subject text
)
returns setof profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code profile_link_codes%rowtype;
  v_identity profile_identities%rowtype;
  v_target profiles%rowtype;
  v_other_identity_exists boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('link:' || p_code_hash, 0));

  select *
  into v_code
  from profile_link_codes
  where code_hash = p_code_hash
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invalid_or_expired_link_code';
  end if;

  select *
  into v_identity
  from profile_identities
  where provider = 'supabase_auth'
    and subject = trim(p_auth_subject)
  for update;

  if not found then
    raise exception 'auth_identity_not_found';
  end if;

  select *
  into v_target
  from profiles
  where id = v_code.profile_id
  for update;

  if not found then
    raise exception 'target_profile_not_found';
  end if;

  if v_identity.profile_id <> v_target.id then
    if exists (
      select 1
      from profile_identities
      where profile_id = v_target.id
        and provider = 'supabase_auth'
        and id <> v_identity.id
    ) then
      raise exception 'target_already_linked';
    end if;

    select exists (
      select 1
      from profile_identities
      where profile_id = v_identity.profile_id
        and id <> v_identity.id
    )
    into v_other_identity_exists;

    if v_other_identity_exists then
      raise exception 'source_profile_has_other_identity';
    end if;

    if profile_has_linkable_data(v_identity.profile_id) then
      raise exception 'source_profile_has_data';
    end if;

    update profile_identities
    set profile_id = v_target.id,
        last_seen_at = now()
    where id = v_identity.id;

    delete from profiles
    where id = v_identity.profile_id;
  end if;

  update profile_link_codes
  set consumed_at = now(),
      consumed_identity_id = v_identity.id
  where id = v_code.id;

  return next v_target;
end;
$$;

revoke all on function profile_has_linkable_data(uuid)
  from public, anon, authenticated;
grant execute on function profile_has_linkable_data(uuid)
  to service_role;

revoke all on function consume_profile_link_code(text, text)
  from public, anon, authenticated;
grant execute on function consume_profile_link_code(text, text)
  to service_role;
