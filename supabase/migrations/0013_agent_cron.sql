-- Schedule agent-tick every 15 minutes via pg_cron + pg_net.
--
-- Before this fires for the first time, add the URL secret:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/agent-tick',
--     'agent_tick_url');

select cron.schedule(
  'agent-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'agent_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
