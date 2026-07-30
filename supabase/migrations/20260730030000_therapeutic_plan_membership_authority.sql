-- Align therapeutic-plan RLS with clinic memberships and patient links.
-- Additive and idempotent; no historical backfill or source-row mutation.

begin;

do $migration_guard$
begin
  if to_regclass('public.clinic_memberships') is null
     or to_regclass('public.patient_professional_links') is null
     or to_regclass('public.patients') is null
     or to_regclass('public.patient_therapeutic_plans') is null
     or to_regclass('public.patient_therapeutic_plan_versions') is null
     or to_regclass('public.patient_therapeutic_objectives') is null
     or to_regclass('public.aba_programs') is null
     or to_regclass('public.aba_targets') is null
     or to_regclass('public.aba_program_versions') is null
     or to_regclass('public.aba_program_audit_events') is null
     or to_regprocedure(
       'public.clinic_membership_current_actor_can_manage_v1(uuid)'
     ) is null
     or to_regprocedure(
       'public.patient_professional_link_current_actor_can_read_v1(uuid,text,text,jsonb,text,text)'
     ) is null then
    raise exception 'THERAPEUTIC_PLAN_MEMBERSHIP_SCHEMA_PENDING'
      using detail =
        'Apply 20260730010000 and 20260730020000 before this migration';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patient_therapeutic_plans'
      and column_name in (
        'id',
        'organization_id',
        'clinic_id',
        'patient_id',
        'mode',
        'responsible_professional_id',
        'participant_professional_ids',
        'status'
      )
  ) <> 8
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patient_therapeutic_plan_versions'
      and column_name in (
        'plan_id',
        'organization_id',
        'patient_id',
        'authorized_reader_ids',
        'created_at'
      )
  ) <> 5
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patients'
      and column_name in ('id', 'clinic_id', 'therapist_id')
  ) <> 3
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinic_memberships'
      and column_name in ('clinic_id', 'user_id', 'role', 'status')
  ) <> 4
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patient_professional_links'
      and column_name in (
        'organization_id',
        'clinic_id',
        'patient_id',
        'professional_id',
        'status',
        'permissions',
        'ends_at',
        'updated_at'
      )
  ) <> 8
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'aba_programs'
      and column_name in (
        'id',
        'organization_id',
        'clinic_id',
        'patient_id',
        'therapeutic_plan_id',
        'therapeutic_objective_id',
        'responsible_professional_ids',
        'created_by'
      )
  ) <> 8
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'aba_targets'
      and column_name in (
        'organization_id',
        'clinic_id',
        'patient_id',
        'program_id',
        'created_by'
      )
  ) <> 5
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'patient_therapeutic_objectives'
      and column_name in (
        'id',
        'organization_id',
        'clinic_id',
        'patient_id',
        'created_by'
      )
  ) <> 5
  or exists (
    select 1
    from (
      values
        ('aba_program_versions'),
        ('aba_program_audit_events')
    ) as required_table(table_name)
    where (
      select count(*)
      from information_schema.columns schema_column
      where schema_column.table_schema = 'public'
        and schema_column.table_name =
          required_table.table_name
        and schema_column.column_name in (
          'organization_id',
          'clinic_id',
          'patient_id',
          'program_id'
        )
    ) <> 4
  ) then
    raise exception 'THERAPEUTIC_PLAN_MEMBERSHIP_SCHEMA_PENDING'
      using detail =
        'Therapeutic-plan, ABA scope or membership authority columns are missing';
  end if;
end;
$migration_guard$;

alter table public.patient_therapeutic_plans
  add column if not exists idempotency_key text,
  add column if not exists request_hash text;

do $integrity_guard$
begin
  if exists (
    select 1
    from public.patient_therapeutic_plans plan
    where plan.mode = 'interdisciplinary'
      and plan.status in ('draft', 'active', 'paused')
    group by plan.organization_id, plan.patient_id
    having count(*) > 1
  ) then
    raise exception
      'THERAPEUTIC_PLAN_INTERDISCIPLINARY_ACTIVE_DUPLICATE'
      using detail =
        'Archive or complete duplicate current PTS rows before applying this migration';
  end if;

  if exists (
    select 1
    from public.patient_therapeutic_plans plan
    where not (
      (
        plan.idempotency_key is null
        and plan.request_hash is null
      )
      or (
        nullif(trim(plan.idempotency_key), '') is not null
        and plan.idempotency_key = trim(plan.idempotency_key)
        and coalesce(
          plan.request_hash ~ '^[0-9a-f]{64}$',
          false
        )
      )
    )
  ) then
    raise exception 'THERAPEUTIC_PLAN_IDEMPOTENCY_CONTRACT_INVALID'
      using detail =
        'An idempotency key requires a lowercase SHA-256 request hash';
  end if;

  if exists (
    select 1
    from public.patient_therapeutic_plans plan
    where nullif(trim(plan.idempotency_key), '') is not null
    group by plan.organization_id, plan.idempotency_key
    having count(*) > 1
  ) then
    raise exception 'THERAPEUTIC_PLAN_IDEMPOTENCY_KEY_DUPLICATE'
      using detail =
        'Resolve duplicate therapeutic-plan idempotency keys before applying this migration';
  end if;
end;
$integrity_guard$;

do $constraint_guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'public.patient_therapeutic_plans'::regclass
      and constraint_row.conname =
        'patient_therapeutic_plans_idempotency_contract_v2'
  ) then
    alter table public.patient_therapeutic_plans
      add constraint
        patient_therapeutic_plans_idempotency_contract_v2
      check (
        (
          idempotency_key is null
          and request_hash is null
        )
        or (
          nullif(trim(idempotency_key), '') is not null
          and idempotency_key = trim(idempotency_key)
          and coalesce(
            request_hash ~ '^[0-9a-f]{64}$',
            false
          )
        )
      );
  end if;
end;
$constraint_guard$;

create or replace function
  public.therapeutic_plan_current_actor_can_access_v1(
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
          public.clinic_membership_current_actor_can_manage_v1(
            patient.clinic_id
          )
          or (
            auth.uid()::text = any(
              array[
                p_responsible_professional_id
              ] || coalesce(
                p_participant_professional_ids,
                '{}'::text[]
              )
            )
            and exists (
              select 1
              from public.clinic_memberships actor_membership
              join public.patient_professional_links link
                on link.patient_id = patient.id
               and link.professional_id =
                 actor_membership.user_id::text
               and link.organization_id =
                 patient.clinic_id::text
               and link.clinic_id = patient.clinic_id::text
               and link.status = 'active'
              where actor_membership.clinic_id = patient.clinic_id
                and actor_membership.user_id = auth.uid()
                and actor_membership.role = 'therapist'
                and actor_membership.status = 'active'
                and case p_required_permission
                  when 'read' then
                    coalesce(
                      link.permissions->'read',
                      'true'::jsonb
                    ) = 'true'::jsonb
                  when 'write' then
                    coalesce(
                      link.permissions->'write',
                      'true'::jsonb
                    ) = 'true'::jsonb
                  else false
                end
            )
          )
        )
    );
$function$;

create or replace function
  public.therapeutic_plan_version_current_actor_can_read_v1(
    p_plan_id uuid,
    p_patient_id uuid,
    p_organization_id text,
    p_authorized_reader_ids text[],
    p_version_created_at timestamptz
  )
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select exists (
    select 1
    from public.patients patient
    join public.patient_therapeutic_plans plan
      on plan.id = p_plan_id
     and plan.patient_id = p_patient_id
     and plan.organization_id = p_organization_id
     and plan.clinic_id = patient.clinic_id::text
    where patient.id = p_patient_id
      and patient.clinic_id::text = p_organization_id
      and (
        public.clinic_membership_current_actor_can_manage_v1(
          patient.clinic_id
        )
        or (
          auth.uid()::text = any(
            coalesce(p_authorized_reader_ids, '{}'::text[])
          )
          and exists (
            select 1
            from public.clinic_memberships actor_membership
            join public.patient_professional_links link
              on link.patient_id = patient.id
             and link.professional_id =
               actor_membership.user_id::text
             and link.organization_id = patient.clinic_id::text
             and link.clinic_id = patient.clinic_id::text
            where actor_membership.clinic_id = patient.clinic_id
              and actor_membership.user_id = auth.uid()
              and actor_membership.role = 'therapist'
              and actor_membership.status = 'active'
              and (
                (
                  link.status = 'active'
                  and coalesce(
                    link.permissions->'read',
                    'true'::jsonb
                  ) = 'true'::jsonb
                )
                or (
                   link.status = 'ended'
                   and link.permissions->'historicalRead' =
                     'true'::jsonb
                   and link.ends_at is not null
                   and p_version_created_at <= link.updated_at
                   and (
                     p_version_created_at
                     at time zone 'America/Sao_Paulo'
                   )::date <= link.ends_at
                )
              )
          )
        )
      )
  );
$function$;

create or replace function
  public.therapeutic_patient_actor_has_link_permission_v1(
    p_patient_id uuid,
    p_organization_id text,
    p_clinic_id text,
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
      join public.clinic_memberships actor_membership
        on actor_membership.clinic_id = patient.clinic_id
       and actor_membership.user_id = auth.uid()
       and actor_membership.role = 'therapist'
       and actor_membership.status = 'active'
      join public.patient_professional_links link
        on link.patient_id = patient.id
       and link.professional_id = auth.uid()::text
       and link.organization_id = patient.clinic_id::text
       and link.clinic_id = patient.clinic_id::text
       and link.status = 'active'
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_clinic_id
        and coalesce(
          nullif(p_organization_id, ''),
          p_clinic_id
        ) = patient.clinic_id::text
        and case p_required_permission
          when 'read' then
            coalesce(
              link.permissions->'read',
              'true'::jsonb
            ) = 'true'::jsonb
          when 'write' then
            coalesce(
              link.permissions->'write',
              'true'::jsonb
            ) = 'true'::jsonb
          else false
        end
    );
$function$;

create or replace function
  public.therapeutic_program_row_actor_can_access_v1(
    p_patient_id uuid,
    p_organization_id text,
    p_clinic_id text,
    p_therapeutic_plan_id uuid,
    p_created_by text,
    p_responsible_professional_ids text[],
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
        and patient.clinic_id::text = p_clinic_id
        and coalesce(
          nullif(p_organization_id, ''),
          p_clinic_id
        ) = patient.clinic_id::text
        and (
          public.clinic_membership_current_actor_can_manage_v1(
            patient.clinic_id
          )
          or (
            p_therapeutic_plan_id is not null
            and exists (
              select 1
              from public.patient_therapeutic_plans plan
              where plan.id = p_therapeutic_plan_id
                and plan.patient_id = patient.id
                and plan.organization_id = patient.clinic_id::text
                and plan.clinic_id = patient.clinic_id::text
                and plan.status <> 'archived'
                and public.therapeutic_plan_current_actor_can_access_v1(
                  plan.patient_id,
                  plan.organization_id,
                  plan.clinic_id,
                  plan.responsible_professional_id,
                  plan.participant_professional_ids,
                  p_required_permission
                )
            )
          )
          or (
            p_therapeutic_plan_id is null
            and (
              patient.therapist_id = auth.uid()
              or p_created_by = auth.uid()::text
              or auth.uid()::text = any(
                coalesce(
                  p_responsible_professional_ids,
                  '{}'::text[]
                )
              )
            )
            and public.therapeutic_patient_actor_has_link_permission_v1(
              patient.id,
              p_organization_id,
              p_clinic_id,
              p_required_permission
            )
          )
        )
    );
$function$;

create or replace function
  public.therapeutic_program_actor_can_access_v1(
    p_program_id text,
    p_organization_id text,
    p_clinic_id text,
    p_patient_id uuid,
    p_required_permission text
  )
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select exists (
    select 1
    from public.aba_programs program
    where program.id = p_program_id
      and program.patient_id = p_patient_id
      and program.clinic_id = p_clinic_id
      and coalesce(
        nullif(program.organization_id, ''),
        program.clinic_id
      ) = coalesce(
        nullif(p_organization_id, ''),
        p_clinic_id
      )
      and public.therapeutic_program_row_actor_can_access_v1(
        program.patient_id,
        program.organization_id,
        program.clinic_id,
        program.therapeutic_plan_id,
        program.created_by,
        program.responsible_professional_ids,
        p_required_permission
      )
  );
$function$;

create or replace function
  public.therapeutic_target_row_actor_can_access_v1(
    p_patient_id uuid,
    p_organization_id text,
    p_clinic_id text,
    p_program_id text,
    p_created_by text,
    p_required_permission text
  )
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select case
    when p_program_id is not null then
      public.therapeutic_program_actor_can_access_v1(
        p_program_id,
        p_organization_id,
        p_clinic_id,
        p_patient_id,
        p_required_permission
      )
    else exists (
      select 1
      from public.patients patient
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_clinic_id
        and coalesce(
          nullif(p_organization_id, ''),
          p_clinic_id
        ) = patient.clinic_id::text
        and (
          public.clinic_membership_current_actor_can_manage_v1(
            patient.clinic_id
          )
          or (
            (
              patient.therapist_id = auth.uid()
              or p_created_by = auth.uid()::text
            )
            and public.therapeutic_patient_actor_has_link_permission_v1(
              patient.id,
              p_organization_id,
              p_clinic_id,
              p_required_permission
            )
          )
        )
    )
  end;
$function$;

create or replace function
  public.therapeutic_objective_actor_can_access_v1(
    p_objective_id uuid,
    p_patient_id uuid,
    p_organization_id text,
    p_clinic_id text,
    p_created_by text,
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
          public.clinic_membership_current_actor_can_manage_v1(
            patient.clinic_id
          )
          or (
            p_required_permission = 'read'
            and exists (
              select 1
              from public.aba_programs program
              where program.therapeutic_objective_id =
                p_objective_id
                and program.patient_id = p_patient_id
                and public.therapeutic_program_row_actor_can_access_v1(
                  program.patient_id,
                  program.organization_id,
                  program.clinic_id,
                  program.therapeutic_plan_id,
                  program.created_by,
                  program.responsible_professional_ids,
                  'read'
                )
            )
          )
        )
    );
$function$;

revoke all on function
  public.therapeutic_plan_current_actor_can_access_v1(
    uuid,
    text,
    text,
    text,
    text[],
    text
  )
  from public, anon;
revoke all on function
  public.therapeutic_plan_version_current_actor_can_read_v1(
    uuid,
    uuid,
    text,
    text[],
    timestamptz
  )
  from public, anon;
grant execute on function
  public.therapeutic_plan_current_actor_can_access_v1(
    uuid,
    text,
    text,
    text,
    text[],
    text
  )
  to authenticated, service_role;
grant execute on function
  public.therapeutic_plan_version_current_actor_can_read_v1(
    uuid,
    uuid,
    text,
    text[],
    timestamptz
  )
  to authenticated, service_role;
revoke all on function
  public.therapeutic_patient_actor_has_link_permission_v1(
    uuid,
    text,
    text,
    text
  )
  from public, anon;
revoke all on function
  public.therapeutic_program_row_actor_can_access_v1(
    uuid,
    text,
    text,
    uuid,
    text,
    text[],
    text
  )
  from public, anon;
revoke all on function
  public.therapeutic_program_actor_can_access_v1(
    text,
    text,
    text,
    uuid,
    text
  )
  from public, anon;
revoke all on function
  public.therapeutic_target_row_actor_can_access_v1(
    uuid,
    text,
    text,
    text,
    text,
    text
  )
  from public, anon;
revoke all on function
  public.therapeutic_objective_actor_can_access_v1(
    uuid,
    uuid,
    text,
    text,
    text,
    text
  )
  from public, anon;
grant execute on function
  public.therapeutic_patient_actor_has_link_permission_v1(
    uuid,
    text,
    text,
    text
  )
  to authenticated, service_role;
grant execute on function
  public.therapeutic_program_row_actor_can_access_v1(
    uuid,
    text,
    text,
    uuid,
    text,
    text[],
    text
  )
  to authenticated, service_role;
grant execute on function
  public.therapeutic_program_actor_can_access_v1(
    text,
    text,
    text,
    uuid,
    text
  )
  to authenticated, service_role;
grant execute on function
  public.therapeutic_target_row_actor_can_access_v1(
    uuid,
    text,
    text,
    text,
    text,
    text
  )
  to authenticated, service_role;
grant execute on function
  public.therapeutic_objective_actor_can_access_v1(
    uuid,
    uuid,
    text,
    text,
    text,
    text
  )
  to authenticated, service_role;

alter table public.patient_therapeutic_plans
  enable row level security;
alter table public.patient_therapeutic_plan_versions
  enable row level security;
alter table public.aba_programs
  enable row level security;
alter table public.aba_targets
  enable row level security;
alter table public.patient_therapeutic_objectives
  enable row level security;
alter table public.aba_program_versions
  enable row level security;
alter table public.aba_program_audit_events
  enable row level security;

create index if not exists
  idx_aba_programs_therapeutic_objective_scope_v2
on public.aba_programs (therapeutic_objective_id, patient_id)
where therapeutic_objective_id is not null;

create unique index if not exists
  idx_therapeutic_plan_active_interdisciplinary_v2
on public.patient_therapeutic_plans (organization_id, patient_id)
where mode = 'interdisciplinary'
  and status in ('draft', 'active', 'paused');

create unique index if not exists
  idx_therapeutic_plan_idempotency_v2
on public.patient_therapeutic_plans (
  organization_id,
  idempotency_key
)
where idempotency_key is not null;

-- Every newly created or edited plan receives an immutable current-version
-- snapshot in the same transaction. Existing rows are deliberately not
-- backfilled; their historical representation remains unchanged.
create or replace function
  public.snapshot_patient_therapeutic_plan_version_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  reader_ids text[];
begin
  select coalesce(
    array_agg(distinct reader_id order by reader_id),
    '{}'::text[]
  )
  into reader_ids
  from unnest(
    array[new.responsible_professional_id]
    || coalesce(new.participant_professional_ids, '{}'::text[])
  ) as readers(reader_id)
  where nullif(readers.reader_id, '') is not null;

  insert into public.patient_therapeutic_plan_versions (
    plan_id,
    organization_id,
    patient_id,
    version,
    snapshot,
    authored_by,
    authorized_reader_ids,
    created_at
  ) values (
    new.id,
    new.organization_id,
    new.patient_id,
    new.edit_version,
    to_jsonb(new),
    coalesce(nullif(trim(new.updated_by), ''), new.created_by),
    reader_ids,
    new.updated_at
  )
  on conflict (plan_id, version) do nothing;

  return new;
end;
$function$;

revoke all on function public.snapshot_patient_therapeutic_plan_version_v2()
  from public, anon, authenticated;

drop trigger if exists snapshot_patient_therapeutic_plan_version_v2
  on public.patient_therapeutic_plans;
create trigger snapshot_patient_therapeutic_plan_version_v2
after insert or update on public.patient_therapeutic_plans
for each row
execute function public.snapshot_patient_therapeutic_plan_version_v2();

drop policy if exists patient_therapeutic_plans_tenant_select
  on public.patient_therapeutic_plans;
create policy patient_therapeutic_plans_tenant_select
on public.patient_therapeutic_plans
for select
to authenticated
using (
  public.therapeutic_plan_current_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    responsible_professional_id,
    participant_professional_ids,
    'read'
  )
);

drop policy if exists patient_therapeutic_plans_tenant_write
  on public.patient_therapeutic_plans;
drop policy if exists patient_therapeutic_plans_tenant_insert_v2
  on public.patient_therapeutic_plans;
drop policy if exists patient_therapeutic_plans_tenant_update_v2
  on public.patient_therapeutic_plans;
drop policy if exists patient_therapeutic_plans_tenant_delete_v2
  on public.patient_therapeutic_plans;

create policy patient_therapeutic_plans_tenant_insert_v2
on public.patient_therapeutic_plans
for insert
to authenticated
with check (
  public.therapeutic_plan_current_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    responsible_professional_id,
    participant_professional_ids,
    'write'
  )
);

create policy patient_therapeutic_plans_tenant_update_v2
on public.patient_therapeutic_plans
for update
to authenticated
using (
  public.therapeutic_plan_current_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    responsible_professional_id,
    participant_professional_ids,
    'write'
  )
)
with check (
  public.therapeutic_plan_current_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    responsible_professional_id,
    participant_professional_ids,
    'write'
  )
);

revoke delete on table public.patient_therapeutic_plans
  from authenticated;

drop policy if exists patient_therapeutic_plan_versions_tenant_select
  on public.patient_therapeutic_plan_versions;
create policy patient_therapeutic_plan_versions_tenant_select
on public.patient_therapeutic_plan_versions
for select
to authenticated
using (
  public.therapeutic_plan_version_current_actor_can_read_v1(
    plan_id,
    patient_id,
    organization_id,
    authorized_reader_ids,
    created_at
  )
);

-- A scoped program inherits the plan participants and permissions. An
-- unscoped legacy program remains available only to its historical
-- author/responsible professional while that professional has a current
-- patient link with the requested permission.
drop policy if exists aba_programs_patient_scope_rw
  on public.aba_programs;
drop policy if exists aba_programs_tenant_select_v2
  on public.aba_programs;
drop policy if exists aba_programs_tenant_insert_v2
  on public.aba_programs;
drop policy if exists aba_programs_tenant_update_v2
  on public.aba_programs;
drop policy if exists aba_programs_tenant_delete_v2
  on public.aba_programs;

create policy aba_programs_tenant_select_v2
on public.aba_programs
for select
to authenticated
using (
  public.therapeutic_program_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    therapeutic_plan_id,
    created_by,
    responsible_professional_ids,
    'read'
  )
);

create policy aba_programs_tenant_insert_v2
on public.aba_programs
for insert
to authenticated
with check (
  public.therapeutic_program_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    therapeutic_plan_id,
    created_by,
    responsible_professional_ids,
    'write'
  )
);

create policy aba_programs_tenant_update_v2
on public.aba_programs
for update
to authenticated
using (
  public.therapeutic_program_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    therapeutic_plan_id,
    created_by,
    responsible_professional_ids,
    'write'
  )
)
with check (
  public.therapeutic_program_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    therapeutic_plan_id,
    created_by,
    responsible_professional_ids,
    'write'
  )
);

create policy aba_programs_tenant_delete_v2
on public.aba_programs
for delete
to authenticated
using (
  public.therapeutic_program_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    therapeutic_plan_id,
    created_by,
    responsible_professional_ids,
    'write'
  )
);

-- Targets follow their program whenever one exists. Orphaned legacy targets
-- preserve their former author/therapist compatibility but still require a
-- current patient link.
drop policy if exists aba_targets_patient_scope_rw
  on public.aba_targets;
drop policy if exists aba_targets_tenant_select_v2
  on public.aba_targets;
drop policy if exists aba_targets_tenant_insert_v2
  on public.aba_targets;
drop policy if exists aba_targets_tenant_update_v2
  on public.aba_targets;
drop policy if exists aba_targets_tenant_delete_v2
  on public.aba_targets;

create policy aba_targets_tenant_select_v2
on public.aba_targets
for select
to authenticated
using (
  public.therapeutic_target_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    program_id,
    created_by,
    'read'
  )
);

create policy aba_targets_tenant_insert_v2
on public.aba_targets
for insert
to authenticated
with check (
  public.therapeutic_target_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    program_id,
    created_by,
    'write'
  )
);

create policy aba_targets_tenant_update_v2
on public.aba_targets
for update
to authenticated
using (
  public.therapeutic_target_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    program_id,
    created_by,
    'write'
  )
)
with check (
  public.therapeutic_target_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    program_id,
    created_by,
    'write'
  )
);

create policy aba_targets_tenant_delete_v2
on public.aba_targets
for delete
to authenticated
using (
  public.therapeutic_target_row_actor_can_access_v1(
    patient_id,
    organization_id,
    clinic_id,
    program_id,
    created_by,
    'write'
  )
);

-- Objectives can be shared by programs from more than one plan. Therapists
-- see only objectives referenced by a program they can read. Mutations remain
-- manager-only through the write branch of the helper.
drop policy if exists patient_therapeutic_objectives_scope
  on public.patient_therapeutic_objectives;
drop policy if exists
  patient_therapeutic_objectives_tenant_select_v2
  on public.patient_therapeutic_objectives;
drop policy if exists
  patient_therapeutic_objectives_tenant_insert_v2
  on public.patient_therapeutic_objectives;
drop policy if exists
  patient_therapeutic_objectives_tenant_update_v2
  on public.patient_therapeutic_objectives;
drop policy if exists
  patient_therapeutic_objectives_tenant_delete_v2
  on public.patient_therapeutic_objectives;

create policy patient_therapeutic_objectives_tenant_select_v2
on public.patient_therapeutic_objectives
for select
to authenticated
using (
  public.therapeutic_objective_actor_can_access_v1(
    id,
    patient_id,
    organization_id,
    clinic_id,
    created_by,
    'read'
  )
);

create policy patient_therapeutic_objectives_tenant_insert_v2
on public.patient_therapeutic_objectives
for insert
to authenticated
with check (
  public.therapeutic_objective_actor_can_access_v1(
    id,
    patient_id,
    organization_id,
    clinic_id,
    created_by,
    'write'
  )
);

create policy patient_therapeutic_objectives_tenant_update_v2
on public.patient_therapeutic_objectives
for update
to authenticated
using (
  public.therapeutic_objective_actor_can_access_v1(
    id,
    patient_id,
    organization_id,
    clinic_id,
    created_by,
    'write'
  )
)
with check (
  public.therapeutic_objective_actor_can_access_v1(
    id,
    patient_id,
    organization_id,
    clinic_id,
    created_by,
    'write'
  )
);

create policy patient_therapeutic_objectives_tenant_delete_v2
on public.patient_therapeutic_objectives
for delete
to authenticated
using (
  public.therapeutic_objective_actor_can_access_v1(
    id,
    patient_id,
    organization_id,
    clinic_id,
    created_by,
    'write'
  )
);

-- Program versions and audit events are immutable from the browser. Their
-- visibility follows the current program scope; service-role writes continue
-- to bypass RLS as before.
drop policy if exists aba_program_versions_read
  on public.aba_program_versions;
drop policy if exists aba_program_versions_tenant_select_v2
  on public.aba_program_versions;
create policy aba_program_versions_tenant_select_v2
on public.aba_program_versions
for select
to authenticated
using (
  public.therapeutic_program_actor_can_access_v1(
    program_id,
    organization_id,
    clinic_id,
    patient_id,
    'read'
  )
);

drop policy if exists aba_program_audit_events_read
  on public.aba_program_audit_events;
drop policy if exists aba_program_audit_events_tenant_select_v2
  on public.aba_program_audit_events;
create policy aba_program_audit_events_tenant_select_v2
on public.aba_program_audit_events
for select
to authenticated
using (
  public.therapeutic_program_actor_can_access_v1(
    program_id,
    organization_id,
    clinic_id,
    patient_id,
    'read'
  )
);

notify pgrst, 'reload schema';

commit;
