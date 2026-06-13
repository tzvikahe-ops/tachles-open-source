-- Scheduling backbone: pg_cron invokes the dispatch-reminders Edge Function every
-- minute via pg_net. The function URL and shared secret are read from Supabase
-- Vault at execution time, so this migration is portable across projects.
--
-- Before the schedule first fires, set the two secrets (replace the placeholders):
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/dispatch-reminders',
--     'dispatch_reminders_url');
--   select vault.create_secret('<DISPATCH_SECRET>', 'dispatch_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'dispatch-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
