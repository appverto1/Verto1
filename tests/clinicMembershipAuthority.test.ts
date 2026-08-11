import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  canAssignClinicRole,
  canManageClinicRole,
  resolveEffectiveClinicRoleFromMembership,
} from '../src/utils/clinicMembershipAuthority';

const actorId = '3d9d9f7e-18ab-4f26-8ddf-e53967016001';
const clinicId = '4e5f1457-f017-48d6-b9df-dc3511f53201';

const activeMembership = (role: string) => ({
  user_id: actorId,
  clinic_id: clinicId,
  role,
  status: 'active',
});

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'coordinator',
    globalRole: 'therapist',
    membership: activeMembership('therapist'),
  }),
  'therapist',
  'a membership ativa corrige uma sessão antiga de coordenador',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'therapist',
    globalRole: 'therapist',
    membership: activeMembership('coordinator'),
  }),
  'coordinator',
  'a membership ativa libera a coordenação sem depender de relogin',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'therapist',
    globalRole: 'admin',
    membership: activeMembership('therapist'),
  }),
  'therapist',
  'papel global legado não sobrepõe a membership da workspace',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'therapist',
    globalRole: 'owner',
    membership: null,
  }),
  null,
  'owner legado sem membership não recebe autoridade clínica',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'coordinator',
    globalRole: null,
    membership: { ...activeMembership('coordinator'), status: 'inactive' },
  }),
  null,
  'membership inativa nunca herda o papel antigo da sessão',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'coordinator',
    globalRole: null,
    membership: {
      ...activeMembership('coordinator'),
      clinic_id: '9da93bd5-0a0b-45ca-9fd8-5ef7b0a4eb02',
    },
  }),
  null,
  'membership de outra clínica não concede autoridade',
);

const server = fs.readFileSync('server.ts', 'utf8');
assert.match(
  server,
  /function requireActiveClinicRoles[\s\S]*?resolveEffectiveClinicRole/,
);
assert.match(
  server,
  /role === 'owner'[\s\S]*?hasVerifiedOwnerMfaSession\(\{[\s\S]*?role: 'owner'/,
  'elevação persistida para owner continua exigindo MFA real',
);
assert.match(
  server,
  /app\.patch\('\/api\/clinic\/members\/:memberId\/specialty', checkAuth, requireActiveClinicRoles\('director', 'coordinator', 'admin', 'owner'\)/,
);
assert.match(
  server,
  /app\.get\('\/api\/aba\/patients\/:patientId\/therapeutic-plan'[^\n]*requireClinicCapability\('treatment_plan\.view'\)[^\n]*checkPatientAccess/,
  'plano terapêutico deve usar capability + escopo do paciente',
);
assert.match(
  server,
  /const actorRole = sanitizeString\(req\.effectiveClinicRole \|\| [^,]+, 40\)/,
);


assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'director',
    globalRole: null,
    membership: activeMembership('director'),
  }),
  'director',
  'diretor é papel válido por membership ativa',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'supervisor',
    globalRole: null,
    membership: activeMembership('supervisor'),
  }),
  'supervisor',
  'supervisor é papel válido por membership ativa',
);

assert.equal(
  resolveEffectiveClinicRoleFromMembership({
    actorId,
    clinicId,
    sessionRole: 'biller',
    globalRole: null,
    membership: activeMembership('biller'),
  }),
  'biller',
  'faturista é papel válido por membership ativa',
);


assert.equal(canAssignClinicRole('owner', 'director'), false);
assert.equal(canAssignClinicRole('admin', 'director'), false);
assert.equal(canAssignClinicRole('director', 'director'), true);
assert.equal(canAssignClinicRole('director', 'biller'), true);
assert.equal(canAssignClinicRole('coordinator', 'supervisor'), true);
assert.equal(canAssignClinicRole('coordinator', 'biller'), true);
assert.equal(canAssignClinicRole('coordinator', 'director'), false);
assert.equal(canAssignClinicRole('supervisor', 'therapist'), false);
assert.equal(canAssignClinicRole('biller', 'biller'), false);

assert.equal(canManageClinicRole('owner', 'director'), false);
assert.equal(canManageClinicRole('admin', 'director'), false);
assert.equal(canManageClinicRole('director', 'director'), true);
assert.equal(canManageClinicRole('director', 'coordinator'), true);
assert.equal(canManageClinicRole('coordinator', 'coordinator'), true);
assert.equal(canManageClinicRole('coordinator', 'biller'), true);
assert.equal(canManageClinicRole('coordinator', 'director'), false);
assert.equal(canManageClinicRole('supervisor', 'therapist'), false);

assert.match(
  server,
  /app\.post\('\/api\/clinic\/invite'[\s\S]*?requireActiveClinicRoles\('director', 'coordinator', 'admin', 'owner'\)/,
  'diretor e coordenador podem abrir o fluxo de convite na clínica ativa',
);
assert.match(
  server,
  /CLINIC_ROLE_DELEGATION_DENIED/,
  'delegação de papel precisa de validação server-side',
);
assert.match(
  server,
  /CLINIC_ROLE_TARGET_ABOVE_ACTOR/,
  'coordenador não pode administrar membro com papel de diretor',
);

console.log('clinicMembershipAuthority.test.ts: ok');
