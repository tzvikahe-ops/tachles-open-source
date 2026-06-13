-- Daily snapshot cron. Runs at 23:30 UTC, which is past midnight in
-- Asia/Jerusalem winter (UTC+2 → 01:30) and 02:30 in summer (UTC+3). For a
-- single-user Hebrew bot this is fine; if we grow we'll switch to a per-tz
-- materialized scheduler.
--
-- Before this fires the first time, add the URL secret:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/snapshot-daily',
--     'snapshot_daily_url');

select cron.schedule(
  'snapshot-daily',
  '30 23 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'snapshot_daily_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
