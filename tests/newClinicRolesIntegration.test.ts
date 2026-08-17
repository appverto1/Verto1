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
const supervisionMigration = fs.readFileSync(
  'supabase/migrations/20260817030000_professional_supervision_capability_v1.sql',
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
  'componente temporário pode permanecer disponível durante a migração gradual',
);
assert.match(
  app,
  /\['director', 'coordinator', 'supervisor', 'receptionist', 'therapist'\]\.includes\(String\(user\.role \|\| ''\)\.toLowerCase\(\)\)[\s\S]{0,160}<CoordinatorDashboard/,
  'Diretor e Supervisor devem usar o dashboard clínico já filtrado por capabilities/scopes',
);
assert.doesNotMatch(
  app,
  /user\.role === 'director' \|\| user\.role === 'supervisor'\)[\s\S]{0,160}<ClinicRoleFoundationPending/,
  'Diretor e Supervisor não devem voltar à tela temporária após liberação por scope',
);
assert.match(
  app,
  /user\.role === 'biller'[\s\S]{0,120}<BillerWorkspace/,
  'Faturista deve entrar no workspace dedicado de faturamento, sem cair no dashboard clínico legado',
);
assert.match(team, /const canGrantDirector = actorRole === 'director'/);
assert.doesNotMatch(team, /setNewMemberRole\('supervisor'\)/);
assert.match(team, /Habilitar como supervisor/);
assert.match(team, /Supervisão não é um papel de convite/);
assert.match(team, /normalizedRole === 'supervisor'\) return 'Profissional · Supervisor'/);
assert.match(team, />Faturista</);
assert.doesNotMatch(invitationModal, /<option value="supervisor">/);
assert.match(invitationModal, /Supervisão é atribuída depois do vínculo/);
assert.match(invitationModal, /<option value="biller">Faturista<\/option>/);
assert.match(
  server,
  /if \(role === 'supervisor'\)[\s\S]{0,240}SUPERVISOR_IS_PROFESSIONAL_CAPABILITY/,
  'backend deve bloquear novos convites de Supervisor mesmo para clientes antigos/cacheados',
);
assert.match(supervisionMigration, /add column if not exists can_supervise boolean not null default false/);
assert.match(supervisionMigration, /set_clinic_member_supervision_eligibility_v1/);
assert.match(supervisionMigration, /for update/);
assert.match(supervisionMigration, /authorization_audit_events/);
assert.match(supervisionMigration, /SUPERVISION_CROSS_CLINIC_PATIENT_DENIED/);

console.log('newClinicRolesIntegration.test.ts: ok');
