-- #256 DATA gate after invitation authority hardening.
-- Metadata/security assertions only; no persistent fixture.

begin;

do $authority_assertions$
declare
  v_def text;
begin
  if not has_table_privilege('authenticated', 'public.invitations', 'SELECT') then
    raise exception 'EXPECTED_AUTHENTICATED_SELECT';
  end if;

  if has_table_privilege('authenticated', 'public.invitations', 'INSERT')
     or has_table_privilege('authenticated', 'public.invitations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.invitations', 'DELETE')
     or has_table_privilege('authenticated', 'public.invitations', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.invitations', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.invitations', 'TRIGGER') then
    raise exception 'AUTHENTICATED_INVITATION_DML_STILL_PRESENT';
  end if;

  if not has_table_privilege('anon', 'public.invitations', 'SELECT') then
    raise exception 'EXPECTED_ANON_SELECT';
  end if;

  if has_table_privilege('anon', 'public.invitations', 'INSERT')
     or has_table_privilege('anon', 'public.invitations', 'UPDATE')
     or has_table_privilege('anon', 'public.invitations', 'DELETE')
     or has_table_privilege('anon', 'public.invitations', 'TRUNCATE')
     or has_table_privilege('anon', 'public.invitations', 'REFERENCES')
     or has_table_privilege('anon', 'public.invitations', 'TRIGGER') then
    raise exception 'ANON_INVITATION_DML_STILL_PRESENT';
  end if;

  if exists (
    select 1
    from pg_policy
    where polrelid = 'public.invitations'::regclass
      and polname = 'invitations_write_for_manager'
  ) then
    raise exception 'CLIENT_WRITE_POLICY_STILL_PRESENT';
  end if;

  if not has_table_privilege('service_role', 'public.invitations', 'INSERT')
     or not has_table_privilege('service_role', 'public.invitations', 'UPDATE')
     or not has_table_privilege('service_role', 'public.invitations', 'DELETE') then
    raise exception 'SERVICE_ROLE_INVITATION_DML_MISSING';
  end if;

  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.invitations'::regclass
      and attname = 'created_at'
      and not attnotnull
  ) then
    raise exception 'INVITATION_CREATED_AT_STILL_NULLABLE';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.accept_clinic_invitation_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'AUTHENTICATED_CAN_EXECUTE_ACCEPT_RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.accept_clinic_invitation_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'ANON_CAN_EXECUTE_ACCEPT_RPC';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.accept_clinic_invitation_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'SERVICE_ROLE_CANNOT_EXECUTE_ACCEPT_RPC';
  end if;

  select lower(pg_get_functiondef('public.accept_clinic_invitation_v1(uuid,uuid,text)'::regprocedure))
    into v_def;

  if position('security definer' in v_def) = 0
     or position('for update' in v_def) = 0
     or position('on conflict' in v_def) = 0
     or position('accepted_user_id' in v_def) = 0
     or position('clinic_invitation_expired' in v_def) = 0 then
    raise exception 'ACCEPT_RPC_ATOMIC_SECURITY_GUARDS_MISSING';
  end if;
end
$authority_assertions$;

rollback;
