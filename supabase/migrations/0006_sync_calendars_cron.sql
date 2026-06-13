-- Schedule sync-calendars hourly. Reuses the same dispatch_secret as dispatch-reminders.
-- A second vault secret holds the function URL.
--
-- Before this schedule first fires, set:
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/sync-calendars',
--     'sync_calendars_url');

select cron.schedule(
  'sync-calendars',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'sync_calendars_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
