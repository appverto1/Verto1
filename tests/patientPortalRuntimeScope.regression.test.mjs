import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const startServerIndex = server.indexOf('async function startServer()');
const guardIndex = server.indexOf('const requirePatientPortalModule =', startServerIndex);
const resolverIndex = server.indexOf('const resolvePatientPortalContext = async', startServerIndex);

assert.ok(startServerIndex >= 0, 'startServer must exist');
assert.ok(guardIndex > startServerIndex, 'patient portal module guard must be scoped inside startServer');
assert.ok(resolverIndex > startServerIndex, 'patient portal context resolver must be scoped inside startServer');
assert.equal(
  server.indexOf('const requirePatientPortalModule =', 0),
  guardIndex,
  'there must not be a top-level portal guard that cannot see the runtime resolver',
);
assert.match(
  server.slice(guardIndex, guardIndex + 2200),
  /resolvePatientPortalContext\(req\.session\?\.user\)/,
  'portal module guard must resolve patient context in the same runtime scope',
);

const milestoneStart = server.indexOf("app.post('/api/portal/milestone-celebration/consume'");
const milestoneEnd = server.indexOf('const readPortalAppointmentPatientScope', milestoneStart);
const milestoneRoute = server.slice(milestoneStart, milestoneEnd);
assert.match(milestoneRoute, /errorCode === 'PGRST202' \|\| errorCode === '42883'/);
assert.match(milestoneRoute, /available: false/);
assert.match(milestoneRoute, /celebrate: false/);
assert.doesNotMatch(milestoneRoute, /res\.status\(503\)/, 'optional milestone rollout must not return 503');

console.log('patientPortalRuntimeScope.regression.test.mjs: ok');
