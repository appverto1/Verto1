import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

for (const label of [
  'PTS - Plano Terapêutico Singular',
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
  'Adicionar programa',
  'Nova versão',
]) {
  assert.ok(dashboard.includes(label), `elemento obrigatório ausente no dashboard do PTS: ${label}`);
}

assert.match(dashboard, /lg:grid-cols-\[300px_minmax\(0,1fr\)\]/);
assert.match(panel, /Programa sem evidência registrada/);
assert.match(panel, /Reavaliação vencida/);
assert.match(dashboard, /data-testid="pts-therapeutic-dashboard"/);
assert.match(dashboard, /professionalPhotoSource/);
assert.match(dashboard, /<SecureImage[\s\S]*Foto de/);
assert.match(panel, /primaryPtsScope \? \(/);
assert.doesNotMatch(panel, /primaryPtsScope && !showPlanManager \? \(/);
assert.match(panel, /data-testid="pts-plan-manager-drawer"/);
assert.match(panel, /title="Planos da equipe"/);
assert.match(panel, /startCreationForScope\(String\(primaryPtsScope\.id\)\)/);
assert.match(panel, /Nova versão do PTS/);
assert.match(panel, /renderPtsProgramCard/);
assert.match(panel, /profile_photo_url:\s*[\s\S]*link\.profile_photo_url/);
assert.match(server, /user_id,full_name,specialty,profile_photo_url/);
assert.match(server, /profile_photo_url:\s*sanitizeUrl\(profile\?\.profile_photo_url\) \|\| null/);


console.log('ptsTherapeuticDashboard.test.mjs: ok');
