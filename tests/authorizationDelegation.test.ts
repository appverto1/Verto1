import assert from 'node:assert/strict';
import {
  canDelegateClinicCapability,
  resolveEffectiveClinicCapabilities,
} from '../src/utils/authorizationRuntime';

const director = resolveEffectiveClinicCapabilities('director');
const coordinator = resolveEffectiveClinicCapabilities('coordinator');
assert.ok(director && coordinator);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'coordinator',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'team.permissions.manage',
    actorCapabilities: director!.capabilities,
  }),
  true,
  'diretor pode delegar capability que possui para membro sob sua autoridade',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'coordinator',
    targetRole: 'director',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'team.view',
    actorCapabilities: coordinator!.capabilities,
  }),
  false,
  'coordenador não pode alterar permissões de diretor',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'therapist',
    actorUserId: 'same',
    targetUserId: 'same',
    capability: 'team.view',
    actorCapabilities: director!.capabilities,
  }),
  false,
  'ninguém pode alterar as próprias permissões',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'coordinator',
    targetRole: 'therapist',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'workspace.multiclinic.analytics',
    actorCapabilities: coordinator!.capabilities,
  }),
  false,
  'ator não delega capability acima do próprio teto',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'therapist',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'portal.view',
    actorCapabilities: director!.capabilities,
  }),
  false,
  'capability estrutural não delegável permanece bloqueada',
);


assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'supervisor',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'finance.payments.view',
    actorCapabilities: director!.capabilities,
    requestedEffect: 'allow',
  }),
  false,
  'grant adicional não pode ampliar supervisor de SUPERVISED_CASES para financeiro da clínica',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'supervisor',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'session.start',
    actorCapabilities: director!.capabilities,
    requestedEffect: 'allow',
  }),
  true,
  'supervisor pode receber atendimento clínico mantendo o escopo dos casos supervisionados',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'biller',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'finance.entries.view',
    actorCapabilities: director!.capabilities,
    requestedEffect: 'allow',
  }),
  false,
  'faturista não pode ganhar ledger financeiro geral por override individual',
);

assert.equal(
  canDelegateClinicCapability({
    actorRole: 'director',
    targetRole: 'biller',
    actorUserId: 'actor',
    targetUserId: 'target',
    capability: 'billing.xml.generate',
    actorCapabilities: director!.capabilities,
    requestedEffect: 'allow',
  }),
  true,
  'faturista pode receber capability adicional dentro do BILLING_SCOPE',
);

console.log('authorizationDelegation.test.ts: ok');
