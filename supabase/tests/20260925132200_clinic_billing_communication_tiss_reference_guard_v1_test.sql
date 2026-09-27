-- Regression contract for #259 TISS reference guard recovery.
-- Synthetic fixtures only; all data is rolled back.
begin;

-- Recovered migration must protect both TISS writes and TISS reference projection.
do $test$
declare
  v_helper_def text;
  v_guard_def text;
  v_list_def text;
  v_trigger_count integer;
begin
  select pg_get_functiondef('private.clinic_billing_tiss_reference_access_v1(uuid,uuid)'::regprocedure)
    into v_helper_def;
  select pg_get_functiondef('private.guard_clinic_communication_tiss_reference_v1()'::regprocedure)
    into v_guard_def;
  select pg_get_functiondef('public.list_clinic_communication_threads_v1(uuid,integer,timestamptz,uuid)'::regprocedure)
    into v_list_def;
  select count(*) into v_trigger_count
  from pg_trigger
  where tgrelid='public.clinic_communication_threads'::regclass
    and tgname='clinic_communication_threads_tiss_reference_guard_v1'
    and not tgisinternal;

  if v_helper_def is null or v_guard_def is null or v_trigger_count <> 1 then
    raise exception 'TEST_FAIL missing TISS reference guard objects';
  end if;
  if position('billing.xml.export' in v_helper_def)=0
     or position('cm.status=''active''' in v_helper_def)=0
     or position('v_effect=''deny''' in v_helper_def)=0 then
    raise exception 'TEST_FAIL TISS access helper contract';
  end if;
  if position('auth.uid()' in v_guard_def)=0
     or position('tiss_official_documents' in v_guard_def)=0
     or position('COMMUNICATION_REFERENCE_UNAVAILABLE' in v_guard_def)=0 then
    raise exception 'TEST_FAIL TISS write guard contract';
  end if;
  if position('clinic_billing_tiss_reference_access_v1' in v_list_def)=0
     or position('''RESTRICTED''' in v_list_def)=0
     or position('''UNAVAILABLE''' in v_list_def)=0
     or position('then p.reference_id' in v_list_def)=0 then
    raise exception 'TEST_FAIL TISS read projection contract';
  end if;

  if has_function_privilege('anon','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE')
     or has_function_privilege('service_role','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.guard_clinic_communication_tiss_reference_v1()','EXECUTE')
     or has_function_privilege('service_role','private.guard_clinic_communication_tiss_reference_v1()','EXECUTE') then
    raise exception 'TEST_FAIL private TISS guard grant';
  end if;
end
$test$;

-- Synthetic clinic with a TISS-capable biller and a communication-only receptionist.
insert into auth.users (id,email) values
 ('25912000-0000-4000-8000-000000000001','issue259-tiss-biller@test.invalid'),
 ('25912000-0000-4000-8000-000000000002','issue259-tiss-reception@test.invalid')
on conflict (id) do nothing;

insert into public.users (id,email,name,role) values
 ('25912000-0000-4000-8000-000000000001','issue259-tiss-biller@test.invalid','TISS Biller Test #259','biller'),
 ('25912000-0000-4000-8000-000000000002','issue259-tiss-reception@test.invalid','TISS Reception Test #259','receptionist')
on conflict (id) do update set email=excluded.email,name=excluded.name,role=excluded.role;

insert into public.school_organizations (id,name)
values ('25922000-0000-4000-8000-000000000001','School Org TISS Guard #259');

insert into public.clinics (id,name,school_organization_id,is_demo,demo_source,demo_status,demo_kind)
values ('25902000-0000-4000-8000-000000000001','Clinic TISS Guard #259','25922000-0000-4000-8000-000000000001',true,'template','active','playground');

insert into public.clinic_memberships (id,user_id,clinic_id,role,status) values
 ('25932000-0000-4000-8000-000000000001','25912000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001','biller','active'),
 ('25932000-0000-4000-8000-000000000002','25912000-0000-4000-8000-000000000002','25902000-0000-4000-8000-000000000001','receptionist','active');

insert into public.clinic_membership_permission_overrides (
  membership_id,permission_key,effect,granted_by,reason
) values (
  '25932000-0000-4000-8000-000000000002',
  'communication.billing_updates.view',
  'allow',
  '25912000-0000-4000-8000-000000000001',
  'synthetic #259 test'
);

insert into public.clinic_payers (id,organization_id,name,payer_type,status,created_by)
values (
  '25962000-0000-4000-8000-000000000001',
  '25902000-0000-4000-8000-000000000001',
  'Synthetic payer #259','PRIVATE','ACTIVE',
  '25912000-0000-4000-8000-000000000001'
);

insert into public.tiss_official_documents (
  id,organization_id,clinic_id,payer_id,competence_month,
  communication_version,content_structure_version,tuss_version,
  schema_root_file,schema_manifest_checksum,batch_number,
  xml_content,xml_hash,generated_from_pre_guide_ids,idempotency_key,
  guide_count,total_amount_cents,generated_by
) values (
  '25952000-0000-4000-8000-000000000001',
  '25902000-0000-4000-8000-000000000001',
  '25902000-0000-4000-8000-000000000001',
  '25962000-0000-4000-8000-000000000001',
  '2026-09-01','4.01.00','synthetic-v1',null,
  'synthetic.xsd','synthetic-checksum','SYN259001',
  '<synthetic/>','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  array['25972000-0000-4000-8000-000000000001'::uuid],
  'issue259-tiss-doc-test-0001',1,100,
  '25912000-0000-4000-8000-000000000001'
);

-- A TISS-capable authenticated biller may persist a same-clinic valid reference.
select set_config('request.jwt.claim.sub','25912000-0000-4000-8000-000000000001',true);
insert into public.clinic_communication_threads (
  id,clinic_id,subject,status,reference_type,reference_id,created_by,
  last_sequence,last_activity_at,created_at,updated_at
) values (
  '25942000-0000-4000-8000-000000000001',
  '25902000-0000-4000-8000-000000000001',
  'Synthetic TISS valid','open','TISS_OFFICIAL_LOT',
  '25952000-0000-4000-8000-000000000001',
  '25912000-0000-4000-8000-000000000001',
  0,clock_timestamp(),clock_timestamp(),clock_timestamp()
);

-- Missing/synthetic foreign TISS references fail closed at the write boundary.
do $test$
begin
  begin
    insert into public.clinic_communication_threads (
      id,clinic_id,subject,status,reference_type,reference_id,created_by,
      last_sequence,last_activity_at,created_at,updated_at
    ) values (
      '25942000-0000-4000-8000-000000000002',
      '25902000-0000-4000-8000-000000000001',
      'Synthetic TISS invalid','open','TISS_OFFICIAL_LOT',
      '25952000-0000-4000-8000-000000000099',
      '25912000-0000-4000-8000-000000000001',
      0,clock_timestamp(),clock_timestamp(),clock_timestamp()
    );
    raise exception 'TEST_FAIL invalid TISS reference accepted';
  exception when sqlstate '42501' then null;
  end;
end
$test$;

-- Communication view does not leak TISS authority or opaque reference IDs.
select set_config('request.jwt.claim.sub','25912000-0000-4000-8000-000000000002',true);
do $test$
declare
  v_result jsonb;
  v_item jsonb;
begin
  v_result := public.list_clinic_communication_threads_v1(
    '25902000-0000-4000-8000-000000000001',30,null,null
  );
  v_item := v_result->'items'->0;
  if v_item->>'referenceState' <> 'RESTRICTED' then
    raise exception 'TEST_FAIL restricted reference state %',v_item;
  end if;
  if v_item->'referenceId' <> 'null'::jsonb then
    raise exception 'TEST_FAIL restricted reference leaked id';
  end if;
end
$test$;

-- A biller with TISS authority sees the same valid opaque reference as AVAILABLE.
select set_config('request.jwt.claim.sub','25912000-0000-4000-8000-000000000001',true);
do $test$
declare
  v_result jsonb;
  v_item jsonb;
begin
  v_result := public.list_clinic_communication_threads_v1(
    '25902000-0000-4000-8000-000000000001',30,null,null
  );
  v_item := v_result->'items'->0;
  if v_item->>'referenceState' <> 'AVAILABLE' then
    raise exception 'TEST_FAIL available reference state %',v_item;
  end if;
  if v_item->>'referenceId' <> '25952000-0000-4000-8000-000000000001' then
    raise exception 'TEST_FAIL available reference id missing';
  end if;
end
$test$;

rollback;