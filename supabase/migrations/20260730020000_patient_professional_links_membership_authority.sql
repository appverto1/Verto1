-- Make clinic_memberships the canonical clinic authority for patient links.
-- Additive and idempotent; no existing patient or link row is modified.

begin;

do $migration_guard$
begin
  if to_regclass('public.clinic_memberships') is null
     or to_regclass('public.professional_profiles') is null
     or to_regprocedure(
       'public.clinic_membership_current_actor_is_global_v1()'
     ) is null then
    raise exception 'MULTIDISCIPLINARY_MEMBERSHIP_SCHEMA_PENDING'
      using detail =
        'Apply 20260730010000 and the workspace membership schema first';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clinic_memberships'
      and column_name in ('user_id', 'clinic_id', 'role', 'status')
  ) <> 4
  or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'professional_profiles'
      and column_name in ('user_id', 'specialty')
  ) <> 2 then
    raise exception 'MULTIDISCIPLINARY_MEMBERSHIP_SCHEMA_PENDING'
      using detail =
        'Clinic membership authority columns or professional specialty are missing';
  end if;
end;
$migration_guard$;

create index if not exists
  idx_patient_professional_links_active_patient_professional_v2
on public.patient_professional_links (patient_id, professional_id)
where status = 'active';

create or replace function
  public.patient_professional_link_current_actor_can_manage_v1(
    p_patient_id uuid
  )
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select
    public.clinic_membership_current_actor_is_global_v1()
    or exists (
      select 1
      from public.patients patient
      join public.clinic_memberships actor_membership
        on actor_membership.clinic_id = patient.clinic_id
       and actor_membership.user_id = auth.uid()
       and actor_membership.role = 'coordinator'
       and actor_membership.status = 'active'
      where patient.id = p_patient_id
    );
$function$;

create or replace function
  public.patient_professional_link_current_actor_can_read_v1(
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
    public.patient_professional_link_current_actor_can_manage_v1(
      p_patient_id
    )
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
            and coalesce(
              (p_permissions->>'historicalRead')::boolean,
              false
            )
          )
        )
    );
$function$;

revoke all on function
  public.patient_professional_link_current_actor_can_manage_v1(uuid)
  from public, anon;
revoke all on function
  public.patient_professional_link_current_actor_can_read_v1(
    uuid,
    text,
    text,
    jsonb,
    text,
    text
  )
  from public, anon;
grant execute on function
  public.patient_professional_link_current_actor_can_read_v1(
    uuid,
    text,
    text,
    jsonb,
    text,
    text
  )
  to authenticated;

drop policy if exists patient_professional_links_tenant_select
  on public.patient_professional_links;
create policy patient_professional_links_tenant_select
on public.patient_professional_links
for select
to authenticated
using (
  public.patient_professional_link_current_actor_can_read_v1(
    patient_id,
    professional_id,
    status,
    permissions,
    organization_id,
    clinic_id
  )
);

drop policy if exists patient_professional_links_tenant_write
  on public.patient_professional_links;
revoke insert, update, delete
  on table public.patient_professional_links
  from public, anon, authenticated;

-- END is defined first because UPSERT calls it when replacing a primary link.
create or replace function public.end_patient_professional_link_v1(
  p_actor_id uuid,
  p_link_id uuid,
  p_patient_id uuid,
  p_ends_at date default current_date
)
returns public.patient_professional_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor_role text;
  patient_clinic_id uuid;
  ended_row public.patient_professional_links%rowtype;
  link_integrity_valid boolean := false;
begin
  if auth.uid() is not null
     and auth.uid() is distinct from p_actor_id then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  select actor.role::text
  into actor_role
  from public.users actor
  where actor.id = p_actor_id
  for share;

  if not found then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  select patient.clinic_id
  into patient_clinic_id
  from public.patients patient
  where patient.id = p_patient_id;

  if not found or patient_clinic_id is null then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  if coalesce(lower(actor_role), '') not in ('admin', 'owner') then
    perform 1
    from public.clinic_memberships actor_membership
    where actor_membership.user_id = p_actor_id
      and actor_membership.clinic_id = patient_clinic_id
      and actor_membership.role = 'coordinator'
      and actor_membership.status = 'active'
    for share;
    if not found then
      raise exception 'PATIENT_NOT_FOUND';
    end if;
  end if;

  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = patient_clinic_id
  for update;
  if not found then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      patient_clinic_id::text || ':' || p_patient_id::text,
      0
    )
  );

  update public.patient_professional_links link
  set
    status = 'ended',
    ends_at = greatest(
      coalesce(p_ends_at, current_date),
      link.starts_at
    ),
    ended_by = p_actor_id::text,
    updated_at = now()
  where link.id = p_link_id
    and link.patient_id = p_patient_id
    and link.status = 'active'
  returning *
  into ended_row;

  if not found then
    raise exception 'PATIENT_PROFESSIONAL_LINK_NOT_FOUND';
  end if;

  link_integrity_valid :=
    ended_row.organization_id = patient_clinic_id::text
    and ended_row.clinic_id = patient_clinic_id::text;
  if link_integrity_valid then
    perform 1
    from public.users professional
    join public.clinic_memberships professional_membership
      on professional_membership.user_id = professional.id
     and professional_membership.clinic_id = patient_clinic_id
     and professional_membership.role = 'therapist'
     and professional_membership.status = 'active'
    join public.professional_profiles profile
      on profile.user_id = professional.id
     and char_length(nullif(trim(profile.specialty), '')) >= 2
    where professional.id::text = ended_row.professional_id
    for share;
    link_integrity_valid := found;
  end if;

  if ended_row.relationship_type = 'primary' then
    update public.patients
    set therapist_id = null
    where id = ended_row.patient_id
      and clinic_id = patient_clinic_id
      and therapist_id::text = ended_row.professional_id;
  end if;

  if link_integrity_valid
     and ended_row.permissions->'historicalRead' = 'true'::jsonb then
    insert into public.patient_therapeutic_plan_versions (
      plan_id,
      organization_id,
      patient_id,
      version,
      snapshot,
      authored_by,
      authorized_reader_ids
    )
    select
      plan.id,
      plan.organization_id,
      plan.patient_id,
      plan.edit_version,
      to_jsonb(plan) || jsonb_build_object(
        'historicalAccessEndedAt',
        now(),
        'historicalProfessionalId',
        ended_row.professional_id
      ),
      p_actor_id::text,
      array(
        select distinct readers.reader_id
        from unnest(
          array[
            plan.responsible_professional_id,
            ended_row.professional_id
          ]
          || coalesce(
            plan.participant_professional_ids,
            '{}'::text[]
          )
        ) as readers(reader_id)
        where nullif(readers.reader_id, '') is not null
      )
    from public.patient_therapeutic_plans plan
    where plan.organization_id = patient_clinic_id::text
      and plan.patient_id = ended_row.patient_id
      and (
        plan.responsible_professional_id =
          ended_row.professional_id
        or ended_row.professional_id =
          any(plan.participant_professional_ids)
      )
    on conflict (plan_id, version) do nothing;
  end if;

  return ended_row;
end;
$function$;

create or replace function public.upsert_patient_professional_link_v1(
  p_actor_id uuid,
  p_patient_id uuid,
  p_professional_id uuid,
  p_specialty text,
  p_case_role text,
  p_relationship_type text,
  p_starts_at date,
  p_permissions jsonb,
  p_replace_primary boolean default false
)
returns public.patient_professional_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  actor_role text;
  patient_clinic_id uuid;
  resolved_specialty text;
  resolved_permissions jsonb;
  active_link_count integer;
  created_row public.patient_professional_links%rowtype;
  primary_link record;
begin
  if auth.uid() is not null
     and auth.uid() is distinct from p_actor_id then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  select actor.role::text
  into actor_role
  from public.users actor
  where actor.id = p_actor_id
  for share;

  if not found then
    raise exception 'PATIENT_PROFESSIONAL_LINK_ACCESS_DENIED';
  end if;

  -- p_specialty remains in the signature for compatibility, but the profile
  -- is the only authority for the specialty snapshot.
  if nullif(trim(p_case_role), '') is null
     or trim(p_case_role) not in (
       'case_coordinator',
       'primary_therapist',
       'therapist',
       'supervisor',
       'consultant'
     )
     or p_relationship_type is null
     or p_relationship_type not in ('primary', 'collaborator')
     or jsonb_typeof(
       coalesce(p_permissions, '{}'::jsonb)
     ) <> 'object' then
    raise exception 'PATIENT_PROFESSIONAL_LINK_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(
      coalesce(p_permissions, '{}'::jsonb)
    ) as permission_key(key)
    where permission_key.key not in (
      'read',
      'write',
      'historicalRead'
    )
  )
  or (
    coalesce(p_permissions, '{}'::jsonb) ? 'read'
    and jsonb_typeof(p_permissions->'read') <> 'boolean'
  )
  or (
    coalesce(p_permissions, '{}'::jsonb) ? 'write'
    and jsonb_typeof(p_permissions->'write') <> 'boolean'
  )
  or (
    coalesce(p_permissions, '{}'::jsonb) ? 'historicalRead'
    and jsonb_typeof(
      p_permissions->'historicalRead'
    ) <> 'boolean'
  ) then
    raise exception 'PATIENT_PROFESSIONAL_LINK_INVALID';
  end if;

  resolved_permissions := jsonb_build_object(
    'read', coalesce((p_permissions->>'read')::boolean, true),
    'write', coalesce((p_permissions->>'write')::boolean, true),
    'historicalRead', coalesce(
      (p_permissions->>'historicalRead')::boolean,
      true
    )
  );

  select patient.clinic_id
  into patient_clinic_id
  from public.patients patient
  where patient.id = p_patient_id;

  if not found or patient_clinic_id is null then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  if coalesce(lower(actor_role), '') not in ('admin', 'owner') then
    perform 1
    from public.clinic_memberships actor_membership
    where actor_membership.user_id = p_actor_id
      and actor_membership.clinic_id = patient_clinic_id
      and actor_membership.role = 'coordinator'
      and actor_membership.status = 'active'
    for share;
    if not found then
      raise exception 'PATIENT_NOT_FOUND';
    end if;
  end if;

  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = patient_clinic_id
  for update;
  if not found then
    raise exception 'PATIENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      patient_clinic_id::text || ':' || p_patient_id::text,
      0
    )
  );

  perform 1
  from public.users professional
  where professional.id = p_professional_id
  for share;
  if not found then
    raise exception 'PATIENT_PROFESSIONAL_NOT_FOUND';
  end if;

  perform 1
  from public.clinic_memberships professional_membership
  where professional_membership.user_id = p_professional_id
    and professional_membership.clinic_id = patient_clinic_id
    and professional_membership.role = 'therapist'
    and professional_membership.status = 'active'
  for share;
  if not found then
    raise exception 'PATIENT_PROFESSIONAL_MEMBERSHIP_INACTIVE';
  end if;

  select nullif(trim(profile.specialty), '')
  into resolved_specialty
  from public.professional_profiles profile
  where profile.user_id = p_professional_id
  for share;
  if not found then
    raise exception 'PATIENT_PROFESSIONAL_PROFILE_REQUIRED';
  end if;
  if resolved_specialty is null
     or char_length(resolved_specialty) < 2 then
    raise exception 'PATIENT_PROFESSIONAL_SPECIALTY_REQUIRED';
  end if;

  if exists (
    select 1
    from public.patient_professional_links link
    where link.patient_id = p_patient_id
      and link.professional_id = p_professional_id::text
      and link.status = 'active'
  ) then
    raise exception 'PATIENT_PROFESSIONAL_LINK_DUPLICATE';
  end if;

  if p_relationship_type = 'primary'
     and p_replace_primary is true then
    for primary_link in
      select link.id
      from public.patient_professional_links link
      where link.patient_id = p_patient_id
        and link.relationship_type = 'primary'
        and link.status = 'active'
      order by link.id
      for update
    loop
      perform public.end_patient_professional_link_v1(
        p_actor_id,
        primary_link.id,
        p_patient_id,
        coalesce(p_starts_at, current_date)
      );
    end loop;
  elsif p_relationship_type = 'primary'
     and exists (
       select 1
       from public.patient_professional_links link
       where link.patient_id = p_patient_id
         and link.relationship_type = 'primary'
         and link.status = 'active'
     ) then
    raise exception 'PATIENT_PROFESSIONAL_LINK_PRIMARY_EXISTS';
  end if;

  select count(*)
  into active_link_count
  from public.patient_professional_links link
  where link.patient_id = p_patient_id
    and link.status = 'active';
  if active_link_count >= 5 then
    raise exception 'PATIENT_PROFESSIONAL_LINK_LIMIT_REACHED';
  end if;

  insert into public.patient_professional_links (
    organization_id,
    clinic_id,
    patient_id,
    professional_id,
    specialty,
    case_role,
    relationship_type,
    starts_at,
    permissions,
    created_by
  )
  values (
    patient_clinic_id::text,
    patient_clinic_id::text,
    p_patient_id,
    p_professional_id::text,
    left(resolved_specialty, 120),
    left(trim(p_case_role), 160),
    p_relationship_type,
    coalesce(p_starts_at, current_date),
    resolved_permissions,
    p_actor_id::text
  )
  returning *
  into created_row;

  if p_relationship_type = 'primary' then
    update public.patients
    set therapist_id = p_professional_id
    where id = p_patient_id
      and clinic_id = patient_clinic_id;
  end if;

  return created_row;
end;
$function$;

revoke all on function public.upsert_patient_professional_link_v1(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  jsonb,
  boolean
) from public, anon;

revoke all on function public.end_patient_professional_link_v1(
  uuid,
  uuid,
  uuid,
  date
) from public, anon;

grant execute on function public.upsert_patient_professional_link_v1(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  jsonb,
  boolean
) to authenticated, service_role;

grant execute on function public.end_patient_professional_link_v1(
  uuid,
  uuid,
  uuid,
  date
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
