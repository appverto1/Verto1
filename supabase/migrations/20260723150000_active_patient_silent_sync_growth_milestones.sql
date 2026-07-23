-- Sincronizacao silenciosa da quantidade de pacientes ativos com Stripe.
-- A fila tem uma linha por clinica para coalescer mutacoes sem perder retries.
-- Os marcos sao imutaveis por clinica e nunca dependem de texto de interface.

create table if not exists public.active_patient_billing_sync_queue (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  desired_active_patient_count integer not null check (desired_active_patient_count >= 0),
  queue_version bigint not null default 1 check (queue_version > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'succeeded')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error text,
  last_synced_active_patient_count integer check (last_synced_active_patient_count >= 0),
  last_synced_at timestamptz,
  trigger text not null default 'patient_lifecycle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_active_patient_billing_sync_queue_due
  on public.active_patient_billing_sync_queue (next_attempt_at, clinic_id)
  where status in ('pending', 'retry');

create table if not exists public.clinic_growth_milestones (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  milestone integer not null check (milestone >= 10 and mod(milestone, 10) = 0),
  active_patient_count integer not null check (active_patient_count >= milestone),
  trigger text not null default 'patient_lifecycle',
  queue_version bigint,
  reached_at timestamptz not null default now(),
  primary key (clinic_id, milestone)
);

create index if not exists idx_clinic_growth_milestones_recent
  on public.clinic_growth_milestones (clinic_id, reached_at desc);

alter table public.active_patient_billing_sync_queue enable row level security;
alter table public.clinic_growth_milestones enable row level security;

revoke all on table public.active_patient_billing_sync_queue from anon, authenticated;
revoke all on table public.clinic_growth_milestones from anon, authenticated;
grant select, insert, update, delete on table public.active_patient_billing_sync_queue to service_role;
grant select, insert, update, delete on table public.clinic_growth_milestones to service_role;

create or replace function public.enqueue_active_patient_billing_sync(
  p_clinic_id uuid,
  p_desired_active_patient_count integer,
  p_trigger text default 'patient_lifecycle',
  p_previous_active_patient_count integer default null
)
returns table (
  queued boolean,
  queue_version bigint,
  desired_active_patient_count integer,
  growth_milestone integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_queue_version bigint;
  v_desired_count integer;
  v_growth_milestone integer;
begin
  if p_clinic_id is null then
    raise exception using errcode = '22023', message = 'clinic_id is required';
  end if;

  if p_desired_active_patient_count is null or p_desired_active_patient_count < 0 then
    raise exception using errcode = '22023', message = 'desired_active_patient_count must be non-negative';
  end if;

  insert into public.active_patient_billing_sync_queue as queue_row (
    clinic_id,
    desired_active_patient_count,
    queue_version,
    status,
    attempts,
    next_attempt_at,
    locked_at,
    lock_token,
    last_error,
    trigger,
    created_at,
    updated_at
  )
  values (
    p_clinic_id,
    p_desired_active_patient_count,
    1,
    'pending',
    0,
    now(),
    null,
    null,
    null,
    coalesce(nullif(trim(p_trigger), ''), 'patient_lifecycle'),
    now(),
    now()
  )
  on conflict (clinic_id) do update
  set
    desired_active_patient_count = excluded.desired_active_patient_count,
    queue_version = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
        then queue_row.queue_version + 1
      else queue_row.queue_version
    end,
    status = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
        then case when queue_row.status = 'processing' then 'processing' else 'pending' end
      else queue_row.status
    end,
    attempts = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
           and queue_row.status <> 'processing'
        then 0
      else queue_row.attempts
    end,
    next_attempt_at = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
        then now()
      else queue_row.next_attempt_at
    end,
    locked_at = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
           and queue_row.status <> 'processing'
        then null
      else queue_row.locked_at
    end,
    lock_token = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
           and queue_row.status <> 'processing'
        then null
      else queue_row.lock_token
    end,
    last_error = case
      when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
        then null
      else queue_row.last_error
    end,
    trigger = excluded.trigger,
    updated_at = now()
  returning
    active_patient_billing_sync_queue.queue_version,
    active_patient_billing_sync_queue.desired_active_patient_count
  into v_queue_version, v_desired_count;

  if p_previous_active_patient_count is not null
     and p_previous_active_patient_count >= 0
     and v_desired_count > p_previous_active_patient_count then
    with inserted_milestones as (
      insert into public.clinic_growth_milestones (
        clinic_id,
        milestone,
        active_patient_count,
        trigger,
        queue_version,
        reached_at
      )
      select
        p_clinic_id,
        milestone_value,
        v_desired_count,
        coalesce(nullif(trim(p_trigger), ''), 'patient_lifecycle'),
        v_queue_version,
        now()
      from generate_series(
        ((p_previous_active_patient_count / 10) + 1) * 10,
        (v_desired_count / 10) * 10,
        10
      ) as milestone_value
      on conflict (clinic_id, milestone) do nothing
      returning milestone
    )
    select max(milestone) into v_growth_milestone from inserted_milestones;
  end if;

  return query select true, v_queue_version, v_desired_count, v_growth_milestone;
end;
$$;

create or replace function public.claim_active_patient_billing_sync_jobs(
  p_lock_token uuid,
  p_limit integer default 20
)
returns table (
  clinic_id uuid,
  desired_active_patient_count integer,
  queue_version bigint,
  attempts integer,
  trigger text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_lock_token is null then
    raise exception using errcode = '22023', message = 'lock token is required';
  end if;

  return query
  with due_jobs as (
    select queue_row.clinic_id
    from public.active_patient_billing_sync_queue as queue_row
    where queue_row.status in ('pending', 'retry')
      and queue_row.next_attempt_at <= now()
    order by queue_row.next_attempt_at asc, queue_row.updated_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update public.active_patient_billing_sync_queue as queue_row
    set
      status = 'processing',
      locked_at = now(),
      lock_token = p_lock_token,
      updated_at = now()
    from due_jobs
    where queue_row.clinic_id = due_jobs.clinic_id
    returning
      queue_row.clinic_id,
      queue_row.desired_active_patient_count,
      queue_row.queue_version,
      queue_row.attempts,
      queue_row.trigger
  )
  select * from claimed;
end;
$$;

create or replace function public.complete_active_patient_billing_sync_job(
  p_clinic_id uuid,
  p_lock_token uuid,
  p_queue_version bigint,
  p_synced_active_patient_count integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  update public.active_patient_billing_sync_queue as queue_row
  set
    status = case when queue_row.queue_version = p_queue_version then 'succeeded' else 'pending' end,
    locked_at = null,
    lock_token = null,
    last_error = null,
    last_synced_active_patient_count = case
      when queue_row.queue_version = p_queue_version then greatest(0, coalesce(p_synced_active_patient_count, 0))
      else queue_row.last_synced_active_patient_count
    end,
    last_synced_at = case when queue_row.queue_version = p_queue_version then now() else queue_row.last_synced_at end,
    next_attempt_at = case when queue_row.queue_version = p_queue_version then now() else now() end,
    updated_at = now()
  where queue_row.clinic_id = p_clinic_id
    and queue_row.lock_token = p_lock_token
  returning queue_row.status into v_status;

  return coalesce(v_status, 'not_claimed');
end;
$$;

create or replace function public.fail_active_patient_billing_sync_job(
  p_clinic_id uuid,
  p_lock_token uuid,
  p_queue_version bigint,
  p_error text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  update public.active_patient_billing_sync_queue as queue_row
  set
    status = case when queue_row.queue_version = p_queue_version then 'retry' else 'pending' end,
    attempts = case when queue_row.queue_version = p_queue_version then queue_row.attempts + 1 else queue_row.attempts end,
    next_attempt_at = case
      when queue_row.queue_version = p_queue_version then
        now() + least(3600, 30 * power(2, least(queue_row.attempts, 6))) * interval '1 second'
      else now()
    end,
    locked_at = null,
    lock_token = null,
    last_error = case when queue_row.queue_version = p_queue_version then left(coalesce(p_error, 'sync_failed'), 1000) else queue_row.last_error end,
    updated_at = now()
  where queue_row.clinic_id = p_clinic_id
    and queue_row.lock_token = p_lock_token
  returning queue_row.status into v_status;

  return coalesce(v_status, 'not_claimed');
end;
$$;

create or replace function public.reconcile_active_patient_billing_sync_queue(
  p_trigger text default 'scheduled_reconciliation'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  with active_counts as (
    select
      patient.clinic_id,
      count(*)::integer as active_patient_count
    from public.patients as patient
    where patient.clinic_id is not null
      and patient.is_active = true
      and patient.deleted_at is null
      and coalesce(to_jsonb(patient)->>'archived_at', '') = ''
      and (
        patient.status is null
        or lower(patient.status) in ('active', 'ativo', 'atendimento_ativo', 'em_tratamento')
      )
    group by patient.clinic_id
  ), reconciled as (
    insert into public.active_patient_billing_sync_queue as queue_row (
      clinic_id,
      desired_active_patient_count,
      queue_version,
      status,
      attempts,
      next_attempt_at,
      trigger,
      created_at,
      updated_at
    )
    select
      clinic.id,
      coalesce(active_counts.active_patient_count, 0),
      1,
      'pending',
      0,
      now(),
      coalesce(nullif(trim(p_trigger), ''), 'scheduled_reconciliation'),
      now(),
      now()
    from public.clinics as clinic
    left join active_counts on active_counts.clinic_id = clinic.id
    where nullif(coalesce(to_jsonb(clinic)->>'stripe_subscription_id', ''), '') is not null
      and coalesce(lower(to_jsonb(clinic)->>'billing_model'), '') <> 'demo'
    on conflict (clinic_id) do update
    set
      desired_active_patient_count = excluded.desired_active_patient_count,
      queue_version = case
        when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
          then queue_row.queue_version + 1
        else queue_row.queue_version
      end,
      status = case
        when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
          then case when queue_row.status = 'processing' then 'processing' else 'pending' end
        else queue_row.status
      end,
      attempts = case
        when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count
             and queue_row.status <> 'processing'
          then 0
        else queue_row.attempts
      end,
      next_attempt_at = case
        when queue_row.desired_active_patient_count is distinct from excluded.desired_active_patient_count then now()
        else queue_row.next_attempt_at
      end,
      trigger = excluded.trigger,
      updated_at = now()
    returning clinic_id
  )
  select count(*) into v_count from reconciled;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.enqueue_active_patient_billing_sync(uuid, integer, text, integer) from public;
revoke all on function public.claim_active_patient_billing_sync_jobs(uuid, integer) from public;
revoke all on function public.complete_active_patient_billing_sync_job(uuid, uuid, bigint, integer) from public;
revoke all on function public.fail_active_patient_billing_sync_job(uuid, uuid, bigint, text) from public;
revoke all on function public.reconcile_active_patient_billing_sync_queue(text) from public;

grant execute on function public.enqueue_active_patient_billing_sync(uuid, integer, text, integer) to service_role;
grant execute on function public.claim_active_patient_billing_sync_jobs(uuid, integer) to service_role;
grant execute on function public.complete_active_patient_billing_sync_job(uuid, uuid, bigint, integer) to service_role;
grant execute on function public.fail_active_patient_billing_sync_job(uuid, uuid, bigint, text) to service_role;
grant execute on function public.reconcile_active_patient_billing_sync_queue(text) to service_role;

notify pgrst, 'reload schema';
