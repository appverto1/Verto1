-- Version professional specialty and availability by clinic membership.
--
-- Prerequisites:
--   20260730010000_clinic_memberships_non_recursive_policies.sql
--
-- This migration contains the complete, transactional definition of
-- accept_clinic_invitation_v1. It is safe whether or not the earlier
-- 20260731193000 definition was applied.
--
-- Existing global fields in professional_profiles remain untouched for
-- historical compatibility. New clinic-scoped flows must use the fields on
-- clinic_memberships as their authority.

begin;

do $prerequisites$
begin
  if to_regclass('public.clinic_memberships') is null
     or to_regclass('public.invitations') is null then
    raise exception 'CLINIC_MEMBERSHIP_SETTINGS_PREREQUISITE_MISSING'
      using detail = 'Apply the workspace membership schema first.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'clinic_memberships'
      and relation.relrowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_memberships'
      and policyname = 'clinic_memberships_select_v2'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_memberships'
      and policyname = 'clinic_memberships_insert_v2'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_memberships'
      and policyname = 'clinic_memberships_update_v2'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_memberships'
      and policyname = 'clinic_memberships_delete_v2'
  ) or exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_memberships'
      and policyname = 'clinic_memberships_access'
  ) then
    raise exception 'CLINIC_MEMBERSHIPS_NON_RECURSIVE_POLICIES_REQUIRED'
      using detail = 'Apply 20260730010000_clinic_memberships_non_recursive_policies.sql first.';
  end if;
end;
$prerequisites$;

alter table public.invitations
  add column if not exists required_onboarding_fields jsonb not null default '{}'::jsonb;

create or replace function public.prevent_duplicate_pending_clinic_invitation_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_email text := lower(trim(coalesce(new.email::text, '')));
begin
  if lower(trim(coalesce(new.status::text, ''))) <> 'pending'
     or new.clinic_id is null
     or v_email = '' then
    return new;
  end if;

  -- Serialize the logical clinic/e-mail key so two concurrent requests cannot
  -- both pass a SELECT-then-INSERT check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.clinic_id::text || ':' || v_email, 0)
  );

  if exists (
    select 1
      from public.invitations invitation
     where invitation.clinic_id = new.clinic_id
       and lower(trim(coalesce(invitation.email::text, ''))) = v_email
       and lower(trim(coalesce(invitation.status::text, ''))) = 'pending'
       and invitation.id is distinct from new.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'CLINIC_INVITATION_PENDING_ALREADY_EXISTS';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_duplicate_pending_clinic_invitation_v1()
  from public, anon, authenticated;
grant execute on function public.prevent_duplicate_pending_clinic_invitation_v1()
  to service_role;

drop trigger if exists invitations_single_pending_per_clinic_email_v1
  on public.invitations;
create trigger invitations_single_pending_per_clinic_email_v1
before insert or update of email, clinic_id, status
on public.invitations
for each row
execute function public.prevent_duplicate_pending_clinic_invitation_v1();

alter table public.clinic_memberships
  add column if not exists specialty text,
  add column if not exists work_schedule jsonb,
  add column if not exists availability_timezone text not null default 'America/Sao_Paulo',
  add column if not exists work_schedule_configured_at timestamptz,
  add column if not exists settings_updated_at timestamptz,
  add column if not exists settings_updated_by uuid;

alter table public.clinic_memberships
  alter column availability_timezone set default 'America/Sao_Paulo';

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.clinic_memberships'::regclass
      and conname = 'clinic_memberships_specialty_v1'
  ) then
    alter table public.clinic_memberships
      add constraint clinic_memberships_specialty_v1
      check (
        specialty is null
        or specialty in (
          'Psicoterapeuta',
          'Fonoaudiólogo',
          'Terapeuta Ocupacional',
          'Nutricionista',
          'Psicomotricista',
          'Psicopedagogo',
          'Arteterapeuta',
          'Musicoterapeuta',
          'Fisioterapeuta'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.clinic_memberships'::regclass
      and conname = 'clinic_memberships_work_schedule_v1'
  ) then
    alter table public.clinic_memberships
      add constraint clinic_memberships_work_schedule_v1
      check (
        work_schedule is null
        or jsonb_typeof(work_schedule) = 'object'
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.clinic_memberships'::regclass
      and conname = 'clinic_memberships_availability_timezone_v1'
  ) then
    alter table public.clinic_memberships
      add constraint clinic_memberships_availability_timezone_v1
      check (availability_timezone = 'America/Sao_Paulo');
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.clinic_memberships'::regclass
      and conname = 'clinic_memberships_settings_updated_by_fkey_v1'
  ) then
    alter table public.clinic_memberships
      add constraint clinic_memberships_settings_updated_by_fkey_v1
      foreign key (settings_updated_by)
      references public.users(id)
      on delete set null;
  end if;
end;
$constraints$;

comment on column public.clinic_memberships.specialty is
  'Clinical specialty exercised in this clinic. The global professional profile is not authoritative for this workspace.';
comment on column public.clinic_memberships.work_schedule is
  'Clinic-scoped working schedule. NULL means that this workspace has not configured a schedule.';
comment on column public.clinic_memberships.availability_timezone is
  'Civil timezone used to interpret this membership working schedule.';
comment on column public.clinic_memberships.work_schedule_configured_at is
  'First or latest explicit configuration time for the clinic-scoped working schedule.';

create or replace function public.accept_clinic_invitation_v1(
  p_invitation_id uuid,
  p_user_id uuid,
  p_verified_email text
)
returns table (
  invitation_id uuid,
  clinic_id uuid,
  membership_role text,
  invitation_status text,
  membership_status text,
  idempotent boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_invitation public.invitations%rowtype;
  v_email text := lower(trim(coalesce(p_verified_email, '')));
  v_status text;
  v_role text;
  v_raw_specialty text;
  v_specialty text;
  v_existing_membership public.clinic_memberships%rowtype;
  v_invited_by uuid;
begin
  if p_invitation_id is null or p_user_id is null or v_email = '' then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_INVALID';
  end if;

  select invitation.*
    into v_invitation
    from public.invitations invitation
   where invitation.id = p_invitation_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_NOT_FOUND';
  end if;

  if lower(trim(coalesce(v_invitation.email::text, ''))) <> v_email then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_EMAIL_MISMATCH';
  end if;

  v_status := lower(trim(coalesce(v_invitation.status::text, '')));
  v_role := lower(trim(coalesce(v_invitation.role::text, '')));

  if v_role not in ('coordinator', 'therapist', 'receptionist') then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ROLE_INVALID';
  end if;

  v_raw_specialty := coalesce(
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialty'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialtyName'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialty_name'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'professionalTitle'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'professional_title'), '')
  );

  v_specialty := case lower(coalesce(v_raw_specialty, ''))
    when lower('Psicoterapeuta') then 'Psicoterapeuta'
    when lower('Fonoaudiólogo') then 'Fonoaudiólogo'
    when lower('Terapeuta Ocupacional') then 'Terapeuta Ocupacional'
    when lower('Nutricionista') then 'Nutricionista'
    when lower('Psicomotricista') then 'Psicomotricista'
    when lower('Psicopedagogo') then 'Psicopedagogo'
    when lower('Arteterapeuta') then 'Arteterapeuta'
    when lower('Musicoterapeuta') then 'Musicoterapeuta'
    when lower('Fisioterapeuta') then 'Fisioterapeuta'
    else null
  end;

  select membership.*
    into v_existing_membership
    from public.clinic_memberships membership
   where membership.user_id = p_user_id
     and membership.clinic_id = v_invitation.clinic_id
   limit 1
   for update;

  if v_status = 'accepted' then
    if v_existing_membership.user_id is null
       or lower(trim(coalesce(v_existing_membership.status::text, ''))) <> 'active' then
      raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ALREADY_USED';
    end if;

    return query
      select v_invitation.id,
             v_invitation.clinic_id,
             v_existing_membership.role::text,
             v_status,
             v_existing_membership.status::text,
             true;
    return;
  end if;

  if v_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_NOT_AVAILABLE';
  end if;

  if v_role = 'therapist' and v_specialty is null then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_SPECIALTY_INVALID';
  end if;

  -- A pending invitation created before an explicit unlink cannot reactivate
  -- the old membership. A new invitation must be created after the unlink.
  if v_existing_membership.user_id is not null
     and lower(trim(coalesce(v_existing_membership.status::text, ''))) <> 'active'
     and coalesce(v_invitation.created_at, '-infinity'::timestamptz)
         <= coalesce(
              v_existing_membership.updated_at,
              v_existing_membership.created_at,
              'infinity'::timestamptz
            ) then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ALREADY_USED';
  end if;

  if coalesce(v_invitation.invited_by::text, '') ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_invited_by := v_invitation.invited_by::text::uuid;
  else
    v_invited_by := null;
  end if;

  insert into public.clinic_memberships as membership (
    user_id,
    clinic_id,
    role,
    status,
    invited_by,
    specialty,
    settings_updated_at,
    settings_updated_by,
    created_at,
    updated_at
  ) values (
    p_user_id,
    v_invitation.clinic_id,
    v_role,
    'active',
    v_invited_by,
    case when v_role = 'therapist' then v_specialty else null end,
    clock_timestamp(),
    v_invited_by,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (user_id, clinic_id)
  do update set
    role = excluded.role,
    status = 'active',
    invited_by = excluded.invited_by,
    specialty = case
      when excluded.role = 'therapist' then excluded.specialty
      else null
    end,
    settings_updated_at = clock_timestamp(),
    settings_updated_by = excluded.settings_updated_by,
    updated_at = clock_timestamp();

  update public.invitations invitation
     set status = 'accepted',
         accepted_at = coalesce(invitation.accepted_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where invitation.id = v_invitation.id
     and invitation.status = 'pending';

  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_CONCURRENT_UPDATE';
  end if;

  return query
    select v_invitation.id,
           v_invitation.clinic_id,
           v_role,
           'accepted'::text,
           'active'::text,
           false;
end;
$function$;

revoke all on function public.accept_clinic_invitation_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_clinic_invitation_v1(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;

-- Deliberately out of scope for this migration: global appointment locking
-- across clinics. That hardening needs its own migration and route coverage so
-- existing appointment, reschedule and team-professional writes stay atomic.
