-- Transactional database test for
-- 20260802010000_clinic_membership_professional_settings.sql.
-- Run only against a local/test database with migrations already applied.
-- Required first: 20260730010000 (non-recursive membership policies).
-- The tested migration itself creates/replaces the atomic acceptance RPC.

begin;

create temp table verto_20260802010000_context (
  user_id uuid not null,
  clinic_a_id uuid not null,
  clinic_b_id uuid not null,
  insert_invitation_id uuid not null,
  conflict_invitation_id uuid not null,
  invalid_invitation_id uuid not null,
  non_therapist_invitation_id uuid not null,
  insert_email text not null,
  conflict_email text not null,
  invalid_email text not null,
  non_therapist_email text not null
) on commit drop;

do $schema_assertions$
declare
  v_column text;
  v_constraint text;
  v_policy text;
begin
  foreach v_column in array array[
    'specialty',
    'work_schedule',
    'availability_timezone',
    'work_schedule_configured_at',
    'settings_updated_at',
    'settings_updated_by'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'clinic_memberships'
        and column_name = v_column
    ) then
      raise exception 'TEST_COLUMN_MISSING: clinic_memberships.%', v_column;
    end if;
  end loop;

  foreach v_constraint in array array[
    'clinic_memberships_specialty_v1',
    'clinic_memberships_work_schedule_v1',
    'clinic_memberships_availability_timezone_v1',
    'clinic_memberships_settings_updated_by_fkey_v1'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.clinic_memberships'::regclass
        and conname = v_constraint
    ) then
      raise exception 'TEST_CONSTRAINT_MISSING: %', v_constraint;
    end if;
  end loop;

  if has_function_privilege(
    'anon',
    'public.accept_clinic_invitation_v1(uuid,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.accept_clinic_invitation_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'TEST_INVITATION_RPC_EXPOSED_TO_BROWSER';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.accept_clinic_invitation_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'TEST_INVITATION_RPC_SERVICE_ROLE_GRANT_MISSING';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger
     where trigger.tgrelid = 'public.invitations'::regclass
       and trigger.tgname = 'invitations_single_pending_per_clinic_email_v1'
       and not trigger.tgisinternal
  ) then
    raise exception 'TEST_PENDING_INVITATION_GUARD_TRIGGER_MISSING';
  end if;

  if has_function_privilege(
    'anon',
    'public.prevent_duplicate_pending_clinic_invitation_v1()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.prevent_duplicate_pending_clinic_invitation_v1()',
    'EXECUTE'
  ) then
    raise exception 'TEST_PENDING_INVITATION_GUARD_EXPOSED';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.prevent_duplicate_pending_clinic_invitation_v1()',
    'EXECUTE'
  ) then
    raise exception 'TEST_PENDING_INVITATION_GUARD_SERVICE_ROLE_GRANT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'clinic_memberships'
      and relation.relrowsecurity
  ) then
    raise exception 'TEST_MEMBERSHIP_RLS_NOT_ENABLED';
  end if;

  foreach v_policy in array array[
    'clinic_memberships_select_v2',
    'clinic_memberships_insert_v2',
    'clinic_memberships_update_v2',
    'clinic_memberships_delete_v2'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = 'clinic_memberships'
        and policyname = v_policy
    ) then
      raise exception 'TEST_MEMBERSHIP_POLICY_NOT_PRESERVED: %', v_policy;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'clinic_memberships'
      and policyname = 'clinic_memberships_access'
  ) then
    raise exception 'TEST_RECURSIVE_MEMBERSHIP_POLICY_REINTRODUCED';
  end if;
end;
$schema_assertions$;

do $fixture$
declare
  v_user_id uuid;
  v_clinic_ids uuid[];
begin
  select app_user.id
    into v_user_id
    from public.users app_user
   order by app_user.id
   limit 1;

  select array_agg(candidate.id order by candidate.id)
    into v_clinic_ids
    from (
      select clinic.id
      from public.clinics clinic
      order by clinic.id
      limit 2
    ) candidate;

  if v_user_id is null or coalesce(array_length(v_clinic_ids, 1), 0) < 2 then
    raise exception 'TEST_FIXTURE_REQUIRED: create at least one user and two clinics';
  end if;

  insert into verto_20260802010000_context (
    user_id,
    clinic_a_id,
    clinic_b_id,
    insert_invitation_id,
    conflict_invitation_id,
    invalid_invitation_id,
    non_therapist_invitation_id,
    insert_email,
    conflict_email,
    invalid_email,
    non_therapist_email
  ) values (
    v_user_id,
    v_clinic_ids[1],
    v_clinic_ids[2],
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    gen_random_uuid(),
    'membership-settings-insert-' || gen_random_uuid()::text || '@example.invalid',
    'membership-settings-conflict-' || gen_random_uuid()::text || '@example.invalid',
    'membership-settings-invalid-' || gen_random_uuid()::text || '@example.invalid',
    'membership-settings-non-therapist-' || gen_random_uuid()::text || '@example.invalid'
  );
end;
$fixture$;

-- The first clinic must exercise the real INSERT branch of the acceptance RPC.
-- The test is transactional, so a pre-existing fixture membership is restored
-- by the final ROLLBACK.
delete from public.clinic_memberships membership
using verto_20260802010000_context context
where membership.user_id = context.user_id
  and membership.clinic_id = context.clinic_a_id;

insert into public.clinic_memberships (
  user_id,
  clinic_id,
  role,
  status,
  specialty,
  work_schedule,
  availability_timezone,
  work_schedule_configured_at,
  settings_updated_at,
  settings_updated_by,
  created_at,
  updated_at
)
select
  context.user_id,
  workspace.clinic_id,
  'therapist',
  'active',
  workspace.specialty,
  workspace.work_schedule,
  'America/Sao_Paulo',
  clock_timestamp(),
  clock_timestamp(),
  context.user_id,
  clock_timestamp(),
  clock_timestamp()
from verto_20260802010000_context context
cross join lateral (
  values
    (
      context.clinic_b_id,
      'Terapeuta Ocupacional'::text,
      '{"days":{"tuesday":{"enabled":true,"periods":[{"start":"13:00","end":"17:00"}]}}}'::jsonb
    )
) workspace(clinic_id, specialty, work_schedule)
on conflict (user_id, clinic_id)
do update set
  role = excluded.role,
  status = excluded.status,
  specialty = excluded.specialty,
  work_schedule = excluded.work_schedule,
  availability_timezone = excluded.availability_timezone,
  work_schedule_configured_at = excluded.work_schedule_configured_at,
  settings_updated_at = excluded.settings_updated_at,
  settings_updated_by = excluded.settings_updated_by,
  updated_at = excluded.updated_at;

insert into public.invitations (
  id,
  email,
  clinic_id,
  clinic_name,
  role,
  required_onboarding_fields,
  status,
  created_at,
  updated_at
)
select
  context.insert_invitation_id,
  context.insert_email,
  context.clinic_a_id,
  clinic.name,
  'therapist',
  jsonb_build_object(
    'specialty', 'Fonoaudiólogo',
    'professionalTitle', 'Fonoaudiólogo'
  ),
  'pending',
  clock_timestamp(),
  clock_timestamp()
from verto_20260802010000_context context
join public.clinics clinic on clinic.id = context.clinic_a_id;

do $insert_acceptance$
declare
  v_first record;
  v_context verto_20260802010000_context%rowtype;
  v_membership public.clinic_memberships%rowtype;
begin
  select * into strict v_context from verto_20260802010000_context;

  if exists (
    select 1
    from public.clinic_memberships membership
    where membership.user_id = v_context.user_id
      and membership.clinic_id = v_context.clinic_a_id
  ) then
    raise exception 'TEST_INSERT_PRECONDITION_MEMBERSHIP_EXISTS';
  end if;

  select * into strict v_first
  from public.accept_clinic_invitation_v1(
    v_context.insert_invitation_id,
    v_context.user_id,
    v_context.insert_email
  );

  if v_first.idempotent
     or v_first.membership_role <> 'therapist'
     or v_first.invitation_status <> 'accepted'
     or v_first.membership_status <> 'active' then
    raise exception 'TEST_INSERT_ACCEPTANCE_RESULT_FAILED';
  end if;

  select membership.* into strict v_membership
  from public.clinic_memberships membership
  where membership.user_id = v_context.user_id
    and membership.clinic_id = v_context.clinic_a_id;

  if v_membership.specialty <> 'Fonoaudiólogo'
     or v_membership.status <> 'active'
     or v_membership.work_schedule is not null then
    raise exception 'TEST_INSERTED_MEMBERSHIP_INVALID';
  end if;

  if not exists (
    select 1
    from public.invitations invitation
    where invitation.id = v_context.insert_invitation_id
      and invitation.status = 'accepted'
      and invitation.accepted_at is not null
  ) then
    raise exception 'TEST_INSERT_INVITATION_NOT_ACCEPTED';
  end if;

  if (
    select count(*)
    from public.clinic_memberships membership
    where membership.user_id = v_context.user_id
      and membership.clinic_id = v_context.clinic_a_id
  ) <> 1 then
    raise exception 'TEST_INSERT_ACCEPTANCE_MEMBERSHIP_COUNT_FAILED';
  end if;
end;
$insert_acceptance$;

insert into public.invitations (
  id,
  email,
  clinic_id,
  clinic_name,
  role,
  required_onboarding_fields,
  status,
  created_at,
  updated_at
)
select
  context.conflict_invitation_id,
  context.conflict_email,
  context.clinic_b_id,
  clinic.name,
  'therapist',
  jsonb_build_object(
    'specialty', '   ',
    'professionalTitle', 'Musicoterapeuta'
  ),
  'pending',
  clock_timestamp(),
  clock_timestamp()
from verto_20260802010000_context context
join public.clinics clinic on clinic.id = context.clinic_b_id;

do $duplicate_pending_invitation_guard$
declare
  v_context verto_20260802010000_context%rowtype;
begin
  select * into strict v_context from verto_20260802010000_context;

  begin
    insert into public.invitations (
      id,
      email,
      clinic_id,
      clinic_name,
      role,
      required_onboarding_fields,
      status,
      created_at,
      updated_at
    )
    select
      gen_random_uuid(),
      v_context.conflict_email,
      v_context.clinic_b_id,
      clinic.name,
      'therapist',
      jsonb_build_object('specialty', 'Fisioterapeuta'),
      'pending',
      clock_timestamp(),
      clock_timestamp()
    from public.clinics clinic
    where clinic.id = v_context.clinic_b_id;

    raise exception 'TEST_DUPLICATE_PENDING_INVITATION_WAS_ACCEPTED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'CLINIC_INVITATION_PENDING_ALREADY_EXISTS' then
        raise;
      end if;
  end;
end;
$duplicate_pending_invitation_guard$;

do $conflict_acceptance_and_retry$
declare
  v_first record;
  v_retry record;
  v_context verto_20260802010000_context%rowtype;
  v_membership public.clinic_memberships%rowtype;
  v_membership_before_retry jsonb;
  v_membership_after_retry jsonb;
begin
  select * into strict v_context from verto_20260802010000_context;

  select * into strict v_first
  from public.accept_clinic_invitation_v1(
    v_context.conflict_invitation_id,
    v_context.user_id,
    v_context.conflict_email
  );

  if v_first.idempotent
     or v_first.membership_role <> 'therapist'
     or v_first.invitation_status <> 'accepted'
     or v_first.membership_status <> 'active' then
    raise exception 'TEST_CONFLICT_ACCEPTANCE_RESULT_FAILED';
  end if;

  select membership.* into strict v_membership
  from public.clinic_memberships membership
  where membership.user_id = v_context.user_id
    and membership.clinic_id = v_context.clinic_b_id;

  if v_membership.specialty <> 'Musicoterapeuta' then
    raise exception 'TEST_NON_EMPTY_SPECIALTY_ALIAS_NOT_USED';
  end if;

  if coalesce(
    (v_membership.work_schedule #>> '{days,tuesday,enabled}')::boolean,
    false
  ) is not true then
    raise exception 'TEST_CONFLICT_ACCEPTANCE_OVERWROTE_WORK_SCHEDULE';
  end if;

  v_membership_before_retry := to_jsonb(v_membership);

  select * into strict v_retry
  from public.accept_clinic_invitation_v1(
    v_context.conflict_invitation_id,
    v_context.user_id,
    v_context.conflict_email
  );

  if not v_retry.idempotent
     or v_retry.membership_role <> 'therapist'
     or v_retry.invitation_status <> 'accepted'
     or v_retry.membership_status <> 'active' then
    raise exception 'TEST_CONFLICT_ACCEPTANCE_RETRY_NOT_IDEMPOTENT';
  end if;

  select to_jsonb(membership)
    into strict v_membership_after_retry
    from public.clinic_memberships membership
   where membership.user_id = v_context.user_id
     and membership.clinic_id = v_context.clinic_b_id;

  if v_membership_after_retry is distinct from v_membership_before_retry then
    raise exception 'TEST_CONFLICT_ACCEPTANCE_RETRY_MUTATED_MEMBERSHIP';
  end if;

  if (
    select count(*)
    from public.clinic_memberships membership
    where membership.user_id = v_context.user_id
      and membership.clinic_id = v_context.clinic_b_id
  ) <> 1 then
    raise exception 'TEST_CONFLICT_ACCEPTANCE_DUPLICATED_MEMBERSHIP';
  end if;
end;
$conflict_acceptance_and_retry$;

update public.clinic_memberships membership
set work_schedule = '{"days":{"monday":{"enabled":true,"periods":[{"start":"08:00","end":"12:00"}]}}}'::jsonb,
    work_schedule_configured_at = clock_timestamp(),
    settings_updated_at = clock_timestamp()
from verto_20260802010000_context context
where membership.user_id = context.user_id
  and membership.clinic_id = context.clinic_a_id;

do $workspace_isolation$
declare
  v_a public.clinic_memberships%rowtype;
  v_b public.clinic_memberships%rowtype;
begin
  select membership.* into strict v_a
  from public.clinic_memberships membership
  join verto_20260802010000_context context
    on context.user_id = membership.user_id
   and context.clinic_a_id = membership.clinic_id;

  select membership.* into strict v_b
  from public.clinic_memberships membership
  join verto_20260802010000_context context
    on context.user_id = membership.user_id
   and context.clinic_b_id = membership.clinic_id;

  if v_a.specialty <> 'Fonoaudiólogo'
     or v_b.specialty <> 'Musicoterapeuta' then
    raise exception 'TEST_SPECIALTY_WORKSPACE_ISOLATION_FAILED';
  end if;

  if coalesce((v_a.work_schedule #>> '{days,monday,enabled}')::boolean, false) is not true
     or coalesce((v_b.work_schedule #>> '{days,tuesday,enabled}')::boolean, false) is not true
     or v_a.work_schedule = v_b.work_schedule then
    raise exception 'TEST_WORK_SCHEDULE_WORKSPACE_ISOLATION_FAILED';
  end if;
end;
$workspace_isolation$;

insert into public.invitations (
  id,
  email,
  clinic_id,
  clinic_name,
  role,
  required_onboarding_fields,
  status,
  created_at,
  updated_at
)
select
  context.invalid_invitation_id,
  context.invalid_email,
  context.clinic_b_id,
  clinic.name,
  'therapist',
  jsonb_build_object('specialty', 'Especialidade inventada'),
  'pending',
  clock_timestamp(),
  clock_timestamp()
from verto_20260802010000_context context
join public.clinics clinic on clinic.id = context.clinic_b_id;

do $invalid_invitation$
declare
  v_context verto_20260802010000_context%rowtype;
begin
  select * into strict v_context from verto_20260802010000_context;

  begin
    perform *
    from public.accept_clinic_invitation_v1(
      v_context.invalid_invitation_id,
      v_context.user_id,
      v_context.invalid_email
    );
    raise exception 'TEST_INVALID_SPECIALTY_WAS_ACCEPTED';
  exception
    when others then
      if sqlerrm <> 'CLINIC_INVITATION_SPECIALTY_INVALID' then
        raise;
      end if;
  end;

  if not exists (
    select 1
    from public.invitations invitation
    where invitation.id = v_context.invalid_invitation_id
      and invitation.status = 'pending'
      and invitation.accepted_at is null
  ) then
    raise exception 'TEST_INVALID_INVITATION_NOT_PRESERVED_PENDING';
  end if;
end;
$invalid_invitation$;

insert into public.invitations (
  id,
  email,
  clinic_id,
  clinic_name,
  role,
  required_onboarding_fields,
  status,
  created_at,
  updated_at
)
select
  context.non_therapist_invitation_id,
  context.non_therapist_email,
  context.clinic_b_id,
  clinic.name,
  'receptionist',
  '{}'::jsonb,
  'pending',
  clock_timestamp(),
  clock_timestamp()
from verto_20260802010000_context context
join public.clinics clinic on clinic.id = context.clinic_b_id;

do $non_therapist_clears_specialty$
declare
  v_context verto_20260802010000_context%rowtype;
  v_membership public.clinic_memberships%rowtype;
begin
  select * into strict v_context from verto_20260802010000_context;

  perform *
  from public.accept_clinic_invitation_v1(
    v_context.non_therapist_invitation_id,
    v_context.user_id,
    v_context.non_therapist_email
  );

  select membership.* into strict v_membership
  from public.clinic_memberships membership
  where membership.user_id = v_context.user_id
    and membership.clinic_id = v_context.clinic_b_id;

  if v_membership.role <> 'receptionist'
     or v_membership.specialty is not null then
    raise exception 'TEST_NON_THERAPIST_SPECIALTY_NOT_CLEARED';
  end if;
end;
$non_therapist_clears_specialty$;

do $constraint_rejections$
declare
  v_context verto_20260802010000_context%rowtype;
begin
  select * into strict v_context from verto_20260802010000_context;

  begin
    update public.clinic_memberships
       set specialty = 'Especialidade inventada'
     where user_id = v_context.user_id
       and clinic_id = v_context.clinic_a_id;
    raise exception 'TEST_INVALID_SPECIALTY_CONSTRAINT_NOT_ENFORCED';
  exception
    when check_violation then null;
  end;

  begin
    update public.clinic_memberships
       set work_schedule = '[]'::jsonb
     where user_id = v_context.user_id
       and clinic_id = v_context.clinic_a_id;
    raise exception 'TEST_WORK_SCHEDULE_OBJECT_CONSTRAINT_NOT_ENFORCED';
  exception
    when check_violation then null;
  end;

  begin
    update public.clinic_memberships
       set availability_timezone = 'UTC'
     where user_id = v_context.user_id
       and clinic_id = v_context.clinic_a_id;
    raise exception 'TEST_NON_CANONICAL_TIMEZONE_CONSTRAINT_NOT_ENFORCED';
  exception
    when check_violation then null;
  end;
end;
$constraint_rejections$;

rollback;
