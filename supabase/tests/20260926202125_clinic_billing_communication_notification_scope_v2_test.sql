-- Regression for #259 A12: notification pagination must be clinic-scoped before LIMIT/cursor.
-- Synthetic fixtures only; all data is rolled back.
begin;

do $test$
begin
  if to_regprocedure('public.list_clinic_communication_notifications_v1(integer,timestamptz,uuid)') is not null then
    raise exception 'TEST_FAIL legacy global notification RPC signature still exists';
  end if;
  if to_regprocedure('public.list_clinic_communication_notifications_v1(uuid,integer,timestamptz,uuid)') is null then
    raise exception 'TEST_FAIL clinic-scoped notification RPC signature missing';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.list_clinic_communication_notifications_v1(uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ) then
    raise exception 'TEST_FAIL authenticated notification RPC grant missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.list_clinic_communication_notifications_v1(uuid,integer,timestamptz,uuid)',
    'EXECUTE'
  ) then
    raise exception 'TEST_FAIL anon notification RPC grant present';
  end if;
end
$test$;

insert into auth.users (id,email) values
 ('25912000-0000-4000-8000-000000000001','issue259-a12-user@test.invalid')
on conflict (id) do nothing;

insert into public.users (id,email,name,role) values
 ('25912000-0000-4000-8000-000000000001','issue259-a12-user@test.invalid','Issue 259 A12 User','biller')
on conflict (id) do update set email=excluded.email,name=excluded.name,role=excluded.role;

insert into public.school_organizations (id,name) values
 ('25922000-0000-4000-8000-000000000001','Issue 259 A12 Org')
on conflict (id) do nothing;

insert into public.clinics (id,name,school_organization_id,is_demo,demo_source,demo_status,demo_kind) values
 ('25902000-0000-4000-8000-000000000001','Issue 259 A12 Clinic A','25922000-0000-4000-8000-000000000001',true,'template','active','playground'),
 ('25902000-0000-4000-8000-000000000002','Issue 259 A12 Clinic B','25922000-0000-4000-8000-000000000001',true,'template','active','playground')
on conflict (id) do nothing;

insert into public.clinic_memberships (id,user_id,clinic_id,role,status) values
 ('25932000-0000-4000-8000-000000000001','25912000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001','biller','active'),
 ('25932000-0000-4000-8000-000000000002','25912000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000002','biller','active')
on conflict (id) do nothing;

insert into public.clinic_communication_threads (
  id,clinic_id,subject,created_by,created_at,updated_at,last_activity_at,last_sequence
) values
 ('25942000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001','A notification','25912000-0000-4000-8000-000000000001','2026-09-25T10:00:00Z','2026-09-25T10:00:00Z','2026-09-25T10:00:00Z',1),
 ('25942000-0000-4000-8000-000000000002','25902000-0000-4000-8000-000000000002','B notifications','25912000-0000-4000-8000-000000000001','2026-09-26T10:00:00Z','2026-09-26T10:00:00Z','2026-09-26T10:35:00Z',35);

insert into public.clinic_communication_messages (
  id,clinic_id,thread_id,sequence,author_user_id,author_name_snapshot,
  author_role_snapshot,body,operation_type,idempotency_key,created_at
) values (
  '25952000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001',
  '25942000-0000-4000-8000-000000000001',1,'25912000-0000-4000-8000-000000000001',
  'Issue 259 A12 User','biller','A body','send_message','issue259-a12-a-message-0001','2026-09-25T10:00:00Z'
);

insert into public.clinic_communication_messages (
  id,clinic_id,thread_id,sequence,author_user_id,author_name_snapshot,
  author_role_snapshot,body,operation_type,idempotency_key,created_at
)
select gen_random_uuid(),
  '25902000-0000-4000-8000-000000000002',
  '25942000-0000-4000-8000-000000000002',
  g,
  '25912000-0000-4000-8000-000000000001',
  'Issue 259 A12 User','biller','B body ' || g,'send_message',
  'issue259-a12-b-message-' || lpad(g::text,4,'0'),
  '2026-09-26T10:00:00Z'::timestamptz + (g || ' minutes')::interval
from generate_series(1,35) g;

insert into public.clinic_communication_mentions (
  id,clinic_id,thread_id,message_id,mentioned_user_id,mentioned_name_snapshot,
  mentioned_role_snapshot,created_at,notified_at
) values (
  '25962000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001',
  '25942000-0000-4000-8000-000000000001','25952000-0000-4000-8000-000000000001',
  '25912000-0000-4000-8000-000000000001','Issue 259 A12 User','biller',
  '2026-09-25T10:00:00Z','2026-09-25T10:00:00Z'
);

insert into public.clinic_communication_mentions (
  clinic_id,thread_id,message_id,mentioned_user_id,mentioned_name_snapshot,
  mentioned_role_snapshot,created_at,notified_at
)
select '25902000-0000-4000-8000-000000000002',
  '25942000-0000-4000-8000-000000000002',m.id,
  '25912000-0000-4000-8000-000000000001','Issue 259 A12 User','biller',m.created_at,m.created_at
from public.clinic_communication_messages m
where m.thread_id='25942000-0000-4000-8000-000000000002';

select set_config('request.jwt.claim.sub','25912000-0000-4000-8000-000000000001',true);

do $test$
declare
  v_a jsonb;
  v_b jsonb;
begin
  v_a := public.list_clinic_communication_notifications_v1(
    '25902000-0000-4000-8000-000000000001',30,null,null
  );
  v_b := public.list_clinic_communication_notifications_v1(
    '25902000-0000-4000-8000-000000000002',30,null,null
  );

  if jsonb_array_length(v_a->'items') <> 1 then
    raise exception 'TEST_FAIL clinic A notification window polluted by clinic B';
  end if;
  if (v_a->'items'->0->>'clinicId')::uuid <> '25902000-0000-4000-8000-000000000001'::uuid then
    raise exception 'TEST_FAIL clinic A returned foreign clinic metadata';
  end if;
  if jsonb_array_length(v_b->'items') <> 30 then
    raise exception 'TEST_FAIL clinic B bounded page expected 30';
  end if;
end
$test$;

rollback;
select 'DATA_NOTIFICATION_SCOPE_259_PASS' as result;
