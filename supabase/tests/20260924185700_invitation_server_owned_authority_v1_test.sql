-- #256 DATA gate: invitation rows trusted by acceptance must not be browser-mutable.
-- Safe to run on staging after 20260924185600_invitation_server_owned_authority_v1.
-- Metadata-only assertions; no production data and no persistent fixture.

begin;

do $authority_assertions$
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
    'public.accept_clinic_invitation_v1(uuid,uuid,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'AUTHENTICATED_CAN_EXECUTE_ACCEPT_RPC';
  end if;

  if has_function_privilege(
    'anon',
    'public.accept_clinic_invitation_v1(uuid,uuid,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'ANON_CAN_EXECUTE_ACCEPT_RPC';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.accept_clinic_invitation_v1(uuid,uuid,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'SERVICE_ROLE_CANNOT_EXECUTE_ACCEPT_RPC';
  end if;
end
$authority_assertions$;

rollback;
