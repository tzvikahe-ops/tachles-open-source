-- Phase 11.1: agent feedback loop. Users tap 👍/👎 on each proactive message;
-- the value lands in agent_runs.feedback. After enough 'noisy' ratings the
-- agent-tick layer can raise the per-user confidence threshold (separate path,
-- but the same column is read).

alter table agent_runs
  add column if not exists feedback text
    check (feedback in ('useful', 'noisy'));

create index if not exists agent_runs_feedback_idx
  on agent_runs (agent_id, owner_id, finished_at desc)
  where feedback is not null;

-- Per-user policy override. min_confidence_to_send can be bumped here when a
-- user repeatedly marks an agent as noisy. NULL = use the agent default.
alter table user_agent_settings
  add column if not exists policy_override jsonb;
