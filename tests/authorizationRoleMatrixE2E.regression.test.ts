import assert from 'node:assert/strict';
import {
  getDefaultScopesForRole,
  roleHasDefaultCapability,
} from '../src/constants/authorizationModel';
import {
  resolveEffectiveClinicCapabilities,
} from '../src/utils/authorizationRuntime';

const director = resolveEffectiveClinicCapabilities('director');
assert.ok(director);
assert.equal(director.capabilities.has('workspace.switch'), true);
assert.equal(director.capabilities.has('workspace.multiclinic.analytics'), true);
assert.equal(director.capabilities.has('team.permissions.manage'), true);
assert.equal(director.capabilities.has('clinical.anamnesis.edit'), true);
assert.deepEqual(getDefaultScopesForRole('director'), ['AUTHORIZED_CLINICS', 'ACTIVE_CLINIC']);

const coordinator = resolveEffectiveClinicCapabilities('coordinator');
assert.ok(coordinator);
assert.equal(coordinator.capabilities.has('workspace.multiclinic.analytics'), false);
assert.equal(coordinator.capabilities.has('team.permissions.manage'), true);
assert.equal(coordinator.capabilities.has('clinical.anamnesis.edit'), true);
assert.deepEqual(getDefaultScopesForRole('coordinator'), ['ACTIVE_CLINIC']);

const supervisor = resolveEffectiveClinicCapabilities('supervisor');
assert.ok(supervisor);
assert.equal(supervisor.capabilities.has('clinical.record.view'), true);
assert.equal(supervisor.capabilities.has('clinical.anamnesis.edit'), true);
assert.equal(supervisor.capabilities.has('treatment_plan.approve'), true);
assert.equal(supervisor.capabilities.has('session.start'), false);
assert.equal(supervisor.capabilities.has('finance.payments.receive'), false);
assert.deepEqual(getDefaultScopesForRole('supervisor'), ['SUPERVISED_CASES', 'OWN_RESOURCES']);

const therapist = resolveEffectiveClinicCapabilities('therapist');
assert.ok(therapist);
assert.equal(therapist.capabilities.has('clinical.record.view'), true);
assert.equal(therapist.capabilities.has('clinical.anamnesis.view'), false);
assert.equal(therapist.capabilities.has('clinical.anamnesis.edit'), false);
assert.equal(therapist.capabilities.has('team.permissions.manage'), false);
assert.deepEqual(getDefaultScopesForRole('therapist'), ['ASSIGNED_PATIENTS', 'OWN_RESOURCES']);

const supervisedTherapist = resolveEffectiveClinicCapabilities('therapist', [], { canSupervise: true });
assert.ok(supervisedTherapist);
assert.equal(supervisedTherapist.capabilities.has('clinical.anamnesis.view'), true);
assert.equal(supervisedTherapist.capabilities.has('clinical.anamnesis.edit'), true);
assert.equal(supervisedTherapist.capabilities.has('treatment_plan.approve'), true);
assert.equal(supervisedTherapist.capabilities.has('calendar.team.view'), true);
assert.equal(supervisedTherapist.capabilities.has('workspace.multiclinic.analytics'), false);

const receptionist = resolveEffectiveClinicCapabilities('receptionist');
assert.ok(receptionist);
assert.equal(receptionist.capabilities.has('patient.list'), true);
assert.equal(receptionist.capabilities.has('finance.payments.receive'), true);
assert.equal(receptionist.capabilities.has('clinical.record.view'), false);
assert.equal(receptionist.capabilities.has('clinical.anamnesis.view'), false);
assert.equal(receptionist.capabilities.has('clinical.anamnesis.edit'), false);
assert.deepEqual(getDefaultScopesForRole('receptionist'), ['ACTIVE_CLINIC']);

// Explicit deny always narrows an existing role capability.
const coordinatorDenied = resolveEffectiveClinicCapabilities('coordinator', [
  { permission_key: 'clinical.anamnesis.edit', effect: 'deny' },
]);
assert.equal(coordinatorDenied?.capabilities.has('clinical.anamnesis.edit'), false);

// An ordinary therapist cannot gain supervisory anamnesis editing authority
// from an allow override (including a stale historical grant).
const therapistAuthorized = resolveEffectiveClinicCapabilities('therapist', [
  { permission_key: 'clinical.anamnesis.edit', effect: 'allow' },
]);
assert.equal(therapistAuthorized?.capabilities.has('clinical.anamnesis.edit'), false);

// Structural ceilings always win over stale/broad overrides.
const receptionistClinicalOverride = resolveEffectiveClinicCapabilities('receptionist', [
  { permission_key: 'clinical.record.view', effect: 'allow' },
  { permission_key: 'clinical.anamnesis.edit', effect: 'allow' },
]);
assert.equal(receptionistClinicalOverride?.capabilities.has('clinical.record.view'), false);
assert.equal(receptionistClinicalOverride?.capabilities.has('clinical.anamnesis.edit'), false);

const therapistMulticlinicOverride = resolveEffectiveClinicCapabilities('therapist', [
  { permission_key: 'workspace.multiclinic.analytics', effect: 'allow' },
]);
assert.equal(therapistMulticlinicOverride?.capabilities.has('workspace.multiclinic.analytics'), false);

// Frozen role defaults must remain aligned with runtime expectations.
assert.equal(roleHasDefaultCapability('therapist', 'clinical.anamnesis.edit'), false);
assert.equal(roleHasDefaultCapability('supervisor', 'clinical.anamnesis.edit'), true);
assert.equal(roleHasDefaultCapability('receptionist', 'clinical.record.view'), false);

console.log('authorizationRoleMatrixE2E.regression.test.ts: ok');
