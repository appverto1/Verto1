-- Smoke corrections Block 6.
-- Additive fixes for adult wellbeing, patient message read receipts,
-- assigned-task lifecycle compatibility and seven-day billing grace.

begin;

create table if not exists public.patient_wellbeing_checkins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  actor_user_id uuid null,
  metric_kind text not null,
  metric_value smallint not null,
  tag_id text null,
  tag_label text null,
  note text null,
  icon text null,
  local_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_wellbeing_checkins_metric_kind_chk check (metric_kind in ('mood', 'energy')),
  constraint patient_wellbeing_checkins_metric_value_chk check (metric_value between 0 and 100),
  constraint patient_wellbeing_checkins_tag_id_len_chk check (tag_id is null or char_length(tag_id) <= 80),
  constraint patient_wellbeing_checkins_tag_label_len_chk check (tag_label is null or char_length(tag_label) <= 120),
  constraint patient_wellbeing_checkins_note_len_chk check (note is null or char_length(note) <= 4000),
  constraint patient_wellbeing_checkins_icon_len_chk check (icon is null or char_length(icon) <= 20),
  constraint patient_wellbeing_checkins_org_clinic_chk check (organization_id = clinic_id),
  unique (clinic_id, patient_id, metric_kind, local_date)
);

create index if not exists idx_patient_wellbeing_checkins_patient_date
  on public.patient_wellbeing_checkins (clinic_id, patient_id, local_date desc, created_at desc);

alter table public.patient_wellbeing_checkins enable row level security;
revoke all on table public.patient_wellbeing_checkins from public, anon, authenticated;
grant select, insert, update, delete on table public.patient_wellbeing_checkins to service_role;

comment on table public.patient_wellbeing_checkins is
  'Canonical patient-portal daily mood/energy check-ins. Values are longitudinal context, not a diagnostic or global clinical score.';

create table if not exists public.patient_message_reads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  note_id uuid not null,
  recipient_user_id uuid not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_message_reads_org_clinic_chk check (organization_id = clinic_id),
  unique (clinic_id, patient_id, note_id, recipient_user_id)
);

create index if not exists idx_patient_message_reads_recipient
  on public.patient_message_reads (clinic_id, patient_id, recipient_user_id, read_at desc);

alter table public.patient_message_reads enable row level security;
revoke all on table public.patient_message_reads from public, anon, authenticated;
grant select, insert, update, delete on table public.patient_message_reads to service_role;

comment on table public.patient_message_reads is
  'Persistent per-recipient read receipts for patient-visible professional notes/messages.';

-- A task clinical link is immutable, but lifecycle updates such as completion must
-- not revalidate the linked plan/program/target against their *current* status.
-- Otherwise a historically valid task can become impossible to complete after a
-- plan/program is archived or otherwise evolves.
create or replace function public.validate_assigned_task_clinical_link_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_program public.aba_programs%rowtype;
  v_target public.aba_targets%rowtype;
  v_objective public.patient_therapeutic_objectives%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.therapeutic_plan_id is distinct from old.therapeutic_plan_id
       or new.therapeutic_objective_id is distinct from old.therapeutic_objective_id
       or new.therapeutic_program_id is distinct from old.therapeutic_program_id
       or new.clinical_target_id is distinct from old.clinical_target_id
       or new.clinical_link_snapshot is distinct from old.clinical_link_snapshot
       or new.clinical_link_version is distinct from old.clinical_link_version then
      raise exception 'ASSIGNED_TASK_CLINICAL_LINK_IMMUTABLE';
    end if;
    return new;
  end if;

  if new.therapeutic_plan_id is null
     and new.therapeutic_objective_id is null
     and nullif(trim(new.therapeutic_program_id), '') is null
     and nullif(trim(new.clinical_target_id), '') is null then
    return new;
  end if;

  if new.therapeutic_plan_id is null then raise exception 'ASSIGNED_TASK_CLINICAL_PLAN_REQUIRED'; end if;
  if nullif(trim(new.therapeutic_program_id), '') is null then raise exception 'ASSIGNED_TASK_CLINICAL_PROGRAM_REQUIRED'; end if;
  if nullif(trim(new.clinical_target_id), '') is null then raise exception 'ASSIGNED_TASK_CLINICAL_TARGET_REQUIRED'; end if;

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = new.therapeutic_plan_id
    and patient_id = new.patient_id
    and organization_id::text = new.clinic_id::text
    and clinic_id::text = new.clinic_id::text
    and status <> 'archived';
  if v_plan.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_PLAN_SCOPE_INVALID'; end if;

  if new.therapeutic_objective_id is not null then
    select * into v_objective
    from public.patient_therapeutic_objectives
    where id = new.therapeutic_objective_id
      and patient_id = new.patient_id
      and organization_id::text = new.clinic_id::text
      and clinic_id::text = new.clinic_id::text
      and status <> 'ARCHIVED';
    if v_objective.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_OBJECTIVE_SCOPE_INVALID'; end if;
  end if;

  select * into v_program
  from public.aba_programs
  where id = new.therapeutic_program_id
    and patient_id = new.patient_id
    and organization_id::text = new.clinic_id::text
    and clinic_id::text = new.clinic_id::text
    and therapeutic_plan_id = new.therapeutic_plan_id
    and status <> 'archived';
  if v_program.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_PROGRAM_SCOPE_INVALID'; end if;
  if new.therapeutic_objective_id is not null
     and v_program.therapeutic_objective_id is not null
     and v_program.therapeutic_objective_id is distinct from new.therapeutic_objective_id then
    raise exception 'ASSIGNED_TASK_CLINICAL_OBJECTIVE_PROGRAM_MISMATCH';
  end if;

  select * into v_target
  from public.aba_targets
  where id = new.clinical_target_id
    and patient_id = new.patient_id
    and clinic_id::text = new.clinic_id::text
    and program_id = new.therapeutic_program_id;
  if v_target.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_TARGET_SCOPE_INVALID'; end if;

  if jsonb_typeof(coalesce(new.clinical_link_snapshot, '{}'::jsonb)) <> 'object' then
    raise exception 'ASSIGNED_TASK_CLINICAL_SNAPSHOT_INVALID';
  end if;
  return new;
end;
$$;

-- Seven-day payment grace. These columns were already used defensively by the
-- server in deployments where they existed; make the contract explicit here.
alter table public.clinics
  add column if not exists stripe_payment_failed_at timestamptz,
  add column if not exists stripe_access_block_at timestamptz,
  add column if not exists stripe_last_failed_invoice_id text;

alter table public.users
  add column if not exists stripe_payment_failed_at timestamptz,
  add column if not exists stripe_access_block_at timestamptz,
  add column if not exists stripe_last_failed_invoice_id text;

-- Existing delinquent rows from the old 3-day rule are expanded to seven days
-- from the first stored failure. Repeated webhooks do not move the deadline.
update public.clinics
set stripe_access_block_at = stripe_payment_failed_at + interval '7 days'
where lower(coalesce(subscription_status, '')) = 'delinquent'
  and stripe_payment_failed_at is not null
  and stripe_access_block_at is distinct from stripe_payment_failed_at + interval '7 days';

update public.users
set stripe_access_block_at = stripe_payment_failed_at + interval '7 days'
where lower(coalesce(subscription_status, '')) = 'delinquent'
  and stripe_payment_failed_at is not null
  and stripe_access_block_at is distinct from stripe_payment_failed_at + interval '7 days';

create or replace function public.apply_billing_payment_failure_v1(
  p_clinic_id uuid,
  p_user_id uuid,
  p_email text,
  p_invoice_id text,
  p_failed_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_failed_at timestamptz := coalesce(p_failed_at, now());
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_clinic_block timestamptz;
  v_user_block timestamptz;
begin
  if p_clinic_id is not null then
    update public.clinics
    set subscription_status = 'delinquent',
        stripe_payment_failed_at = coalesce(stripe_payment_failed_at, v_failed_at),
        stripe_access_block_at = coalesce(stripe_payment_failed_at, v_failed_at) + interval '7 days',
        stripe_last_failed_invoice_id = coalesce(nullif(trim(p_invoice_id), ''), stripe_last_failed_invoice_id),
        updated_at = now()
    where id = p_clinic_id
    returning stripe_access_block_at into v_clinic_block;
  end if;

  if p_user_id is not null then
    update public.users
    set subscription_status = 'delinquent',
        stripe_payment_failed_at = coalesce(stripe_payment_failed_at, v_failed_at),
        stripe_access_block_at = coalesce(stripe_payment_failed_at, v_failed_at) + interval '7 days',
        stripe_last_failed_invoice_id = coalesce(nullif(trim(p_invoice_id), ''), stripe_last_failed_invoice_id),
        updated_at = now()
    where id = p_user_id
    returning stripe_access_block_at into v_user_block;
  elsif v_email is not null then
    update public.users
    set subscription_status = 'delinquent',
        stripe_payment_failed_at = coalesce(stripe_payment_failed_at, v_failed_at),
        stripe_access_block_at = coalesce(stripe_payment_failed_at, v_failed_at) + interval '7 days',
        stripe_last_failed_invoice_id = coalesce(nullif(trim(p_invoice_id), ''), stripe_last_failed_invoice_id),
        updated_at = now()
    where lower(email) = v_email
    returning stripe_access_block_at into v_user_block;
  end if;

  return jsonb_build_object(
    'clinicAccessBlockAt', v_clinic_block,
    'userAccessBlockAt', v_user_block,
    'graceDays', 7
  );
end;
$$;

revoke all on function public.apply_billing_payment_failure_v1(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_billing_payment_failure_v1(uuid, uuid, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
