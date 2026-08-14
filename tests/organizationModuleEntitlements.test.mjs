import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260813130000_organization_module_entitlements.sql', 'utf8');
const modules = fs.readFileSync('src/constants/organizationModules.ts', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const portal = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const stripeEnvironment = fs.readFileSync('services/stripeEnvironment.ts', 'utf8');

for (const moduleKey of [
  'clinical_core',
  'appointments_communication',
  'financial_management',
  'insurance_tiss',
  'school_management',
]) {
  assert.match(modules, new RegExp(`['\"]${moduleKey}['\"]`), `registry deve conter ${moduleKey}`);
  assert.match(migration, new RegExp(`'${moduleKey}'`), `migration deve restringir ${moduleKey}`);
}

for (const nonRuntimeItem of ['platform_foundation', 'additional_storage', 'onboarding']) {
  assert.doesNotMatch(
    modules.match(/ORGANIZATION_MODULE_KEYS[\s\S]*?as const;/)?.[0] || '',
    new RegExp(nonRuntimeItem),
    `${nonRuntimeItem} não pode virar módulo operacional`,
  );
}

assert.match(migration, /create table if not exists public\.organization_module_access_profiles/);
assert.match(migration, /create table if not exists public\.organization_module_entitlements/);
assert.match(migration, /create table if not exists public\.organization_module_entitlement_events/);
assert.match(migration, /unique \(organization_id, module_key\)/);
assert.match(migration, /unique \(idempotency_key\)/);
assert.match(migration, /alter table public\.organization_module_access_profiles enable row level security/);
assert.match(migration, /alter table public\.organization_module_entitlements enable row level security/);
assert.match(migration, /alter table public\.organization_module_entitlement_events enable row level security/);
assert.match(migration, /revoke all on table public\.organization_module_entitlements from anon, authenticated/);
assert.match(migration, /grant all on table public\.organization_module_entitlements to service_role/);
assert.match(migration, /organization_module_entitlement_events_append_only_v1/);
assert.match(migration, /select c\.id, 'legacy_full', 1, now\(\)[\s\S]*?from public\.clinics c[\s\S]*?on conflict \(organization_id\) do nothing/);

const provisioningRpc = migration.match(
  /create or replace function public\.apply_sales_offer_module_entitlements_v1[\s\S]*?\$function\$;/,
)?.[0] || '';
assert.match(provisioningRpc, /security definer/);
assert.match(provisioningRpc, /auth\.role\(\) <> 'service_role'/);
assert.match(provisioningRpc, /from public\.sales_offer_items/);
assert.match(provisioningRpc, /lead_row\.converted_clinic_id is distinct from p_organization_id/);
assert.match(provisioningRpc, /MODULE_ENTITLEMENT_SUBSCRIPTION_TENANT_MISMATCH/);
assert.match(provisioningRpc, /on conflict \(organization_id, module_key\) do update/);
assert.match(provisioningRpc, /on conflict \(idempotency_key\) do nothing/);
assert.match(provisioningRpc, /set version = version \+ 1/);
assert.doesNotMatch(provisioningRpc, /delete\s+from/i, 'downgrade não deve apagar dados');
assert.doesNotMatch(provisioningRpc, /for\s+\w+\s+in\s+select/i, 'provisionamento deve ser set-based');

const readRpc = migration.match(
  /create or replace function public\.get_organization_module_access_v1[\s\S]*?\$function\$;/,
)?.[0] || '';
assert.match(readRpc, /security definer/);
assert.match(readRpc, /jsonb_agg\(e\.module_key order by e\.module_key\)/);
assert.match(readRpc, /e\.status in \('active','trial','grace'\)/);
assert.match(migration, /grant execute on function public\.get_organization_module_access_v1\(uuid\) to service_role/);
assert.match(server, /supabase\.rpc\('get_organization_module_access_v1'/);
assert.match(server, /filterCapabilitiesByOrganizationModules/);
assert.match(server, /function requireClinicModule\(moduleKey: OrganizationModuleKey\)/);
assert.match(server, /CLINIC_MODULE_NOT_ENTITLED/);
assert.match(server, /requireClinicModule\('insurance_tiss'\)/);
assert.match(server, /requirePatientPortalModule\('appointments_communication'\)/);
assert.match(server, /requirePatientPortalModule\('clinical_core'\)/);
assert.match(server, /moduleAccessMode/);
assert.match(server, /entitlementVersion/);
assert.match(server, /apply_sales_offer_module_entitlements_v2/);
assert.match(server, /Retry an interrupted paid modular activation on a later login/);

assert.match(migration, /trial_days integer not null default 0/);
assert.match(migration, /check \(trial_days in \(0, 7, 14, 30\)\)/);
assert.match(server, /trial_period_days/);
assert.match(server, /payment_method_collection: "always"/);
assert.match(server, /MODULAR_OFFER_ACCEPTANCE_REQUIRED/);
assert.match(server, /createOrReuseModularCheckout/);
assert.match(server, /moduleSetHash/);
assert.match(server, /MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH/);
assert.doesNotMatch(server, /\.eq\(["']environment["'],\s*["']test["']\)/);
assert.doesNotMatch(server, /environment:\s*["']test["']/);
assert.match(stripeEnvironment, /STRIPE_ENVIRONMENT/);
assert.match(stripeEnvironment, /sk_test_/);
assert.match(stripeEnvironment, /rk_test_/);
assert.match(stripeEnvironment, /sk_live_/);
assert.match(stripeEnvironment, /rk_live_/);
assert.doesNotMatch(stripeEnvironment, /NODE_ENV/);

assert.match(coordinator, /requiredModule/);
assert.match(coordinator, /insurance_tiss/);
assert.match(coordinator, /financial_management/);
assert.match(portal, /clinicalPortalEnabled/);
assert.match(portal, /appointmentsPortalEnabled/);
assert.match(portal, /portalSection === 'home' && clinicalPortalEnabled/);
assert.match(app, /moduleAccessMode/);
assert.match(app, /entitlementVersion/);

console.log('organizationModuleEntitlements.test.mjs: ok');
