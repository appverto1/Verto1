-- Therapeutic plan and teaching programs.
-- Additive only: legacy PEI payloads, ABA targets, trials and summaries are preserved.

create extension if not exists pgcrypto;

create table if not exists public.patient_therapeutic_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  category text not null default 'OUTRO',
  title text not null,
  description text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  priority integer not null default 0 check (priority between 0 and 100),
  review_due_date date,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.aba_programs
  add column if not exists therapeutic_objective_id uuid references public.patient_therapeutic_objectives(id) on delete set null,
  add column if not exists objective text,
  add column if not exists category text,
  add column if not exists measurement_type text not null default 'independent_prompted_no_response',
  add column if not exists mastery_criteria jsonb not null default '{}'::jsonb,
  add column if not exists advanced_settings jsonb not null default '{}'::jsonb,
  add column if not exists origin_type text not null default 'legacy',
  add column if not exists origin_id text,
  add column if not exists domain_id text,
  add column if not exists domain_name text,
  add column if not exists review_due_date date,
  add column if not exists responsible_professional_ids text[] not null default '{}'::text[],
  add column if not exists version integer not null default 1,
  add column if not exists idempotency_key text,
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text;

alter table public.aba_programs drop constraint if exists aba_programs_status_check;
alter table public.aba_programs
  add constraint aba_programs_status_check
  check (status in (
    'draft', 'awaiting_approval', 'teaching', 'maintenance', 'paused',
    'completed', 'archived', 'active', 'on_hold'
  ));

alter table public.aba_programs drop constraint if exists aba_programs_measurement_type_check;
alter table public.aba_programs
  add constraint aba_programs_measurement_type_check
  check (measurement_type in (
    'independent_prompted_no_response', 'correct_incorrect', 'frequency',
    'duration', 'latency', 'task_analysis', 'percentage'
  ));

alter table public.aba_programs drop constraint if exists aba_programs_origin_type_check;
alter table public.aba_programs
  add constraint aba_programs_origin_type_check
  check (origin_type in ('manual', 'template', 'protocol', 'recommendation', 'legacy'));

alter table public.aba_targets
  add column if not exists sort_order integer not null default 0,
  add column if not exists program_version integer not null default 1,
  add column if not exists objective_snapshot text,
  add column if not exists measurement_type text;

create table if not exists public.aba_program_templates (
  id text primary key default gen_random_uuid()::text,
  organization_id text,
  clinic_id text,
  source_scope text not null default 'CLINIC'
    check (source_scope in ('VERTO', 'CLINIC', 'PERSONAL')),
  owner_user_id text,
  name text not null,
  description text,
  category text not null default 'OUTRO',
  objective text not null,
  suggested_targets jsonb not null default '[]'::jsonb,
  measurement_type text not null default 'independent_prompted_no_response',
  mastery_criteria jsonb not null default '{}'::jsonb,
  advanced_settings jsonb not null default '{}'::jsonb,
  status text not null default 'PUBLISHED'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ARCHIVED')),
  approved_by text,
  approved_at timestamptz,
  idempotency_key text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_program_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  program_id text not null references public.aba_programs(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  change_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (program_id, version)
);

create table if not exists public.aba_program_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  program_id text not null references public.aba_programs(id) on delete cascade,
  event_type text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_therapeutic_objectives_patient_title
  on public.patient_therapeutic_objectives (organization_id, patient_id, lower(title))
  where status <> 'ARCHIVED';
create index if not exists idx_therapeutic_objectives_patient
  on public.patient_therapeutic_objectives (organization_id, patient_id, status, priority desc);
create unique index if not exists idx_aba_programs_therapeutic_idempotency
  on public.aba_programs (organization_id, idempotency_key)
  where organization_id is not null and idempotency_key is not null;
create index if not exists idx_aba_programs_therapeutic_patient
  on public.aba_programs (organization_id, patient_id, status, updated_at desc);
create index if not exists idx_aba_targets_program_name
  on public.aba_targets (program_id, lower(name))
  where program_id is not null;
create index if not exists idx_aba_targets_program_order
  on public.aba_targets (organization_id, patient_id, program_id, sort_order);
create unique index if not exists idx_aba_program_templates_idempotency
  on public.aba_program_templates (organization_id, idempotency_key)
  where organization_id is not null and idempotency_key is not null;
create index if not exists idx_aba_program_templates_library
  on public.aba_program_templates (source_scope, organization_id, category, status, updated_at desc);
create index if not exists idx_aba_program_versions_program
  on public.aba_program_versions (organization_id, patient_id, program_id, version desc);
create unique index if not exists idx_aba_program_audit_idempotency
  on public.aba_program_audit_events (organization_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists idx_aba_program_audit_program
  on public.aba_program_audit_events (organization_id, patient_id, program_id, created_at desc);

create or replace function public.prevent_duplicate_therapeutic_program_target()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.program_id is not null and exists (
    select 1 from public.aba_targets target
    where target.program_id = new.program_id
      and lower(trim(target.name)) = lower(trim(new.name))
      and target.id <> new.id
  ) then
    raise exception 'THERAPEUTIC_TARGET_ALREADY_EXISTS';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_duplicate_therapeutic_program_target on public.aba_targets;
create trigger prevent_duplicate_therapeutic_program_target
before insert or update of program_id, name on public.aba_targets
for each row execute function public.prevent_duplicate_therapeutic_program_target();

alter table public.patient_therapeutic_objectives enable row level security;
alter table public.aba_program_templates enable row level security;
alter table public.aba_program_versions enable row level security;
alter table public.aba_program_audit_events enable row level security;

drop policy if exists patient_therapeutic_objectives_scope on public.patient_therapeutic_objectives;
create policy patient_therapeutic_objectives_scope on public.patient_therapeutic_objectives
for all to authenticated
using (
  exists (
    select 1
    from public.users u
    join public.patients p on p.id = patient_therapeutic_objectives.patient_id
    where u.id = auth.uid()
      and p.clinic_id::text = patient_therapeutic_objectives.organization_id
      and (u.clinic_id::text = patient_therapeutic_objectives.organization_id or u.id::text = patient_therapeutic_objectives.organization_id)
      and (
        u.role in ('owner', 'admin', 'coordinator')
        or (u.role = 'therapist' and p.therapist_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    join public.patients p on p.id = patient_therapeutic_objectives.patient_id
    where u.id = auth.uid()
      and p.clinic_id::text = patient_therapeutic_objectives.organization_id
      and (u.clinic_id::text = patient_therapeutic_objectives.organization_id or u.id::text = patient_therapeutic_objectives.organization_id)
      and u.role in ('owner', 'admin', 'coordinator')
  )
);

drop policy if exists aba_program_templates_read on public.aba_program_templates;
create policy aba_program_templates_read on public.aba_program_templates
for select to authenticated
using (
  (source_scope = 'VERTO' and status = 'PUBLISHED')
  or exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (u.clinic_id::text = aba_program_templates.organization_id or u.id::text = aba_program_templates.organization_id)
      and (
        (
          aba_program_templates.source_scope = 'CLINIC'
          and (
            aba_program_templates.status = 'PUBLISHED'
            or u.role in ('owner', 'admin', 'coordinator')
          )
        )
        or aba_program_templates.owner_user_id = auth.uid()::text
      )
  )
);

drop policy if exists aba_program_templates_manage on public.aba_program_templates;
create policy aba_program_templates_manage on public.aba_program_templates
for all to authenticated
using (
  source_scope <> 'VERTO'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (u.clinic_id::text = aba_program_templates.organization_id or u.id::text = aba_program_templates.organization_id)
      and (
        u.role in ('owner', 'admin', 'coordinator')
        or (source_scope = 'PERSONAL' and owner_user_id = auth.uid()::text)
      )
  )
)
with check (
  source_scope <> 'VERTO'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (u.clinic_id::text = aba_program_templates.organization_id or u.id::text = aba_program_templates.organization_id)
      and (
        u.role in ('owner', 'admin', 'coordinator')
        or (source_scope = 'PERSONAL' and owner_user_id = auth.uid()::text)
      )
  )
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['aba_program_versions', 'aba_program_audit_events']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format($policy$
      create policy %I on public.%I
      for select to authenticated
      using (
        exists (
          select 1
          from public.users u
          join public.patients p on p.id = %I.patient_id
          where u.id = auth.uid()
            and p.clinic_id::text = %I.organization_id
            and (u.clinic_id::text = %I.organization_id or u.id::text = %I.organization_id)
            and (
              u.role in ('owner', 'admin', 'coordinator')
              or (u.role = 'therapist' and p.therapist_id = auth.uid())
            )
        )
      )
    $policy$, table_name || '_read', table_name, table_name, table_name, table_name, table_name);
  end loop;
end $$;

create or replace function public.therapeutic_program_payload(p_program_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'program', to_jsonb(program),
    'objective', to_jsonb(objective),
    'targets', coalesce((
      select jsonb_agg(to_jsonb(target) order by target.sort_order, target.created_at)
      from public.aba_targets target
      where target.program_id = program.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(to_jsonb(event) order by event.created_at desc)
      from (
        select * from public.aba_program_audit_events audit
        where audit.program_id = program.id
        order by audit.created_at desc
        limit 100
      ) event
    ), '[]'::jsonb)
  )
  from public.aba_programs program
  left join public.patient_therapeutic_objectives objective on objective.id = program.therapeutic_objective_id
  where program.id = p_program_id;
$$;

create or replace function public.create_therapeutic_program(
  p_organization_id text,
  p_patient_id uuid,
  p_name text,
  p_objective text,
  p_category text,
  p_measurement_type text,
  p_mastery_criteria jsonb,
  p_targets jsonb,
  p_advanced_settings jsonb,
  p_origin_type text,
  p_origin_id text,
  p_protocol_id text,
  p_protocol_title text,
  p_domain_id text,
  p_domain_name text,
  p_review_due_date date,
  p_status text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program_id text;
  v_objective_id uuid;
  v_target jsonb;
  v_target_name text;
  v_target_index integer := 0;
  v_status text := lower(trim(coalesce(p_status, 'draft')));
  v_measurement text := lower(trim(coalesce(p_measurement_type, 'independent_prompted_no_response')));
  v_origin text := lower(trim(coalesce(p_origin_type, 'manual')));
  v_snapshot jsonb;
begin
  if nullif(trim(coalesce(p_organization_id, '')), '') is null or p_patient_id is null then
    raise exception 'THERAPEUTIC_PLAN_SCOPE_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_NAME_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_objective, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_OBJECTIVE_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_IDEMPOTENCY_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_targets, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) < 1
    or jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) > 50 then
    raise exception 'THERAPEUTIC_PROGRAM_TARGETS_REQUIRED';
  end if;
  if v_status not in ('draft', 'awaiting_approval', 'teaching', 'maintenance') then
    raise exception 'THERAPEUTIC_PROGRAM_STATUS_INVALID';
  end if;
  if v_measurement not in ('independent_prompted_no_response', 'correct_incorrect', 'frequency', 'duration', 'latency', 'task_analysis', 'percentage') then
    raise exception 'THERAPEUTIC_PROGRAM_MEASUREMENT_INVALID';
  end if;
  if v_origin not in ('manual', 'template', 'protocol', 'recommendation', 'legacy') then
    raise exception 'THERAPEUTIC_PROGRAM_ORIGIN_INVALID';
  end if;
  if not exists (
    select 1 from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id::text = p_organization_id
      and coalesce(patient.is_active, true) = true
      and patient.deleted_at is null
  ) then
    raise exception 'THERAPEUTIC_PLAN_PATIENT_SCOPE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':' || p_idempotency_key, 0));
  select id into v_program_id
  from public.aba_programs
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key
  limit 1;
  if v_program_id is not null then
    return public.therapeutic_program_payload(v_program_id);
  end if;

  select id into v_objective_id
  from public.patient_therapeutic_objectives
  where organization_id = p_organization_id
    and patient_id = p_patient_id
    and lower(title) = lower(trim(p_objective))
    and status <> 'ARCHIVED'
  order by created_at
  limit 1;

  if v_objective_id is null then
    insert into public.patient_therapeutic_objectives (
      organization_id, clinic_id, patient_id, category, title, description,
      status, review_due_date, created_by, updated_by
    ) values (
      p_organization_id, p_organization_id, p_patient_id,
      upper(coalesce(nullif(trim(p_category), ''), 'OUTRO')),
      trim(p_objective), trim(p_objective), 'ACTIVE', p_review_due_date,
      p_actor_id, p_actor_id
    ) on conflict do nothing
    returning id into v_objective_id;
    if v_objective_id is null then
      select id into v_objective_id
      from public.patient_therapeutic_objectives
      where organization_id = p_organization_id
        and patient_id = p_patient_id
        and lower(title) = lower(trim(p_objective))
        and status <> 'ARCHIVED'
      order by created_at
      limit 1;
    end if;
  end if;

  v_program_id := gen_random_uuid()::text;
  insert into public.aba_programs (
    id, organization_id, clinic_id, patient_id, therapeutic_objective_id,
    name, description, objective, category, program_type, status,
    measurement_type, mastery_criteria, advanced_settings, origin_type, origin_id,
    protocol_id, protocol_title, domain_id, domain_name, review_due_date,
    idempotency_key, activated_at, activated_by, approved_at, approved_by,
    created_by, created_at, updated_at
  ) values (
    v_program_id, p_organization_id, p_organization_id, p_patient_id, v_objective_id,
    trim(p_name), trim(p_objective), trim(p_objective), upper(coalesce(nullif(trim(p_category), ''), 'OUTRO')),
    'skill_acquisition', v_status, v_measurement,
    coalesce(p_mastery_criteria, '{}'::jsonb), coalesce(p_advanced_settings, '{}'::jsonb),
    v_origin, nullif(trim(coalesce(p_origin_id, '')), ''),
    nullif(trim(coalesce(p_protocol_id, '')), ''), nullif(trim(coalesce(p_protocol_title, '')), ''),
    nullif(trim(coalesce(p_domain_id, '')), ''), nullif(trim(coalesce(p_domain_name, '')), ''),
    p_review_due_date, p_idempotency_key,
    case when v_status in ('teaching', 'maintenance') then now() else null end,
    case when v_status in ('teaching', 'maintenance') then p_actor_id else null end,
    case when v_status in ('teaching', 'maintenance') then now() else null end,
    case when v_status in ('teaching', 'maintenance') then p_actor_id else null end,
    p_actor_id, now(), now()
  );

  for v_target in select value from jsonb_array_elements(p_targets)
  loop
    v_target_name := trim(coalesce(v_target->>'name', v_target #>> '{}'));
    if nullif(v_target_name, '') is not null then
      if not exists (
        select 1 from public.aba_targets target
        where target.program_id = v_program_id
          and lower(trim(target.name)) = lower(v_target_name)
      ) then
      insert into public.aba_targets (
        id, organization_id, clinic_id, patient_id, program_id, name, description,
        target_type, phase, protocol_id, protocol_title, domain_id, domain_name,
        mastery_criteria, sort_order, program_version, objective_snapshot,
        measurement_type, created_by, created_at, updated_at
      ) values (
        gen_random_uuid()::text, p_organization_id, p_organization_id, p_patient_id,
        v_program_id, left(v_target_name, 240), nullif(trim(coalesce(v_target->>'description', '')), ''),
        case when v_measurement = 'task_analysis' then 'task_analysis' else 'dtt' end,
        case when v_status = 'maintenance' then 'maintenance' else 'teaching' end,
        nullif(trim(coalesce(p_protocol_id, '')), ''), nullif(trim(coalesce(p_protocol_title, '')), ''),
        nullif(trim(coalesce(p_domain_id, '')), ''), nullif(trim(coalesce(p_domain_name, '')), ''),
        coalesce(v_target->'masteryCriteria', v_target->'mastery_criteria', p_mastery_criteria, '{}'::jsonb),
        v_target_index, 1, trim(p_objective), v_measurement, p_actor_id, now(), now()
      );
      v_target_index := v_target_index + 1;
      end if;
    end if;
  end loop;

  if v_target_index = 0 then
    raise exception 'THERAPEUTIC_PROGRAM_TARGETS_REQUIRED';
  end if;

  v_snapshot := public.therapeutic_program_payload(v_program_id);
  insert into public.aba_program_versions (
    organization_id, clinic_id, patient_id, program_id, version, snapshot,
    change_reason, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, v_program_id, 1,
    v_snapshot, 'Programa criado', p_actor_id
  );
  insert into public.aba_program_audit_events (
    organization_id, clinic_id, patient_id, program_id, event_type,
    before_state, after_state, idempotency_key, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, v_program_id,
    case when v_status = 'awaiting_approval' then 'SUBMITTED_FOR_APPROVAL' when v_status in ('teaching', 'maintenance') then 'ACTIVATED' else 'CREATED' end,
    '{}'::jsonb, v_snapshot, p_idempotency_key || ':created', p_actor_id
  );

  return v_snapshot;
end;
$$;

create or replace function public.update_therapeutic_program_status(
  p_organization_id text,
  p_patient_id uuid,
  p_program_id text,
  p_status text,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.aba_programs%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if v_status not in ('draft', 'awaiting_approval', 'teaching', 'maintenance', 'paused', 'completed', 'archived') then
    raise exception 'THERAPEUTIC_PROGRAM_STATUS_INVALID';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_IDEMPOTENCY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':' || p_program_id, 0));
  if exists (
    select 1 from public.aba_program_audit_events
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  ) then
    return public.therapeutic_program_payload(p_program_id);
  end if;

  select * into v_program
  from public.aba_programs
  where id = p_program_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
  for update;
  if not found then raise exception 'THERAPEUTIC_PROGRAM_NOT_FOUND'; end if;
  if p_expected_version is not null and v_program.version <> p_expected_version then
    raise exception 'THERAPEUTIC_PROGRAM_VERSION_CONFLICT';
  end if;

  v_before := public.therapeutic_program_payload(p_program_id);
  update public.aba_programs
  set
    status = v_status,
    version = version + 1,
    activated_at = case when v_status in ('teaching', 'maintenance') then coalesce(activated_at, now()) else activated_at end,
    activated_by = case when v_status in ('teaching', 'maintenance') then coalesce(activated_by, p_actor_id) else activated_by end,
    approved_at = case when v_status in ('teaching', 'maintenance') then coalesce(approved_at, now()) else approved_at end,
    approved_by = case when v_status in ('teaching', 'maintenance') then coalesce(approved_by, p_actor_id) else approved_by end,
    completed_at = case when v_status = 'completed' then now() else completed_at end,
    completed_by = case when v_status = 'completed' then p_actor_id else completed_by end,
    updated_at = now()
  where id = p_program_id;

  v_after := public.therapeutic_program_payload(p_program_id);
  insert into public.aba_program_versions (
    organization_id, clinic_id, patient_id, program_id, version, snapshot,
    change_reason, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, p_program_id,
    v_program.version + 1, v_after, nullif(trim(coalesce(p_reason, '')), ''), p_actor_id
  );
  insert into public.aba_program_audit_events (
    organization_id, clinic_id, patient_id, program_id, event_type,
    before_state, after_state, idempotency_key, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, p_program_id,
    'STATUS_' || upper(v_status), v_before, v_after, p_idempotency_key, p_actor_id
  );
  return v_after;
end;
$$;

create or replace function public.update_therapeutic_program(
  p_organization_id text,
  p_patient_id uuid,
  p_program_id text,
  p_name text,
  p_objective text,
  p_category text,
  p_measurement_type text,
  p_mastery_criteria jsonb,
  p_advanced_settings jsonb,
  p_targets jsonb,
  p_review_due_date date,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.aba_programs%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_objective_id uuid;
  v_other_objective_programs integer := 0;
  v_target jsonb;
  v_target_name text;
  v_target_count integer := 0;
  v_sort_order integer := 0;
  v_measurement text := lower(trim(coalesce(p_measurement_type, 'independent_prompted_no_response')));
begin
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_NAME_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_objective, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_OBJECTIVE_REQUIRED';
  end if;
  if v_measurement not in ('independent_prompted_no_response', 'correct_incorrect', 'frequency', 'duration', 'latency', 'task_analysis', 'percentage') then
    raise exception 'THERAPEUTIC_PROGRAM_MEASUREMENT_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_targets, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_targets, '[]'::jsonb)) > 50 then
    raise exception 'THERAPEUTIC_PROGRAM_TARGET_LIMIT';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_IDEMPOTENCY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':' || p_program_id, 0));
  if exists (
    select 1 from public.aba_program_audit_events
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  ) then
    return public.therapeutic_program_payload(p_program_id);
  end if;

  select * into v_program
  from public.aba_programs
  where id = p_program_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
  for update;
  if not found then raise exception 'THERAPEUTIC_PROGRAM_NOT_FOUND'; end if;
  if v_program.status in ('completed', 'archived') then raise exception 'THERAPEUTIC_PROGRAM_READ_ONLY'; end if;
  if p_expected_version is not null and v_program.version <> p_expected_version then
    raise exception 'THERAPEUTIC_PROGRAM_VERSION_CONFLICT';
  end if;

  select id into v_objective_id
  from public.patient_therapeutic_objectives
  where organization_id = p_organization_id
    and patient_id = p_patient_id
    and lower(title) = lower(trim(p_objective))
    and status <> 'ARCHIVED'
  order by created_at
  limit 1;

  if v_objective_id is null then
    select count(*)::integer into v_other_objective_programs
    from public.aba_programs
    where therapeutic_objective_id = v_program.therapeutic_objective_id
      and organization_id = p_organization_id
      and patient_id = p_patient_id
      and id <> p_program_id
      and status <> 'archived';

    if v_program.therapeutic_objective_id is not null and v_other_objective_programs = 0 then
      v_objective_id := v_program.therapeutic_objective_id;
    else
      insert into public.patient_therapeutic_objectives (
        organization_id, clinic_id, patient_id, category, title, description,
        status, review_due_date, created_by, updated_by
      ) values (
        p_organization_id, p_organization_id, p_patient_id,
        upper(coalesce(nullif(trim(p_category), ''), 'OUTRO')),
        trim(p_objective), trim(p_objective), 'ACTIVE', p_review_due_date,
        p_actor_id, p_actor_id
      ) on conflict do nothing
      returning id into v_objective_id;

      if v_objective_id is null then
        select id into v_objective_id
        from public.patient_therapeutic_objectives
        where organization_id = p_organization_id
          and patient_id = p_patient_id
          and lower(title) = lower(trim(p_objective))
          and status <> 'ARCHIVED'
        order by created_at
        limit 1;
      end if;
    end if;
  end if;

  if v_objective_id is null then
    raise exception 'THERAPEUTIC_PROGRAM_OBJECTIVE_RESOLUTION_FAILED';
  end if;

  select count(*)::integer into v_other_objective_programs
  from public.aba_programs
  where therapeutic_objective_id = v_objective_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
    and id <> p_program_id
    and status <> 'archived';

  if v_other_objective_programs = 0 then
    update public.patient_therapeutic_objectives
    set
      category = upper(coalesce(nullif(trim(p_category), ''), 'OUTRO')),
      title = trim(p_objective),
      description = trim(p_objective),
      review_due_date = p_review_due_date,
      updated_by = p_actor_id,
      updated_at = now()
    where id = v_objective_id
      and organization_id = p_organization_id
      and patient_id = p_patient_id;
  end if;

  v_before := public.therapeutic_program_payload(p_program_id);
  update public.aba_programs
  set
    therapeutic_objective_id = v_objective_id,
    name = trim(p_name),
    description = trim(p_objective),
    objective = trim(p_objective),
    category = upper(coalesce(nullif(trim(p_category), ''), 'OUTRO')),
    measurement_type = v_measurement,
    mastery_criteria = coalesce(p_mastery_criteria, '{}'::jsonb),
    advanced_settings = coalesce(p_advanced_settings, '{}'::jsonb),
    review_due_date = p_review_due_date,
    version = version + 1,
    updated_at = now()
  where id = p_program_id;

  update public.aba_targets
  set
    mastery_criteria = coalesce(p_mastery_criteria, '{}'::jsonb),
    measurement_type = v_measurement,
    objective_snapshot = trim(p_objective),
    program_version = v_program.version + 1,
    updated_at = now()
  where program_id = p_program_id
    and organization_id = p_organization_id;

  select count(*)::integer, coalesce(max(sort_order), -1) + 1
  into v_target_count, v_sort_order
  from public.aba_targets
  where program_id = p_program_id
    and organization_id = p_organization_id;

  for v_target in select value from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb))
  loop
    v_target_name := trim(coalesce(v_target->>'name', v_target #>> '{}'));
    if nullif(v_target_name, '') is not null and not exists (
      select 1 from public.aba_targets target
      where target.program_id = p_program_id
        and target.organization_id = p_organization_id
        and lower(trim(target.name)) = lower(v_target_name)
    ) then
      if v_target_count >= 50 then
        raise exception 'THERAPEUTIC_PROGRAM_TARGET_LIMIT';
      end if;
      insert into public.aba_targets (
        id, organization_id, clinic_id, patient_id, program_id, name, description,
        target_type, phase, protocol_id, protocol_title, domain_id, domain_name,
        mastery_criteria, sort_order, program_version, objective_snapshot,
        measurement_type, created_by, created_at, updated_at
      ) values (
        gen_random_uuid()::text, p_organization_id, p_organization_id, p_patient_id,
        p_program_id, left(v_target_name, 240), nullif(trim(coalesce(v_target->>'description', '')), ''),
        case when v_measurement = 'task_analysis' then 'task_analysis' else 'dtt' end,
        case when v_program.status = 'maintenance' then 'maintenance' else 'teaching' end,
        v_program.protocol_id, v_program.protocol_title, v_program.domain_id, v_program.domain_name,
        coalesce(v_target->'masteryCriteria', v_target->'mastery_criteria', p_mastery_criteria, '{}'::jsonb),
        v_sort_order, v_program.version + 1, trim(p_objective), v_measurement,
        p_actor_id, now(), now()
      );
      v_target_count := v_target_count + 1;
      v_sort_order := v_sort_order + 1;
    end if;
  end loop;

  v_after := public.therapeutic_program_payload(p_program_id);
  insert into public.aba_program_versions (
    organization_id, clinic_id, patient_id, program_id, version, snapshot,
    change_reason, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, p_program_id,
    v_program.version + 1, v_after,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Programa atualizado'), p_actor_id
  );
  insert into public.aba_program_audit_events (
    organization_id, clinic_id, patient_id, program_id, event_type,
    before_state, after_state, idempotency_key, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, p_program_id,
    'UPDATED', v_before, v_after, p_idempotency_key, p_actor_id
  );
  return v_after;
end;
$$;

create or replace function public.add_therapeutic_program_target(
  p_organization_id text,
  p_patient_id uuid,
  p_program_id text,
  p_name text,
  p_description text,
  p_idempotency_key text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.aba_programs%rowtype;
  v_existing_target_id text;
  v_sort_order integer;
  v_after jsonb;
begin
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'THERAPEUTIC_TARGET_NAME_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'THERAPEUTIC_PROGRAM_IDEMPOTENCY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':' || p_program_id, 0));
  if exists (
    select 1 from public.aba_program_audit_events
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  ) then
    return public.therapeutic_program_payload(p_program_id);
  end if;

  select * into v_program
  from public.aba_programs
  where id = p_program_id
    and organization_id = p_organization_id
    and patient_id = p_patient_id
  for update;
  if not found then raise exception 'THERAPEUTIC_PROGRAM_NOT_FOUND'; end if;
  if v_program.status in ('completed', 'archived') then raise exception 'THERAPEUTIC_PROGRAM_READ_ONLY'; end if;

  select id into v_existing_target_id
  from public.aba_targets
  where program_id = p_program_id and lower(name) = lower(trim(p_name))
  limit 1;
  if v_existing_target_id is not null then
    return public.therapeutic_program_payload(p_program_id);
  end if;
  if v_existing_target_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_sort_order
    from public.aba_targets where program_id = p_program_id;
    insert into public.aba_targets (
      id, organization_id, clinic_id, patient_id, program_id, name, description,
      target_type, phase, protocol_id, protocol_title, domain_id, domain_name,
      mastery_criteria, sort_order, program_version, objective_snapshot,
      measurement_type, created_by, created_at, updated_at
    ) values (
      gen_random_uuid()::text, p_organization_id, p_organization_id, p_patient_id,
      p_program_id, left(trim(p_name), 240), nullif(trim(coalesce(p_description, '')), ''),
      case when v_program.measurement_type = 'task_analysis' then 'task_analysis' else 'dtt' end,
      case when v_program.status = 'maintenance' then 'maintenance' else 'teaching' end,
      v_program.protocol_id, v_program.protocol_title, v_program.domain_id, v_program.domain_name,
      v_program.mastery_criteria, v_sort_order, v_program.version + 1,
      v_program.objective, v_program.measurement_type, p_actor_id, now(), now()
    );
    update public.aba_programs set version = version + 1, updated_at = now() where id = p_program_id;
  end if;

  v_after := public.therapeutic_program_payload(p_program_id);
  insert into public.aba_program_versions (
    organization_id, clinic_id, patient_id, program_id, version, snapshot,
    change_reason, created_by
  ) select
    p_organization_id, p_organization_id, p_patient_id, p_program_id, version,
    v_after, 'Alvo adicionado', p_actor_id
  from public.aba_programs where id = p_program_id
  on conflict (program_id, version) do nothing;
  insert into public.aba_program_audit_events (
    organization_id, clinic_id, patient_id, program_id, event_type,
    after_state, idempotency_key, created_by
  ) values (
    p_organization_id, p_organization_id, p_patient_id, p_program_id,
    'TARGET_ADDED', v_after, p_idempotency_key, p_actor_id
  );
  return v_after;
end;
$$;

insert into public.aba_program_templates (
  id, source_scope, name, description, category, objective, suggested_targets,
  measurement_type, mastery_criteria, advanced_settings, status, created_by
) values
  ('verto-template-request-help', 'VERTO', 'Solicitar ajuda', 'Ensina pedidos funcionais diante de dificuldades.', 'COMUNICACAO', 'Solicitar ajuda funcionalmente diante de uma dificuldade.', '["Ajuda para abrir", "Ajuda para alcancar", "Ajuda para concluir"]'::jsonb, 'independent_prompted_no_response', '{"type":"accuracy_sessions","minAccuracyPercent":80,"requiredSessions":3}'::jsonb, '{}'::jsonb, 'PUBLISHED', 'verto'),
  ('verto-template-wait', 'VERTO', 'Esperar', 'Desenvolve tolerancia a espera em atividades cotidianas.', 'REGULACAO', 'Esperar pelo tempo combinado sem tentar acessar o item.', '["Esperar 10 segundos", "Esperar 20 segundos", "Esperar 30 segundos"]'::jsonb, 'duration', '{"type":"duration_opportunities","durationSeconds":30,"requiredOpportunities":3}'::jsonb, '{}'::jsonb, 'PUBLISHED', 'verto'),
  ('verto-template-respond-name', 'VERTO', 'Responder ao proprio nome', 'Ensina orientacao ao interlocutor quando chamado.', 'COMUNICACAO', 'Orientar-se para quem chamou ao ouvir o proprio nome.', '["Em ambiente estruturado", "Durante brincadeira", "Com distratores"]'::jsonb, 'independent_prompted_no_response', '{"type":"accuracy_sessions","minAccuracyPercent":80,"requiredSessions":3}'::jsonb, '{}'::jsonb, 'PUBLISHED', 'verto'),
  ('verto-template-follow-instructions', 'VERTO', 'Seguir instrucoes', 'Ensina o seguimento de instrucoes funcionais.', 'AUTONOMIA', 'Seguir instrucoes simples de forma funcional.', '["Instrucoes de uma etapa", "Instrucoes com dois objetos", "Instrucoes em rotina"]'::jsonb, 'correct_incorrect', '{"type":"accuracy_sessions","minAccuracyPercent":80,"requiredSessions":3}'::jsonb, '{}'::jsonb, 'PUBLISHED', 'verto'),
  ('verto-template-turn-taking', 'VERTO', 'Brincar em turnos', 'Organiza trocas de turno em brincadeiras compartilhadas.', 'SOCIAL', 'Participar de brincadeiras respeitando a alternancia de turnos.', '["Um turno", "Tres turnos", "Com outra crianca"]'::jsonb, 'independent_prompted_no_response', '{"type":"accuracy_sessions","minAccuracyPercent":80,"requiredSessions":3}'::jsonb, '{}'::jsonb, 'PUBLISHED', 'verto'),
  ('verto-template-brush-teeth', 'VERTO', 'Escovar os dentes', 'Estrutura a rotina de higiene bucal por etapas.', 'CUIDADOS_PESSOAIS', 'Realizar a rotina de escovacao com maior independencia.', '["Separar materiais", "Escovar", "Enxaguar e guardar"]'::jsonb, 'task_analysis', '{"type":"steps_independent","minAccuracyPercent":90,"requiredSessions":2}'::jsonb, '{}'::jsonb, 'PUBLISHED', 'verto')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  objective = excluded.objective,
  suggested_targets = excluded.suggested_targets,
  measurement_type = excluded.measurement_type,
  mastery_criteria = excluded.mastery_criteria,
  advanced_settings = excluded.advanced_settings,
  status = excluded.status,
  updated_at = now();

revoke all on function public.therapeutic_program_payload(text) from public, anon, authenticated;
revoke all on function public.create_therapeutic_program(text, uuid, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, text, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.update_therapeutic_program_status(text, uuid, text, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.update_therapeutic_program(text, uuid, text, text, text, text, text, jsonb, jsonb, jsonb, date, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.add_therapeutic_program_target(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.therapeutic_program_payload(text) to service_role;
grant execute on function public.create_therapeutic_program(text, uuid, text, text, text, text, jsonb, jsonb, jsonb, text, text, text, text, text, text, date, text, text, text) to service_role;
grant execute on function public.update_therapeutic_program_status(text, uuid, text, text, integer, text, text, text) to service_role;
grant execute on function public.update_therapeutic_program(text, uuid, text, text, text, text, text, jsonb, jsonb, jsonb, date, integer, text, text, text) to service_role;
grant execute on function public.add_therapeutic_program_target(text, uuid, text, text, text, text, text) to service_role;
