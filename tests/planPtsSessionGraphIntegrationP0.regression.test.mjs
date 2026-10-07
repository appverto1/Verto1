import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const shell = fs.readFileSync('src/components/ClinicalPlanAnalyticsShell.tsx', 'utf8');

const routeStart = server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes-dashboard'");
assert.ok(routeStart > -1, 'clinical outcomes dashboard route must exist');
const routeEnd = server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes", routeStart + 20);
const route = server.slice(routeStart, routeEnd > routeStart ? routeEnd : routeStart + 150000);

assert.match(route, /patient_pts_collection_contexts_v1/);
assert.match(route, /source_session_id,plan_id,specialty_plan_id,version_number/);
assert.match(route, /ptsVersionBySessionPlan/);
assert.match(route, /read_clinical_outcomes_converged_v3/);
assert.match(route, /p_plan_ids: visiblePlanIdList/);
assert.match(route, /p_program_ids: visibleProgramIdList/);
assert.match(route, /sessionId:/);
assert.match(route, /programId:/);
assert.match(route, /goalId:/);
assert.match(route, /planId:/);
assert.match(route, /mergeClinicalOutcomeRowsV3First/);
assert.match(route, /canonicalAbaSessionTargets/);
assert.match(route, /rawEventsRead: false/);

assert.match(
  dashboard,
  /scopeId === 'pts'[\s\S]*?ptsAnalyticsSeries[\s\S]*?selectedPlanSeries\.filter/,
  'PTS must reuse the authorized plan/session outcome series rather than a separate truth source'
);
assert.match(dashboard, /<ClinicalPlanAnalyticsShell/);
assert.match(shell, /session-minute:/);
assert.match(shell, /_reportSessionIds/);
assert.match(shell, /onOpenSessionReport/);
assert.match(shell, /metricSignature/);
assert.match(shell, /Percentuais, duração, frequência e outras unidades não são somados entre si\./);

console.log('planPtsSessionGraphIntegrationP0.regression.test.mjs: ok');
