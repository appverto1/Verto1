import fs from 'node:fs';
import assert from 'node:assert/strict';

const sessionMode = fs.readFileSync(new URL('../src/components/SessionMode.tsx', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const plan = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');

assert.match(
  sessionMode,
  /onMasteryPreviewChanged/,
  'SessionMode must expose live mastery preview updates to its parent',
);
assert.match(
  sessionMode,
  /criterion_progress_count:[\s\S]*criterionProgressCount/,
  'Live preview must preserve partial criterion progress instead of only mastered status',
);
assert.match(
  patientDetail,
  /abaMasteryPreviewEvaluations/,
  'Patient detail must keep a transient live mastery preview while a session is open',
);
assert.match(
  patientDetail,
  /abaMasteryEvaluationsForPlan/,
  'Plan must merge live session preview with canonical persisted mastery evaluations',
);
assert.match(
  patientDetail,
  /masteryEvaluations=\{abaMasteryEvaluationsForPlan\}/,
  'Therapeutic plan must consume the merged live+persisted mastery source',
);
assert.match(
  patientDetail,
  /onMasteryPreviewChanged=\{setAbaMasteryPreviewEvaluations\}/,
  'Session preview callback must be wired to patient detail state',
);
assert.match(
  plan,
  /Alvo atual:[\s\S]*criterionProgressLabel[\s\S]*do critério/,
  'PTS card must expose the current target partial criterion progress, not only the aggregate bar',
);

console.log('abaMasteryLivePlanPreview.regression.test.mjs: ok');
