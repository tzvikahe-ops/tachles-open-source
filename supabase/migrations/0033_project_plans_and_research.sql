create table project_plan_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected')),
  plan jsonb not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (jsonb_typeof(plan->'milestones') = 'array')
);

create index project_plan_proposals_project_idx
  on project_plan_proposals (project_id, created_at desc);

alter table project_plan_proposals enable row level security;

create table research_briefs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  query text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(sources) = 'array')
);

create index research_briefs_owner_idx
  on research_briefs (owner_id, created_at desc);

alter table research_briefs enable row level security;

-- Applying a proposal is deliberately separate from generating it. This RPC
-- creates all tasks and marks the proposal approved in one transaction.
create or replace function approve_project_plan(
  p_owner_id uuid,
  p_proposal_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal project_plan_proposals%rowtype;
  v_milestone jsonb;
  v_task jsonb;
  v_count integer := 0;
begin
  select *
  into v_proposal
  from project_plan_proposals
  where id = p_proposal_id
    and owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'proposal_not_found';
  end if;

  if v_proposal.status <> 'proposed' then
    raise exception 'proposal_already_decided';
  end if;

  for v_milestone in
    select value from jsonb_array_elements(v_proposal.plan->'milestones')
  loop
    for v_task in
      select value from jsonb_array_elements(coalesce(v_milestone->'tasks', '[]'::jsonb))
    loop
      insert into tasks (
        owner_id,
        project_id,
        title,
        priority,
        estimated_minutes,
        due_at
      )
      values (
        p_owner_id,
        v_proposal.project_id,
        trim(v_task->>'title'),
        least(2, greatest(0, coalesce((v_task->>'priority')::integer, 0))),
        case
          when (v_task->>'estimated_minutes') ~ '^[0-9]+$'
            then least(1440, greatest(5, (v_task->>'estimated_minutes')::integer))
          else null
        end,
        case
          when coalesce(v_task->>'due_at', '') = '' then null
          else (v_task->>'due_at')::timestamptz
        end
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  update project_plan_proposals
  set status = 'approved',
      decided_at = now()
  where id = v_proposal.id;

  return v_count;
end;
$$;

revoke all on function approve_project_plan(uuid, uuid)
  from public, anon, authenticated;
grant execute on function approve_project_plan(uuid, uuid)
  to service_role;
