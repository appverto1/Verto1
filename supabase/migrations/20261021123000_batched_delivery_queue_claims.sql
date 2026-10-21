-- Claim the two independent durable delivery queues in one Supabase REST request.
-- Both existing service-role, environment-isolated, SKIP LOCKED claims execute
-- inside the same database transaction; if either fails, nothing is committed.
begin;

create or replace function public.claim_due_delivery_queues_v1(
  p_deployment_env text,
  p_worker text,
  p_notification_limit integer default 100,
  p_announcement_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_env text;
  v_jobs jsonb;
  v_announcements jsonb;
begin
  -- Revalidate the trusted service-role namespace header, not only the argument.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'DELIVERY_QUEUE_SERVICE_ROLE_REQUIRED';
  end if;
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);

  select coalesce(jsonb_agg(to_jsonb(j) order by j.scheduled_for, j.id), '[]'::jsonb)
  into v_jobs
  from public.claim_due_notification_jobs_v1(
    v_env,
    p_worker,
    greatest(1, least(coalesce(p_notification_limit, 100), 500))
  ) as j;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  into v_announcements
  from public.claim_due_clinic_announcements_v1(
    v_env,
    p_worker,
    greatest(1, least(coalesce(p_announcement_limit, 20), 100))
  ) as a;

  return jsonb_build_object(
    'notification_jobs', v_jobs,
    'clinic_announcements', v_announcements
  );
end;
$$;

revoke all on function public.claim_due_delivery_queues_v1(text,text,integer,integer)
from public, anon, authenticated;
grant execute on function public.claim_due_delivery_queues_v1(text,text,integer,integer)
to service_role;

commit;
