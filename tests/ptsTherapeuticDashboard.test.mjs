import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const editor = fs.readFileSync('src/components/PtsWorkspaceEditor.tsx', 'utf8');
const server = readPatientPlanServerSource();

for (const label of [
  'Projeto Terapêutico Singular',
  'Resumo do plano',
  'Estrutura do rascunho',
  'Técnico de referência',
  'Equipe multidisciplinar',
  'Objetivos compartilhados',
  'Prioridades familiares',
  'Evidências do cuidado',
  'Reavaliações',
  'Histórico',
  'Criar nova versão',
  'Continuar rascunho',
]) {
  assert.ok(dashboard.includes(label), `elemento obrigatório ausente no dashboard do PTS: ${label}`);
}

assert.match(dashboard, /data-testid="pts-therapeutic-dashboard"/);
assert.match(dashboard, /data-testid="pts-active-with-draft-notice"/);
assert.match(dashboard, /data-testid="pts-shared-evidence-card"/);
assert.match(dashboard, /professionalPhotoSource/);
assert.match(dashboard, /<SecureImage[\s\S]*Foto de/);
assert.match(dashboard, /A versão v\{activePtsVersionNumber\} permanece como referência clínica ativa/);
assert.match(dashboard, /Somente resumos explicitamente compartilhados com o PTS aparecem aqui/);
assert.match(dashboard, /canOpenSourcePlan === true[\s\S]*sourcePlanId[\s\S]*Ver no Plano de/);
assert.doesNotMatch(dashboard, /Adicionar programa|Adicionar o primeiro programa|canCreateProgram|onAddProgram/);
assert.doesNotMatch(dashboard, /text-violet-700 dark:text-violet-300/);
assert.doesNotMatch(dashboard, /bg-emerald[^'"\n]*Ativo|Ativo[^\n]*bg-emerald/);

assert.match(panel, /data-testid="therapeutic-plan-hub"/);
assert.match(panel, /Planos terapêuticos/);
assert.match(panel, /Plano da equipe/);
assert.match(panel, /Planos por especialidade/);
assert.match(panel, /Projeto Terapêutico Singular/);
assert.match(panel, /Novo plano por especialidade/);
assert.match(panel, /lifecycleBadgeClass/);
assert.match(panel, /Rascunho v\{ptsDraftNumber\} em elaboração; a versão v\{ptsActiveNumber\} permanece ativa/);
assert.match(panel, /Compartilhar resumo com o PTS/);
assert.match(panel, /shareWithPts/);
assert.match(panel, /ptsSharedEvidence/);
assert.match(panel, /title=\{draftVersionForScope\(selectedPtsScope\)\?\.id \? 'Editar rascunho do PTS' : 'Nova versão do PTS'\}/);
assert.doesNotMatch(panel, /title="Planos da equipe"/);
assert.doesNotMatch(panel, /startCreationForScope\(String\(primaryPtsScope\.id\)\)/);

assert.match(patientDetail, /data-testid="therapeutic-plan-mode-switch"/);
assert.match(patientDetail, /role="tab"/);
assert.match(patientDetail, /h-\[3px\][^\n]*bg-violet-600/);
assert.doesNotMatch(patientDetail, /w-32 h-32 bg-\[#05CD99\]/);
assert.doesNotMatch(patientDetail, /therapeuticPlanMode === 'pts' \? 'text-violet-700 dark:text-violet-300'/);

assert.match(editor, /sharedEvidenceRows/);
assert.match(editor, /Somente resumos explicitamente compartilhados pelas especialidades aparecem aqui/);
assert.doesNotMatch(editor, /scopedPrograms/);

assert.match(server, /const ptsSharedEvidence = hasVisiblePts/);
assert.match(server, /explicitlyShared = program\?\.advanced_settings\?\.shareWithPts === true/);
assert.match(server, /sourcePlanId: canOpenSourcePlan \? sourcePlanId : null/);
assert.match(server, /canOpenSourcePlan,/);
assert.match(server, /ptsSharedEvidence,/);
assert.match(server, /shareWithPts:[\s\S]*advancedSettings\?\.shareWithPts === true/);

console.log('ptsTherapeuticDashboard.test.mjs: ok');
