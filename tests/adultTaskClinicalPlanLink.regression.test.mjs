import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const planPanel = fs.readFileSync(new URL('../src/components/TherapeuticPlanPanel.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const pdf = fs.readFileSync(new URL('../src/components/ProgressReportPDFLayout.tsx', import.meta.url), 'utf8');
const report = fs.readFileSync(new URL('../src/utils/clinicalProgressReport.ts', import.meta.url), 'utf8');
const fallbacks = fs.readFileSync(new URL('../src/utils/routeSchemaFallbacks.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260828190000_adult_task_clinical_plan_link_v1.sql', import.meta.url), 'utf8');

// Persistence model is additive, canonical, immutable, and does not guess old rows.
for (const field of [
  'therapeutic_plan_id',
  'therapeutic_objective_id',
  'therapeutic_program_id',
  'clinical_target_id',
  'clinical_link_snapshot',
  'clinical_link_version',
]) {
  assert.match(migration, new RegExp(`add column if not exists ${field}`));
  assert.match(fallbacks, new RegExp(`'${field}'`));
}
assert.match(migration, /create or replace function public\.validate_assigned_task_clinical_link_v1/);
assert.match(migration, /ASSIGNED_TASK_CLINICAL_LINK_IMMUTABLE/);
assert.match(migration, /ASSIGNED_TASK_CLINICAL_PROGRAM_REQUIRED/);
assert.match(migration, /ASSIGNED_TASK_CLINICAL_TARGET_REQUIRED/);
assert.match(migration, /from public\.patient_therapeutic_plans/);
assert.match(migration, /from public\.aba_programs/);
assert.match(migration, /from public\.aba_targets/);
assert.match(migration, /therapeutic_plan_id = new\.therapeutic_plan_id/);
assert.match(migration, /program_id = new\.therapeutic_program_id/);
assert.doesNotMatch(migration.toLowerCase(), /update\s+public\.tasks\b|delete\s+from\s+public\.tasks\b/);
assert.doesNotMatch(migration.toLowerCase(), /update\s+public\.assigned_tasks\s+set\s+therapeutic_plan_id/);

// Patient completion keeps the immutable clinical chain in longitudinal history.
assert.match(migration, /create or replace function public\.complete_patient_assigned_task_v2/);
assert.match(migration, /for update/);
assert.match(migration, /therapeutic_plan_id, therapeutic_objective_id, therapeutic_program_id/);
assert.match(migration, /v_task\.therapeutic_plan_id, v_task\.therapeutic_objective_id, v_task\.therapeutic_program_id/);
assert.match(migration, /v_task\.clinical_target_id, v_task\.clinical_link_snapshot/);
assert.match(migration, /revoke all on function public\.complete_patient_assigned_task_v2/);
assert.match(migration, /grant execute on function public\.complete_patient_assigned_task_v2[\s\S]{0,260}to service_role/);

// Server does not trust plan/program/target labels sent by the browser.
assert.match(server, /const resolveAssignedTaskClinicalLink = async/);
assert.match(server, /ASSIGNED_TASK_CLINICAL_PROGRAM_REQUIRED/);
assert.match(server, /ASSIGNED_TASK_CLINICAL_TARGET_REQUIRED/);
assert.match(server, /\.from\('patient_therapeutic_plans'\)/);
assert.match(server, /\.from\('aba_programs'\)/);
assert.match(server, /\.from\('aba_targets'\)/);
assert.match(server, /const planScopeAccess = resolveTherapeuticPlanScopeAccess\(plan, accessContext\)/);
assert.match(server, /if \(!planScopeAccess\.canEdit\)/);
assert.match(server, /const trustedTaskData = clinicalLink[\s\S]{0,100}\? \{ \.\.\.safeTaskData, \.\.\.clinicalLink\.taskData \}/);
assert.match(server, /therapeutic_plan_id: clinicalLink\?\.therapeutic_plan_id/);
assert.match(server, /therapeutic_program_id: clinicalLink\?\.therapeutic_program_id/);
assert.match(server, /clinical_target_id: clinicalLink\?\.clinical_target_id/);

const patchRoute = server.slice(
  server.indexOf("app.patch('/api/assigned-tasks/:taskId'"),
  server.indexOf("app.post('/api/patient/self/legacy-tasks/:taskId/complete'"),
);
assert.doesNotMatch(patchRoute, /therapeutic_plan_id\s*:/);
assert.doesNotMatch(patchRoute, /clinical_link_snapshot\s*:/);

// Review remains contextual evidence; it is not projected into CMV3 observations.
const reviewRoute = server.slice(
  server.indexOf("app.post('/api/assigned-tasks/:taskId/review'"),
  server.indexOf('const normalizeServerFeatureFlag'),
);
assert.match(reviewRoute, /evidence_kind: 'contextual_task_review'/);
assert.match(reviewRoute, /therapeutic_plan_id: reviewMetadata\.therapeuticPlanId/);
assert.match(reviewRoute, /therapeutic_program_id: reviewMetadata\.therapeuticProgramId/);
assert.match(reviewRoute, /clinical_target_id: reviewMetadata\.clinicalTargetId/);
assert.match(reviewRoute, /Plano: \$\{reviewMetadata\.planName\}/);
assert.match(reviewRoute, /Programa: \$\{reviewMetadata\.programName\}/);
assert.match(reviewRoute, /Alvo clínico: \$\{reviewMetadata\.targetName\}/);

const outcomesRoute = server.slice(
  server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes-dashboard'"),
  server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes", server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes-dashboard'") + 20) > -1
    ? server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes", server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes-dashboard'") + 20)
    : server.indexOf('//', server.indexOf("app.get('/api/patients/:patientId/clinical-outcomes-dashboard'") + 1000),
);
assert.match(outcomesRoute, /\.from\('adult_task_reviews'\)/);
assert.match(outcomesRoute, /const activityEvidence =/);
assert.match(outcomesRoute, /sourceAuthority: 'contextual'/);
assert.match(outcomesRoute, /isClinicalMetric: false/);
assert.match(outcomesRoute, /activityEvidenceAvailable/);

// UX starts the assignment from a real plan target and exposes it to the patient.
assert.match(planPanel, /onAssignActivity/);
assert.match(planPanel, /canEditProgram\(selectedProgram\)/);
assert.match(planPanel, />Enviar ao portal</);
assert.match(detail, /const handleAssignAdultClinicalActivity = \(context: any\)/);
assert.match(detail, /adult-canonical-clinical-task-context/);
assert.match(detail, /therapeutic_plan_id: pendingAdultClinicalTaskContext\?\.therapeuticPlanId/);
assert.match(detail, /therapeutic_program_id: pendingAdultClinicalTaskContext\?\.therapeuticProgramId/);
assert.match(detail, /clinical_target_id: pendingAdultClinicalTaskContext\?\.clinicalTargetId/);
assert.match(dashboard, /const clinicalPath = \[/);
assert.match(dashboard, /taskData\?\.planName \|\| taskData\?\.therapeuticPlanName/);
assert.match(dashboard, /taskData\?\.programName/);
assert.match(dashboard, /taskData\?\.targetName \|\| taskData\?\.clinicalTargetName/);

// Reports keep task review separate from clinical measurement series.
assert.match(report, /ClinicalProgressReportActivityEvidence/);
assert.match(report, /activityEvidence/);
assert.match(report, /activities: ClinicalProgressReportActivityEvidence\[\]/);
assert.match(pdf, /Atividades vinculadas · evidência contextual/);
assert.match(pdf, /Revisões de tarefas são evidência contextual e não são convertidas em métrica clínica/);

console.log('adultTaskClinicalPlanLink.regression: PASS');
