-- Regression contract for #259 clinic billing communication v1.
-- Synthetic fixtures only; all data is rolled back.
begin;

-- Structural security: RPC-only tables, RLS on, browser table grants absent.
do $test$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in (
      'clinic_communication_threads',
      'clinic_communication_messages',
      'clinic_communication_mentions',
      'clinic_communication_read_states',
      'clinic_communication_audit_events'
    )
    and not c.relrowsecurity;
  if v_bad <> 0 then raise exception 'TEST_FAIL communication RLS disabled'; end if;

  if has_table_privilege('authenticated','public.clinic_communication_threads','SELECT')
     or has_table_privilege('authenticated','public.clinic_communication_threads','INSERT')
     or has_table_privilege('authenticated','public.clinic_communication_threads','UPDATE')
     or has_table_privilege('authenticated','public.clinic_communication_threads','DELETE') then
    raise exception 'TEST_FAIL authenticated direct thread DML';
  end if;
  if has_table_privilege('anon','public.clinic_communication_messages','SELECT') then
    raise exception 'TEST_FAIL anon direct communication read';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.create_clinic_communication_thread_v1(uuid,text,text,uuid[],text,uuid,text)',
    'EXECUTE'
  ) then raise exception 'TEST_FAIL authenticated RPC grant missing'; end if;
  if has_function_privilege(
    'anon',
    'public.create_clinic_communication_thread_v1(uuid,text,text,uuid[],text,uuid,text)',
    'EXECUTE'
  ) then raise exception 'TEST_FAIL anon RPC grant'; end if;
end
$test$;

-- SECURITY DEFINER and fixed search_path are mandatory on the browser RPC surface.
do $test$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (
      'create_clinic_communication_thread_v1',
      'send_clinic_communication_message_v1',
      'set_clinic_communication_thread_archived_v1',
      'mark_clinic_communication_read_v1',
      'mark_clinic_communication_notification_read_v1',
      'list_clinic_communication_threads_v1',
      'list_clinic_communication_messages_v1',
      'list_clinic_communication_mention_targets_v1',
      'list_clinic_communication_notifications_v1',
      'get_clinic_communication_unread_count_v1'
    )
    and (not p.prosecdef or not (coalesce(p.proconfig,array[]::text[]) @> array['search_path=']::text[]));
  if v_bad <> 0 then raise exception 'TEST_FAIL RPC security definer/search_path'; end if;
end
$test$;

-- Minimal synthetic A/B tenants.
insert into auth.users (id,email) values
 ('25911000-0000-4000-8000-000000000001','issue259-test-biller@test.invalid'),
 ('25911000-0000-4000-8000-000000000002','issue259-test-director@test.invalid'),
 ('25911000-0000-4000-8000-000000000003','issue259-test-cross@test.invalid')
on conflict (id) do nothing;

insert into public.users (id,email,name,role) values
 ('25911000-0000-4000-8000-000000000001','issue259-test-biller@test.invalid','Biller Test #259','biller'),
 ('25911000-0000-4000-8000-000000000002','issue259-test-director@test.invalid','Director Test #259','director'),
 ('25911000-0000-4000-8000-000000000003','issue259-test-cross@test.invalid','Cross Test #259','coordinator')
on conflict (id) do update set email=excluded.email,name=excluded.name,role=excluded.role;

insert into public.school_organizations (id,name)
values ('25921000-0000-4000-8000-000000000001','School Org Test #259');

insert into public.clinics (id,name,school_organization_id,is_demo,demo_source,demo_status,demo_kind) values
 ('25901000-0000-4000-8000-000000000001','Clinic A Test #259','25921000-0000-4000-8000-000000000001',true,'template','active','playground'),
 ('25901000-0000-4000-8000-000000000002','Clinic B Test #259','25921000-0000-4000-8000-000000000001',true,'template','active','playground');

insert into public.clinic_memberships (id,user_id,clinic_id,role,status) values
 ('25931000-0000-4000-8000-000000000001','25911000-0000-4000-8000-000000000001','25901000-0000-4000-8000-000000000001','biller','active'),
 ('25931000-0000-4000-8000-000000000002','25911000-0000-4000-8000-000000000002','25901000-0000-4000-8000-000000000001','director','active'),
 ('25931000-0000-4000-8000-000000000003','25911000-0000-4000-8000-000000000003','25901000-0000-4000-8000-000000000002','coordinator','active');

-- Capability defaults are server-owned and membership-scoped.
do $test$
begin
  if not private.clinic_billing_communication_capability_v1(
    '25911000-0000-4000-8000-000000000001','25901000-0000-4000-8000-000000000001','communication.billing_updates.write'
  ) then raise exception 'TEST_FAIL biller write default'; end if;
  if private.clinic_billing_communication_capability_v1(
    '25911000-0000-4000-8000-000000000001','25901000-0000-4000-8000-000000000001','communication.billing_updates.manage'
  ) then raise exception 'TEST_FAIL biller manage default'; end if;
  if not private.clinic_billing_communication_capability_v1(
    '25911000-0000-4000-8000-000000000002','25901000-0000-4000-8000-000000000001','communication.billing_updates.manage'
  ) then raise exception 'TEST_FAIL director manage default'; end if;
end
$test$;

-- Authenticated actor creates once; retry returns the same thread/message.
select set_config('request.jwt.claim.sub','25911000-0000-4000-8000-000000000001',true);
select public.create_clinic_communication_thread_v1(
  '25901000-0000-4000-8000-000000000001',
  'Synthetic subject',
  'Synthetic first message',
  array['25911000-0000-4000-8000-000000000002'::uuid],
  null,null,'issue259-create-test-0001'
);
select public.create_clinic_communication_thread_v1(
  '25901000-0000-4000-8000-000000000001',
  'Ignored retry subject',
  'Ignored retry body',
  array['25911000-0000-4000-8000-000000000002'::uuid],
  null,null,'issue259-create-test-0001'
);

create temp table issue259_test_ids on commit drop as
select thread_id,id as first_message_id
from public.clinic_communication_messages
where idempotency_key='issue259-create-test-0001';

do $test$
declare v_thread uuid;
begin
  select thread_id into v_thread from issue259_test_ids;
  if (select count(*) from public.clinic_communication_threads where id=v_thread) <> 1 then
    raise exception 'TEST_FAIL thread duplicated';
  end if;
  if (select count(*) from public.clinic_communication_messages where idempotency_key='issue259-create-test-0001') <> 1 then
    raise exception 'TEST_FAIL create retry duplicated message';
  end if;
  if (select last_sequence from public.clinic_communication_threads where id=v_thread) <> 1 then
    raise exception 'TEST_FAIL initial sequence';
  end if;
end
$test$;

-- Send retry is idempotent and sequence stays monotonic.
select public.send_clinic_communication_message_v1(
  (select thread_id from issue259_test_ids),
  'Synthetic reply',array[]::uuid[],'issue259-send-test-000001'
);
select public.send_clinic_communication_message_v1(
  (select thread_id from issue259_test_ids),
  'Ignored retry reply',array[]::uuid[],'issue259-send-test-000001'
);

do $test$
declare v_thread uuid;
begin
  select thread_id into v_thread from issue259_test_ids;
  if (select count(*) from public.clinic_communication_messages where thread_id=v_thread) <> 2 then
    raise exception 'TEST_FAIL send retry duplicate';
  end if;
  if (select last_sequence from public.clinic_communication_threads where id=v_thread) <> 2 then
    raise exception 'TEST_FAIL monotonic thread sequence';
  end if;
end
$test$;

-- Cross-tenant mention fails atomically.
do $test$
declare v_thread uuid;
begin
  select thread_id into v_thread from issue259_test_ids;
  begin
    perform public.send_clinic_communication_message_v1(
      v_thread,'Cross tenant denied',array['25911000-0000-4000-8000-000000000003'::uuid],'issue259-cross-test-0001'
    );
    raise exception 'TEST_FAIL cross-tenant mention allowed';
  exception when sqlstate '42501' then null;
  end;
  if exists(select 1 from public.clinic_communication_messages where idempotency_key='issue259-cross-test-0001') then
    raise exception 'TEST_FAIL cross-tenant send not atomic';
  end if;
end
$test$;

-- Notification read and thread unread are distinct authorities; stale tab cannot regress read cursor.
select set_config('request.jwt.claim.sub','25911000-0000-4000-8000-000000000002',true);
select public.mark_clinic_communication_notification_read_v1(
  (select mn.id from public.clinic_communication_mentions mn
   join issue259_test_ids x on x.first_message_id=mn.message_id
   where mn.mentioned_user_id='25911000-0000-4000-8000-000000000002' limit 1)
);
do $test$
begin
  if exists(select 1 from public.clinic_communication_read_states rs join issue259_test_ids x on x.thread_id=rs.thread_id where rs.user_id='25911000-0000-4000-8000-000000000002') then
    raise exception 'TEST_FAIL notification mutated read cursor';
  end if;
end
$test$;
select public.mark_clinic_communication_read_v1((select thread_id from issue259_test_ids),2);
select public.mark_clinic_communication_read_v1((select thread_id from issue259_test_ids),1);
do $test$
begin
  if (select rs.last_read_sequence from public.clinic_communication_read_states rs join issue259_test_ids x on x.thread_id=rs.thread_id where rs.user_id='25911000-0000-4000-8000-000000000002') <> 2 then
    raise exception 'TEST_FAIL read cursor regressed';
  end if;
end
$test$;

-- Direct Data API table access is denied to authenticated, not merely filtered by RLS.
set local role authenticated;
do $test$
begin
  begin perform 1 from public.clinic_communication_threads limit 1; raise exception 'TEST_FAIL direct select allowed'; exception when sqlstate '42501' then null; end;
  begin update public.clinic_communication_threads set subject=subject where false; raise exception 'TEST_FAIL direct update allowed'; exception when sqlstate '42501' then null; end;
  begin delete from public.clinic_communication_threads where false; raise exception 'TEST_FAIL direct delete allowed'; exception when sqlstate '42501' then null; end;
end
$test$;
reset role;

rollback;
