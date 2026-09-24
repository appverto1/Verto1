-- #256 behavioral DATA gate for server-owned invitation authority.
-- Synthetic fixtures only; every write is rolled back.

begin;

create or replace function pg_temp.a10_expect_accept_error(
  p_invitation_id uuid,
  p_user_id uuid,
  p_email text,
  p_expected text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  begin
    perform * from public.accept_clinic_invitation_v1(p_invitation_id, p_user_id, p_email);
  exception when others then
    if sqlerrm = p_expected then return; end if;
    raise exception 'A10_UNEXPECTED_ACCEPT_ERROR expected=% got=%', p_expected, sqlerrm;
  end;
  raise exception 'A10_EXPECTED_ACCEPT_ERROR_NOT_RAISED: %', p_expected;
end;
$$;

do $$
declare
  ids uuid[] := array[
    'a2561934-0000-4000-8000-000000000101'::uuid,
    'a2561934-0000-4000-8000-000000000102'::uuid,
    'a2561934-0000-4000-8000-000000000103'::uuid,
    'a2561934-0000-4000-8000-000000000104'::uuid,
    'a2561934-0000-4000-8000-000000000105'::uuid,
    'a2561934-0000-4000-8000-000000000106'::uuid,
    'a2561934-0000-4000-8000-000000000107'::uuid
  ];
  emails text[] := array[
    'a10-coordinator-1934@example.invalid',
    'a10-director-1934@example.invalid',
    'a10-legit-1934@example.invalid',
    'a10-other-1934@example.invalid',
    'a10-inactive-1934@example.invalid',
    'a10-expired-1934@example.invalid',
    'a10-null-expiry-1934@example.invalid'
  ];
  i int;
begin
  for i in 1..array_length(ids,1) loop
    insert into auth.users (
      id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous
    ) values (
      ids[i],'authenticated','authenticated',emails[i],'',clock_timestamp(),
      '{}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp(),false,false
    ) on conflict (id) do nothing;
    insert into public.users (id,email,name,role,created_at,updated_at,is_demo_user)
    values (ids[i],emails[i],'A10 synthetic','therapist',clock_timestamp(),clock_timestamp(),true)
    on conflict (id) do update set email=excluded.email,updated_at=excluded.updated_at,is_demo_user=true;
  end loop;
end $$;

insert into public.school_organizations (id,name,is_active)
values ('a2561934-0000-4000-8000-000000000001','A10 synthetic org',true)
on conflict (id) do nothing;

insert into public.clinics (id,name,school_organization_id,is_demo)
values
 ('a2561934-0000-4000-8000-000000000010','A10 clinic A','a2561934-0000-4000-8000-000000000001',true),
 ('a2561934-0000-4000-8000-000000000011','A10 clinic B','a2561934-0000-4000-8000-000000000001',true)
on conflict (id) do nothing;

insert into public.clinic_memberships (id,user_id,clinic_id,role,status,created_at,updated_at)
values
 ('a2561934-0000-4000-8000-000000000201','a2561934-0000-4000-8000-000000000101','a2561934-0000-4000-8000-000000000010','coordinator','active',clock_timestamp(),clock_timestamp()),
 ('a2561934-0000-4000-8000-000000000202','a2561934-0000-4000-8000-000000000102','a2561934-0000-4000-8000-000000000010','director','active',clock_timestamp(),clock_timestamp()),
 ('a2561934-0000-4000-8000-000000000205','a2561934-0000-4000-8000-000000000105','a2561934-0000-4000-8000-000000000010','therapist','inactive',clock_timestamp()-interval '2 hours',clock_timestamp())
on conflict (user_id,clinic_id) do update set role=excluded.role,status=excluded.status,updated_at=excluded.updated_at;

insert into public.invitations (id,clinic_id,email,role,status,created_at,expires_at,required_onboarding_fields)
values
 ('a2561934-0000-4000-8000-000000000301','a2561934-0000-4000-8000-000000000010','a10-coordinator-1934@example.invalid','therapist','pending',clock_timestamp(),clock_timestamp()+interval '2 days','{"specialty":"Psicoterapeuta"}'::jsonb),
 ('a2561934-0000-4000-8000-000000000302','a2561934-0000-4000-8000-000000000011','a10-other-1934@example.invalid','director','pending',clock_timestamp(),clock_timestamp()+interval '2 days','{}'::jsonb);

-- Coordinator is a true manager under the historical helper, but table authority is gone.
do $$ begin
  if not public.can_manage_clinic('a2561934-0000-4000-8000-000000000010','a2561934-0000-4000-8000-000000000101') then
    raise exception 'A10_COORDINATOR_PRECONDITION_FAILED';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','a2561934-0000-4000-8000-000000000101',true);
do $$
declare
  statement text;
  attempts text[] := array[
    $q$insert into public.invitations(id,clinic_id,email,role,status,created_at,expires_at,required_onboarding_fields) values ('a2561934-0000-4000-8000-000000000399','a2561934-0000-4000-8000-000000000010','attack-1934@example.invalid','director','pending',clock_timestamp(),clock_timestamp()+interval '7 days','{}'::jsonb)$q$,
    $q$update public.invitations set role='director' where id='a2561934-0000-4000-8000-000000000301'$q$,
    $q$delete from public.invitations where id='a2561934-0000-4000-8000-000000000301'$q$,
    $q$update public.invitations set email='a10-coordinator-1934@example.invalid' where id='a2561934-0000-4000-8000-000000000302'$q$,
    $q$update public.invitations set clinic_id='a2561934-0000-4000-8000-000000000011' where id='a2561934-0000-4000-8000-000000000301'$q$,
    $q$update public.invitations set status='accepted' where id='a2561934-0000-4000-8000-000000000301'$q$,
    $q$update public.invitations set expires_at=null where id='a2561934-0000-4000-8000-000000000301'$q$,
    $q$update public.invitations set accepted_user_id='a2561934-0000-4000-8000-000000000101' where id='a2561934-0000-4000-8000-000000000301'$q$,
    $q$update public.invitations set required_onboarding_fields='{"specialty":"Psicoterapeuta"}'::jsonb where id='a2561934-0000-4000-8000-000000000301'$q$
  ];
begin
  foreach statement in array attempts loop
    begin
      execute statement;
      raise exception 'A10_AUTHENTICATED_MUTATION_ALLOWED: %',statement;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
  if exists (select 1 from public.invitations where id='a2561934-0000-4000-8000-000000000302') then
    raise exception 'A10_CROSS_TENANT_SELECT_LEAK';
  end if;
end $$;
reset role;

-- Direct coordinator->director tampering did not alter invitation or membership.
do $$ begin
  if (select role from public.invitations where id='a2561934-0000-4000-8000-000000000301') <> 'therapist' then
    raise exception 'A10_INVITATION_ROLE_TAMPERED';
  end if;
  if (select role from public.clinic_memberships where user_id='a2561934-0000-4000-8000-000000000101' and clinic_id='a2561934-0000-4000-8000-000000000010') <> 'coordinator' then
    raise exception 'A10_COORDINATOR_ROLE_CHANGED';
  end if;
end $$;

-- Both-null expiry source rows are impossible after created_at became NOT NULL.
set local role service_role;
do $$ begin
  begin
    insert into public.invitations(id,clinic_id,email,role,status,created_at,expires_at,required_onboarding_fields)
    values ('a2561934-0000-4000-8000-000000000398','a2561934-0000-4000-8000-000000000010','nulls-1934@example.invalid','therapist','pending',null,null,'{"specialty":"Psicoterapeuta"}'::jsonb);
  exception when not_null_violation then return;
  end;
  raise exception 'A10_BOTH_NULL_TIMESTAMP_ROW_WAS_ACCEPTED';
end $$;
reset role;

-- Authorized server-owned invitation path and acceptance remain functional.
insert into public.invitations (id,clinic_id,email,role,status,created_at,expires_at,required_onboarding_fields,invited_by)
values ('a2561934-0000-4000-8000-000000000303','a2561934-0000-4000-8000-000000000010','a10-legit-1934@example.invalid','therapist','pending',clock_timestamp(),clock_timestamp()+interval '2 days','{"specialty":"Psicoterapeuta"}'::jsonb,'a2561934-0000-4000-8000-000000000102');

insert into public.invitations (id,clinic_id,email,role,status,created_at,expires_at,required_onboarding_fields,accepted_user_id,accepted_at)
values ('a2561934-0000-4000-8000-000000000304','a2561934-0000-4000-8000-000000000010','a10-other-1934@example.invalid','therapist','accepted',clock_timestamp(),clock_timestamp()+interval '2 days','{"specialty":"Psicoterapeuta"}'::jsonb,'a2561934-0000-4000-8000-000000000103',clock_timestamp());

insert into public.invitations (id,clinic_id,email,role,status,created_at,expires_at,required_onboarding_fields)
values
 ('a2561934-0000-4000-8000-000000000305','a2561934-0000-4000-8000-000000000010','a10-inactive-1934@example.invalid','therapist','pending',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 days','{"specialty":"Psicoterapeuta"}'::jsonb),
 ('a2561934-0000-4000-8000-000000000306','a2561934-0000-4000-8000-000000000010','a10-expired-1934@example.invalid','therapist','pending',clock_timestamp(),clock_timestamp(),'{"specialty":"Psicoterapeuta"}'::jsonb),
 ('a2561934-0000-4000-8000-000000000307','a2561934-0000-4000-8000-000000000010','a10-null-expiry-1934@example.invalid','therapist','pending',clock_timestamp()-interval '8 days',null,'{"specialty":"Psicoterapeuta"}'::jsonb);

set local role service_role;
do $$
declare first_accept record; replay record;
begin
  select * into first_accept from public.accept_clinic_invitation_v1('a2561934-0000-4000-8000-000000000303','a2561934-0000-4000-8000-000000000103','a10-legit-1934@example.invalid');
  if first_accept.idempotent or first_accept.membership_role <> 'therapist' or first_accept.invitation_status <> 'accepted' then
    raise exception 'A10_LEGITIMATE_ACCEPT_FAILED';
  end if;
  select * into replay from public.accept_clinic_invitation_v1('a2561934-0000-4000-8000-000000000303','a2561934-0000-4000-8000-000000000103','a10-legit-1934@example.invalid');
  if not replay.idempotent then raise exception 'A10_SAME_USER_REPLAY_NOT_IDEMPOTENT'; end if;
end $$;
select pg_temp.a10_expect_accept_error('a2561934-0000-4000-8000-000000000304','a2561934-0000-4000-8000-000000000104','a10-other-1934@example.invalid','CLINIC_INVITATION_ALREADY_USED');
select pg_temp.a10_expect_accept_error('a2561934-0000-4000-8000-000000000305','a2561934-0000-4000-8000-000000000105','a10-inactive-1934@example.invalid','CLINIC_INVITATION_ALREADY_USED');
select pg_temp.a10_expect_accept_error('a2561934-0000-4000-8000-000000000306','a2561934-0000-4000-8000-000000000106','a10-expired-1934@example.invalid','CLINIC_INVITATION_EXPIRED');
select pg_temp.a10_expect_accept_error('a2561934-0000-4000-8000-000000000307','a2561934-0000-4000-8000-000000000107','a10-null-expiry-1934@example.invalid','CLINIC_INVITATION_EXPIRED');
reset role;

do $$ begin
  if not exists (select 1 from public.clinic_memberships where user_id='a2561934-0000-4000-8000-000000000103' and clinic_id='a2561934-0000-4000-8000-000000000010' and role='therapist' and status='active') then
    raise exception 'A10_LEGITIMATE_MEMBERSHIP_MISSING';
  end if;
  if not exists (select 1 from public.invitations where id='a2561934-0000-4000-8000-000000000303' and status='accepted' and accepted_user_id='a2561934-0000-4000-8000-000000000103') then
    raise exception 'A10_ACCEPTED_IDENTITY_BINDING_MISSING';
  end if;
  if has_function_privilege('anon','public.accept_clinic_invitation_v1(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.accept_clinic_invitation_v1(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.accept_clinic_invitation_v1(uuid,uuid,text)','EXECUTE') then
    raise exception 'A10_ACCEPT_RPC_ACL_INVALID';
  end if;
end $$;

rollback;
