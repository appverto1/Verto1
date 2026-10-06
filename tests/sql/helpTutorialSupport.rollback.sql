-- Run only in staging. Fixtures are synthetic; every inserted row is rolled back.
begin;
do $$
declare
  u1 uuid=gen_random_uuid(); u2 uuid=gen_random_uuid();
  c1 uuid=gen_random_uuid(); c2 uuid=gen_random_uuid();
  m1 uuid=gen_random_uuid(); m2 uuid=gen_random_uuid(); m3 uuid=gen_random_uuid();
  org uuid; first_completion jsonb; second_completion jsonb;
begin
  select id into org from public.school_organizations limit 1;
  if org is null then raise exception 'No staging fixture organization'; end if;
  insert into auth.users(id,email) values(u1,u1::text||'@tutorial.example.invalid'),(u2,u2::text||'@tutorial.example.invalid');
  insert into public.users(id,email,role) values(u1,u1::text||'@tutorial.example.invalid','director'),(u2,u2::text||'@tutorial.example.invalid','director');
  insert into public.clinics(id,name,school_organization_id) values(c1,'Tutorial rollback fixture A',org),(c2,'Tutorial rollback fixture B',org);
  insert into public.clinic_memberships(id,user_id,clinic_id,role,status)
    values(m1,u1,c1,'director','active'),(m2,u2,c1,'director','active'),(m3,u1,c2,'director','active');
  assert public.get_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef')->>'completedAt' is null;
  first_completion=public.set_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef',true);
  assert first_completion->>'completedAt' is not null;
  second_completion=public.set_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef',true);
  assert first_completion=second_completion, 'idempotent completion preserves first timestamp';
  assert (select count(*) from public.help_tutorial_progress where user_id=u1 and clinic_id=c1)=1;
  assert public.get_help_tutorial_completion(u2,c1,m2,'director','agenda-confirmar','0123456789abcdef')->>'completedAt' is null, 'other user';
  assert public.get_help_tutorial_completion(u1,c2,m3,'director','agenda-confirmar','0123456789abcdef')->>'completedAt' is null, 'other clinic';
  assert public.get_help_tutorial_completion(u1,c1,m1,'director','agenda-remarcar','0123456789abcdef')->>'completedAt' is null, 'other topic';
  assert public.get_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','fedcba9876543210')->>'completedAt' is null, 'other revision';
  begin
    perform public.set_help_tutorial_completion(u2,c1,m1,'director','agenda-confirmar','0123456789abcdef',true);
    raise exception 'forged actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_help_tutorial_completion(u1,c2,m1,'director','agenda-confirmar','0123456789abcdef');
    raise exception 'forged clinic accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_help_tutorial_completion(u1,c1,m1,'receptionist','agenda-confirmar','0123456789abcdef');
    raise exception 'stale role accepted';
  exception when insufficient_privilege then null; end;
  perform public.set_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef',false);
  assert public.get_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef')->>'completedAt' is null;
  update public.clinic_memberships set status='inactive' where id=m1;
  begin
    perform public.get_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef');
    raise exception 'revoked membership accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_help_tutorial_completion(u1,c1,m1,'director','agenda-confirmar','0123456789abcdef',true);
    raise exception 'revoked membership write accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
select 'PASS: atomic topic completion; actor, tenant, revision, role and revoked membership isolation; fixtures rolled back' as result;
