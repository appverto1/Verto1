import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260814143000_module_entitlement_runtime_recovery.sql', 'utf8');

assert.match(
  dashboard,
  /useState<Set<string>>\(new Set\(\)\)/,
  'clinic capabilities must start empty until the canonical authorization context is hydrated',
);
assert.match(
  dashboard,
  /useState<OrganizationModuleAccessMode>\("contract"\)/,
  'module visibility must fail closed before authorization hydration',
);
assert.match(
  dashboard,
  /setEffectiveCapabilities\(new Set\(\)\)[\s\S]*?setModuleAccessMode\("contract"\)/,
  'workspace changes must clear optimistic permissions before re-hydration',
);
assert.doesNotMatch(
  dashboard,
  /setEffectiveCapabilities\(baseCapabilities\)/,
  'role defaults must never be exposed while canonical authorization is unavailable',
);
assert.match(
  dashboard,
  /!workspaceId \|\| !authorizationHydrated \|\| !hasCapability\("team\.view"\)/,
  'team members must not be prefetched before authorization is known',
);
assert.match(
  dashboard,
  /authorizationHydrated && hasCapability\("clinical\.anamnesis\.view"\)/,
  'anamnesis templates must not load before authorization is known',
);

assert.match(server, /function isClinicModuleAccessProfileError\(error: any\)/);
assert.match(server, /error: 'CLINIC_MODULE_ACCESS_PROFILE_MISSING'/);
assert.match(
  server,
  /app\.get\('\/api\/clinic\/authorization\/me'[\s\S]*?isClinicModuleAccessProfileError\(error\)[\s\S]*?res\.status\(503\)/,
  'authorization context should expose an explicit retryable infrastructure state instead of a generic 500',
);

assert.match(migration, /ORGANIZATION_MODULE_ENTITLEMENTS_BASE_MIGRATION_REQUIRED/);
assert.match(migration, /pending_modular_contracts/);
assert.match(migration, /o\.offer_type = 'modular'/);
assert.match(migration, /o\.status = 'paid'/);
assert.match(migration, /pa\.used = false/);
assert.match(migration, /u\.id = u\.clinic_id/);
assert.match(
  migration,
  /update public\.organization_module_access_profiles p[\s\S]*?mode = 'contract'/,
  'interrupted paid modular activations must fail closed until exact entitlements are replayed',
);
assert.match(
  migration,
  /case when pending\.organization_id is not null then 'contract' else 'legacy_full' end/,
  'missing profiles must preserve legacy clinics while failing closed for paid modular clinics',
);
assert.match(migration, /on conflict \(organization_id\) do nothing/);
assert.match(migration, /clinics_initialize_module_access_profile_v1/);
assert.doesNotMatch(migration, /delete\s+from/i, 'runtime recovery must not delete business data');
assert.doesNotMatch(migration, /truncate\s+/i, 'runtime recovery must never truncate business data');
assert.doesNotMatch(
  migration,
  /insert\s+into\s+public\.organization_module_entitlements\b/i,
  'recovery must not fabricate module entitlements without Stripe-backed activation replay',
);

console.log('moduleEntitlementRuntimeRecovery.test.mjs: ok');
