-- Tachles → SaaS Phase A: convenience views that the cron jobs (Phase C) will
-- join against to skip work for non-paying / non-trialing users. Views centralize
-- the "who counts as active" predicate so that handlers/crons don't drift.

-- Owners with ANY active or trialing entitlement (basic OR pro OR founder).
-- This is the gate for: dispatch-reminders, sync-calendars.
create or replace view active_owners as
  select
    p.id            as owner_id,
    p.telegram_user_id,
    p.timezone,
    s.plan,
    s.status,
    s.current_period_end,
    s.trial_ends_at
  from profiles p
  join subscriptions s on s.owner_id = p.id
  where s.status in ('trialing', 'active');

-- Owners entitled to Pro features (agents, recall, snapshots, etc).
-- Trial users get Pro features for 7 days; founders always get Pro.
create or replace view pro_owners as
  select * from active_owners
  where plan in ('trial', 'pro', 'founder');
