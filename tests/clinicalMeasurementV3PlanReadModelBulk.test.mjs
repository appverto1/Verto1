import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260821161000_clinical_measurement_v3_plan_read_model_bulk.sql', 'utf8');
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const lower = migration.toLowerCase();

assert.match(lower, /create or replace function public\.read_clinical_plan_outcomes_v3/);
assert.match(lower, /stable/);
assert.match(lower, /security definer/);
assert.match(lower, /set row_security = off/);
assert.match(lower, /scoped_metadata as materialized/);
assert.match(lower, /source_kind in \('plan_goal', 'therapeutic_objective'\)/);
assert.match(lower, /target\.therapeutic_plan_id = any/);
assert.match(lower, /target\.therapeutic_objective_id = any/);
assert.match(lower, /clinical_measurement_session_continuous_summaries_v3/);
assert.match(lower, /clinical_measurement_session_count_summaries_v3/);
assert.match(lower, /clinical_measurement_session_rate_summaries_v3/);
assert.match(lower, /clinical_measurement_session_temporal_summaries_v3/);
assert.match(lower, /clinical_measurement_session_categorical_summaries_v3/);
assert.match(lower, /clinical_measurement_session_category_breakdown_v3/);
assert.match(lower, /clinical_measurement_projection_queue_v3/);
assert.match(lower, /projection_stale/);
assert.match(lower, /cmv3_plan_read_model_bulk_installed/);
assert.match(lower, /next', 'cmv3_clinical_outcomes_dashboard_convergence'/);

// The hot reader is projection-only: no raw-event scan and no legacy clinical graph fallback.
for (const forbidden of [
  'clinical_measurement_raw_events_v3',
  'clinical_measurement_effective_raw_events_v3',
  'clinical_observations',
  'aba_session_metric_snapshots',
  'aba_trials',
  'aba_trials_v3',
]) {
  const operationalBody = lower.split('-- installation/security attestation')[0].replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(operationalBody, new RegExp(`\\b${forbidden}\\b`), `${forbidden} must not feed the bulk CMV3 plan reader`);
}

// Absolute preservation: this milestone is read-only against clinical/source rows.
for (const clinicalTable of [
  'clinical_measurement_targets_v3',
  'clinical_measurement_sessions_v3',
  'clinical_measurement_session_continuous_summaries_v3',
  'clinical_measurement_session_count_summaries_v3',
  'clinical_measurement_session_rate_summaries_v3',
  'clinical_measurement_session_temporal_summaries_v3',
  'clinical_measurement_session_categorical_summaries_v3',
  'patient_therapeutic_plans',
  'patient_therapeutic_objectives',
]) {
  assert.doesNotMatch(lower, new RegExp(`insert\\s+into\\s+public\\.${clinicalTable}(?:\\s|\\()`));
  assert.doesNotMatch(lower, new RegExp(`update\\s+public\\.${clinicalTable}(?:\\s|\\n)`));
  assert.doesNotMatch(lower, new RegExp(`delete\\s+from\\s+public\\.${clinicalTable}(?:\\s|\\n)`));
}

assert.match(lower, /revoke all on function public\.read_clinical_plan_outcomes_v3[\s\S]*from public, anon, authenticated/);
assert.match(lower, /grant execute on function public\.read_clinical_plan_outcomes_v3[\s\S]*to service_role/);
assert.doesNotMatch(lower, /grant execute on function public\.read_clinical_plan_outcomes_v3[\s\S]*to authenticated/);

// HTTP authorization reuses the exact plan visibility rules already used elsewhere.
assert.match(routes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/plan-outcomes/);
assert.match(routes, /requireClinicCapability\('reports\.clinical\.indicators'\)/);
assert.match(routes, /checkPatientAccess/);
assert.match(routes, /filterTherapeuticPlanScopesForActor/);
assert.match(routes, /filterTherapeuticPlanProgramsForActor/);
assert.match(routes, /patient_professional_links/);
assert.match(routes, /visiblePlanIds/);
assert.match(routes, /visibleObjectiveIds/);
assert.match(routes, /supabase\.rpc\('read_clinical_outcomes_converged_v3'/);
assert.match(routes, /p_plan_ids:visiblePlanIds/);
assert.match(routes, /p_therapeutic_objective_ids:visibleObjectiveIds/);
assert.match(routes, /p_program_ids:visibleProgramIds/);
assert.match(routes, /rpcCount:1/);
assert.doesNotMatch(routes, /for\s*\([^)]*target[^)]*\)[\s\S]{0,300}read_clinical_outcomes_converged_v3/i);

assert.match(dataService, /getClinicalPlanOutcomesV3/);
assert.match(dataService, /plan-outcomes/);
assert.match(dataService, /read_clinical_outcomes_converged_v3/);
assert.match(server, /registerClinicalMeasurementV3Routes\(app,[\s\S]{0,700}filterTherapeuticPlanScopesForActor,[\s\S]{0,200}filterTherapeuticPlanProgramsForActor/);

console.log('clinicalMeasurementV3PlanReadModelBulk.test.mjs: ok');
