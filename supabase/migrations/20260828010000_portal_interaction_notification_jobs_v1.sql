begin;

-- Unified future-work queue for appointment/task patient notifications.
create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  clinic_id uuid,
  patient_id uuid,
  source_type text not null check (source_type in ('APPOINTMENT','ASSIGNED_TASK')),
  source_id uuid not null,
  notification_kind text not null check (notification_kind in ('APPOINTMENT_REMINDER_24H','APPOINTMENT_REMINDER_12H','TASK_REMINDER')),
  scheduled_for timestamptz not null,
  recurrence_rule text,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','CLAIMED','SENT','CANCELED','FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  idempotency_key text not null unique,
  claimed_at timestamptz,
  claimed_by text,
  sent_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_jobs_due_v1
  on public.notification_jobs (scheduled_for, id)
  where status = 'SCHEDULED';
create index if not exists idx_notification_jobs_source_v1
  on public.notification_jobs (source_type, source_id, status);
create index if not exists idx_notification_jobs_patient_v1
  on public.notification_jobs (patient_id, scheduled_for desc);

alter table public.notification_jobs enable row level security;
revoke all on public.notification_jobs from public, anon, authenticated;
grant all on public.notification_jobs to service_role;

-- Resolve the clinic's canonical IANA timezone without requiring the optional
-- clinics.timezone column to exist on older schemas. to_jsonb(row) keeps this
-- migration compatible while still honoring the canonical value when present.
create or replace function public.verto_notification_clinic_timezone_v1(
  p_clinic_id uuid
) returns text
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare
  v_requested text;
  v_timezone text;
begin
  if p_clinic_id is not null then
    select nullif(to_jsonb(c)->>'timezone','') into v_requested
    from public.clinics c
    where c.id=p_clinic_id
    limit 1;
  end if;
  if v_requested is not null then
    select name into v_timezone from pg_timezone_names where name=v_requested limit 1;
  end if;
  return coalesce(v_timezone,'America/Sao_Paulo');
end;
$$;

create or replace function public.verto_notification_delivery_due_v1(
  p_scheduled_at timestamptz,
  p_hours_before integer,
  p_timezone text
) returns timestamptz
language plpgsql immutable
as $$
declare
  v_local timestamp;
  v_due_local timestamp;
  v_hour integer;
  v_timezone text:=coalesce(nullif(p_timezone,''),'America/Sao_Paulo');
begin
  if p_scheduled_at is null then return null; end if;
  v_local := p_scheduled_at at time zone v_timezone;
  v_due_local := v_local - make_interval(hours => greatest(p_hours_before, 0));
  v_hour := extract(hour from v_due_local);
  if v_hour >= 22 then
    v_due_local := date_trunc('day', v_due_local) + interval '1 day 6 hours';
  elsif v_hour < 6 then
    v_due_local := date_trunc('day', v_due_local) + interval '6 hours';
  end if;
  return v_due_local at time zone v_timezone;
end;
$$;

create or replace function public.verto_daily_notification_next_due_v1(
  p_scheduled_at timestamptz,
  p_now timestamptz,
  p_timezone text
) returns timestamptz
language plpgsql stable
as $$
declare
  v_source_local timestamp;
  v_now_local timestamp;
  v_candidate_local timestamp;
  v_hour integer;
  v_timezone text:=coalesce(nullif(p_timezone,''),'America/Sao_Paulo');
begin
  if p_scheduled_at is null then return null; end if;
  v_source_local := p_scheduled_at at time zone v_timezone;
  v_now_local := p_now at time zone v_timezone;
  v_candidate_local := date_trunc('day', v_now_local) + (v_source_local - date_trunc('day', v_source_local));
  if v_candidate_local <= v_now_local then v_candidate_local := v_candidate_local + interval '1 day'; end if;
  v_hour := extract(hour from v_candidate_local);
  if v_hour >= 22 then
    v_candidate_local := date_trunc('day', v_candidate_local) + interval '1 day 6 hours';
  elsif v_hour < 6 then
    v_candidate_local := date_trunc('day', v_candidate_local) + interval '6 hours';
  end if;
  return v_candidate_local at time zone v_timezone;
end;
$$;

create or replace function public.sync_appointment_notification_jobs_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_status text := lower(coalesce(new.status, ''));
  v_active boolean := coalesce(new.is_active, true) and new.deleted_at is null and v_status not in ('cancelled','canceled','no_show','missed','completed');
  v_org uuid := new.clinic_id;
  v_clinic uuid := new.clinic_id;
  v_timezone text := public.verto_notification_clinic_timezone_v1(new.clinic_id);
begin
  update public.notification_jobs
     set status='CANCELED', updated_at=now(), claimed_at=null, claimed_by=null
   where source_type='APPOINTMENT' and source_id=new.id and status in ('SCHEDULED','CLAIMED');

  if v_active and new.scheduled_at is not null and new.patient_id is not null then
    insert into public.notification_jobs(organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,idempotency_key,payload)
    values
      (v_org,v_clinic,new.patient_id,'APPOINTMENT',new.id,'APPOINTMENT_REMINDER_24H',public.verto_notification_delivery_due_v1(new.scheduled_at,24,v_timezone),
       'appointment:'||new.id::text||':24h:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS'), jsonb_build_object('scheduledAt',new.scheduled_at)),
      (v_org,v_clinic,new.patient_id,'APPOINTMENT',new.id,'APPOINTMENT_REMINDER_12H',public.verto_notification_delivery_due_v1(new.scheduled_at,12,v_timezone),
       'appointment:'||new.id::text||':12h:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS'), jsonb_build_object('scheduledAt',new.scheduled_at))
    on conflict (idempotency_key) do update set
      scheduled_for=excluded.scheduled_for,
      status=case when notification_jobs.status='SENT' then 'SENT' else 'SCHEDULED' end,
      attempt_count=case when notification_jobs.status='SENT' then notification_jobs.attempt_count else 0 end,
      last_error=case when notification_jobs.status='SENT' then notification_jobs.last_error else null end,
      claimed_at=case when notification_jobs.status='SENT' then notification_jobs.claimed_at else null end,
      claimed_by=case when notification_jobs.status='SENT' then notification_jobs.claimed_by else null end,
      sent_at=case when notification_jobs.status='SENT' then notification_jobs.sent_at else null end,
      payload=excluded.payload,
      updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointments_notification_jobs_v1 on public.appointments;
create trigger trg_appointments_notification_jobs_v1
after insert or update of scheduled_at,status,patient_id,clinic_id,is_active,deleted_at on public.appointments
for each row execute function public.sync_appointment_notification_jobs_v1();

create or replace function public.sync_assigned_task_notification_jobs_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_data jsonb := coalesce(new.task_data,'{}'::jsonb);
  v_daily boolean := lower(coalesce(v_data->>'isDailyReminder',v_data->>'is_daily_reminder','false')) in ('true','1','yes','on');
  v_due timestamptz;
  v_active boolean := lower(coalesce(new.status,'pending')) not in ('completed','done','canceled','cancelled');
  v_clinic uuid;
begin
  begin
    v_clinic := nullif(new.clinic_id,'')::uuid;
  exception when others then
    v_clinic := null;
  end;
  v_due := public.verto_notification_delivery_due_v1(
    coalesce(new.scheduled_at,now()),0,public.verto_notification_clinic_timezone_v1(v_clinic)
  );
  update public.notification_jobs
     set status='CANCELED', updated_at=now(), claimed_at=null, claimed_by=null
   where source_type='ASSIGNED_TASK' and source_id=new.id and status in ('SCHEDULED','CLAIMED');

  if v_active and v_daily and new.patient_id is not null then
    insert into public.notification_jobs(organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,recurrence_rule,idempotency_key,payload)
    values (
      v_clinic,v_clinic,new.patient_id,'ASSIGNED_TASK',new.id,'TASK_REMINDER',
      case when v_due < now() then public.verto_daily_notification_next_due_v1(coalesce(new.scheduled_at,now()),now(),public.verto_notification_clinic_timezone_v1(v_clinic)) else v_due end,
      'DAILY_WHILE_PENDING',
      'assigned-task:'||new.id::text||':reminder',
      jsonb_build_object('scheduledAt',new.scheduled_at,'daily',v_daily,'title',coalesce(v_data->>'title','Tarefa'))
    )
    on conflict (idempotency_key) do update set
      scheduled_for=excluded.scheduled_for,
      recurrence_rule=excluded.recurrence_rule,
      status='SCHEDULED',
      attempt_count=0,
      last_error=null,
      claimed_at=null,
      claimed_by=null,
      sent_at=null,
      payload=excluded.payload,
      updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assigned_tasks_notification_jobs_v1 on public.assigned_tasks;
create trigger trg_assigned_tasks_notification_jobs_v1
after insert or update of scheduled_at,status,patient_id,clinic_id,task_data on public.assigned_tasks
for each row execute function public.sync_assigned_task_notification_jobs_v1();

-- Helper/trigger functions are internal implementation details; keep direct execution service-only.
revoke all on function public.verto_notification_clinic_timezone_v1(uuid) from public, anon, authenticated;
grant execute on function public.verto_notification_clinic_timezone_v1(uuid) to service_role;
revoke all on function public.verto_notification_delivery_due_v1(timestamptz,integer,text) from public, anon, authenticated;
grant execute on function public.verto_notification_delivery_due_v1(timestamptz,integer,text) to service_role;
revoke all on function public.verto_daily_notification_next_due_v1(timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.verto_daily_notification_next_due_v1(timestamptz,timestamptz,text) to service_role;

-- Defensive cleanup for a never-promoted draft signature. Safe on clean staging and
-- keeps this migration idempotent if an earlier local draft was ever executed.
drop function if exists public.verto_notification_delivery_due_v1(timestamptz,integer);
drop function if exists public.verto_daily_notification_next_due_v1(timestamptz,timestamptz);
revoke all on function public.sync_appointment_notification_jobs_v1() from public, anon, authenticated;
grant execute on function public.sync_appointment_notification_jobs_v1() to service_role;
revoke all on function public.sync_assigned_task_notification_jobs_v1() from public, anon, authenticated;
grant execute on function public.sync_assigned_task_notification_jobs_v1() to service_role;

-- Backfill active future/near-due work idempotently.
insert into public.notification_jobs(organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,idempotency_key,payload)
select a.clinic_id,a.clinic_id,a.patient_id,'APPOINTMENT',a.id,k.kind,
       public.verto_notification_delivery_due_v1(a.scheduled_at,k.hours_before,public.verto_notification_clinic_timezone_v1(a.clinic_id)),
       'appointment:'||a.id::text||':'||k.short_kind||':'||to_char(a.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS'),
       jsonb_build_object('scheduledAt',a.scheduled_at)
from public.appointments a
cross join (values ('APPOINTMENT_REMINDER_24H'::text,24,'24h'::text),('APPOINTMENT_REMINDER_12H'::text,12,'12h'::text)) k(kind,hours_before,short_kind)
where a.patient_id is not null and a.scheduled_at is not null
  and coalesce(a.is_active,true) and a.deleted_at is null
  and lower(coalesce(a.status,'')) not in ('cancelled','canceled','no_show','missed','completed')
  and a.scheduled_at >= now() - interval '24 hours'
  and a.scheduled_at <= now() + interval '60 days'
on conflict (idempotency_key) do nothing;

insert into public.notification_jobs(organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,recurrence_rule,idempotency_key,payload)
select nullif(t.clinic_id,'')::uuid,nullif(t.clinic_id,'')::uuid,t.patient_id,'ASSIGNED_TASK',t.id,'TASK_REMINDER',
       public.verto_daily_notification_next_due_v1(coalesce(t.scheduled_at,now()),now(),public.verto_notification_clinic_timezone_v1(nullif(t.clinic_id,'')::uuid)),
       'DAILY_WHILE_PENDING',
       'assigned-task:'||t.id::text||':reminder',
       jsonb_build_object('scheduledAt',t.scheduled_at,'daily',true,'title',coalesce(t.task_data->>'title','Tarefa'))
from public.assigned_tasks t
where t.patient_id is not null
  and t.clinic_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and lower(coalesce(t.status,'pending')) not in ('completed','done','canceled','cancelled')
  and lower(coalesce(t.task_data->>'isDailyReminder',t.task_data->>'is_daily_reminder','false')) in ('true','1','yes','on')
on conflict (idempotency_key) do nothing;

create or replace function public.claim_due_notification_jobs_v1(p_worker text, p_limit integer default 100)
returns setof public.notification_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Self-heal claims left behind by a crashed/restarted worker.
  update public.notification_jobs
     set status='SCHEDULED', claimed_at=null, claimed_by=null, updated_at=now(),
         last_error=coalesce(last_error,'STALE_CLAIM_RECOVERED')
   where status='CLAIMED' and claimed_at < now() - interval '15 minutes';

  return query
  with due as (
    select id from public.notification_jobs
    where status='SCHEDULED' and scheduled_for <= now()
    order by scheduled_for,id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),500))
  ), claimed as (
    update public.notification_jobs j
       set status='CLAIMED', claimed_at=now(), claimed_by=left(coalesce(p_worker,'worker'),160), attempt_count=j.attempt_count+1, updated_at=now()
      from due where j.id=due.id
      returning j.*
  ) select * from claimed;
end;
$$;

create or replace function public.finalize_notification_jobs_v1(p_results jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_count integer:=0;
begin
  with input as (
    select * from jsonb_to_recordset(coalesce(p_results,'[]'::jsonb)) as x(id uuid, outcome text, error text)
  ), upd as (
    update public.notification_jobs j set
      status = case
        when upper(coalesce(i.outcome,''))='SENT' and j.recurrence_rule='DAILY_WHILE_PENDING' then 'SCHEDULED'
        when upper(coalesce(i.outcome,''))='SENT' then 'SENT'
        when upper(coalesce(i.outcome,''))='CANCELED' then 'CANCELED'
        else 'SCHEDULED' end,
      scheduled_for = case
        when upper(coalesce(i.outcome,''))='SENT' and j.recurrence_rule='DAILY_WHILE_PENDING' then public.verto_daily_notification_next_due_v1(j.scheduled_for,now(),public.verto_notification_clinic_timezone_v1(j.clinic_id))
        when upper(coalesce(i.outcome,'')) not in ('SENT','CANCELED') then now() + least(interval '60 minutes', interval '5 minutes' * greatest(j.attempt_count,1))
        else j.scheduled_for end,
      sent_at = case when upper(coalesce(i.outcome,''))='SENT' then now() else j.sent_at end,
      last_error = nullif(left(coalesce(i.error,''),1000),''),
      claimed_at=null, claimed_by=null, updated_at=now()
    from input i where j.id=i.id and j.status='CLAIMED'
    returning 1
  ) select count(*) into v_count from upd;
  return v_count;
end;
$$;

create or replace function public.upsert_portal_notifications_batch_v1(p_rows jsonb)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_count integer:=0;
begin
  with input as (
    select * from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
      id uuid, organization_id uuid, clinic_id uuid, recipient_user_id uuid, recipient_email text, patient_id uuid, appointment_id uuid, type text, title text, message text,
      sent_at timestamptz, scheduled_for timestamptz, idempotency_key text, metadata jsonb
    )
  ), ins as (
    insert into public.portal_notifications(id,organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,idempotency_key,metadata)
    select coalesce(id,gen_random_uuid()),organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,idempotency_key,coalesce(metadata,'{}'::jsonb)
    from input
    on conflict (idempotency_key) do update set
      recipient_user_id=excluded.recipient_user_id,recipient_email=excluded.recipient_email,appointment_id=excluded.appointment_id,
      title=excluded.title,message=excluded.message,sent_at=excluded.sent_at,scheduled_for=excluded.scheduled_for,metadata=excluded.metadata
    returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end;
$$;

revoke all on function public.claim_due_notification_jobs_v1(text,integer) from public,anon,authenticated;
revoke all on function public.finalize_notification_jobs_v1(jsonb) from public,anon,authenticated;
revoke all on function public.upsert_portal_notifications_batch_v1(jsonb) from public,anon,authenticated;
grant execute on function public.claim_due_notification_jobs_v1(text,integer) to service_role;
grant execute on function public.finalize_notification_jobs_v1(jsonb) to service_role;
grant execute on function public.upsert_portal_notifications_batch_v1(jsonb) to service_role;

-- Minimal, PHI-free audit trail for patient-portal submissions.
create table if not exists public.patient_portal_submission_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  actor_user_id uuid,
  resource_type text not null,
  resource_id uuid not null,
  action text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists idx_patient_portal_submission_audit_patient_v1 on public.patient_portal_submission_audit(patient_id,created_at desc);
alter table public.patient_portal_submission_audit enable row level security;
revoke all on public.patient_portal_submission_audit from public,anon,authenticated;
grant all on public.patient_portal_submission_audit to service_role;

-- Atomic adult patient task completion: one task mutation, one deterministic history projection and one PHI-free audit event.
create or replace function public.complete_patient_assigned_task_v1(
  p_task_id uuid,
  p_actor_user_id uuid,
  p_expected_patient_id uuid,
  p_patient_effort integer,
  p_patient_effort_emoji text,
  p_patient_effort_label text,
  p_patient_comment text,
  p_completed_at timestamptz,
  p_history_id uuid,
  p_date_group text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_task public.assigned_tasks%rowtype;
  v_history public.history%rowtype;
  v_task_data jsonb;
  v_completed_at timestamptz := coalesce(p_completed_at, now());
  v_clinic uuid;
  v_patient_clinic uuid;
begin
  select * into v_task from public.assigned_tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'ASSIGNED_TASK_NOT_FOUND'; end if;
  if p_expected_patient_id is null or v_task.patient_id is distinct from p_expected_patient_id then
    raise exception 'ASSIGNED_TASK_SCOPE_CHANGED';
  end if;
  if p_patient_effort is not null and (p_patient_effort < 0 or p_patient_effort > 100) then
    raise exception 'ASSIGNED_TASK_EFFORT_INVALID';
  end if;
  begin
    v_clinic := v_task.clinic_id::uuid;
  exception when others then
    raise exception 'ASSIGNED_TASK_CLINIC_INVALID';
  end;
  select p.clinic_id into v_patient_clinic
  from public.patients p
  where p.id=v_task.patient_id and coalesce(p.is_active,true) and p.deleted_at is null
  for share;
  if v_patient_clinic is null or v_patient_clinic is distinct from v_clinic then
    raise exception 'ASSIGNED_TASK_PATIENT_CLINIC_SCOPE_INVALID';
  end if;

  v_task_data := coalesce(v_task.task_data,'{}'::jsonb) || jsonb_build_object(
    'patientEffort',p_patient_effort,
    'patient_effort',p_patient_effort,
    'patientEffortEmoji',nullif(p_patient_effort_emoji,''),
    'patient_effort_emoji',nullif(p_patient_effort_emoji,''),
    'patientEffortLabel',nullif(p_patient_effort_label,''),
    'patient_effort_label',nullif(p_patient_effort_label,'')
  );

  update public.assigned_tasks
     set patient_effort=p_patient_effort,
         patient_effort_emoji=nullif(p_patient_effort_emoji,''),
         patient_effort_label=nullif(p_patient_effort_label,''),
         patient_comment=coalesce(p_patient_comment,''),
         task_data=v_task_data,
         status='completed',
         completed_at=coalesce(v_task.completed_at,v_completed_at),
         last_history_event_id=p_history_id,
         updated_at=now()
   where id=p_task_id
   returning * into v_task;

  insert into public.history(
    id,patient_id,patient_email,type,title,score,energy,note,icon,therapist_id,created_at,date_group,
    assigned_task_id,source,task_data,is_active,deleted_at
  ) values (
    p_history_id,v_task.patient_id,v_task.patient_email,coalesce(nullif(v_task.task_type,''),'task'),
    coalesce(nullif(v_task.task_data->>'title',''),'Tarefa concluída'),null,p_patient_effort,
    coalesce(p_patient_comment,''),coalesce(nullif(v_task.task_data->>'icon',''),'📌'),v_task.professional_id,
    coalesce(v_task.completed_at,v_completed_at),p_date_group,v_task.id,'assigned_task_completion',v_task.task_data,true,null
  )
  on conflict (id) do update set
    patient_id=excluded.patient_id,patient_email=excluded.patient_email,type=excluded.type,title=excluded.title,
    score=null,energy=excluded.energy,note=excluded.note,icon=excluded.icon,therapist_id=excluded.therapist_id,
    created_at=excluded.created_at,date_group=excluded.date_group,assigned_task_id=excluded.assigned_task_id,
    source=excluded.source,task_data=excluded.task_data,is_active=true,deleted_at=null
  returning * into v_history;

  insert into public.patient_portal_submission_audit(
    organization_id,clinic_id,patient_id,actor_user_id,resource_type,resource_id,action,idempotency_key
  ) values (
    v_clinic,v_clinic,v_task.patient_id,p_actor_user_id,'assigned_task',v_task.id,'patient_task_completed',
    'assigned-task-completion:'||v_task.id::text
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('task',to_jsonb(v_task),'history',to_jsonb(v_history));
end;
$$;
revoke all on function public.complete_patient_assigned_task_v1(uuid,uuid,uuid,integer,text,text,text,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_patient_assigned_task_v1(uuid,uuid,uuid,integer,text,text,text,timestamptz,uuid,text) to service_role;
drop function if exists public.complete_patient_assigned_task_v1(uuid,uuid,integer,text,text,text,timestamptz,uuid,text);

create or replace function public.create_patient_portal_history_entry_v1(
  p_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_actor_user_id uuid,
  p_patient_email text,
  p_type text,
  p_title text,
  p_score numeric,
  p_energy numeric,
  p_note text,
  p_icon text,
  p_image text,
  p_image_path text,
  p_date_group text,
  p_source text,
  p_task_data jsonb
) returns setof public.history
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_count integer;
  v_type text:=lower(coalesce(p_type,''));
  v_org uuid;
  v_timezone text;
  v_quota_date date;
begin
  if p_id is null or p_clinic_id is null or p_patient_id is null then raise exception 'PATIENT_PORTAL_HISTORY_SCOPE_INVALID'; end if;
  select p.clinic_id into v_org
  from public.patients p
  where p.id=p_patient_id and p.clinic_id=p_clinic_id and coalesce(p.is_active,true) and p.deleted_at is null;
  if v_org is null then raise exception 'PATIENT_PORTAL_HISTORY_SCOPE_INVALID'; end if;

  if v_type='photo' then
    v_timezone := public.verto_notification_clinic_timezone_v1(p_clinic_id);
    v_quota_date := (now() at time zone v_timezone)::date;
    perform pg_advisory_xact_lock(hashtext(p_patient_id::text||':'||v_quota_date::text||':portal-photo'));
    select count(*) into v_count
    from public.history h
    where h.patient_id=p_patient_id
      and lower(coalesce(h.type,''))='photo'
      and (h.created_at at time zone v_timezone)::date=v_quota_date
      and coalesce(h.is_active,true)
      and h.deleted_at is null
      and h.id<>p_id;
    if v_count >= 5 then raise exception 'FAMILY_DAILY_PHOTO_LIMIT'; end if;
  end if;

  insert into public.history(id,patient_id,patient_email,type,title,score,energy,note,icon,image,image_path,date_group,therapist_id,source,task_data,created_at,is_active,deleted_at)
  values(p_id,p_patient_id,nullif(lower(trim(coalesce(p_patient_email,''))),''),p_type,p_title,p_score,p_energy,p_note,p_icon,p_image,p_image_path,p_date_group,null,p_source,coalesce(p_task_data,'{}'::jsonb),now(),true,null)
  on conflict (id) do update set
    patient_id=excluded.patient_id, patient_email=excluded.patient_email, type=excluded.type, title=excluded.title,
    score=excluded.score, energy=excluded.energy, note=excluded.note, icon=excluded.icon, image=excluded.image,
    image_path=excluded.image_path, date_group=excluded.date_group, source=excluded.source, task_data=excluded.task_data,
    is_active=true, deleted_at=null;

  insert into public.patient_portal_submission_audit(organization_id,clinic_id,patient_id,actor_user_id,resource_type,resource_id,action,idempotency_key)
  values(v_org,p_clinic_id,p_patient_id,p_actor_user_id,'history',p_id,
    case when v_type='photo' then 'patient_diary_photo_submitted' when v_type='checkin' then 'patient_checkin_submitted' else 'patient_diary_text_submitted' end,
    'portal-history:'||p_id::text)
  on conflict (idempotency_key) do nothing;

  return query select * from public.history where id=p_id;
end;
$$;
revoke all on function public.create_patient_portal_history_entry_v1(uuid,uuid,uuid,uuid,text,text,text,numeric,numeric,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_patient_portal_history_entry_v1(uuid,uuid,uuid,uuid,text,text,text,numeric,numeric,text,text,text,text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
