import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { buildHelpContext } from '../services/helpContext';

const clinic1 = '11111111-1111-4111-8111-111111111111';
const clinic2 = '22222222-2222-4222-8222-222222222222';

const actor = {
  session: { user: { id: 'user-1', role: 'receptionist', clinicName: 'Clínica fallback' } },
  authorizationContext: {
    userId: 'user-1', membershipId: 'membership-1', role: 'professional',
    clinicId: clinic1, clinicName: 'Clínica autorizada',
    capabilities: new Set(['patient.view', 'patient.list']),
    modules: new Set(['clinical', 'scheduling'])
  }
};

test('identical context projection preserves role, clinic and stable SHA-256 fingerprint', () => {
  const actual = buildHelpContext(actor, () => clinic1);
  const expectedHash = createHash('sha256').update(JSON.stringify([
    'user-1', clinic1, 'membership-1', 'professional',
    ['patient.list', 'patient.view'], ['clinical', 'scheduling']
  ])).digest('hex');
  assert.equal(actual.contextKey, expectedHash);
  assert.equal(actual.clinicId, clinic1);
  assert.equal(actual.clinicName, 'Clínica autorizada');
  assert.equal(actual.audience, 'professional');
  assert.equal(actual.userId, 'user-1');
  assert.equal(actual.membershipId, 'membership-1');
  assert.deepEqual(actual.capabilities.sort(), ['patient.list', 'patient.view']);
});

test('different verified clinic, role, membership, or capability has a different context key', () => {
  const base = buildHelpContext(actor, () => clinic1).contextKey;
  assert.notEqual(buildHelpContext(actor, () => clinic2).contextKey, base);
  assert.notEqual(buildHelpContext({ ...actor, authorizationContext: { ...actor.authorizationContext, role: 'director' } }, () => clinic1).contextKey, base);
  assert.notEqual(buildHelpContext({ ...actor, authorizationContext: { ...actor.authorizationContext, membershipId: 'membership-2' } }, () => clinic1).contextKey, base);
  assert.notEqual(buildHelpContext({ ...actor, authorizationContext: { ...actor.authorizationContext, capabilities: new Set(['patient.list']) } }, () => clinic1).contextKey, base);
});

test('set ordering, empty values and session fallback retain existing semantics', () => {
  const switched = { ...actor, authorizationContext: { ...actor.authorizationContext,
    capabilities: new Set(['patient.list','patient.view']), modules: new Set(['scheduling','clinical']) } };
  assert.equal(buildHelpContext(switched, () => clinic1).contextKey, buildHelpContext(actor, () => clinic1).contextKey);
  const fallback = buildHelpContext({ session: actor.session }, () => clinic1);
  assert.equal(fallback.audience, 'receptionist');
  assert.equal(fallback.clinicName, 'Clínica fallback');
  assert.deepEqual(fallback.capabilities, []);
  assert.deepEqual(fallback.modules, []);
  assert.equal(fallback.membershipId, '');
  assert.equal(buildHelpContext({ session: null }, () => null).clinicId, null);
});

test('extraction retains auth middleware, patient denial and no DB/network access in the helper', () => {
  const routes = readFileSync('services/helpCenterRoutes.ts', 'utf8');
  const moduleText = readFileSync('services/helpContext.ts', 'utf8');
  assert.match(routes, /const helpContext = \(req:any\) => buildHelpContext\(req, currentClinicId\)/);
  assert.match(routes, /const requireActiveHelpMembership=/);
  assert.match(routes, /isClinicBaseRole\(help\.audience\)/);
  assert.match(routes, /requireClinicMembershipContext/);
  assert.match(routes, /registerSalesProspectingRoutes\(app, \{ supabase, checkAuth \}\)/);
  assert.doesNotMatch(moduleText, /\bsupabase\b|\bfetch\s*\(|\.from\s*\(|\.insert\s*\(|\.update\s*\(/);
});
