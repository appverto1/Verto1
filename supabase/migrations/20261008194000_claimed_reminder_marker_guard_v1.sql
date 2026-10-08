begin;

-- P0 22/23: acknowledge sent markers only for a still-matching appointment
-- schedule and tenant. Prevent a claimed old reminder from marking the new
-- schedule as delivered after concurrent rescheduling.
-- One batched call replaces unscoped bulk updates (no per-appointment N+1).
create or replace function public.mark_sent_appointment_notification_jobs_v1(
  p_deployment_env text,
  p_job_ids uuid[]
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_env text;
  v_count integer := 0;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);

  with eligible as (
    select
      a.id,
      a.clinic_id,
      a.patient_id,
      a.scheduled_at,
      bool_or(j.notification_kind = 'APPOINTMENT_REMINDER_24H') as mark_24h,
      bool_or(j.notification_kind = 'APPOINTMENT_REMINDER_12H') as mark_12h
    from public.notification_jobs j
    join public.appointments a on a.id = j.source_id
    where j.id = any(coalesce(p_job_ids, array[]::uuid[]))
      and j.deployment_env = v_env
      and j.source_type = 'APPOINTMENT'
      and j.status = 'CLAIMED'
      and j.clinic_id = a.clinic_id
      and j.patient_id = a.patient_id
      and a.scheduled_at = nullif(j.payload->>'scheduledAt', '')::timestamptz
      and a.is_active is distinct from false
      and a.deleted_at is null
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed')
    group by a.id, a.clinic_id, a.patient_id, a.scheduled_at
  )
  update public.appointments a
  set
    notification_24h_sent_at = case when e.mark_24h then now() else a.notification_24h_sent_at end,
    notification_12h_sent_at = case when e.mark_12h then now() else a.notification_12h_sent_at end
  from eligible e
  where a.id = e.id
    and a.clinic_id = e.clinic_id
    and a.patient_id = e.patient_id
    and a.scheduled_at = e.scheduled_at
    and a.is_active is distinct from false
    and a.deleted_at is null
    and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_sent_appointment_notification_jobs_v1(text, uuid[])
from public, anon, authenticated;
grant execute on function public.mark_sent_appointment_notification_jobs_v1(text, uuid[])
to service_role;

comment on function public.mark_sent_appointment_notification_jobs_v1(text, uuid[])
is 'Only marks claimed appointment reminder jobs in their original tenant and schedule cycle; called after portal notification persistence.';

commit;
