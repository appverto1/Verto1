-- Regression contract for #259 TISS reference guard recovery.
-- No production data; structural assertions plus synthetic rollback fixture.
begin;

do $test$
declare
  v_helper_def text;
  v_list_def text;
begin
  select pg_get_functiondef('private.clinic_billing_tiss_reference_access_v1(uuid,uuid)'::regprocedure)
    into v_helper_def;
  select pg_get_functiondef('public.list_clinic_communication_threads_v1(uuid,integer,timestamptz,uuid)'::regprocedure)
    into v_list_def;

  if v_helper_def is null then raise exception 'TEST_FAIL missing TISS reference access helper'; end if;
  if position('cm.status=''active''' in v_helper_def)=0 then raise exception 'TEST_FAIL TISS helper active membership'; end if;
  if position('billing.xml.export' in v_helper_def)=0 then raise exception 'TEST_FAIL TISS helper capability'; end if;
  if position('v_effect=''deny''' in v_helper_def)=0 then raise exception 'TEST_FAIL TISS helper deny override'; end if;

  if has_function_privilege('anon','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE')
     or has_function_privilege('service_role','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE') then
    raise exception 'TEST_FAIL TISS helper browser/service grant';
  end if;

  if position('clinic_billing_tiss_reference_access_v1' in v_list_def)=0 then raise exception 'TEST_FAIL list threads missing TISS capability guard'; end if;
  if position('tiss_official_documents' in v_list_def)=0 then raise exception 'TEST_FAIL list threads missing same-clinic TISS resolution'; end if;
  if position('then p.reference_id' in v_list_def)=0 then raise exception 'TEST_FAIL list threads missing guarded reference id'; end if;
  if position('''RESTRICTED''' in v_list_def)=0 or position('''UNAVAILABLE''' in v_list_def)=0 then
    raise exception 'TEST_FAIL list threads missing restricted/unavailable states';
  end if;
end
$test$;

-- Synthetic unavailable reference: even a TISS-capable biller must not receive
-- the opaque reference id when the official document is absent.
insert into auth.users (id,email)
values ('25912000-0000-4000-8000-000000000001','issue259-tiss-guard@test.invalid')
on conflict (id) do nothing;
insert into public.users (id,email,name,role)
values ('25912000-0000-4000-8000-000000000001','issue259-tiss-guard@test.invalid','TISS Guard Test #259','biller')
on conflict (id) do update set email=excluded.email,name=excluded.name,role=excluded.role;
insert into public.school_organizations (id,name)
values ('25922000-0000-4000-8000-000000000001','School Org TISS Guard #259');
insert into public.clinics (id,name,school_organization_id,is_demo,demo_source,demo_status,demo_kind)
values ('25902000-0000-4000-8000-000000000001','Clinic TISS Guard #259','25922000-0000-4000-8000-000000000001',true,'template','active','playground');
insert into public.clinic_memberships (id,user_id,clinic_id,role,status)
values ('25932000-0000-4000-8000-000000000001','25912000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001','biller','active');
insert into public.clinic_communication_threads (
  id,clinic_id,subject,status,reference_type,reference_id,created_by,last_sequence,last_activity_at,created_at,updated_at
) values (
  '25942000-0000-4000-8000-000000000001','25902000-0000-4000-8000-000000000001','Synthetic TISS unavailable','open','TISS_OFFICIAL_LOT','25952000-0000-4000-8000-000000000001','25912000-0000-4000-8000-000000000001',0,clock_timestamp(),clock_timestamp(),clock_timestamp()
);
select set_config('request.jwt.claim.sub','25912000-0000-4000-8000-000000000001',true);

do $test$
declare
  v_result jsonb;
  v_item jsonb;
begin
  v_result := public.list_clinic_communication_threads_v1('25902000-0000-4000-8000-000000000001',30,null,null);
  v_item := v_result->'items'->0;
  if v_item->>'referenceState' <> 'UNAVAILABLE' then raise exception 'TEST_FAIL unavailable reference state'; end if;
  if v_item->'referenceId' <> 'null'::jsonb then raise exception 'TEST_FAIL unavailable reference leaked id'; end if;
end
$test$;

rollback;