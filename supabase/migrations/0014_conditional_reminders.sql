-- Phase 6.4: conditional reminders. The existing reminders table grows two
-- columns and a new 'conditional' kind. The evaluator (in dispatch-reminders)
-- runs every minute, queries the events table to decide whether the predicate
-- is satisfied, and fires only when it is. After firing, run_at is bumped
-- by 24h to avoid re-firing in a tight loop.

alter table reminders drop constraint reminders_kind_check;
alter table reminders add constraint reminders_kind_check
  check (kind in ('static', 'dynamic', 'conditional'));

alter table reminders
  add column if not exists condition_type text
    check (condition_type in ('inactivity', 'streak_break', 'threshold')),
  add column if not exists condition_params jsonb;
