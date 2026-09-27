-- Security-boundary regression coverage for #259 clinic billing communication v1.
-- Synthetic fixtures only; all writes are rolled back.
begin;

insert into auth.users (id,email) values
 ('25913000-0000-4000-8000-000000000001','issue259-final-biller@test.invalid'),
 ('25913000-0000-4000-8000-000000000002','issue259-final-therapist@test.invalid')
on conflict (id) do nothing;

insert into public.users (id,email,name,role) values
 ('25913000-0000-4000-8000-000000000001','issue259-final-biller@test.invalid','Final Biller #259','biller'),
 ('25913000-0000-4000-8000-000000000002','issue259-final-therapist@test.invalid','Final Therapist #259','therapist')
on conflict (id) do update set email=excluded.email,name=excluded.name,role=excluded.role;

insert into public.school_organizations (id,name)
values ('25923000-0000-4000-8000-000000000001','School Org Final #259');

insert into public.clinics (id,name,school_organization_id,is_demo,demo_source,demo_status,demo_kind) values
 ('25903000-0000-4000-8000-000000000001','Final Clinic A #259','25923000-0000-4000-8000-000000000001',true,'template','active','playground'),
 ('25903000-0000-4000-8000-000000000002','Final Clinic B #259','25923000-0000-4000-8000-000000000001',true,'template','active','playground');

insert into public.clinic_memberships (id,user_id,clinic_id,role,status) values
 ('25933000-0000-4000-8000-000000000001','25913000-0000-4000-8000-000000000001','25903000-0000-4000-8000-000000000001','biller','active'),
 ('25933000-0000-4000-8000-000000000002','25913000-0000-4000-8000-000000000002','25903000-0000-4000-8000-000000000001','therapist','active');

insert into public.clinic_membership_permission_overrides (
  membership_id,permission_key,effect,granted_by,reason
) values (
  '25933000-0000-4000-8000-000000000002',
  'communication.billing_updates.view','allow',
  '25913000-0000-4000-8000-000000000001',
  'synthetic scope ceiling test'
);

-- Existing role-scope policy does not let a therapist escalate into clinic-wide communication.
do $test$
begin
  if private.clinic_billing_communication_capability_v1(
    '25913000-0000-4000-8000-000000000002',
    '25903000-0000-4000-8000-000000000001',
    'communication.billing_updates.view'
  ) then
    raise exception 'TEST_FAIL therapist gained clinic-wide communication via override';
  end if;
end
$test$;

select set_config('request.jwt.claim.sub','25913000-0000-4000-8000-000000000001',true);

-- Browser-supplied clinic is only a requested resource: authority remains server-owned.
do $test$
begin
  begin
    perform public.create_clinic_communication_thread_v1(
      '25903000-0000-4000-8000-000000000002',
      'Cross clinic denied','Body',array[]::uuid[],null,null,
      'issue259-final-cross-clinic'
    );
    raise exception 'TEST_FAIL cross-clinic create allowed';
  exception when sqlstate '42501' then null;
  end;
end
$test$;

-- Plain-text and bounded input contract fails closed.
do $test$
begin
  begin
    perform public.create_clinic_communication_thread_v1(
      '25903000-0000-4000-8000-000000000001',
      'Markup denied','<script>alert(1)</script>',array[]::uuid[],null,null,
      'issue259-final-markup'
    );
    raise exception 'TEST_FAIL markup allowed';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.create_clinic_communication_thread_v1(
      '25903000-0000-4000-8000-000000000001',
      repeat('S',121),'Body',array[]::uuid[],null,null,
      'issue259-final-subject-long'
    );
    raise exception 'TEST_FAIL oversize subject allowed';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.create_clinic_communication_thread_v1(
      '25903000-0000-4000-8000-000000000001',
      'Body long',repeat('B',2001),array[]::uuid[],null,null,
      'issue259-final-body-long'
    );
    raise exception 'TEST_FAIL oversize body allowed';
  exception when sqlstate '22023' then null;
  end;
end
$test$;

select public.create_clinic_communication_thread_v1(
  '25903000-0000-4000-8000-000000000001',
  'Revocation test','Body',array[]::uuid[],null,null,
  'issue259-final-revoke-create'
);

create temp table issue259_final_thread on commit drop as
select thread_id
from public.clinic_communication_messages
where idempotency_key='issue259-final-revoke-create';

update public.clinic_memberships
set status='inactive',updated_at=clock_timestamp()
where id='25933000-0000-4000-8000-000000000001';

-- Active membership is revalidated on list/read/send/read-cursor operations.
do $test$
declare
  v_thread uuid;
begin
  select thread_id into v_thread from issue259_final_thread;

  begin
    perform public.list_clinic_communication_threads_v1(
      '25903000-0000-4000-8000-000000000001',30,null,null
    );
    raise exception 'TEST_FAIL revoked list allowed';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.list_clinic_communication_messages_v1(v_thread,50,null);
    raise exception 'TEST_FAIL revoked read allowed';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.send_clinic_communication_message_v1(
      v_thread,'After revoke',array[]::uuid[],'issue259-final-revoke-send'
    );
    raise exception 'TEST_FAIL revoked send allowed';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.mark_clinic_communication_read_v1(v_thread,1);
    raise exception 'TEST_FAIL revoked read cursor allowed';
  exception when sqlstate '42501' then null;
  end;
end
$test$;

rollback;