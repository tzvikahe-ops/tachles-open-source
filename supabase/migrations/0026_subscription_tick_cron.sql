-- Daily subscription lifecycle job (trial expiry + recurring renewals).
-- Runs at 03:00 UTC (~05:00/06:00 Asia/Jerusalem) so renewals fire before
-- the user wakes up and the dispatch jobs would otherwise pull stale state.
--
-- Before this fires the first time, add the URL secret:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/subscription-tick',
--     'subscription_tick_url');

select cron.schedule(
  'subscription-tick',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'subscription_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
