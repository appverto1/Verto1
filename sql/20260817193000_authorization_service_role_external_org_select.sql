-- Verto production hotfix — external organization authorization read permissions
-- Scope: restore server-side SELECT required by /api/auth/login external billing access resolution.
-- Idempotent; does not alter users, memberships, invitations, entitlements, patients, clinical data, or RLS policies.

begin;

grant select on table public.external_organization_users to service_role;
grant select on table public.external_organizations to service_role;
grant select on table public.external_organization_clinic_links to service_role;

commit;

select
  has_table_privilege(
    'service_role',
    'public.external_organization_users',
    'SELECT'
  ) as external_org_users_service_role_select_ready,
  has_table_privilege(
    'service_role',
    'public.external_organizations',
    'SELECT'
  ) as external_orgs_service_role_select_ready,
  has_table_privilege(
    'service_role',
    'public.external_organization_clinic_links',
    'SELECT'
  ) as external_org_clinic_links_service_role_select_ready;
