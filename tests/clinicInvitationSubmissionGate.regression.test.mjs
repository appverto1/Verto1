import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClinicInvitationSubmissionGate } from '../src/utils/clinicInvitationSubmissionGate.mjs';

const gate = createClinicInvitationSubmissionGate();
const first = gate.begin('clinic-a');
assert.ok(first);
assert.equal(gate.hasPending(), true);
assert.equal(gate.begin('clinic-a'), null, 'rapid double submit must not start a second request');
assert.equal(gate.isCurrent(first, 'clinic-a'), true);
assert.equal(gate.isCurrent(first, 'clinic-b'), false, 'late response must not appear in another clinic');
gate.reset();
assert.equal(gate.hasPending(), false);
const second = gate.begin('clinic-b');
assert.ok(second);
assert.equal(gate.isCurrent(first, 'clinic-a'), false, 'stale request must remain invalid even after clinic switch');
assert.equal(gate.end(first), false, 'old finally must not release the new clinic request');
assert.equal(gate.isCurrent(second, 'clinic-b'), true);
assert.equal(gate.end(second), true);
assert.equal(gate.hasPending(), false);
assert.equal(gate.end(second), false);
const third = gate.begin('clinic-a');
assert.ok(third);
gate.reset();
const fourth = gate.begin('clinic-a');
assert.ok(fourth);
assert.equal(gate.isCurrent(third, 'clinic-a'), false, 'A → B → A must not revive an earlier request');
assert.equal(gate.isCurrent(fourth, 'clinic-a'), true);

const team = readFileSync('src/components/TeamManagement.tsx', 'utf8');
const modal = readFileSync('src/components/InvitationModal.tsx', 'utf8');
for (const [name, source] of [['TeamManagement', team], ['InvitationModal', modal]]) {
  assert.match(source, /createClinicInvitationSubmissionGate\(\)/, `${name} must use the shared gate`);
  assert.match(source, /invitationGateRef\.current\.hasPending\(\)/, `${name} must block duplicate submissions`);
  assert.match(source, /invitationGateRef\.current\.begin\(activeTenantKey\)/, `${name} must bind each request to its clinic`);
  assert.match(source, /invitationGateRef\.current\.isCurrent\(request, activeTenantKeyRef\.current\)/, `${name} must ignore late cross-clinic responses`);
  assert.match(source, /invitationGateRef\.current\.end\(request\)/, `${name} must release only its own request`);
  assert.match(source, /invitationGateRef\.current\.reset\(\)/, `${name} must invalidate requests on tenant switch`);
  assert.match(source, /result\.success && \(result\.inAppInvitation === true \|\| result\.invitationEmailSent !== false\)/, `${name} must preserve email delivery confirmation`);
}
assert.match(team, /await fetchInvitations\(request\.tenantKey\)/, 'team refresh must be bound to the request clinic');
assert.match(modal, /setInvitations\(\(current\) => \[/, 'modal must append without stale state capture');

console.log('clinicInvitationSubmissionGate.regression.test.mjs: ok');
