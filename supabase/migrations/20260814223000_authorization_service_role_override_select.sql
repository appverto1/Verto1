-- Verto production hotfix — clinic authorization override read permission
-- Scope: restore server-side SELECT required by /api/clinic/authorization/me.
-- Idempotent; does not alter memberships, entitlements, Stripe, proposals, patients, or clinical data.

begin;

grant select on table public.clinic_membership_permission_overrides to service_role;

commit;

select
  to_regclass('public.clinic_membership_permission_overrides') is not null
    as overrides_table_ready,
  has_table_privilege(
    'service_role',
    'public.clinic_membership_permission_overrides',
    'SELECT'
  ) as overrides_service_role_select_ready,
  to_regprocedure('public.get_organization_module_access_v1(uuid)') is not null
    as module_access_rpc_ready,
  has_function_privilege(
    'service_role',
    'public.get_organization_module_access_v1(uuid)',
    'EXECUTE'
  ) as module_access_rpc_service_role_ready;
