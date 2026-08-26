import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

for (const label of [
  'Projeto Terapêutico Singular (PTS)',
  'Resumo executivo',
  'Responsável de referência',
  'Equipe multidisciplinar',
  'Objetivos compartilhados',
  'Prioridades familiares',
  'Histórico de versões',
  'Programas',
  'Manutenção',
  'Generalização',
  'Histórico',
  'Criar nova versão',
]) {
  assert.ok(dashboard.includes(label), `elemento obrigatório ausente no dashboard do PTS: ${label}`);
}

assert.match(dashboard, /lg:grid-cols-\[300px_minmax\(0,1fr\)\]/);
assert.match(dashboard, /data-testid="pts-therapeutic-dashboard"/);
assert.match(dashboard, /professionalPhotoSource/);
assert.match(dashboard, /<SecureImage[\s\S]*Foto de/);
assert.match(
  dashboard,
  /Os programas clínicos ficam nos planos por especialidade/,
  'o PTS precisa explicar que programas são evidência histórica e não propriedade do documento compartilhado',
);
assert.doesNotMatch(dashboard, /Adicionar programa|Adicionar o primeiro programa/);
assert.doesNotMatch(dashboard, /canCreateProgram|onAddProgram/);

assert.match(panel, /Programa sem evidência registrada/);
assert.match(panel, /Reavaliação vencida/);
assert.match(panel, /data-testid="therapeutic-plan-hub"/);
assert.match(panel, /Planos terapêuticos/);
assert.match(panel, /Plano da equipe/);
assert.match(panel, /Planos por especialidade/);
assert.match(panel, /data-testid="specialty-plan-workspace"/);
assert.match(panel, /Nova versão do PTS/);
assert.match(panel, /renderPtsProgramCard/);
assert.doesNotMatch(panel, /title="Planos da equipe"/);
assert.doesNotMatch(panel, /startCreationForScope\(String\(primaryPtsScope\.id\)\)/);
assert.match(panel, /profile_photo_url:\s*[\s\S]*link\.profile_photo_url/);

assert.match(server, /user_id,full_name,specialty,profile_photo_url/);
assert.match(server, /const user: any = linkedUserById\.get\(String\(professionalId\)\)[\s\S]*profile_photo_url:\s*await resolveProfessionalProfilePhotoUrl\(profile, user\)/);

console.log('ptsTherapeuticDashboard.test.mjs: ok');
