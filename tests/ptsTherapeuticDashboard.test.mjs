import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');

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
assert.match(panel, /primaryPtsScope \? \(/);
assert.doesNotMatch(panel, /primaryPtsScope && !showPlanManager \? \(/);
assert.match(panel, /data-testid="pts-plan-manager-drawer"/);
assert.match(panel, /title="Planos da equipe"/);
assert.match(panel, /startCreationForScope\(String\(primaryPtsScope\.id\)\)/);
assert.match(panel, /Nova versão do PTS/);
assert.match(panel, /renderPtsProgramCard/);

console.log('ptsTherapeuticDashboard.test.mjs: ok');
