-- #256 focused data-contract test for professional invitation membership authority.
do $test$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invitations' and column_name='expires_at'
  ) then raise exception 'missing invitations.expires_at'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invitations' and column_name='accepted_user_id'
  ) then raise exception 'missing invitations.accepted_user_id'; end if;

  if has_function_privilege('anon','public.accept_clinic_invitation_v1(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.accept_clinic_invitation_v1(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('service_role','public.accept_clinic_invitation_v1(uuid,uuid,text)','EXECUTE')
  then raise exception 'accept RPC grants invalid'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.clinic_memberships'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) ilike '%user_id%'
      and pg_get_constraintdef(oid) ilike '%clinic_id%'
  ) then raise exception 'membership user+clinic uniqueness missing'; end if;

  select lower(pg_get_functiondef('public.accept_clinic_invitation_v1(uuid,uuid,text)'::regprocedure)) into v_def;
  if position('for update' in v_def)=0
     or position('on conflict' in v_def)=0
     or position('clinic_invitation_expired' in v_def)=0
     or position('identity_email_mismatch' in v_def)=0
  then raise exception 'accept RPC atomic/security guards missing'; end if;
end
$test$;
