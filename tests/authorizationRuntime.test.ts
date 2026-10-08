import assert from 'node:assert/strict';
import {
  hasEffectiveClinicCapability,
  resolveEffectiveClinicCapabilities,
} from '../src/utils/authorizationRuntime';

const coordinator = resolveEffectiveClinicCapabilities('coordinator');
assert.ok(coordinator, 'coordenador deve resolver capabilities padrão');
assert.equal(coordinator?.capabilities.has('team.permissions.manage'), true);

const coordinatorDenied = resolveEffectiveClinicCapabilities('coordinator', [
  { permission_key: 'team.permissions.manage', effect: 'deny' },
]);
assert.equal(
  coordinatorDenied?.capabilities.has('team.permissions.manage'),
  false,
  'deny explícito remove capability padrão delegável',
);

const therapistWithBilling = resolveEffectiveClinicCapabilities('therapist', [
  { permission_key: 'billing.xml.generate', effect: 'allow' },
]);
assert.equal(
  therapistWithBilling?.capabilities.has('billing.xml.generate'),
  false,
  'override não pode romper o teto estrutural do escopo do profissional',
);

// P0: anamnesis operational changes require clinic manager or verified supervision.
// A stale or forged allow override must not upgrade an ordinary therapist.
const commonTherapist = resolveEffectiveClinicCapabilities('therapist');
assert.equal(commonTherapist?.capabilities.has('clinical.anamnesis.view'), false);
assert.equal(commonTherapist?.capabilities.has('clinical.anamnesis.edit'), false);
const therapistWithUnsafeAnamnesisGrant = resolveEffectiveClinicCapabilities('therapist', [
  { permission_key: 'clinical.anamnesis.edit', effect: 'allow' },
]);
assert.equal(therapistWithUnsafeAnamnesisGrant?.capabilities.has('clinical.anamnesis.edit'), false);
const therapistWithUnsafeViewGrant = resolveEffectiveClinicCapabilities('therapist', [
  { permission_key: 'clinical.anamnesis.view', effect: 'allow' },
]);
assert.equal(therapistWithUnsafeViewGrant?.capabilities.has('clinical.anamnesis.view'), false);
for (const role of ['director', 'coordinator', 'supervisor'] as const) {
  assert.equal(
    resolveEffectiveClinicCapabilities(role)?.capabilities.has('clinical.anamnesis.edit'),
    true,
    `${role} autorizado deve manter capacidade operacional de anamnese`,
  );
}
for (const role of ['receptionist', 'biller'] as const) {
  assert.equal(
    resolveEffectiveClinicCapabilities(role, [{ permission_key: 'clinical.anamnesis.edit', effect: 'allow' }])
      ?.capabilities.has('clinical.anamnesis.edit'),
    false,
    `${role} não pode editar anamnese via override`,
  );
}

const therapistSupervisor = resolveEffectiveClinicCapabilities('therapist', [], { canSupervise: true });
assert.equal(therapistSupervisor?.capabilities.has('session.start'), true);
assert.equal(therapistSupervisor?.capabilities.has('calendar.team.view'), true);
assert.equal(therapistSupervisor?.capabilities.has('treatment_plan.approve'), true);
assert.equal(therapistSupervisor?.capabilities.has('clinical.anamnesis.edit'), true);
assert.equal(
  resolveEffectiveClinicCapabilities('therapist', [
    { permission_key: 'clinical.anamnesis.edit', effect: 'deny' },
  ], { canSupervise: true })?.capabilities.has('clinical.anamnesis.edit'),
  false,
  'override deny explícito prevalece mesmo para supervisor contextual',
);

const coordinatorInvite = resolveEffectiveClinicCapabilities('coordinator');
assert.equal(
  coordinatorInvite?.capabilities.has('team.invite'),
  true,
  'coordenador pode convidar profissionais dentro da própria unidade',
);

const receptionistInviteOverride = resolveEffectiveClinicCapabilities('receptionist', [
  { permission_key: 'team.invite', effect: 'allow' },
]);
assert.equal(
  receptionistInviteOverride?.capabilities.has('team.invite'),
  false,
  'papéis operacionais não podem recuperar convite por override antigo',
);


const coordinatorMulticlinicOverride = resolveEffectiveClinicCapabilities('coordinator', [
  { permission_key: 'workspace.multiclinic.analytics', effect: 'allow' },
]);
assert.equal(
  coordinatorMulticlinicOverride?.capabilities.has('workspace.multiclinic.analytics'),
  false,
  'coordenador permanece limitado à unidade mesmo diante de override histórico',
);

const receptionistArchiveOverride = resolveEffectiveClinicCapabilities('receptionist', [
  { permission_key: 'patient.archive', effect: 'allow' },
]);
assert.equal(
  receptionistArchiveOverride?.capabilities.has('patient.archive'),
  false,
  'recepção não pode receber operação destrutiva de paciente por override',
);
const receptionistClinicalOverride = resolveEffectiveClinicCapabilities('receptionist', [
  { permission_key: 'clinical.record.view', effect: 'allow' },
]);
assert.equal(
  receptionistClinicalOverride?.capabilities.has('clinical.record.view'),
  false,
  'recepção nunca recebe prontuário clínico por override',
);

const therapistWithInvalidOverride = resolveEffectiveClinicCapabilities('therapist', [
  { permission_key: 'platform.super_admin', effect: 'allow' },
]);
assert.equal(
  therapistWithInvalidOverride?.appliedOverrides.length,
  0,
  'chaves fora do catálogo não podem virar privilégio por override',
);

assert.equal(hasEffectiveClinicCapability('biller', 'billing.xml.generate'), true);
assert.equal(hasEffectiveClinicCapability('biller', 'patient.insurance.authorization.edit'), true);
assert.equal(hasEffectiveClinicCapability('biller', 'patient.insurance.eligibility.view'), true);
assert.equal(
  hasEffectiveClinicCapability('biller', 'clinical.record.view'),
  false,
  'faturista não recebe prontuário clínico por padrão',
);
assert.equal(hasEffectiveClinicCapability('supervisor', 'clinical.record.view'), true);
assert.equal(
  hasEffectiveClinicCapability('supervisor', 'session.start'),
  false,
  'supervisor não vira profissional executante de sessão por padrão',
);
assert.equal(hasEffectiveClinicCapability('unknown', 'clinic.view'), false);

console.log('authorizationRuntime.test.ts: ok');
