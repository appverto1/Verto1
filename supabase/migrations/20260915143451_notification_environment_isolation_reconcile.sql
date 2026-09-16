begin;

-- Explicit deployment namespace for notification infrastructure.
-- Existing rows intentionally remain NULL: historical origin cannot be proven safely.
alter table public.push_subscriptions add column if not exists deployment_env text;
alter table public.notification_jobs add column if not exists deployment_env text;
alter table public.portal_notifications add column if not exists deployment_env text;
alter table public.clinic_announcements add column if not exists deployment_env text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_deployment_env_check' and conrelid = 'public.push_subscriptions'::regclass) then
    alter table public.push_subscriptions add constraint push_subscriptions_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_jobs_deployment_env_check' and conrelid = 'public.notification_jobs'::regclass) then
    alter table public.notification_jobs add constraint notification_jobs_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'portal_notifications_deployment_env_check' and conrelid = 'public.portal_notifications'::regclass) then
    alter table public.portal_notifications add constraint portal_notifications_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinic_announcements_deployment_env_check' and conrelid = 'public.clinic_announcements'::regclass) then
    alter table public.clinic_announcements add constraint clinic_announcements_deployment_env_check check (deployment_env is null or deployment_env in ('staging','production'));
  end if;
end $$;

comment on column public.push_subscriptions.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is never eligible for push delivery.';
comment on column public.notification_jobs.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is never eligible for worker claim.';
comment on column public.portal_notifications.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is excluded from application reads.';
comment on column public.clinic_announcements.deployment_env is 'Trusted runtime namespace. NULL means legacy/untrusted and is never eligible for delivery claim.';

-- Read the non-secret namespace supplied by the backend service-role client.
-- A browser/anon/authenticated request cannot establish this trust marker.
create or replace function public.verto_request_deployment_env_v1()
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
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
  if v_env in ('staging','production') then
    return v_env;
  end if;
  return null;
end;
$$;

create or replace function public.verto_require_notification_deployment_env_v1(p_deployment_env text)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_env text := lower(trim(coalesce(p_deployment_env, '')));
  v_request_env text := public.verto_request_deployment_env_v1();
begin
  if v_env not in ('staging','production') then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_INVALID';
  end if;
  if v_request_env is null then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_REQUIRED';
  end if;
  if v_request_env <> v_env then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_MISMATCH';
  end if;
  return v_env;
end;
$$;

create or replace function public.verto_notification_idempotency_key_v1(p_deployment_env text, p_key text)
returns text
language sql
immutable
as $$
  select lower(trim(p_deployment_env)) || ':' || regexp_replace(coalesce(p_key, ''), '^(staging|production):', '', 'i')
$$;

-- Future backend writes inherit the trusted service-role request namespace.
-- Legacy NULL rows are never promoted by UPDATE: environment is immutable once persisted.
create or replace function public.verto_apply_notification_deployment_env_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request_env text;
begin
  if tg_op = 'UPDATE' then
    new.deployment_env := old.deployment_env;
    return new;
  end if;

  v_request_env := public.verto_request_deployment_env_v1();
  if v_request_env is null then
    new.deployment_env := null;
    return new;
  end if;
  if new.deployment_env is not null and lower(trim(new.deployment_env)) <> v_request_env then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_MISMATCH';
  end if;
  new.deployment_env := v_request_env;
  return new;
end;
$$;

revoke all on function public.verto_request_deployment_env_v1() from public, anon, authenticated;
revoke all on function public.verto_require_notification_deployment_env_v1(text) from public, anon, authenticated;
revoke all on function public.verto_notification_idempotency_key_v1(text,text) from public, anon, authenticated;
revoke all on function public.verto_apply_notification_deployment_env_v1() from public, anon, authenticated;
grant execute on function public.verto_request_deployment_env_v1() to service_role;
grant execute on function public.verto_require_notification_deployment_env_v1(text) to service_role;
grant execute on function public.verto_notification_idempotency_key_v1(text,text) to service_role;
grant execute on function public.verto_apply_notification_deployment_env_v1() to service_role;

-- Environment is immutable for these four delivery-owned tables.
drop trigger if exists trg_push_subscriptions_deployment_env_v1 on public.push_subscriptions;
create trigger trg_push_subscriptions_deployment_env_v1 before insert or update on public.push_subscriptions
for each row execute function public.verto_apply_notification_deployment_env_v1();
drop trigger if exists trg_notification_jobs_deployment_env_v1 on public.notification_jobs;
create trigger trg_notification_jobs_deployment_env_v1 before insert or update on public.notification_jobs
for each row execute function public.verto_apply_notification_deployment_env_v1();
drop trigger if exists trg_portal_notifications_deployment_env_v1 on public.portal_notifications;
create trigger trg_portal_notifications_deployment_env_v1 before insert or update on public.portal_notifications
for each row execute function public.verto_apply_notification_deployment_env_v1();
drop trigger if exists trg_clinic_announcements_deployment_env_v1 on public.clinic_announcements;
create trigger trg_clinic_announcements_deployment_env_v1 before insert or update on public.clinic_announcements
for each row execute function public.verto_apply_notification_deployment_env_v1();

-- Replace global uniqueness/indexes with environment-scoped access paths.
drop index if exists public.idx_push_subscriptions_endpoint;
drop index if exists public.idx_push_subscriptions_patient_endpoint;
drop index if exists public.idx_push_subscriptions_patient_id;
drop index if exists public.idx_push_subscriptions_user_email;
drop index if exists public.idx_push_subscriptions_active_patient;
drop index if exists public.idx_push_subscriptions_renewal_token_hash;
create unique index if not exists idx_push_subscriptions_env_endpoint
  on public.push_subscriptions(deployment_env, endpoint)
  where endpoint is not null;
create unique index if not exists idx_push_subscriptions_env_renewal_token_hash
  on public.push_subscriptions(deployment_env, renewal_token_hash)
  where renewal_token_hash is not null;
create index if not exists idx_push_subscriptions_env_patient_active
  on public.push_subscriptions(deployment_env, patient_id, updated_at desc)
  where invalidated_at is null;
create index if not exists idx_push_subscriptions_env_user_active
  on public.push_subscriptions(deployment_env, user_id, updated_at desc)
  where invalidated_at is null;
create index if not exists idx_push_subscriptions_env_email_active
  on public.push_subscriptions(deployment_env, lower(user_email), updated_at desc)
  where invalidated_at is null;

alter table public.notification_jobs drop constraint if exists notification_jobs_idempotency_key_key;
drop index if exists public.idx_notification_jobs_due_v1;
drop index if exists public.idx_notification_jobs_source_v1;
drop index if exists public.idx_notification_jobs_patient_v1;
create unique index if not exists idx_notification_jobs_env_idempotency_v1
  on public.notification_jobs(deployment_env, idempotency_key);
create index if not exists idx_notification_jobs_env_due_v1
  on public.notification_jobs(deployment_env, scheduled_for, id)
  where status = 'SCHEDULED';
create index if not exists idx_notification_jobs_env_source_v1
  on public.notification_jobs(deployment_env, source_type, source_id, status);
create index if not exists idx_notification_jobs_env_patient_v1
  on public.notification_jobs(deployment_env, patient_id, scheduled_for desc);

-- portal_notifications is backend-owned in the current application. Direct authenticated
-- table access would not have a trustworthy deployment claim in a shared database.
revoke all on table public.portal_notifications from anon, authenticated;
grant all on table public.portal_notifications to service_role;
drop index if exists public.portal_notifications_idempotency_key_uidx;
drop index if exists public.portal_notifications_recipient_read_created_idx;
drop index if exists public.portal_notifications_recipient_email_read_created_idx;
drop index if exists public.portal_notifications_patient_created_idx;
drop index if exists public.portal_notifications_appointment_type_recipient_idx;
drop index if exists public.idx_portal_notifications_clinic_type_created;
create unique index if not exists portal_notifications_env_idempotency_uidx
  on public.portal_notifications(deployment_env, idempotency_key);
create index if not exists portal_notifications_env_patient_created_idx
  on public.portal_notifications(deployment_env, patient_id, created_at desc);
create index if not exists portal_notifications_env_recipient_read_created_idx
  on public.portal_notifications(deployment_env, recipient_user_id, read_at, created_at desc);
create index if not exists portal_notifications_env_recipient_email_read_created_idx
  on public.portal_notifications(deployment_env, recipient_email, read_at, created_at desc);
create index if not exists portal_notifications_env_appointment_type_patient_idx
  on public.portal_notifications(deployment_env, appointment_id, type, patient_id);
create index if not exists portal_notifications_env_clinic_type_created_idx
  on public.portal_notifications(deployment_env, clinic_id, type, created_at desc);

alter table public.clinic_announcements drop constraint if exists clinic_announcements_clinic_id_idempotency_key_key;
drop index if exists public.idx_clinic_announcements_due;
drop index if exists public.idx_clinic_announcements_scope_created;
create unique index if not exists idx_clinic_announcements_env_clinic_idempotency
  on public.clinic_announcements(deployment_env, clinic_id, idempotency_key);
create index if not exists idx_clinic_announcements_env_due
  on public.clinic_announcements(deployment_env, scheduled_for, id)
  where status = 'SCHEDULED';
create index if not exists idx_clinic_announcements_env_scope_created
  on public.clinic_announcements(deployment_env, clinic_id, created_at desc);

-- Atomic subscription renewal is explicitly scoped. The legacy signature is removed
-- so older code cannot renew an untrusted NULL-environment subscription.
drop function if exists public.renew_push_subscription_v1(text,text,text,text,text,jsonb);
create or replace function public.renew_push_subscription_v1(
  p_deployment_env text,
  p_renewal_token_hash text,
  p_next_renewal_token_hash text,
  p_new_endpoint text,
  p_p256dh text,
  p_auth text,
  p_subscription jsonb
)
returns table(success boolean, patient_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_env text;
  v_subscription public.push_subscriptions%rowtype;
  v_owner_id uuid;
  v_owner_patient_id uuid;
  v_now timestamptz := now();
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  if p_renewal_token_hash is null
     or p_renewal_token_hash !~ '^[a-f0-9]{64}$'
     or p_next_renewal_token_hash is null
     or p_next_renewal_token_hash !~ '^[a-f0-9]{64}$'
     or coalesce(length(p_new_endpoint), 0) < 1
     or length(p_new_endpoint) > 2000
     or coalesce(length(p_p256dh), 0) < 1
     or length(p_p256dh) > 2000
     or coalesce(length(p_auth), 0) < 1
     or length(p_auth) > 2000
     or p_subscription is null
     or jsonb_typeof(p_subscription) <> 'object'
  then
    raise exception 'PUSH_RENEWAL_INVALID';
  end if;

  select ps.* into v_subscription
    from public.push_subscriptions ps
   where ps.deployment_env = v_env
     and ps.renewal_token_hash = p_renewal_token_hash
   for update;

  if not found or v_subscription.patient_id is null then
    raise exception 'PUSH_RENEWAL_TOKEN_INVALID';
  end if;

  select ps.id, ps.patient_id into v_owner_id, v_owner_patient_id
    from public.push_subscriptions ps
   where ps.deployment_env = v_env
     and ps.endpoint = p_new_endpoint
     and ps.id <> v_subscription.id
   for update;

  if found then
    if v_owner_patient_id is distinct from v_subscription.patient_id then
      raise exception 'PUSH_RENEWAL_ENDPOINT_OWNERSHIP_CONFLICT';
    end if;
    delete from public.push_subscriptions
     where id = v_owner_id
       and deployment_env = v_env
       and patient_id = v_subscription.patient_id;
  end if;

  update public.push_subscriptions
     set endpoint = p_new_endpoint,
         p256dh = p_p256dh,
         auth = p_auth,
         subscription = p_subscription,
         renewal_token_hash = p_next_renewal_token_hash,
         renewal_token_created_at = v_now,
         last_seen_at = v_now,
         invalidated_at = null,
         updated_at = v_now
   where id = v_subscription.id
     and deployment_env = v_env
     and renewal_token_hash = p_renewal_token_hash;

  if not found then raise exception 'PUSH_RENEWAL_RACE_LOST'; end if;
  return query select true, v_subscription.patient_id;
end;
$$;
revoke all on function public.renew_push_subscription_v1(text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.renew_push_subscription_v1(text,text,text,text,text,text,jsonb) to service_role;

-- Appointment source -> environment-owned jobs. Missing request namespace creates no work.
create or replace function public.sync_appointment_notification_jobs_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_env text := public.verto_request_deployment_env_v1();
  v_status text := lower(coalesce(new.status, ''));
  v_active boolean := coalesce(new.is_active, true) and new.deleted_at is null and v_status not in ('cancelled','canceled','no_show','missed','completed');
  v_org uuid := new.clinic_id;
  v_clinic uuid := new.clinic_id;
  v_timezone text := public.verto_notification_clinic_timezone_v1(new.clinic_id);
begin
  if v_env is null then return new; end if;

  update public.notification_jobs
     set status='CANCELED', updated_at=now(), claimed_at=null, claimed_by=null
   where deployment_env=v_env
     and source_type='APPOINTMENT' and source_id=new.id and status in ('SCHEDULED','CLAIMED');

  if v_active and new.scheduled_at is not null and new.patient_id is not null then
    insert into public.notification_jobs(deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,idempotency_key,payload)
    values
      (v_env,v_org,v_clinic,new.patient_id,'APPOINTMENT',new.id,'APPOINTMENT_REMINDER_24H',public.verto_notification_delivery_due_v1(new.scheduled_at,24,v_timezone),
       public.verto_notification_idempotency_key_v1(v_env,'appointment:'||new.id::text||':24h:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS')),
       jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at)),
      (v_env,v_org,v_clinic,new.patient_id,'APPOINTMENT',new.id,'APPOINTMENT_REMINDER_12H',public.verto_notification_delivery_due_v1(new.scheduled_at,12,v_timezone),
       public.verto_notification_idempotency_key_v1(v_env,'appointment:'||new.id::text||':12h:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS')),
       jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at))
    on conflict (deployment_env,idempotency_key) do update set
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

-- Preserve the current scheduled-once + optional-daily assigned-task semantics.
create or replace function public.sync_assigned_task_notification_jobs_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_env text := public.verto_request_deployment_env_v1();
  v_data jsonb := coalesce(new.task_data, '{}'::jsonb);
  v_daily boolean := lower(coalesce(v_data->>'isDailyReminder', v_data->>'is_daily_reminder', 'false')) in ('true','1','yes','on');
  v_active boolean := lower(coalesce(new.status, 'pending')) not in ('completed','done','canceled','cancelled');
  v_clinic uuid;
  v_timezone text;
  v_scheduled_due timestamptz;
  v_daily_due timestamptz;
begin
  if v_env is null then return new; end if;
  begin
    v_clinic := nullif(new.clinic_id, '')::uuid;
  exception when invalid_text_representation then
    v_clinic := null;
  end;

  v_timezone := public.verto_notification_clinic_timezone_v1(v_clinic);
  v_scheduled_due := case when new.scheduled_at is null then null else public.verto_notification_delivery_due_v1(new.scheduled_at, 0, v_timezone) end;

  update public.notification_jobs
     set status='CANCELED', updated_at=now(), claimed_at=null, claimed_by=null
   where deployment_env=v_env
     and source_type='ASSIGNED_TASK' and source_id=new.id and status in ('SCHEDULED','CLAIMED');

  if v_active and new.patient_id is not null and new.scheduled_at is not null and new.scheduled_at >= now() - interval '6 hours' then
    insert into public.notification_jobs(
      deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,recurrence_rule,idempotency_key,payload
    ) values (
      v_env,v_clinic,v_clinic,new.patient_id,'ASSIGNED_TASK',new.id,'TASK_REMINDER',v_scheduled_due,null,
      public.verto_notification_idempotency_key_v1(v_env,'assigned-task:'||new.id::text||':scheduled:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS')),
      jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at,'daily',false,'deliveryMode','SCHEDULED_ONCE','title',coalesce(v_data->>'title','Tarefa'))
    )
    on conflict (deployment_env,idempotency_key) do update set
      organization_id=excluded.organization_id, clinic_id=excluded.clinic_id, patient_id=excluded.patient_id,
      scheduled_for=excluded.scheduled_for, recurrence_rule=null,
      status=case when notification_jobs.status='SENT' then 'SENT' else 'SCHEDULED' end,
      attempt_count=case when notification_jobs.status='SENT' then notification_jobs.attempt_count else 0 end,
      last_error=case when notification_jobs.status='SENT' then notification_jobs.last_error else null end,
      claimed_at=case when notification_jobs.status='SENT' then notification_jobs.claimed_at else null end,
      claimed_by=case when notification_jobs.status='SENT' then notification_jobs.claimed_by else null end,
      sent_at=case when notification_jobs.status='SENT' then notification_jobs.sent_at else null end,
      payload=excluded.payload, updated_at=now();
  end if;

  if v_active and v_daily and new.patient_id is not null and new.scheduled_at is not null then
    v_daily_due := public.verto_daily_notification_next_due_v1(new.scheduled_at,greatest(now(),coalesce(v_scheduled_due,now())),v_timezone);
    insert into public.notification_jobs(
      deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,recurrence_rule,idempotency_key,payload
    ) values (
      v_env,v_clinic,v_clinic,new.patient_id,'ASSIGNED_TASK',new.id,'TASK_REMINDER',v_daily_due,'DAILY_WHILE_PENDING',
      public.verto_notification_idempotency_key_v1(v_env,'assigned-task:'||new.id::text||':daily'),
      jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at,'daily',true,'deliveryMode','DAILY_WHILE_PENDING','title',coalesce(v_data->>'title','Tarefa'))
    )
    on conflict (deployment_env,idempotency_key) do update set
      organization_id=excluded.organization_id, clinic_id=excluded.clinic_id, patient_id=excluded.patient_id,
      scheduled_for=excluded.scheduled_for, recurrence_rule=excluded.recurrence_rule,
      status='SCHEDULED', attempt_count=0, last_error=null, claimed_at=null, claimed_by=null, sent_at=null,
      payload=excluded.payload, updated_at=now();
  end if;
  return new;
end;
$$;

revoke all on function public.sync_appointment_notification_jobs_v1() from public,anon,authenticated;
revoke all on function public.sync_assigned_task_notification_jobs_v1() from public,anon,authenticated;
grant execute on function public.sync_appointment_notification_jobs_v1() to service_role;
grant execute on function public.sync_assigned_task_notification_jobs_v1() to service_role;

-- Claim/finalize require both the explicit parameter and the trusted request header.
drop function if exists public.claim_due_notification_jobs_v1(text,integer);
create or replace function public.claim_due_notification_jobs_v1(p_deployment_env text, p_worker text, p_limit integer default 100)
returns setof public.notification_jobs
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  update public.notification_jobs
     set status='SCHEDULED', claimed_at=null, claimed_by=null, updated_at=now(), last_error=coalesce(last_error,'STALE_CLAIM_RECOVERED')
   where deployment_env=v_env and status='CLAIMED' and claimed_at < now() - interval '15 minutes';

  return query
  with due as (
    select id from public.notification_jobs
     where deployment_env=v_env and status='SCHEDULED' and scheduled_for <= now()
     order by scheduled_for,id
     for update skip locked
     limit greatest(1,least(coalesce(p_limit,100),500))
  ), claimed as (
    update public.notification_jobs j
       set status='CLAIMED', claimed_at=now(), claimed_by=left(coalesce(p_worker,'worker'),160), attempt_count=j.attempt_count+1, updated_at=now()
      from due where j.id=due.id and j.deployment_env=v_env
      returning j.*
  ) select * from claimed;
end;
$$;

drop function if exists public.finalize_notification_jobs_v1(jsonb);
create or replace function public.finalize_notification_jobs_v1(p_deployment_env text, p_results jsonb)
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_count integer:=0; v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
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
      last_error = nullif(left(coalesce(i.error,''),1000),''), claimed_at=null, claimed_by=null, updated_at=now()
    from input i where j.id=i.id and j.deployment_env=v_env and j.status='CLAIMED'
    returning 1
  ) select count(*) into v_count from upd;
  return v_count;
end;
$$;

drop function if exists public.upsert_portal_notifications_batch_v1(jsonb);
create or replace function public.upsert_portal_notifications_batch_v1(p_deployment_env text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_count integer:=0; v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  with input as (
    select * from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
      id uuid, organization_id uuid, clinic_id uuid, recipient_user_id uuid, recipient_email text, patient_id uuid, appointment_id uuid, type text, title text, message text,
      sent_at timestamptz, scheduled_for timestamptz, idempotency_key text, metadata jsonb
    )
  ), ins as (
    insert into public.portal_notifications(deployment_env,id,organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,idempotency_key,metadata)
    select v_env,coalesce(id,gen_random_uuid()),organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,
      public.verto_notification_idempotency_key_v1(v_env,idempotency_key),coalesce(metadata,'{}'::jsonb)||jsonb_build_object('deploymentEnv',v_env)
    from input
    on conflict (deployment_env,idempotency_key) do update set
      recipient_user_id=excluded.recipient_user_id,recipient_email=excluded.recipient_email,appointment_id=excluded.appointment_id,
      title=excluded.title,message=excluded.message,sent_at=excluded.sent_at,scheduled_for=excluded.scheduled_for,metadata=excluded.metadata
    returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end;
$$;

revoke all on function public.claim_due_notification_jobs_v1(text,text,integer) from public,anon,authenticated;
revoke all on function public.finalize_notification_jobs_v1(text,jsonb) from public,anon,authenticated;
revoke all on function public.upsert_portal_notifications_batch_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_due_notification_jobs_v1(text,text,integer) to service_role;
grant execute on function public.finalize_notification_jobs_v1(text,jsonb) to service_role;
grant execute on function public.upsert_portal_notifications_batch_v1(text,jsonb) to service_role;

-- Disable obsolete announcement writers that cannot carry a trusted namespace.
revoke execute on function public.create_clinic_announcement_delivery_v1(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb) from service_role;
revoke execute on function public.create_clinic_announcement_delivery_v2(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb) from service_role;

-- Current announcement creation derives its environment only from the trusted backend request header.
create or replace function public.create_clinic_announcement_delivery_v3(
  p_announcement_id uuid,
  p_organization_id uuid,
  p_clinic_id uuid,
  p_category text,
  p_title text,
  p_message text,
  p_event_date date,
  p_audience_mode text,
  p_idempotency_key text,
  p_created_by uuid,
  p_recipients jsonb,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_env text := public.verto_request_deployment_env_v1();
  v_announcement_id uuid;
  v_input_count integer := 0;
  v_valid_count integer := 0;
  v_existing_count integer := 0;
  v_status text;
  v_scheduled_for timestamptz;
  v_local_hour integer;
  v_idempotency_key text;
begin
  if v_env is null then raise exception 'NOTIFICATION_DEPLOYMENT_ENV_REQUIRED'; end if;
  if p_clinic_id is null then raise exception 'INVALID_ANNOUNCEMENT_CLINIC'; end if;
  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_ANNOUNCEMENT_RECIPIENTS'; end if;

  v_input_count := jsonb_array_length(coalesce(p_recipients, '[]'::jsonb));
  if v_input_count <= 0 or v_input_count > 500 then raise exception 'INVALID_ANNOUNCEMENT_RECIPIENT_COUNT'; end if;

  select count(*) into v_valid_count
    from jsonb_to_recordset(p_recipients) as r(patient_id uuid,recipient_user_id uuid,recipient_email text)
    join public.patients p on p.id=r.patient_id
   where p.clinic_id=p_clinic_id and coalesce(p.is_active,true)=true and p.deleted_at is null;
  if v_valid_count <> v_input_count then raise exception 'ANNOUNCEMENT_RECIPIENT_SCOPE_MISMATCH'; end if;

  v_scheduled_for := case when p_scheduled_for is not null and p_scheduled_for > now()+interval '15 seconds' then date_trunc('minute',p_scheduled_for) else null end;
  if v_scheduled_for is not null then
    v_local_hour := extract(hour from (v_scheduled_for at time zone 'America/Sao_Paulo'))::integer;
    if v_local_hour >= 22 or v_local_hour < 6 then raise exception 'ANNOUNCEMENT_QUIET_HOURS'; end if;
  end if;
  v_status := case when v_scheduled_for is null then 'SENDING' else 'SCHEDULED' end;
  v_idempotency_key := public.verto_notification_idempotency_key_v1(v_env,p_idempotency_key);

  insert into public.clinic_announcements(
    deployment_env,id,organization_id,clinic_id,category,title,message,event_date,audience_mode,recipient_count,push_sent_count,push_failed_count,
    status,idempotency_key,created_by,scheduled_for,delivery_started_at,delivery_attempt_count,created_at,updated_at
  ) values (
    v_env,p_announcement_id,p_organization_id,p_clinic_id,p_category,p_title,p_message,p_event_date,p_audience_mode,v_input_count,0,0,
    v_status,v_idempotency_key,p_created_by,v_scheduled_for,case when v_status='SENDING' then now() else null end,case when v_status='SENDING' then 1 else 0 end,now(),now()
  )
  on conflict (deployment_env,clinic_id,idempotency_key) do nothing
  returning id into v_announcement_id;

  if v_announcement_id is null then
    select ca.id,ca.recipient_count into v_announcement_id,v_existing_count
      from public.clinic_announcements ca
     where ca.deployment_env=v_env and ca.clinic_id=p_clinic_id and ca.idempotency_key=v_idempotency_key
     limit 1;
    return jsonb_build_object('announcement_id',v_announcement_id,'recipient_count',v_existing_count,'created',false,'deployment_env',v_env);
  end if;

  insert into public.clinic_announcement_recipients(
    announcement_id,organization_id,clinic_id,patient_id,recipient_user_id,recipient_email,portal_notification_id,push_status,created_at,updated_at
  )
  select v_announcement_id,p_organization_id,p_clinic_id,r.patient_id,r.recipient_user_id,nullif(trim(r.recipient_email),''),null,'PENDING',now(),now()
    from jsonb_to_recordset(p_recipients) as r(patient_id uuid,recipient_user_id uuid,recipient_email text)
    join public.patients p on p.id=r.patient_id
   where p.clinic_id=p_clinic_id and coalesce(p.is_active,true)=true and p.deleted_at is null
  on conflict (announcement_id,patient_id) do update
    set recipient_user_id=excluded.recipient_user_id,recipient_email=excluded.recipient_email,updated_at=excluded.updated_at;

  return jsonb_build_object('announcement_id',v_announcement_id,'recipient_count',v_input_count,'created',true,'status',v_status,'scheduled_for',v_scheduled_for,'deployment_env',v_env);
end;
$$;
revoke all on function public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamptz) to service_role;

-- Announcement workers use the same explicit + trusted-header double check as notification_jobs.
drop function if exists public.claim_due_clinic_announcements_v1(text,integer);
create or replace function public.claim_due_clinic_announcements_v1(p_deployment_env text,p_worker_id text,p_limit integer default 20)
returns table(announcement_id uuid)
language plpgsql
security definer
set search_path=public
as $$
declare v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  update public.clinic_announcements
     set status='SCHEDULED',scheduled_for=coalesce(scheduled_for,date_trunc('minute',now())),delivery_started_at=null,delivery_worker_id=null,updated_at=now()
   where deployment_env=v_env and status='SENDING' and sent_at is null and delivery_started_at is not null
     and delivery_started_at < now()-interval '5 minutes' and coalesce(scheduled_for,created_at) <= now();

  return query
  with candidates as (
    select ca.id from public.clinic_announcements ca
     where ca.deployment_env=v_env and ca.status='SCHEDULED' and ca.scheduled_for is not null and ca.scheduled_for <= now()
     order by ca.scheduled_for asc,ca.id asc
     for update skip locked
     limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.clinic_announcements ca
     set status='SENDING',delivery_started_at=now(),delivery_worker_id=left(coalesce(p_worker_id,'worker'),200),
         delivery_attempt_count=coalesce(ca.delivery_attempt_count,0)+1,updated_at=now()
    from candidates c
   where ca.id=c.id and ca.deployment_env=v_env
  returning ca.id;
end;
$$;

drop function if exists public.materialize_clinic_announcement_portal_notifications_v1(uuid);
create or replace function public.materialize_clinic_announcement_portal_notifications_v1(p_deployment_env text,p_announcement_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_count integer:=0; v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  with announcement as (
    select ca.* from public.clinic_announcements ca
     where ca.deployment_env=v_env and ca.id=p_announcement_id and ca.status in ('SENDING','SENT','PARTIAL')
     limit 1
  ), notification_rows as (
    insert into public.portal_notifications(
      deployment_env,id,organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,idempotency_key,metadata,created_at,updated_at
    )
    select v_env,gen_random_uuid(),a.organization_id,a.clinic_id,r.recipient_user_id,r.recipient_email,r.patient_id,null,'clinic_announcement',a.title,
      left(a.title||': '||a.message,1000),now(),a.scheduled_for,
      public.verto_notification_idempotency_key_v1(v_env,'clinic-announcement:'||a.id::text||':'||r.patient_id::text),
      jsonb_build_object('deploymentEnv',v_env,'announcementId',a.id,'category',a.category,'eventDate',a.event_date,'title',a.title,'clinicId',a.clinic_id,'patientId',r.patient_id,'scheduledFor',a.scheduled_for),
      now(),now()
    from announcement a join public.clinic_announcement_recipients r on r.announcement_id=a.id
    on conflict (deployment_env,idempotency_key) do update set updated_at=excluded.updated_at
    returning id,patient_id
  )
  update public.clinic_announcement_recipients r
     set portal_notification_id=n.id,updated_at=now()
    from notification_rows n
   where r.announcement_id=p_announcement_id and r.patient_id=n.patient_id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_due_clinic_announcements_v1(text,text,integer) from public,anon,authenticated;
revoke all on function public.materialize_clinic_announcement_portal_notifications_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_due_clinic_announcements_v1(text,text,integer) to service_role;
grant execute on function public.materialize_clinic_announcement_portal_notifications_v1(text,uuid) to service_role;

-- Legacy NULL rows remain preserved but intentionally untrusted/unclaimable.
-- No UPDATE backfill to staging or production is performed in this migration.

notify pgrst, 'reload schema';
commit;
