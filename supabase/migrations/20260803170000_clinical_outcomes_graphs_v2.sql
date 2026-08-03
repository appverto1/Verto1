-- Clinical outcomes foundation for specialty plans and PTS dashboards.
-- Additive, idempotent and non-destructive. Existing clinical records remain intact.

begin;

create extension if not exists pgcrypto;

create table if not exists public.clinical_measure_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  goal_id text,
  program_id text,
  specialty text,
  name text not null,
  metric_key text not null,
  metric_type text not null default 'numeric',
  unit text,
  direction text not null default 'higher_is_better',
  target_type text not null default 'none',
  target_value numeric,
  target_min numeric,
  target_max numeric,
  numerator_definition text,
  denominator_definition text,
  instrument_id text,
  instrument_version text,
  definition_version integer not null default 1,
  minimum_data_points smallint not null default 4,
  aggregation_method text not null default 'raw',
  recency_window_days smallint not null default 30,
  active boolean not null default true,
  idempotency_key text not null,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clinical_measure_definitions
  add column if not exists organization_id text,
  add column if not exists clinic_id text,
  add column if not exists patient_id uuid,
  add column if not exists plan_id uuid,
  add column if not exists goal_id text,
  add column if not exists program_id text,
  add column if not exists specialty text,
  add column if not exists name text,
  add column if not exists metric_key text,
  add column if not exists metric_type text default 'numeric',
  add column if not exists unit text,
  add column if not exists direction text default 'higher_is_better',
  add column if not exists target_type text default 'none',
  add column if not exists target_value numeric,
  add column if not exists target_min numeric,
  add column if not exists target_max numeric,
  add column if not exists numerator_definition text,
  add column if not exists denominator_definition text,
  add column if not exists instrument_id text,
  add column if not exists instrument_version text,
  add column if not exists definition_version integer default 1,
  add column if not exists minimum_data_points smallint default 4,
  add column if not exists aggregation_method text default 'raw',
  add column if not exists recency_window_days smallint default 30,
  add column if not exists active boolean default true,
  add column if not exists idempotency_key text,
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.clinical_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  plan_version integer,
  goal_id text,
  program_id text,
  session_id text,
  professional_id text not null,
  specialty text,
  measure_definition_id uuid references public.clinical_measure_definitions(id) on delete restrict,
  metric_key text not null,
  metric_label text not null,
  metric_type text not null default 'numeric',
  unit text,
  direction text not null default 'higher_is_better',
  value numeric,
  numerator numeric,
  denominator numeric,
  observed_at timestamptz not null,
  context text not null default 'clinic',
  source text not null default 'professional_observation',
  instrument_id text,
  instrument_version text,
  definition_version integer not null default 1,
  missing_reason text,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

alter table public.clinical_observations
  add column if not exists organization_id text,
  add column if not exists clinic_id text,
  add column if not exists patient_id uuid,
  add column if not exists plan_id uuid,
  add column if not exists plan_version integer,
  add column if not exists goal_id text,
  add column if not exists program_id text,
  add column if not exists session_id text,
  add column if not exists professional_id text,
  add column if not exists specialty text,
  add column if not exists measure_definition_id uuid,
  add column if not exists metric_key text,
  add column if not exists metric_label text,
  add column if not exists metric_type text default 'numeric',
  add column if not exists unit text,
  add column if not exists direction text default 'higher_is_better',
  add column if not exists value numeric,
  add column if not exists numerator numeric,
  add column if not exists denominator numeric,
  add column if not exists observed_at timestamptz,
  add column if not exists context text default 'clinic',
  add column if not exists source text default 'professional_observation',
  add column if not exists instrument_id text,
  add column if not exists instrument_version text,
  add column if not exists definition_version integer default 1,
  add column if not exists missing_reason text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists idempotency_key text,
  add column if not exists created_by text,
  add column if not exists created_at timestamptz default now();

create table if not exists public.clinical_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  pts_plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  pts_goal_id text not null,
  specialty_plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  specialty_goal_id text,
  specialty text not null,
  contribution_type text not null default 'supporting',
  status text not null default 'planned',
  validated_by text,
  validated_at timestamptz,
  idempotency_key text not null,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clinical_plan_phases (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  plan_id uuid not null references public.patient_therapeutic_plans(id) on delete restrict,
  goal_id text,
  program_id text,
  metric_key text,
  phase_type text not null,
  label text not null,
  reason text,
  started_at timestamptz not null,
  ended_at timestamptz,
  plan_version integer,
  created_by text not null,
  created_at timestamptz not null default now()
);

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_measure_definitions'::regclass and conname = 'clinical_measure_direction_v1') then
    alter table public.clinical_measure_definitions add constraint clinical_measure_direction_v1
      check (direction in ('higher_is_better','lower_is_better','target_value','target_range','event'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_measure_definitions'::regclass and conname = 'clinical_measure_target_type_v1') then
    alter table public.clinical_measure_definitions add constraint clinical_measure_target_type_v1
      check (target_type in ('none','value','minimum','maximum','range','event'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_measure_definitions'::regclass and conname = 'clinical_measure_minimum_points_v1') then
    alter table public.clinical_measure_definitions add constraint clinical_measure_minimum_points_v1
      check (minimum_data_points between 4 and 50 and recency_window_days between 1 and 3650 and definition_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_observations'::regclass and conname = 'clinical_observation_direction_v1') then
    alter table public.clinical_observations add constraint clinical_observation_direction_v1
      check (direction in ('higher_is_better','lower_is_better','target_value','target_range','event'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_observations'::regclass and conname = 'clinical_observation_missing_reason_v1') then
    alter table public.clinical_observations add constraint clinical_observation_missing_reason_v1
      check (missing_reason is null or missing_reason in ('not_collected','session_cancelled','not_applicable','incomplete','patient_absent','instrument_unavailable','invalid'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_observations'::regclass and conname = 'clinical_observation_value_or_missing_v1') then
    alter table public.clinical_observations add constraint clinical_observation_value_or_missing_v1
      check (value is not null or missing_reason is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_observations'::regclass and conname = 'clinical_observation_denominator_v1') then
    alter table public.clinical_observations add constraint clinical_observation_denominator_v1
      check (denominator is null or denominator > 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_observations'::regclass and conname = 'clinical_observation_metadata_object_v1') then
    alter table public.clinical_observations add constraint clinical_observation_metadata_object_v1
      check (jsonb_typeof(metadata) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_goal_contributions'::regclass and conname = 'clinical_goal_contribution_type_v1') then
    alter table public.clinical_goal_contributions add constraint clinical_goal_contribution_type_v1
      check (contribution_type in ('required','supporting'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_goal_contributions'::regclass and conname = 'clinical_goal_contribution_status_v1') then
    alter table public.clinical_goal_contributions add constraint clinical_goal_contribution_status_v1
      check (status in ('planned','active','paused','achieved','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.clinical_plan_phases'::regclass and conname = 'clinical_plan_phase_type_v1') then
    alter table public.clinical_plan_phases add constraint clinical_plan_phase_type_v1
      check (phase_type in ('baseline','intervention','procedure_change','maintenance','generalization','pause','goal_change','instrument_change','context_event'));
  end if;
end;
$constraints$;


create or replace function public.validate_clinical_outcome_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_specialty_plan public.patient_therapeutic_plans%rowtype;
  v_definition public.clinical_measure_definitions%rowtype;
begin
  select plan.* into v_plan
  from public.patient_therapeutic_plans plan
  where plan.id = case when tg_table_name = 'clinical_goal_contributions' then new.pts_plan_id else new.plan_id end;

  if not found
     or v_plan.organization_id <> new.organization_id
     or v_plan.clinic_id <> new.clinic_id
     or v_plan.patient_id <> new.patient_id then
    raise exception 'CLINICAL_OUTCOME_PLAN_SCOPE_INVALID';
  end if;

  if tg_table_name = 'clinical_goal_contributions' then
    if v_plan.mode <> 'interdisciplinary' then
      raise exception 'CLINICAL_OUTCOME_PTS_REQUIRED';
    end if;
    select plan.* into v_specialty_plan
    from public.patient_therapeutic_plans plan
    where plan.id = new.specialty_plan_id;
    if not found
       or v_specialty_plan.mode <> 'specialty'
       or v_specialty_plan.organization_id <> new.organization_id
       or v_specialty_plan.clinic_id <> new.clinic_id
       or v_specialty_plan.patient_id <> new.patient_id
       or lower(coalesce(v_specialty_plan.specialty, '')) <> lower(coalesce(new.specialty, '')) then
      raise exception 'CLINICAL_OUTCOME_SPECIALTY_SCOPE_INVALID';
    end if;
  end if;

  if tg_table_name = 'clinical_observations' and new.measure_definition_id is not null then
    select definition.* into v_definition
    from public.clinical_measure_definitions definition
    where definition.id = new.measure_definition_id;
    if not found
       or v_definition.organization_id <> new.organization_id
       or v_definition.clinic_id <> new.clinic_id
       or v_definition.patient_id <> new.patient_id
       or v_definition.plan_id <> new.plan_id
       or v_definition.metric_key <> new.metric_key then
      raise exception 'CLINICAL_OUTCOME_DEFINITION_SCOPE_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_clinical_outcome_scope_v1() from public, anon, authenticated;
grant execute on function public.validate_clinical_outcome_scope_v1() to service_role;

drop trigger if exists validate_clinical_measure_definition_scope_v1 on public.clinical_measure_definitions;
create trigger validate_clinical_measure_definition_scope_v1
before insert or update on public.clinical_measure_definitions
for each row execute function public.validate_clinical_outcome_scope_v1();

drop trigger if exists validate_clinical_observation_scope_v1 on public.clinical_observations;
create trigger validate_clinical_observation_scope_v1
before insert or update on public.clinical_observations
for each row execute function public.validate_clinical_outcome_scope_v1();

drop trigger if exists validate_clinical_goal_contribution_scope_v1 on public.clinical_goal_contributions;
create trigger validate_clinical_goal_contribution_scope_v1
before insert or update on public.clinical_goal_contributions
for each row execute function public.validate_clinical_outcome_scope_v1();

drop trigger if exists validate_clinical_plan_phase_scope_v1 on public.clinical_plan_phases;
create trigger validate_clinical_plan_phase_scope_v1
before insert or update on public.clinical_plan_phases
for each row execute function public.validate_clinical_outcome_scope_v1();

create unique index if not exists idx_clinical_measure_definition_idempotency_v1
  on public.clinical_measure_definitions (organization_id, idempotency_key);
create index if not exists idx_clinical_measure_definition_plan_v1
  on public.clinical_measure_definitions (organization_id, patient_id, plan_id, active, metric_key);
create unique index if not exists idx_clinical_observation_idempotency_v1
  on public.clinical_observations (organization_id, idempotency_key);
create index if not exists idx_clinical_observation_series_v1
  on public.clinical_observations (organization_id, patient_id, plan_id, goal_id, metric_key, observed_at desc);
create index if not exists idx_clinical_observation_recent_v1
  on public.clinical_observations (organization_id, patient_id, observed_at desc);
create unique index if not exists idx_clinical_goal_contribution_idempotency_v1
  on public.clinical_goal_contributions (organization_id, idempotency_key);
create index if not exists idx_clinical_goal_contribution_pts_v1
  on public.clinical_goal_contributions (organization_id, patient_id, pts_plan_id, pts_goal_id);
create index if not exists idx_clinical_plan_phase_series_v1
  on public.clinical_plan_phases (organization_id, patient_id, plan_id, goal_id, metric_key, started_at);


-- Compatibility authority used by the outcomes RLS policies. It is declared
-- here so this migration does not depend on a previously deployed overload.
create or replace function public.therapeutic_plan_current_actor_can_access_v1(
  p_patient_id uuid,
  p_organization_id text,
  p_clinic_id text,
  p_responsible_professional_id text,
  p_participant_professional_ids text[],
  p_required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select
    p_required_permission in ('read', 'write')
    and exists (
      select 1
      from public.patients patient
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_organization_id
        and patient.clinic_id::text = p_clinic_id
        and (
          exists (
            select 1
            from public.users actor
            where actor.id = auth.uid()
              and lower(actor.role) in ('admin', 'owner')
          )
          or exists (
            select 1
            from public.clinic_memberships manager_membership
            where manager_membership.clinic_id = patient.clinic_id
              and manager_membership.user_id = auth.uid()
              and manager_membership.status = 'active'
              and manager_membership.role = 'coordinator'
          )
          or (
            auth.uid()::text = any(
              array[p_responsible_professional_id]
              || coalesce(p_participant_professional_ids, '{}'::text[])
            )
            and exists (
              select 1
              from public.clinic_memberships actor_membership
              join public.patient_professional_links link
                on link.patient_id = patient.id
               and link.professional_id = actor_membership.user_id::text
               and link.organization_id = patient.clinic_id::text
               and link.clinic_id = patient.clinic_id::text
               and link.status = 'active'
              where actor_membership.clinic_id = patient.clinic_id
                and actor_membership.user_id = auth.uid()
                and actor_membership.role = 'therapist'
                and actor_membership.status = 'active'
                and case p_required_permission
                  when 'read' then coalesce(link.permissions->'read', 'true'::jsonb) = 'true'::jsonb
                  when 'write' then coalesce(link.permissions->'write', 'true'::jsonb) = 'true'::jsonb
                  else false
                end
            )
          )
        )
    );
$function$;

revoke all on function public.therapeutic_plan_current_actor_can_access_v1(
  uuid, text, text, text, text[], text
) from public, anon;
grant execute on function public.therapeutic_plan_current_actor_can_access_v1(
  uuid, text, text, text, text[], text
) to authenticated, service_role;

alter table public.clinical_measure_definitions enable row level security;
alter table public.clinical_observations enable row level security;
alter table public.clinical_goal_contributions enable row level security;
alter table public.clinical_plan_phases enable row level security;

-- Access is inherited from the authoritative therapeutic plan. This avoids
-- accepting clinic, patient or professional identities from browser payloads.
drop policy if exists clinical_measure_definitions_read_v1 on public.clinical_measure_definitions;
create policy clinical_measure_definitions_read_v1 on public.clinical_measure_definitions
for select to authenticated using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_measure_definitions.plan_id
      and plan.organization_id = clinical_measure_definitions.organization_id
      and plan.patient_id = clinical_measure_definitions.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'read'::text
      )
  )
);
drop policy if exists clinical_measure_definitions_write_v1 on public.clinical_measure_definitions;
create policy clinical_measure_definitions_write_v1 on public.clinical_measure_definitions
for all to authenticated
using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_measure_definitions.plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
)
with check (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_measure_definitions.plan_id
      and plan.organization_id = clinical_measure_definitions.organization_id
      and plan.patient_id = clinical_measure_definitions.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
);

drop policy if exists clinical_observations_read_v1 on public.clinical_observations;
create policy clinical_observations_read_v1 on public.clinical_observations
for select to authenticated using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_observations.plan_id
      and plan.organization_id = clinical_observations.organization_id
      and plan.patient_id = clinical_observations.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'read'::text
      )
  )
);
drop policy if exists clinical_observations_write_v1 on public.clinical_observations;
create policy clinical_observations_write_v1 on public.clinical_observations
for all to authenticated
using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_observations.plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
)
with check (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_observations.plan_id
      and plan.organization_id = clinical_observations.organization_id
      and plan.patient_id = clinical_observations.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
);

drop policy if exists clinical_goal_contributions_read_v1 on public.clinical_goal_contributions;
create policy clinical_goal_contributions_read_v1 on public.clinical_goal_contributions
for select to authenticated using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_goal_contributions.pts_plan_id
      and plan.organization_id = clinical_goal_contributions.organization_id
      and plan.patient_id = clinical_goal_contributions.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'read'::text
      )
  )
);
drop policy if exists clinical_goal_contributions_write_v1 on public.clinical_goal_contributions;
create policy clinical_goal_contributions_write_v1 on public.clinical_goal_contributions
for all to authenticated
using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_goal_contributions.pts_plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
)
with check (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_goal_contributions.pts_plan_id
      and plan.organization_id = clinical_goal_contributions.organization_id
      and plan.patient_id = clinical_goal_contributions.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
);

drop policy if exists clinical_plan_phases_read_v1 on public.clinical_plan_phases;
create policy clinical_plan_phases_read_v1 on public.clinical_plan_phases
for select to authenticated using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_plan_phases.plan_id
      and plan.organization_id = clinical_plan_phases.organization_id
      and plan.patient_id = clinical_plan_phases.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'read'::text
      )
  )
);
drop policy if exists clinical_plan_phases_write_v1 on public.clinical_plan_phases;
create policy clinical_plan_phases_write_v1 on public.clinical_plan_phases
for all to authenticated
using (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_plan_phases.plan_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
)
with check (
  exists (
    select 1 from public.patient_therapeutic_plans plan
    where plan.id = clinical_plan_phases.plan_id
      and plan.organization_id = clinical_plan_phases.organization_id
      and plan.patient_id = clinical_plan_phases.patient_id
      and public.therapeutic_plan_current_actor_can_access_v1(
        plan.patient_id, plan.organization_id, plan.clinic_id,
        plan.responsible_professional_id, plan.participant_professional_ids, 'write'::text
      )
  )
);

revoke delete on table public.clinical_measure_definitions from authenticated;
revoke delete on table public.clinical_observations from authenticated;
revoke delete on table public.clinical_goal_contributions from authenticated;
revoke delete on table public.clinical_plan_phases from authenticated;

grant select, insert, update on table public.clinical_measure_definitions to authenticated;
grant select, insert, update on table public.clinical_observations to authenticated;
grant select, insert, update on table public.clinical_goal_contributions to authenticated;
grant select, insert, update on table public.clinical_plan_phases to authenticated;
grant all on table public.clinical_measure_definitions to service_role;
grant all on table public.clinical_observations to service_role;
grant all on table public.clinical_goal_contributions to service_role;
grant all on table public.clinical_plan_phases to service_role;

commit;
