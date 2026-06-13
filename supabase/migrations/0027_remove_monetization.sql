-- Remove the abandoned SaaS monetization layer. Historical migrations
-- 0024-0026 remain in the repository for deterministic replay; this migration
-- leaves both existing and freshly reset databases in the free community state.

do $$
declare
  job_id bigint;
begin
  select jobid into job_id
  from cron.job
  where jobname = 'subscription-tick'
  limit 1;

  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

drop view if exists pro_owners;
drop view if exists active_owners;

drop table if exists cardcom_webhook_events;
drop table if exists subscriptions;

drop type if exists subscription_status;
drop type if exists plan_tier;
