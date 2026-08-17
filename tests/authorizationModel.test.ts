import assert from 'node:assert/strict';
import {
  CAPABILITY_CATALOG,
  CANONICAL_CLINIC_BASE_ROLES,
  CLINIC_BASE_ROLES,
  ROLE_DEFAULT_SCOPES,
  isDelegableCapability,
  roleHasDefaultCapability,
} from '../src/constants/authorizationModel';

assert.deepEqual(CLINIC_BASE_ROLES, [
  'director',
  'coordinator',
  'therapist',
  'receptionist',
  'biller',
  'supervisor',
]);
assert.deepEqual(CANONICAL_CLINIC_BASE_ROLES, [
  'director',
  'coordinator',
  'therapist',
  'receptionist',
  'biller',
]);

const keys = CAPABILITY_CATALOG.map((item) => item.key);
assert.equal(new Set(keys).size, keys.length, 'capability keys devem ser únicas');

assert.equal(roleHasDefaultCapability('director', 'workspace.switch'), true);
assert.equal(roleHasDefaultCapability('director', 'workspace.multiclinic.analytics'), true);
assert.equal(roleHasDefaultCapability('coordinator', 'workspace.multiclinic.analytics'), false);
assert.equal(roleHasDefaultCapability('director', 'team.invite'), true);
assert.equal(roleHasDefaultCapability('coordinator', 'team.invite'), true);

assert.equal(roleHasDefaultCapability('therapist', 'clinical.record.view'), true);
assert.equal(roleHasDefaultCapability('therapist', 'patient.create'), false);

assert.equal(roleHasDefaultCapability('supervisor', 'treatment_plan.approve'), true);
assert.equal(roleHasDefaultCapability('supervisor', 'finance.entries.manage'), false);

assert.equal(roleHasDefaultCapability('receptionist', 'finance.payments.receive'), true);
assert.equal(roleHasDefaultCapability('receptionist', 'clinical.record.view'), false);
assert.equal(roleHasDefaultCapability('receptionist', 'school.manage'), false);
assert.equal(roleHasDefaultCapability('receptionist', 'patient.insurance.authorization.edit'), false);
assert.equal(isDelegableCapability('team.invite'), false);
assert.equal(isDelegableCapability('billing.xml.generate'), true);

assert.equal(roleHasDefaultCapability('biller', 'billing.xml.generate'), true);
assert.equal(roleHasDefaultCapability('biller', 'clinical.record.view'), false);
assert.deepEqual(ROLE_DEFAULT_SCOPES.biller, ['AUTHORIZED_CLINICS', 'BILLING_SCOPE']);

assert.equal(roleHasDefaultCapability('patient', 'portal.view'), true);
assert.equal(roleHasDefaultCapability('patient', 'billing.xml.generate'), false);

console.log('authorizationModel.test.ts: ok');
