import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readPatientPlanServerSource();
const linksPanel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const ptsDashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const planPanel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260826183000_patient_case_team_coordinator_authority_v2.sql', 'utf8');
const caseTeamRoles = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const readRouteStart = server.indexOf("app.get('/api/aba/patients/:patientId/therapeutic-plan'");
const readRouteEnd = server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-plans'", readRouteStart);
assert.ok(readRouteStart >= 0 && readRouteEnd > readRouteStart, 'rotas de leitura e criação dos planos devem existir');
const planReadRoute = server.slice(readRouteStart, readRouteEnd);

assert.match(
  migration,
  /membership\.role in \('director', 'coordinator'\)/,
  'coordenador/diretor ativo da clínica deve possuir autoridade explícita sobre a equipe do caso',
);
assert.match(
  migration,
  /create or replace function public\.end_patient_professional_link_v1[\s\S]*?status = 'ended'[\s\S]*?ended_by = p_actor_id::text/,
  'remoção deve encerrar o vínculo e preservar a linha histórica',
);
assert.match(
  migration,
  /create or replace function public\.set_patient_primary_professional_v1[\s\S]*?relationship_type = 'collaborator'[\s\S]*?relationship_type = 'primary'/,
  'troca de responsável deve ser atômica e demover o responsável anterior sem apagar seu vínculo',
);
assert.match(
  migration,
  /pg_advisory_xact_lock/,
  'trocas críticas da equipe precisam de trava transacional contra concorrência',
);
assert.match(
  migration,
  /link\.organization_id = patient_clinic_id::text[\s\S]*?link\.clinic_id = patient_clinic_id::text/,
  'mutação deve permanecer explicitamente limitada ao tenant/paciente',
);
assert.match(
  caseTeamRoles,
  /PATIENT_CASE_TEAM_MEMBERSHIP_ROLES\s*=\s*\[[\s\S]*?'therapist'[\s\S]*?'supervisor'[\s\S]*?'coordinator'[\s\S]*?'director'/,
  'os quatro papéis clínicos devem permanecer na definição canônica compartilhada',
);
assert.match(
  planReadRoute,
  /\.in\('role', Array\.from\(PATIENT_CASE_TEAM_MEMBERSHIP_ROLES\)\)/,
  'read model do plano deve consultar os papéis clínicos canônicos sem fixar um subconjunto local',
);
assert.match(
  planReadRoute,
  /planEligible =[\s\S]*?hasActiveClinicalMembership[\s\S]*?Boolean\(membershipSpecialty\)[\s\S]*?canWritePlan/,
  'somente membros clínicos ativos e elegíveis devem alimentar o planejamento',
);
assert.match(
  ptsDashboard,
  /const caseTeamProfessionals = useMemo[\s\S]*?Array\.isArray\(professionals\)/,
  'PTS deve renderizar a equipe ativa do caso, não apenas ids congelados no snapshot do PTS',
);
assert.match(
  ptsDashboard,
  /caseTeamProfessionals\.map/,
  'seção Equipe multidisciplinar deve usar a projeção atual da equipe do caso',
);
assert.doesNotMatch(
  ptsDashboard,
  /participantIds\.map/,
  'a lista visual da equipe não deve voltar a depender exclusivamente dos participantes persistidos na versão do PTS',
);

assert.match(
  patientDetail,
  /caseTeamLinks=\{activeCaseTeamLinks\}/,
  'o planejamento deve reaproveitar a equipe já carregada no prontuário sem exigir um segundo carregamento no frontend',
);
assert.match(
  planPanel,
  /const professionalLinks = useMemo[\s\S]*?Array\.isArray\(caseTeamLinks\)[\s\S]*?status[\s\S]{0,120}active/,
  'o hub/PTS deve preferir a projeção viva da equipe do caso quando ela já estiver em estado local',
);

assert.match(
  planPanel,
  /caseRole: link\.case_role/,
  'projeção frontend da equipe deve preservar o papel clínico do vínculo',
);
assert.match(
  linksPanel,
  /payload\?\.message \|\| payload\?\.error/,
  'erros de autorização/migração devem preservar a mensagem segura enviada pelo servidor',
);
assert.match(
  server,
  /PATIENT_CASE_TEAM_MANAGEMENT_MIGRATION_REQUIRED/,
  'API deve distinguir migration pendente de vínculo inexistente',
);

console.log('patientCaseTeamCoordinatorAuthority.regression.test.mjs: ok');
