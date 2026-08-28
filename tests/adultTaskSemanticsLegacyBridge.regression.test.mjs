import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const common = fs.readFileSync(new URL('../src/components/Common.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828150000_adult_task_effort_semantics_legacy_bridge_v1.sql', import.meta.url), 'utf8');

assert.match(server, /const ADULT_EFFORT_SEMANTICS_V2 = 'effort_min_0_max_100_v2'/);
assert.match(server, /if \(percent < 20\) return '🙂'/);
assert.match(server, /if \(percent < 80\) return 'Difícil'/);
assert.match(server, /complete_patient_assigned_task_v2/);
assert.match(server, /p_effort_semantics: ADULT_EFFORT_SEMANTICS_V2/);

assert.match(dashboard, /0% significa esforço mínimo e 100% esforço máximo/);
assert.match(dashboard, /\['Pouco esforço', 'Moderado', 'Muito esforço'\]/);
assert.match(dashboard, /<span>Pouco esforço 🙂<\/span>/);
assert.match(dashboard, /<span>Muito esforço 😫<\/span>/);
assert.doesNotMatch(dashboard, /Maior esforço 😟[\s\S]{0,120}Menor esforço/);
assert.match(common, /emojiForValue/);
assert.match(common, /getValueEmoji/);

assert.match(app, /shouldLoadLegacyTasks = clinicalPortalEnabled && patientPortalTaskKind === 'KIDS'/);
assert.match(app, /shouldLoadAssignedTasks = clinicalPortalEnabled && patientPortalTaskKind !== 'KIDS'/);
assert.match(app, /const isLegacyFallback = taskSource === 'tasks_fallback'/);
assert.match(app, /assignedTaskId: isLegacyFallback \? null : t\.id/);
assert.match(app, /legacyTaskId: legacyTaskId \|\| null/);
assert.match(app, /completeLegacyPatientTask\(legacyTaskId, completionPayload\)/);

const selfAssigned = server.slice(
  server.indexOf("app.get('/api/patient/self/assigned-tasks'"),
  server.indexOf("app.post('/api/assigned-tasks'"),
);
assert.match(selfAssigned, /bridgedLegacyTaskIds/);
assert.match(selfAssigned, /legacyTaskId/);
assert.match(selfAssigned, /_source: 'tasks_fallback'/);

const legacyComplete = server.slice(
  server.indexOf("app.post('/api/patient/self/legacy-tasks/:taskId/complete'"),
  server.indexOf("app.post('/api/assigned-tasks/:taskId/complete'"),
);
assert.match(legacyComplete, /resolveCanonicalPatientPortalScope/);
assert.match(legacyComplete, /canPortalSessionAccessPatient/);
assert.match(legacyComplete, /uuidFromStableString\(\s*`legacy-assigned-task:/);
assert.match(legacyComplete, /complete_patient_legacy_task_v1/);
assert.doesNotMatch(legacyComplete, /\.from\('tasks'\)[\s\S]{0,900}\.update\(/);

assert.match(dataService, /completeLegacyPatientTask/);
assert.match(dataService, /\/api\/patient\/self\/legacy-tasks\/\$\{safeTaskId\}\/complete/);

const patientLogsPost = server.slice(server.indexOf("app.post('/api/patient-logs'"), server.indexOf('// Activity Logs'));
assert.match(patientLogsPost, /requireClinicCapability\('clinical\.evolution\.create'\)/);
assert.doesNotMatch(patientLogsPost, /canPortalSessionAccessPatient|requireClinicCapabilityOrPatientPortal/);

assert.match(detail, /ADULT_EFFORT_SEMANTICS_V2/);
assert.match(detail, /Registro anterior à padronização da escala/);
assert.match(detail, /Semântica legada não padronizada/);
assert.match(detail, /from-\[#05CD99\][\s\S]{0,80}to-\[#fb5a4d\]/);
assert.match(detail, /Pouco esforço[\s\S]{0,100}Moderado[\s\S]{0,100}Muito esforço/);

assert.match(migration, /create or replace function public\.complete_patient_assigned_task_v2/);
assert.match(migration, /'patientEffortSemantics', v_semantics/);
assert.match(migration, /create or replace function public\.complete_patient_legacy_task_v1/);
assert.match(migration, /from public\.tasks t[\s\S]{0,160}for update/);
assert.match(migration, /insert into public\.assigned_tasks/);
assert.match(migration, /public\.complete_patient_assigned_task_v2/);
assert.doesNotMatch(migration, /update public\.tasks|delete from public\.tasks/);
assert.match(migration, /revoke all on function public\.complete_patient_legacy_task_v1/);
assert.match(migration, /grant execute on function public\.complete_patient_legacy_task_v1[\s\S]{0,300}to service_role/);

console.log('adultTaskSemanticsLegacyBridge.regression: PASS');
