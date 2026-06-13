-- Consolidate the morning message onto the `smart_morning` proactive agent.
--
-- Previously two systems could both fire in the morning: the opt-in
-- `daily_calendar_summary` dynamic reminder (created by `/summary on`) and the
-- on-by-default `smart_morning` agent. After this change `smart_morning` is the
-- single morning hook and `/summary` only toggles that agent. Cancel any
-- leftover dynamic-summary reminders so existing users don't receive two
-- morning messages. The DYNAMIC_HANDLERS entry stays in code (harmless) for
-- deterministic replay; we simply stop creating these rows.

update reminders
set status = 'cancelled'
where kind = 'dynamic'
  and dynamic_handler = 'daily_calendar_summary'
  and status not in ('done', 'cancelled');
