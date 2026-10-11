-- Issue #366: TEMPORARY bridge; execute ONLY on dedicated production project vtzuorydrcueqltntpcm.

-- Allows previous main's trusted service-role client during the rolling deployment; no browser can establish this namespace.

begin;

CREATE OR REPLACE FUNCTION public.verto_request_deployment_env_v1()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_claims jsonb;
  v_headers jsonb;
  v_env text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if coalesce(v_claims->>'role', '') <> 'service_role' then
    return null;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  v_env := lower(trim(coalesce(v_headers->>'x-verto-deployment-env', '')));
  -- Temporary compatibility for the trusted service-role client of the previous main release.
  -- Execute only in the dedicated production project; authenticated/anon still return NULL above.
  if v_env = '' then
    return 'production';
  end if;
  if v_env in ('staging','production') then
    return v_env;
  end if;
  return null;
end;
$function$;

ALTER TABLE public.push_subscriptions DISABLE TRIGGER trg_push_subscriptions_deployment_env_v1;

UPDATE public.push_subscriptions SET deployment_env = 'production' WHERE deployment_env IS NULL;

ALTER TABLE public.push_subscriptions ENABLE TRIGGER trg_push_subscriptions_deployment_env_v1;

ALTER TABLE public.notification_jobs DISABLE TRIGGER trg_notification_jobs_deployment_env_v1;

UPDATE public.notification_jobs SET deployment_env = 'production' WHERE deployment_env IS NULL;

ALTER TABLE public.notification_jobs ENABLE TRIGGER trg_notification_jobs_deployment_env_v1;

ALTER TABLE public.portal_notifications DISABLE TRIGGER trg_portal_notifications_deployment_env_v1;

UPDATE public.portal_notifications SET deployment_env = 'production' WHERE deployment_env IS NULL;

ALTER TABLE public.portal_notifications ENABLE TRIGGER trg_portal_notifications_deployment_env_v1;

ALTER TABLE public.clinic_announcements DISABLE TRIGGER trg_clinic_announcements_deployment_env_v1;

UPDATE public.clinic_announcements SET deployment_env = 'production' WHERE deployment_env IS NULL;

ALTER TABLE public.clinic_announcements ENABLE TRIGGER trg_clinic_announcements_deployment_env_v1;

NOTIFY pgrst, 'reload schema';

commit;
