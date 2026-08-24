import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');

assert.doesNotMatch(
  panel,
  /aria-label=\"Equipe do caso\"[^>]*min-h-\[9\.5rem\]/,
  'o cabeçalho da equipe não deve reservar a altura antiga dos cartões',
);
assert.match(panel, /Gerenciar equipe/);
assert.match(panel, /const \[showManager, setShowManager\] = useState\(false\)/);
assert.match(panel, /case-team-manager-title/);
assert.match(panel, /max-h-\[88vh\][\s\S]*sm:max-w-\[34rem\]/);
assert.match(panel, /integrityIssueCount[\s\S]*pendência/);
assert.match(panel, /Histórico de vínculos \(/);
assert.match(panel, /<SecureImage key=\{link\.id\} src=\{photoSource\}/);
assert.match(
  detail,
  /id=\"patient-care-context\"[\s\S]{0,180}?'mt-3 grid'[\s\S]{0,120}?gap-3/,
  'o contexto assistencial deve usar espaçamento vertical reduzido',
);

console.log('patientCaseTeamCompactHeader.regression.test.mjs: ok');
