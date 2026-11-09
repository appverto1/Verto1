import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readPatientPlanServerSource();
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const dashboard = fs.readFileSync('src/components/PtsTherapeuticDashboard.tsx', 'utf8');

assert.match(
  server,
  /const ptsSharedEvidence = hasVisiblePts[\s\S]*?if \(!explicitlyShared \|\| sourceMode !== 'specialty'\) return \[\];/,
  'a projeção compartilhada deve aceitar somente compartilhamento explícito vindo de plano por especialidade',
);
assert.doesNotMatch(
  server.match(/const ptsSharedEvidence = hasVisiblePts[\s\S]*?const ptsLegacyEvidence = hasVisiblePts/)?.[0] || '',
  /legacyPtsEvidence|sharingMode: legacyPtsEvidence \? 'legacy_pts'/,
  'programa legado do PTS não pode ser promovido para a projeção compartilhada',
);
assert.match(
  server,
  /const ptsLegacyEvidence = hasVisiblePts[\s\S]*?sourceMode !== 'interdisciplinary'[\s\S]*?sharingMode: 'legacy_history_only'/,
  'histórico legado permanece disponível em uma projeção separada e somente histórica',
);
assert.match(server, /ptsSharedEvidence,[\s\S]*?ptsLegacyEvidence,/);

assert.match(panel, /ptsLegacyEvidence: \[\]/);
assert.match(panel, /Array\.isArray\(data\?\.ptsLegacyEvidence\)/);
assert.match(panel, /legacyEvidence=\{ptsLegacyEvidence\}/);

assert.match(dashboard, /data-testid="pts-legacy-evidence-section"/);
assert.match(dashboard, /Histórico clínico legado/);
assert.match(dashboard, /não significam compartilhamento atual com o PTS/);
assert.doesNotMatch(
  dashboard,
  /sharingMode === 'legacy_pts'[\s\S]*?>Legado</,
  'cards da área de evidências compartilhadas não devem usar legado como se fosse um modo de compartilhamento',
);

console.log('ptsLegacyEvidenceBoundary.regression.test.mjs: ok');
