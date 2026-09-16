begin;

-- Add the deployment namespace columns before enforcement so a controlled rollout can
-- classify only rows whose production provenance was explicitly verified.
-- No trigger/function/index/grant behavior changes in this phase.
alter table public.push_subscriptions add column if not exists deployment_env text;
alter table public.notification_jobs add column if not exists deployment_env text;
alter table public.portal_notifications add column if not exists deployment_env text;
alter table public.clinic_announcements add column if not exists deployment_env text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='push_subscriptions_deployment_env_check' and conrelid='public.push_subscriptions'::regclass) then
    alter table public.push_subscriptions add constraint push_subscriptions_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname='notification_jobs_deployment_env_check' and conrelid='public.notification_jobs'::regclass) then
    alter table public.notification_jobs add constraint notification_jobs_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname='portal_notifications_deployment_env_check' and conrelid='public.portal_notifications'::regclass) then
    alter table public.portal_notifications add constraint portal_notifications_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname='clinic_announcements_deployment_env_check' and conrelid='public.clinic_announcements'::regclass) then
    alter table public.clinic_announcements add constraint clinic_announcements_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
end $$;

comment on column public.push_subscriptions.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is never eligible for push delivery after isolation activation.';
comment on column public.notification_jobs.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is never eligible for worker claim after isolation activation.';
comment on column public.portal_notifications.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is excluded from application reads after isolation activation.';
comment on column public.clinic_announcements.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is never eligible for delivery claim after isolation activation.';

notify pgrst, 'reload schema';
commit;
