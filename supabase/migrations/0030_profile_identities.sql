-- Channel-independent profile identities.
--
-- Profiles remain the owner of all user data. Telegram and Supabase Auth are
-- external identities that resolve to a profile; neither identity owns the
-- profile row. The legacy telegram_user_id column stays during the migration
-- window so existing functions and hosted code remain compatible.

alter table profiles
  alter column telegram_user_id drop not null;

create table profile_identities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('telegram', 'supabase_auth')),
  subject text not null check (length(trim(subject)) > 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (provider, subject),
  unique (profile_id, provider)
);

create index profile_identities_profile_idx
  on profile_identities (profile_id);

alter table profile_identities enable row level security;

insert into profile_identities (profile_id, provider, subject)
select id, 'telegram', telegram_user_id::text
from profiles
where telegram_user_id is not null
on conflict (provider, subject) do nothing;

-- Resolve an external identity to its profile, creating both rows atomically
-- when this is the identity's first contact. The advisory lock prevents two
-- simultaneous first requests from creating duplicate empty profiles.
create or replace function resolve_or_create_profile_identity(
  p_provider text,
  p_subject text,
  p_display_name text default null,
  p_locale text default 'he',
  p_timezone text default 'Asia/Jerusalem'
)
returns setof profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_subject text := trim(p_subject);
  v_display_name text := nullif(trim(p_display_name), '');
begin
  if p_provider not in ('telegram', 'supabase_auth') then
    raise exception 'unsupported identity provider';
  end if;
  if v_subject = '' then
    raise exception 'identity subject is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_provider || ':' || v_subject, 0)
  );

  select p.*
  into v_profile
  from profile_identities i
  join profiles p on p.id = i.profile_id
  where i.provider = p_provider
    and i.subject = v_subject;

  if found then
    update profile_identities
    set last_seen_at = now()
    where provider = p_provider
      and subject = v_subject;

    if v_display_name is not null and v_profile.display_name is distinct from v_display_name then
      update profiles
      set display_name = v_display_name
      where id = v_profile.id
      returning * into v_profile;
    end if;

    return next v_profile;
    return;
  end if;

  -- During the compatibility window, an old deployment may already have
  -- created a Telegram profile without inserting profile_identities.
  if p_provider = 'telegram' then
    select *
    into v_profile
    from profiles
    where telegram_user_id = v_subject::bigint;
  end if;

  if not found then
    insert into profiles (
      telegram_user_id,
      display_name,
      locale,
      timezone
    )
    values (
      case when p_provider = 'telegram' then v_subject::bigint else null end,
      v_display_name,
      coalesce(nullif(trim(p_locale), ''), 'he'),
      coalesce(nullif(trim(p_timezone), ''), 'Asia/Jerusalem')
    )
    returning * into v_profile;
  elsif v_display_name is not null and v_profile.display_name is distinct from v_display_name then
    update profiles
    set display_name = v_display_name
    where id = v_profile.id
    returning * into v_profile;
  end if;

  insert into profile_identities (profile_id, provider, subject)
  values (v_profile.id, p_provider, v_subject);

  return next v_profile;
end;
$$;

revoke all on function resolve_or_create_profile_identity(
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function resolve_or_create_profile_identity(
  text,
  text,
  text,
  text,
  text
) to service_role;
