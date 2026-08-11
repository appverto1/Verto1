import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const team = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const invitationModal = fs.readFileSync('src/components/InvitationModal.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260811183000_clinic_invitation_roles_v2.sql',
  'utf8',
);

assert.match(
  server,
  /type ClinicRole = 'director' \| 'coordinator' \| 'supervisor' \| 'therapist' \| 'receptionist' \| 'biller'/,
  'backend deve reconhecer todos os papéis de clínica',
);
assert.match(
  server,
  /async function resolveClinicCapabilityContext/,
  'resolver de capability precisa existir antes da migração gradual das rotas',
);
assert.match(
  server,
  /function requireClinicCapability\(capability: CapabilityKey\)/,
  'middleware de capability precisa estar disponível',
);
assert.match(
  migration,
  /role in \('director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller'\)/,
  'convites precisam aceitar os mesmos papéis de clinic_memberships',
);
assert.match(
  migration,
  /v_role not in \('director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller'\)/,
  'aceite atômico precisa validar os novos papéis',
);
assert.match(
  app,
  /const ClinicRoleFoundationPending/,
  'Diretor, Supervisor e Faturista precisam de estado seguro durante a migração de scopes',
);
assert.match(
  app,
  /user\.role === 'director' \|\| user\.role === 'supervisor' \|\| user\.role === 'biller'/,
  'papéis com escopo ainda não migrado não devem cair no dashboard amplo legado',
);
assert.match(team, /const canGrantDirector = actorRole === 'director' \|\| actorRole === 'admin' \|\| actorRole === 'owner'/);
assert.match(team, />Supervisor</);
assert.match(team, />Faturista</);
assert.match(invitationModal, /<option value="supervisor">Supervisor<\/option>/);
assert.match(invitationModal, /<option value="biller">Faturista<\/option>/);

console.log('newClinicRolesIntegration.test.ts: ok');
