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
  true,
  'grant explícito adiciona capability operacional sem trocar papel base',
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
