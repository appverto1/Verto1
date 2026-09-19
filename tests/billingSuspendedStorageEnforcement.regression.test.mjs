import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const allowlist = section(
  server,
  'function isBillingOnboardingAllowedPath',
  'function isClinicInvitationAcceptancePath',
);

assert.ok(!allowlist.includes("path.startsWith('/api/storage/')"), 'suspended tenants must not bypass billing enforcement for protected storage routes');
assert.ok(allowlist.includes("path.startsWith('/api/stripe/')"), 'Stripe recovery routes must remain available');
assert.ok(allowlist.includes("path.startsWith('/api/billing/')"), 'billing recovery routes must remain available');
assert.ok(allowlist.includes("path === '/api/workspaces'"), 'workspace discovery must remain available');
assert.ok(allowlist.includes("path === '/api/workspaces/select'"), 'workspace switching must remain available');
assert.ok(allowlist.includes("path === '/api/access-contexts/select'"), 'access-context switching must remain available');
assert.ok(allowlist.includes("path === '/api/clinic/accept-invite'"), 'clinic reinvite hotfix route must remain available');
assert.ok(server.includes("app.get('/api/storage/patient-photos/view'"), 'protected patient photo route must still exist');