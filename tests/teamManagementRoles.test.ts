import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = process.cwd();
const teamManagementCode = readFileSync(join(root, 'src/components/TeamManagement.tsx'), 'utf8');
const invitationModalCode = readFileSync(join(root, 'src/components/InvitationModal.tsx'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');

test('convite separa papel operacional de titulo profissional', () => {
  assert.match(teamManagementCode, /Profissional de atendimento/);
  assert.match(teamManagementCode, /Psicólogo/);
  assert.match(teamManagementCode, /Terapeuta Ocupacional/);
  assert.match(teamManagementCode, /Acompanhante Terapêutico/);
  assert.match(teamManagementCode, /Aplicador ABA/);
  assert.doesNotMatch(teamManagementCode, />\s*Terapeuta\s*</);
  assert.match(teamManagementCode, /inviteToClinic\([\s\S]*professionalTitle/);
  assert.match(teamManagementCode, /newMemberRole === 'therapist'/);
});

test('lista, menu e historico nao renderizam enum cru therapist', () => {
  assert.match(teamManagementCode, /formatAccessRoleLabel\(member\.role, member\)/);
  assert.match(teamManagementCode, /formatInvitationRoleLabel\(inv\)/);
  assert.match(teamManagementCode, /formatInvitationRoleLabel\(entry\)/);
  assert.match(teamManagementCode, /Alterar acesso/);
  assert.match(teamManagementCode, /Recepcionista\/Assistente/);
  assert.doesNotMatch(teamManagementCode, /\{inv\.role\}<\/p>/);
  assert.doesNotMatch(teamManagementCode, /\{entry\.role\}<\/p>/);
  assert.doesNotMatch(teamManagementCode, /THERAPIST/);
});

test('gestao da equipe usa hierarquia leve e separa cadastro do historico', () => {
  assert.match(teamManagementCode, /max-w-7xl/);
  assert.match(teamManagementCode, /xl:grid-cols-\[minmax\(0,1\.35fr\)_minmax\(420px,0\.85fr\)\]/);
  assert.match(teamManagementCode, /Movimenta\S+ da equipe/);
  assert.match(teamManagementCode, /max-h-80 divide-y divide-slate-100 overflow-y-auto/);
  assert.doesNotMatch(teamManagementCode, /<h1[^>]*>GestÃ£o da Equipe<\/h1>/);
  assert.doesNotMatch(teamManagementCode, /font-bold[^"\n]*(?:uppercase|tracking-widest)|(?:uppercase|tracking-widest)[^"\n]*font-bold/);
  assert.match(teamManagementCode, /handleResendInvitation\(inv\)/);
  assert.match(teamManagementCode, /handleCancelInvitation\(inv\.id\)/);
});

test('modal de convite reutilizavel tambem evita Terapeuta generico', () => {
  assert.match(invitationModalCode, /Profissional de atendimento/);
  assert.match(invitationModalCode, /professionalTitle/);
  assert.match(invitationModalCode, /Acompanhante Terapêutico/);
  assert.doesNotMatch(invitationModalCode, />\s*Terapeuta\s*</);
  assert.doesNotMatch(invitationModalCode, /THERAPIST/);
});

test('backend persiste titulo sem criar novas permissoes', () => {
  assert.match(serverCode, /const PROFESSIONAL_TITLE_OPTIONS = \[/);
  assert.match(serverCode, /formatClinicAccessRoleLabel/);
  assert.match(serverCode, /role === 'therapist'[\s\S]*professionalTitle/);
  assert.match(serverCode, /required_onboarding_fields: normalizedOnboardingFields/);
  assert.match(serverCode, /professionalTitleUpdatedAt/);
  assert.match(serverCode, /clinic_memberships'[\s\S]*\.update\(\{ role \}\)/);
  assert.doesNotMatch(serverCode, /role:\s*'Psicólogo'|role:\s*'Aplicador ABA'|role:\s*'Acompanhante Terapêutico'/);
  assert.match(dataServiceCode, /updateMemberRole\(memberId: string, role: string, metadata/);
});
