-- Seed the agent registry with the four MVP agents. Each is enabled=true at
-- the global level but starts disabled at the user level (we want the user to
-- opt in via /agents enable <name>). Output policies err on the side of
-- silence — max_per_day low, min_confidence_to_send high.

insert into agents (name, role, system_prompt, schedule_cron, output_policy)
values
  (
    'chief_of_staff',
    'Chief of Staff — twice-daily glance',
    'placeholder; the actual prompt lives in _shared/agents/chief_of_staff.ts and is sent at runtime',
    '0 8,19 * * *',
    jsonb_build_object(
      'max_per_day', 2,
      'quiet_hours', jsonb_build_array('22:00', '07:00'),
      'dedupe_window_minutes', 720,
      'min_confidence_to_send', 0.7
    )
  ),
  (
    'anti_chaos',
    'Anti-Chaos — Monday morning overload check',
    'placeholder',
    '0 9 * * 1',
    jsonb_build_object(
      'max_per_day', 1,
      'quiet_hours', jsonb_build_array('22:00', '07:00'),
      'dedupe_window_minutes', 1440,
      'min_confidence_to_send', 0.7
    )
  ),
  (
    'health_intelligence',
    'Health Intelligence — Sunday morning correlation',
    'placeholder',
    '0 8 * * 0',
    jsonb_build_object(
      'max_per_day', 1,
      'quiet_hours', jsonb_build_array('22:00', '07:00'),
      'dedupe_window_minutes', 1440,
      'min_confidence_to_send', 0.7
    )
  ),
  (
    'memory_agent',
    'Memory Agent — triggered by recall questions',
    'placeholder',
    null,
    '{}'::jsonb
  )
on conflict (name) do nothing;

-- Default off per user — they must /agents enable <name> first.
update agents set enabled = true;
