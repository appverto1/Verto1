-- Verto platform-admin authority v1
-- Separates Verto platform administration from clinic authority and removes
-- legacy owner/admin as an implicit clinic or clinical-data bypass.
-- No user is promoted automatically: platform admins must be explicitly present
-- in public.platform_admins with active = true.

begin;

do $platform_admins_foundation$
begin
  if to_regclass('public.platform_admins') is null then
    create table public.platform_admins (
      user_id uuid primary key references public.users(id) on delete cascade,
      active boolean not null default true,
      granted_by uuid references public.users(id) on delete set null,
      reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  else
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = 'public.platform_admins'::regclass
        and attribute.attname = 'user_id'
        and not attribute.attisdropped
    ) then
      raise exception 'PLATFORM_ADMINS_USER_ID_REQUIRED';
    end if;

    alter table public.platform_admins
      add column if not exists active boolean not null default true,
      add column if not exists granted_by uuid references public.users(id) on delete set null,
      add column if not exists reason text,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now();
  end if;
end;
$platform_admins_foundation$;

create index if not exists idx_platform_admins_active_user
  on public.platform_admins(user_id)
  where active is true;

alter table public.platform_admins enable row level security;

-- Direct client access stays closed. The backend validates this table using the
-- service-role connection and never trusts users.role = owner/admin as proof.
revoke all on table public.platform_admins from anon, authenticated;

comment on table public.platform_admins is
  'Explicit Verto platform administrators. Clinic roles and memberships never imply platform administration.';
comment on column public.platform_admins.active is
  'Only rows with active=true grant platform administration.';

do $authorization_foundation_guard$
begin
  if to_regclass('public.clinic_memberships') is null
     or to_regclass('public.patients') is null
     or to_regclass('public.professional_profiles') is null
     or to_regclass('public.clinical_supervision_links') is null then
    raise exception 'AUTHORIZATION_FOUNDATION_REQUIRED'
      using detail = 'Apply the authorization capabilities foundation before platform-admin authority v1';
  end if;
end;
$authorization_foundation_guard$;

-- Preserve legacy clinic ownership as one explicit clinic membership only.
-- This is a reduction of authority: owner/admin no longer implies every clinic,
-- and this backfill never creates a platform_admin row.
do $legacy_clinic_membership_backfill$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'clinic_id'
  ) then
    execute $sql$
      insert into public.clinic_memberships (
        user_id,
        clinic_id,
        role,
        status,
        created_at,
        updated_at
      )
      select
        legacy_user.id,
        clinic.id,
        'director',
        'active',
        now(),
        now()
      from public.users legacy_user
      join public.clinics clinic
        on clinic.id::text = legacy_user.clinic_id::text
      where lower(coalesce(legacy_user.role, '')) in ('owner', 'admin')
        and legacy_user.clinic_id is not null
      on conflict (user_id, clinic_id) do nothing
    $sql$;
  end if;
end;
$legacy_clinic_membership_backfill$;

-- ---------------------------------------------------------------------------
-- Clinic membership authority: active Director/Coordinator only.
-- Keep the historical function name because existing policies/functions depend
-- on it, but remove its legacy owner/admin meaning.
-- ---------------------------------------------------------------------------
create or replace function public.clinic_membership_current_actor_is_global_v1()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select false;
$$;

create or replace function public.clinic_membership_current_actor_can_manage_v1(
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.clinic_memberships manager_membership
    where manager_membership.clinic_id = p_clinic_id
      and manager_membership.user_id = auth.uid()
      and manager_membership.status = 'active'
      and manager_membership.role in ('director', 'coordinator')
  );
$$;

revoke all on function public.clinic_membership_current_actor_is_global_v1()
  from public, anon;
revoke all on function public.clinic_membership_current_actor_can_manage_v1(uuid)
  from public, anon;
grant execute on function public.clinic_membership_current_actor_can_manage_v1(uuid)
  to authenticated;

-- Replace only the legacy clinics_access policy when it exists. Basic clinic
-- metadata is readable to an active member; clinic mutation requires manager
-- membership in the exact clinic.
do $clinics_policy$
begin
  if to_regclass('public.clinics') is not null then
    execute 'alter table public.clinics enable row level security';
    execute 'drop policy if exists clinics_access on public.clinics';
    execute $policy$
      create policy clinics_access
      on public.clinics
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.clinic_memberships membership
          where membership.clinic_id = clinics.id
            and membership.user_id = auth.uid()
            and membership.status = 'active'
        )
      )
    $policy$;
  end if;
end;
$clinics_policy$;

-- If a previous run created this policy, recreate idempotently.
do $clinics_update_policy_cleanup$
begin
  if to_regclass('public.clinics') is not null then
    execute 'drop policy if exists clinics_manager_update_v2 on public.clinics';
    execute $policy$
      create policy clinics_manager_update_v2
      on public.clinics
      for update
      to authenticated
      using (
        public.clinic_membership_current_actor_can_manage_v1(id)
      )
      with check (
        public.clinic_membership_current_actor_can_manage_v1(id)
      )
    $policy$;
  end if;
end;
$clinics_update_policy_cleanup$;

-- ---------------------------------------------------------------------------
-- Patient-professional link RLS follows the same authority model and recognizes
-- explicit clinical supervision scope. Platform admin is not a clinical bypass.
-- ---------------------------------------------------------------------------
create or replace function public.patient_professional_link_current_actor_can_manage_v1(
  p_patient_id uuid
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
    join public.clinic_memberships actor_membership
      on actor_membership.clinic_id = patient.clinic_id
     and actor_membership.user_id = auth.uid()
     and actor_membership.role in ('director', 'coordinator')
     and actor_membership.status = 'active'
    where patient.id = p_patient_id
  );
$function$;

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
       and supervisor_membership.role = 'supervisor'
       and supervisor_membership.status = 'active'
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

revoke all on function public.patient_professional_link_current_actor_can_manage_v1(uuid)
  from public, anon;
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
