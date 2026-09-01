-- Verto Block 6 final correction — scheduled adult-task notification semantics.
--
-- Goals:
--   1. every active canonical assigned task with scheduled_at gets one TASK_REMINDER
--      at the professional-defined scheduled moment (subject to the existing clinic
--      quiet-hours delivery policy);
--   2. isDailyReminder adds a separate DAILY_WHILE_PENDING reminder only after the
--      scheduled occurrence; it no longer gates the first scheduled notification;
--   3. task completion/cancellation or rescheduling cancels pending/claimed jobs;
--   4. a notification already SENT for the same schedule cycle is never resurrected;
--   5. legacy :reminder recurring jobs are retired without deleting history.
--
-- Additive/idempotent/non-destructive: no task/history rows are rewritten or deleted.

begin;

create or replace function public.sync_assigned_task_notification_jobs_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_data jsonb := coalesce(new.task_data, '{}'::jsonb);
  v_daily boolean := lower(coalesce(v_data->>'isDailyReminder', v_data->>'is_daily_reminder', 'false')) in ('true','1','yes','on');
  v_active boolean := lower(coalesce(new.status, 'pending')) not in ('completed','done','canceled','cancelled');
  v_clinic uuid;
  v_timezone text;
  v_scheduled_due timestamptz;
  v_daily_due timestamptz;
begin
  begin
    v_clinic := nullif(new.clinic_id, '')::uuid;
  exception when invalid_text_representation then
    v_clinic := null;
  end;

  v_timezone := public.verto_notification_clinic_timezone_v1(v_clinic);
  v_scheduled_due := case
    when new.scheduled_at is null then null
    else public.verto_notification_delivery_due_v1(new.scheduled_at, 0, v_timezone)
  end;

  -- Any source mutation invalidates work that has not been delivered yet. SENT rows
  -- are immutable delivery history and remain untouched.
  update public.notification_jobs
     set status = 'CANCELED',
         updated_at = now(),
         claimed_at = null,
         claimed_by = null
   where source_type = 'ASSIGNED_TASK'
     and source_id = new.id
     and status in ('SCHEDULED','CLAIMED');

  -- One-time reminder for the professional-defined schedule. A short lookback
  -- prevents an unrelated edit to a very old pending task from creating a stale
  -- notification while still allowing normal worker/deploy delay recovery.
  if v_active
     and new.patient_id is not null
     and new.scheduled_at is not null
     and new.scheduled_at >= now() - interval '6 hours' then
    insert into public.notification_jobs(
      organization_id,
      clinic_id,
      patient_id,
      source_type,
      source_id,
      notification_kind,
      scheduled_for,
      recurrence_rule,
      idempotency_key,
      payload
    ) values (
      v_clinic,
      v_clinic,
      new.patient_id,
      'ASSIGNED_TASK',
      new.id,
      'TASK_REMINDER',
      v_scheduled_due,
      null,
      'assigned-task:' || new.id::text || ':scheduled:' || to_char(new.scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
      jsonb_build_object(
        'scheduledAt', new.scheduled_at,
        'daily', false,
        'deliveryMode', 'SCHEDULED_ONCE',
        'title', coalesce(v_data->>'title', 'Tarefa')
      )
    )
    on conflict (idempotency_key) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      patient_id = excluded.patient_id,
      scheduled_for = excluded.scheduled_for,
      recurrence_rule = null,
      status = case when notification_jobs.status = 'SENT' then 'SENT' else 'SCHEDULED' end,
      attempt_count = case when notification_jobs.status = 'SENT' then notification_jobs.attempt_count else 0 end,
      last_error = case when notification_jobs.status = 'SENT' then notification_jobs.last_error else null end,
      claimed_at = case when notification_jobs.status = 'SENT' then notification_jobs.claimed_at else null end,
      claimed_by = case when notification_jobs.status = 'SENT' then notification_jobs.claimed_by else null end,
      sent_at = case when notification_jobs.status = 'SENT' then notification_jobs.sent_at else null end,
      payload = excluded.payload,
      updated_at = now();
  end if;

  -- Daily reminders are an additional recurrence, never a replacement for the
  -- scheduled occurrence. The first recurrence is strictly after that occurrence.
  if v_active
     and v_daily
     and new.patient_id is not null
     and new.scheduled_at is not null then
    v_daily_due := public.verto_daily_notification_next_due_v1(
      new.scheduled_at,
      greatest(now(), coalesce(v_scheduled_due, now())),
      v_timezone
    );

    insert into public.notification_jobs(
      organization_id,
      clinic_id,
      patient_id,
      source_type,
      source_id,
      notification_kind,
      scheduled_for,
      recurrence_rule,
      idempotency_key,
      payload
    ) values (
      v_clinic,
      v_clinic,
      new.patient_id,
      'ASSIGNED_TASK',
      new.id,
      'TASK_REMINDER',
      v_daily_due,
      'DAILY_WHILE_PENDING',
      'assigned-task:' || new.id::text || ':daily',
      jsonb_build_object(
        'scheduledAt', new.scheduled_at,
        'daily', true,
        'deliveryMode', 'DAILY_WHILE_PENDING',
        'title', coalesce(v_data->>'title', 'Tarefa')
      )
    )
    on conflict (idempotency_key) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      patient_id = excluded.patient_id,
      scheduled_for = excluded.scheduled_for,
      recurrence_rule = excluded.recurrence_rule,
      status = 'SCHEDULED',
      attempt_count = 0,
      last_error = null,
      claimed_at = null,
      claimed_by = null,
      sent_at = null,
      payload = excluded.payload,
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.sync_assigned_task_notification_jobs_v1() from public, anon, authenticated;
grant execute on function public.sync_assigned_task_notification_jobs_v1() to service_role;

-- Retire only undelivered jobs from the previous semantics where daily reminder
-- was the sole task notification. SENT rows remain as immutable delivery history.
update public.notification_jobs
   set status = 'CANCELED',
       updated_at = now(),
       claimed_at = null,
       claimed_by = null
 where source_type = 'ASSIGNED_TASK'
   and status in ('SCHEDULED','CLAIMED')
   and idempotency_key ~ '^assigned-task:[0-9a-fA-F-]+:reminder$';

-- Bounded one-time backfill for active tasks near/future to deployment. The trigger
-- handles all subsequent writes, including tasks scheduled more than 60 days out.
insert into public.notification_jobs(
  organization_id,
  clinic_id,
  patient_id,
  source_type,
  source_id,
  notification_kind,
  scheduled_for,
  recurrence_rule,
  idempotency_key,
  payload
)
select
  nullif(t.clinic_id, '')::uuid,
  nullif(t.clinic_id, '')::uuid,
  t.patient_id,
  'ASSIGNED_TASK',
  t.id,
  'TASK_REMINDER',
  public.verto_notification_delivery_due_v1(
    t.scheduled_at,
    0,
    public.verto_notification_clinic_timezone_v1(nullif(t.clinic_id, '')::uuid)
  ),
  null,
  'assigned-task:' || t.id::text || ':scheduled:' || to_char(t.scheduled_at at time zone 'UTC', 'YYYYMMDDHH24MISS'),
  jsonb_build_object(
    'scheduledAt', t.scheduled_at,
    'daily', false,
    'deliveryMode', 'SCHEDULED_ONCE',
    'title', coalesce(t.task_data->>'title', 'Tarefa')
  )
from public.assigned_tasks t
where t.patient_id is not null
  and t.scheduled_at is not null
  and t.clinic_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and lower(coalesce(t.status, 'pending')) not in ('completed','done','canceled','cancelled')
  and t.scheduled_at >= now() - interval '6 hours'
  and t.scheduled_at <= now() + interval '60 days'
on conflict (idempotency_key) do update set
  organization_id = excluded.organization_id,
  clinic_id = excluded.clinic_id,
  patient_id = excluded.patient_id,
  scheduled_for = excluded.scheduled_for,
  recurrence_rule = null,
  status = case when notification_jobs.status = 'SENT' then 'SENT' else 'SCHEDULED' end,
  attempt_count = case when notification_jobs.status = 'SENT' then notification_jobs.attempt_count else 0 end,
  last_error = case when notification_jobs.status = 'SENT' then notification_jobs.last_error else null end,
  claimed_at = case when notification_jobs.status = 'SENT' then notification_jobs.claimed_at else null end,
  claimed_by = case when notification_jobs.status = 'SENT' then notification_jobs.claimed_by else null end,
  sent_at = case when notification_jobs.status = 'SENT' then notification_jobs.sent_at else null end,
  payload = excluded.payload,
  updated_at = now();

-- Rebuild daily reminders under a distinct idempotency key. The first daily job is
-- always after the professional-defined scheduled occurrence so it cannot duplicate
-- the one-time notification at the same moment.
insert into public.notification_jobs(
  organization_id,
  clinic_id,
  patient_id,
  source_type,
  source_id,
  notification_kind,
  scheduled_for,
  recurrence_rule,
  idempotency_key,
  payload
)
select
  nullif(t.clinic_id, '')::uuid,
  nullif(t.clinic_id, '')::uuid,
  t.patient_id,
  'ASSIGNED_TASK',
  t.id,
  'TASK_REMINDER',
  public.verto_daily_notification_next_due_v1(
    t.scheduled_at,
    greatest(
      now(),
      public.verto_notification_delivery_due_v1(
        t.scheduled_at,
        0,
        public.verto_notification_clinic_timezone_v1(nullif(t.clinic_id, '')::uuid)
      )
    ),
    public.verto_notification_clinic_timezone_v1(nullif(t.clinic_id, '')::uuid)
  ),
  'DAILY_WHILE_PENDING',
  'assigned-task:' || t.id::text || ':daily',
  jsonb_build_object(
    'scheduledAt', t.scheduled_at,
    'daily', true,
    'deliveryMode', 'DAILY_WHILE_PENDING',
    'title', coalesce(t.task_data->>'title', 'Tarefa')
  )
from public.assigned_tasks t
where t.patient_id is not null
  and t.scheduled_at is not null
  and t.clinic_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and lower(coalesce(t.status, 'pending')) not in ('completed','done','canceled','cancelled')
  and lower(coalesce(t.task_data->>'isDailyReminder', t.task_data->>'is_daily_reminder', 'false')) in ('true','1','yes','on')
on conflict (idempotency_key) do update set
  organization_id = excluded.organization_id,
  clinic_id = excluded.clinic_id,
  patient_id = excluded.patient_id,
  scheduled_for = excluded.scheduled_for,
  recurrence_rule = excluded.recurrence_rule,
  status = 'SCHEDULED',
  attempt_count = 0,
  last_error = null,
  claimed_at = null,
  claimed_by = null,
  sent_at = null,
  payload = excluded.payload,
  updated_at = now();

notify pgrst, 'reload schema';
commit;
