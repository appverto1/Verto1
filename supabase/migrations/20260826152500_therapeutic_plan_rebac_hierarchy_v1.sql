-- Therapeutic-plan hierarchy + ReBAC authorization.
-- PTS is shared with the active patient care team; specialty plans remain
-- restricted to their participants, explicitly related supervisors and
-- clinic coordinators/directors. Additive/idempotent; no clinical rows mutate.

begin;

do $migration_guard$
begin
  if to_regclass('public.patient_therapeutic_plans') is null
     or to_regclass('public.patient_therapeutic_plan_versions') is null
     or to_regclass('public.patient_professional_links') is null
     or to_regclass('public.clinical_supervision_links') is null
     or to_regclass('public.clinic_memberships') is null
     or to_regclass('public.patients') is null
     or to_regclass('public.aba_programs') is null then
    raise exception 'THERAPEUTIC_PLAN_REBAC_SCHEMA_PENDING'
      using detail = 'Apply therapeutic-plan, patient-link and supervision migrations first';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinic_memberships'
      and column_name = 'can_supervise'
  ) then
    raise exception 'THERAPEUTIC_PLAN_REBAC_SUPERVISION_PENDING'
      using detail = 'Apply 20260817030000_professional_supervision_capability_v1.sql first';
  end if;
end;
$migration_guard$;

-- Core relationship-aware authorization contract.
-- IMPORTANT: specialty alone never grants access.
create or replace function public.therapeutic_plan_current_actor_can_access_v2(
  p_patient_id uuid,
  p_organization_id text,
  p_clinic_id text,
  p_mode text,
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
          -- Clinic-scoped coordinators/directors preserve administrative
          -- authority. This remains patient/tenant scoped by the caller.
          public.clinic_membership_current_actor_can_manage_v1(patient.clinic_id)

          -- Direct care relationship.
          or exists (
            select 1
            from public.clinic_memberships membership
            join public.patient_professional_links case_link
              on case_link.patient_id = patient.id
             and case_link.organization_id = patient.clinic_id::text
             and case_link.clinic_id = patient.clinic_id::text
             and case_link.professional_id = membership.user_id::text
             and case_link.status = 'active'
            where membership.clinic_id = patient.clinic_id
              and membership.user_id = auth.uid()
              and membership.status = 'active'
              and membership.role in ('therapist', 'supervisor')
              and (
                -- PTS is the deliberate interdisciplinary sharing boundary:
                -- every active professional on the case may read it.
                (
                  lower(coalesce(p_mode, '')) = 'interdisciplinary'
                  and p_required_permission = 'read'
                  and coalesce((case_link.permissions->>'read')::boolean, true)
                )
                -- Writes to the PTS and every read/write to a specialty plan
                -- require explicit plan participation.
                or (
                  auth.uid()::text = any(
                    array[p_responsible_professional_id]
                    || coalesce(p_participant_professional_ids, '{}'::text[])
                  )
                  and case p_required_permission
                    when 'read' then coalesce((case_link.permissions->>'read')::boolean, true)
                    when 'write' then coalesce((case_link.permissions->>'write')::boolean, true)
                    else false
                  end
                )
              )
          )

          -- Supervision is relationship-scoped and read-only by default.
          -- A supervisor may read a specialty plan only when supervising the
          -- case or one of that plan's explicit participants.
          or (
            p_required_permission = 'read'
            and exists (
              select 1
              from public.clinic_memberships supervisor_membership
              join public.clinical_supervision_links supervision
                on supervision.clinic_id = patient.clinic_id
               and supervision.supervisor_user_id = supervisor_membership.user_id
               and supervision.status = 'active'
              where supervisor_membership.clinic_id = patient.clinic_id
                and supervisor_membership.user_id = auth.uid()
                and supervisor_membership.status = 'active'
                and (
                  supervisor_membership.role = 'supervisor'
                  or (
                    supervisor_membership.role = 'therapist'
                    and supervisor_membership.can_supervise = true
                  )
                )
                and (
                  supervision.patient_id = patient.id
                  or supervision.supervised_user_id::text = any(
                    array[p_responsible_professional_id]
                    || coalesce(p_participant_professional_ids, '{}'::text[])
                  )
                )
            )
          )
        )
    );
$function$;

revoke all on function public.therapeutic_plan_current_actor_can_access_v2(
  uuid, text, text, text, text, text[], text
) from public, anon;
grant execute on function public.therapeutic_plan_current_actor_can_access_v2(
  uuid, text, text, text, text, text[], text
) to authenticated, service_role;

-- Keep the historical-version helper name stable while upgrading its current
-- access branch to the new ReBAC contract. Historical-read compatibility for
-- professionals whose patient link ended remains intentionally preserved.
create or replace function public.therapeutic_plan_version_current_actor_can_read_v1(
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
        public.therapeutic_plan_current_actor_can_access_v2(
          plan.patient_id,
          plan.organization_id,
          plan.clinic_id,
          plan.mode,
          plan.responsible_professional_id,
          plan.participant_professional_ids,
          'read'
        )
        or (
          auth.uid()::text = any(coalesce(p_authorized_reader_ids, '{}'::text[]))
          and exists (
            select 1
            from public.clinic_memberships actor_membership
            join public.patient_professional_links link
              on link.patient_id = patient.id
             and link.professional_id = actor_membership.user_id::text
             and link.organization_id = patient.clinic_id::text
             and link.clinic_id = patient.clinic_id::text
            where actor_membership.clinic_id = patient.clinic_id
              and actor_membership.user_id = auth.uid()
              and actor_membership.status = 'active'
              and actor_membership.role in ('therapist', 'supervisor')
              and link.status = 'ended'
              and link.permissions->'historicalRead' = 'true'::jsonb
              and link.ends_at is not null
              and p_version_created_at <= link.updated_at
              and (
                p_version_created_at at time zone 'America/Sao_Paulo'
              )::date <= link.ends_at
          )
        )
      )
  );
$function$;

-- Compatibility helper for installations where the historical
-- therapeutic-plan membership migration was not applied in full. Keep the
-- contract idempotent and preserve the legacy unbound-program authorization
-- semantics; specialty alone still grants no access.
create or replace function public.therapeutic_patient_actor_has_link_permission_v1(
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
        and coalesce(nullif(p_organization_id, ''), p_clinic_id) = patient.clinic_id::text
        and case p_required_permission
          when 'read' then coalesce((link.permissions->>'read')::boolean, true)
          when 'write' then coalesce((link.permissions->>'write')::boolean, true)
          else false
        end
    );
$function$;

revoke all on function public.therapeutic_patient_actor_has_link_permission_v1(
  uuid, text, text, text
) from public, anon;
grant execute on function public.therapeutic_patient_actor_has_link_permission_v1(
  uuid, text, text, text
) to authenticated, service_role;

-- Programs inherit the exact visibility/write scope of their plan. Legacy
-- programs without a plan keep their prior author/responsible compatibility.
create or replace function public.therapeutic_program_row_actor_can_access_v1(
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
        and coalesce(nullif(p_organization_id, ''), p_clinic_id) = patient.clinic_id::text
        and (
          public.clinic_membership_current_actor_can_manage_v1(patient.clinic_id)
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
                and public.therapeutic_plan_current_actor_can_access_v2(
                  plan.patient_id,
                  plan.organization_id,
                  plan.clinic_id,
                  plan.mode,
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
              or auth.uid()::text = any(coalesce(p_responsible_professional_ids, '{}'::text[]))
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

-- Plan row policies now use mode-aware ReBAC directly in the database.
drop policy if exists patient_therapeutic_plans_tenant_select on public.patient_therapeutic_plans;
create policy patient_therapeutic_plans_tenant_select
on public.patient_therapeutic_plans
for select to authenticated
using (
  public.therapeutic_plan_current_actor_can_access_v2(
    patient_id,
    organization_id,
    clinic_id,
    mode,
    responsible_professional_id,
    participant_professional_ids,
    'read'
  )
);

drop policy if exists patient_therapeutic_plans_tenant_insert_v2 on public.patient_therapeutic_plans;
create policy patient_therapeutic_plans_tenant_insert_v2
on public.patient_therapeutic_plans
for insert to authenticated
with check (
  public.therapeutic_plan_current_actor_can_access_v2(
    patient_id,
    organization_id,
    clinic_id,
    mode,
    responsible_professional_id,
    participant_professional_ids,
    'write'
  )
);

drop policy if exists patient_therapeutic_plans_tenant_update_v2 on public.patient_therapeutic_plans;
create policy patient_therapeutic_plans_tenant_update_v2
on public.patient_therapeutic_plans
for update to authenticated
using (
  public.therapeutic_plan_current_actor_can_access_v2(
    patient_id,
    organization_id,
    clinic_id,
    mode,
    responsible_professional_id,
    participant_professional_ids,
    'write'
  )
)
with check (
  public.therapeutic_plan_current_actor_can_access_v2(
    patient_id,
    organization_id,
    clinic_id,
    mode,
    responsible_professional_id,
    participant_professional_ids,
    'write'
  )
);

-- PTS lineage tables follow the same shared-PTS read boundary.
do $pts_policy_guard$
begin
  if to_regclass('public.patient_pts_documents_v2') is not null then
    execute 'drop policy if exists patient_pts_documents_v2_select on public.patient_pts_documents_v2';
    execute $policy$
      create policy patient_pts_documents_v2_select
      on public.patient_pts_documents_v2 for select to authenticated
      using (
        exists (
          select 1 from public.patient_therapeutic_plans plan
          where plan.id = patient_pts_documents_v2.plan_id
            and public.therapeutic_plan_current_actor_can_access_v2(
              plan.patient_id, plan.organization_id, plan.clinic_id, plan.mode,
              plan.responsible_professional_id, plan.participant_professional_ids, 'read'
            )
        )
      )
    $policy$;
  end if;

  if to_regclass('public.patient_pts_versions_v2') is not null then
    execute 'drop policy if exists patient_pts_versions_v2_select on public.patient_pts_versions_v2';
    execute $policy$
      create policy patient_pts_versions_v2_select
      on public.patient_pts_versions_v2 for select to authenticated
      using (
        exists (
          select 1 from public.patient_therapeutic_plans plan
          where plan.id = patient_pts_versions_v2.plan_id
            and public.therapeutic_plan_current_actor_can_access_v2(
              plan.patient_id, plan.organization_id, plan.clinic_id, plan.mode,
              plan.responsible_professional_id, plan.participant_professional_ids, 'read'
            )
        )
      )
    $policy$;
  end if;

  if to_regclass('public.patient_pts_events_v2') is not null then
    execute 'drop policy if exists patient_pts_events_v2_select on public.patient_pts_events_v2';
    execute $policy$
      create policy patient_pts_events_v2_select
      on public.patient_pts_events_v2 for select to authenticated
      using (
        exists (
          select 1 from public.patient_therapeutic_plans plan
          where plan.id = patient_pts_events_v2.plan_id
            and public.therapeutic_plan_current_actor_can_access_v2(
              plan.patient_id, plan.organization_id, plan.clinic_id, plan.mode,
              plan.responsible_professional_id, plan.participant_professional_ids, 'read'
            )
        )
      )
    $policy$;
  end if;
end;
$pts_policy_guard$;

notify pgrst, 'reload schema';

commit;
