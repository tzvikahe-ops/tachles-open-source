-- Phase 10.6: register the smart_morning agent. Runs at 07:00 local, max
-- once per day. Lower confidence threshold than CoS — this is a routine
-- "good morning + orientation" patch, not analysis.

insert into agents (name, role, system_prompt, schedule_cron, output_policy)
values (
  'smart_morning',
  'בוקר חכם — אוריינטציה קצרה לתחילת היום',
  'placeholder; the actual prompt lives in _shared/agents/smart_morning.ts and is sent at runtime',
  '0 7 * * *',
  jsonb_build_object(
    'max_per_day', 1,
    'quiet_hours', jsonb_build_array('22:00', '06:30'),
    'dedupe_window_minutes', 720,
    'min_confidence_to_send', 0.5
  )
)
on conflict (name) do nothing;

update agents set enabled = true where name = 'smart_morning';
