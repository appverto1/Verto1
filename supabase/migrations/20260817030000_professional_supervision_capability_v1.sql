-- Verto professional supervision capability v1
-- Supervisor is a contextual capability of a professional, not a new base role.
-- This migration is additive and preserves legacy supervisor memberships.

begin;

alter table public.clinic_memberships
  add column if not exists can_supervise boolean not null default false;

alter table public.clinical_supervision_links
  add column if not exists source_patient_professional_link_id uuid
    references public.patient_professional_links(id) on delete set null;

create unique index if not exists uq_clinical_supervision_source_patient_link
  on public.clinical_supervision_links(source_patient_professional_link_id)
  where source_patient_professional_link_id is not null;

-- Preserve every existing supervisor: no membership is deleted or downgraded.
-- Legacy rows become supervision-eligible immediately and can be migrated to
-- therapist gradually by the application once their specialty is confirmed.
update public.clinic_memberships
set can_supervise = true,
    settings_updated_at = coalesce(settings_updated_at, clock_timestamp()),
    updated_at = clock_timestamp()
where role = 'supervisor'
  and can_supervise is distinct from true;

comment on column public.clinic_memberships.can_supervise is
  'Whether an active therapist may receive explicit supervision assignments. Legacy supervisor memberships are treated as eligible for compatibility.';

create or replace function public.set_clinic_member_supervision_eligibility_v1(
  p_clinic_id uuid,
  p_member_id uuid,
  p_actor_id uuid,
  p_can_supervise boolean
)
returns table (
  member_id uuid,
  membership_role text,
  can_supervise boolean,
  ended_supervision_assignments integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  actor_membership public.clinic_memberships%rowtype;
  target_membership public.clinic_memberships%rowtype;
  ended_count integer := 0;
begin
  if p_clinic_id is null
     or p_member_id is null
     or p_actor_id is null
     or p_can_supervise is null then
    raise exception using errcode = '22023', message = 'SUPERVISION_ELIGIBILITY_INVALID';
  end if;

  if auth.uid() is not null and auth.uid() is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'SUPERVISION_ELIGIBILITY_ACTOR_MISMATCH';
  end if;

  select membership.*
    into actor_membership
  from public.clinic_memberships membership
  where membership.clinic_id = p_clinic_id
    and membership.user_id = p_actor_id
    and membership.status = 'active'
  for update;

  if not found or actor_membership.role not in ('director', 'coordinator') then
    raise exception using errcode = '42501', message = 'SUPERVISION_ELIGIBILITY_ACCESS_DENIED';
  end if;

  select membership.*
    into target_membership
  from public.clinic_memberships membership
  where membership.clinic_id = p_clinic_id
    and membership.user_id = p_member_id
    and membership.status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SUPERVISION_ELIGIBILITY_MEMBER_NOT_FOUND';
  end if;

  if target_membership.role not in ('therapist', 'supervisor') then
    raise exception using errcode = '22023', message = 'SUPERVISION_ELIGIBILITY_PROFESSIONAL_REQUIRED';
  end if;

  if p_can_supervise
     and target_membership.role = 'therapist'
     and nullif(trim(target_membership.specialty), '') is null then
    raise exception using errcode = '22023', message = 'SUPERVISION_ELIGIBILITY_SPECIALTY_REQUIRED';
  end if;

  update public.clinic_memberships membership
     set can_supervise = p_can_supervise,
         settings_updated_at = clock_timestamp(),
         settings_updated_by = p_actor_id,
         updated_at = clock_timestamp()
   where membership.id = target_membership.id;

  if p_can_supervise is false then
    -- The person remains on each case as a normal professional. Only the
    -- contextual supervision function is removed.
    update public.patient_professional_links link
       set case_role = case
        when relationship_type = 'primary' then 'primary_therapist'
        else 'therapist'
      end,
           updated_at = clock_timestamp()
     where link.organization_id = p_clinic_id::text
       and link.professional_id = p_member_id::text
       and link.status = 'active'
       and link.case_role = 'supervisor';

    update public.clinical_supervision_links supervision
       set status = 'ended',
           ended_at = coalesce(supervision.ended_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where supervision.clinic_id = p_clinic_id
       and supervision.supervisor_user_id = p_member_id
       and supervision.status = 'active';
    get diagnostics ended_count = row_count;
  end if;

  insert into public.authorization_audit_events (
    actor_user_id,
    target_user_id,
    clinic_id,
    event_type,
    permission_key,
    previous_value,
    new_value,
    reason
  ) values (
    p_actor_id,
    p_member_id,
    p_clinic_id,
    'professional_supervision_eligibility_updated',
    'team.supervision.eligible',
    jsonb_build_object(
      'canSupervise', coalesce(target_membership.can_supervise, target_membership.role = 'supervisor')
    ),
    jsonb_build_object(
      'canSupervise', p_can_supervise,
      'endedAssignments', ended_count
    ),
    'Supervision eligibility changed through clinic management.'
  );

  return query
    select target_membership.user_id,
           target_membership.role,
           p_can_supervise,
           ended_count;
end;
$function$;

revoke all on function public.set_clinic_member_supervision_eligibility_v1(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_clinic_member_supervision_eligibility_v1(uuid, uuid, uuid, boolean)
  to service_role;

-- Defense in depth: every active supervision link must point to an eligible
-- professional in the exact same clinic. This blocks cross-tenant IDs even if
-- a future API route forgets the corresponding application check.
create or replace function public.enforce_clinical_supervision_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if new.status <> 'active' then
    return new;
  end if;

  if new.supervised_user_id is not null
     and new.supervised_user_id = new.supervisor_user_id then
    raise exception using errcode = '22023', message = 'SUPERVISION_SELF_ASSIGNMENT_DENIED';
  end if;

  perform 1
  from public.clinic_memberships membership
  where membership.clinic_id = new.clinic_id
    and membership.user_id = new.supervisor_user_id
    and membership.status = 'active'
    and (
      membership.role = 'supervisor'
      or (membership.role = 'therapist' and membership.can_supervise = true)
    );
  if not found then
    raise exception using errcode = '42501', message = 'SUPERVISION_PROFESSIONAL_NOT_ELIGIBLE';
  end if;

  if new.supervised_user_id is not null then
    perform 1
    from public.clinic_memberships supervised_membership
    where supervised_membership.clinic_id = new.clinic_id
      and supervised_membership.user_id = new.supervised_user_id
      and supervised_membership.status = 'active'
      and supervised_membership.role in ('therapist', 'supervisor');
    if not found then
      raise exception using errcode = '42501', message = 'SUPERVISION_CROSS_CLINIC_PROFESSIONAL_DENIED';
    end if;
  end if;

  if new.patient_id is not null then
    perform 1
    from public.patients patient
    where patient.id = new.patient_id
      and patient.clinic_id = new.clinic_id;
    if not found then
      raise exception using errcode = '42501', message = 'SUPERVISION_CROSS_CLINIC_PATIENT_DENIED';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_clinical_supervision_scope_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_clinical_supervision_scope_v1()
  to service_role;

drop trigger if exists clinical_supervision_scope_v1 on public.clinical_supervision_links;
create trigger clinical_supervision_scope_v1
before insert or update of clinic_id, supervisor_user_id, supervised_user_id, patient_id, status
on public.clinical_supervision_links
for each row
execute function public.enforce_clinical_supervision_scope_v1();

-- A case-level "supervisor" label is only valid when the linked professional
-- is supervision-eligible in the patient's clinic.
create or replace function public.enforce_patient_case_supervisor_eligibility_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  patient_clinic_id uuid;
  professional_uuid uuid;
begin
  if new.status <> 'active' or new.case_role <> 'supervisor' then
    return new;
  end if;

  if coalesce(new.professional_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'PATIENT_SUPERVISOR_PROFESSIONAL_INVALID';
  end if;
  professional_uuid := new.professional_id::uuid;

  select patient.clinic_id
    into patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;

  if patient_clinic_id is null
     or new.organization_id <> patient_clinic_id::text
     or new.clinic_id <> patient_clinic_id::text then
    raise exception using errcode = '42501', message = 'PATIENT_SUPERVISOR_CROSS_CLINIC_DENIED';
  end if;

  perform 1
  from public.clinic_memberships membership
  where membership.clinic_id = patient_clinic_id
    and membership.user_id = professional_uuid
    and membership.status = 'active'
    and (
      membership.role = 'supervisor'
      or (membership.role = 'therapist' and membership.can_supervise = true)
    );
  if not found then
    raise exception using errcode = '42501', message = 'PATIENT_SUPERVISION_NOT_ELIGIBLE';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_patient_case_supervisor_eligibility_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_patient_case_supervisor_eligibility_v1()
  to service_role;

drop trigger if exists patient_case_supervisor_eligibility_v1 on public.patient_professional_links;
create trigger patient_case_supervisor_eligibility_v1
before insert or update of case_role, status, professional_id, patient_id, organization_id, clinic_id
on public.patient_professional_links
for each row
execute function public.enforce_patient_case_supervisor_eligibility_v1();

-- Keep the direct patient supervision scope synchronized with the canonical
-- case-team relation. No duplicate write path is exposed to the frontend.
create or replace function public.sync_patient_case_supervision_link_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  professional_uuid uuid;
  patient_clinic_id uuid;
begin
  if coalesce(new.professional_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;
  professional_uuid := new.professional_id::uuid;

  select patient.clinic_id
    into patient_clinic_id
  from public.patients patient
  where patient.id = new.patient_id;
  if patient_clinic_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('patient-case-supervision:' || new.id::text, 0)
  );

  if new.status = 'active' and new.case_role = 'supervisor' then
    update public.clinical_supervision_links supervision
       set clinic_id = patient_clinic_id,
           supervisor_user_id = professional_uuid,
           patient_id = new.patient_id,
           supervised_user_id = null,
           status = 'active',
           ended_at = null,
           updated_at = clock_timestamp()
     where supervision.source_patient_professional_link_id = new.id;

    if not found then
      insert into public.clinical_supervision_links (
        clinic_id,
        supervisor_user_id,
        patient_id,
        status,
        starts_at,
        created_by,
        source_patient_professional_link_id,
        created_at,
        updated_at
      ) values (
        patient_clinic_id,
        professional_uuid,
        new.patient_id,
        'active',
        clock_timestamp(),
        case
          when coalesce(new.created_by, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then new.created_by::uuid
          else null
        end,
        new.id,
        clock_timestamp(),
        clock_timestamp()
      );
    end if;
  else
    update public.clinical_supervision_links supervision
       set status = 'ended',
           ended_at = coalesce(supervision.ended_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where supervision.source_patient_professional_link_id = new.id
       and supervision.status = 'active';
  end if;

  return new;
end;
$function$;

revoke all on function public.sync_patient_case_supervision_link_v1()
  from public, anon, authenticated;
grant execute on function public.sync_patient_case_supervision_link_v1()
  to service_role;

drop trigger if exists patient_case_supervision_link_sync_v1 on public.patient_professional_links;
create trigger patient_case_supervision_link_sync_v1
after insert or update of case_role, status, professional_id, patient_id, organization_id, clinic_id
on public.patient_professional_links
for each row
execute function public.sync_patient_case_supervision_link_v1();

-- RLS helper: supervision access now accepts therapist + can_supervise while
-- keeping the legacy supervisor branch during the transition.
create or replace function public.patient_professional_link_current_actor_can_read_v1(
  p_patient_id uuid,
  p_professional_id text,
  p_status text,
  p_permissions jsonb,
  p_organization_id text,
  p_clinic_id text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select
    public.patient_professional_link_current_actor_can_manage_v1(p_patient_id)
    or exists (
      select 1
      from public.patients patient
      join public.clinic_memberships professional_membership
        on professional_membership.clinic_id = patient.clinic_id
       and professional_membership.user_id = auth.uid()
       and professional_membership.role = 'therapist'
       and professional_membership.status = 'active'
      join public.professional_profiles profile
        on profile.user_id = professional_membership.user_id
       and char_length(nullif(trim(profile.specialty), '')) >= 2
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_organization_id
        and patient.clinic_id::text = p_clinic_id
        and p_professional_id = auth.uid()::text
        and (
          (
            p_status = 'active'
            and coalesce((p_permissions->>'read')::boolean, true)
          )
          or (
            p_status = 'ended'
            and coalesce((p_permissions->>'historicalRead')::boolean, false)
          )
        )
    )
    or exists (
      select 1
      from public.patients patient
      join public.clinic_memberships supervisor_membership
        on supervisor_membership.clinic_id = patient.clinic_id
       and supervisor_membership.user_id = auth.uid()
       and supervisor_membership.status = 'active'
       and (
         supervisor_membership.role = 'supervisor'
         or (
           supervisor_membership.role = 'therapist'
           and supervisor_membership.can_supervise = true
         )
       )
      join public.clinical_supervision_links supervision
        on supervision.clinic_id = patient.clinic_id
       and supervision.supervisor_user_id = auth.uid()
       and supervision.status = 'active'
      where patient.id = p_patient_id
        and patient.clinic_id::text = p_organization_id
        and patient.clinic_id::text = p_clinic_id
        and (
          supervision.patient_id = patient.id
          or exists (
            select 1
            from public.patient_professional_links case_link
            where case_link.patient_id = patient.id
              and case_link.organization_id = patient.clinic_id::text
              and case_link.status = 'active'
              and case_link.professional_id = supervision.supervised_user_id::text
          )
        )
    );
$function$;

revoke all on function public.patient_professional_link_current_actor_can_read_v1(
  uuid,
  text,
  text,
  jsonb,
  text,
  text
) from public, anon;
grant execute on function public.patient_professional_link_current_actor_can_read_v1(
  uuid,
  text,
  text,
  jsonb,
  text,
  text
) to authenticated;

notify pgrst, 'reload schema';

commit;
