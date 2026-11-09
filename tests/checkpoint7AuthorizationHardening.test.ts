import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const migration = fs.readFileSync('supabase/migrations/20260811230000_authorization_override_rpc_v1.sql', 'utf8');

const mustUseCapability = [
  ['/api/clinic/members', 'team.view'],
  ['/api/clinic/invite', 'team.invite'],
  ['/api/patient-finance/ledger', 'finance.payments.view'],
  ['/api/payments', 'finance.payments.view'],
  ['/api/financial/entries', 'finance.entries.view'],
  ['/api/financial/professional-payments', 'finance.entries.view'],
  ['/api/clinic/rooms', 'clinic.rooms.manage'],
] as const;

for (const [route, capability] of mustUseCapability) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedCapability = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const routeRegex = new RegExp(`${escapedRoute.replace('\\/api\\/rooms', '\\/api\\/rooms')}[^\\n]{0,260}require(?:Any)?ClinicCapability\\([^\\n]*${escapedCapability}`);
  assert.match(server, routeRegex, `${route} deve ser protegido por ${capability}`);
}

assert.match(server, /app\.get\('\/api\/clinic\/members\/:memberId\/authorization'[\s\S]{0,220}requireClinicCapability\('team\.permissions\.manage'\)/);
assert.match(server, /app\.patch\('\/api\/clinic\/members\/:memberId\/authorization'[\s\S]{0,260}requireClinicCapability\('team\.permissions\.manage'\)/);
assert.match(server, /canDelegateClinicCapability\(\{/);
assert.match(server, /SELF_PERMISSION_CHANGE_DENIED/);
assert.match(server, /CLINIC_PERMISSION_NOT_DELEGABLE/);

assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = pg_catalog, public/i);
assert.match(migration, /from public\.clinic_memberships[\s\S]*for update/i);
assert.match(migration, /insert into public\.authorization_audit_events/i);
assert.match(migration, /revoke all on function[\s\S]*from authenticated/i);
assert.match(migration, /grant execute on function[\s\S]*to service_role/i);

const clinicRoleGateCount = (server.match(/requireRoles\('(?:director|coordinator|supervisor|therapist|receptionist|biller)/g) || []).length;
assert.ok(clinicRoleGateCount <= 22, `restaram ${clinicRoleGateCount} gates clínicos legados; revisar regressão`);

console.log('checkpoint7AuthorizationHardening.test.ts: ok');
