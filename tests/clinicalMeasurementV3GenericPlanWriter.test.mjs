import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260821154500_clinical_measurement_v3_generic_plan_writer.sql', 'utf8');
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const lower = migration.toLowerCase();

assert.match(lower, /create or replace function public\.write_clinical_plan_measurement_v3/);
assert.match(lower, /security definer/);
assert.match(lower, /set row_security = off/);
assert.match(lower, /pg_advisory_xact_lock/);
assert.match(lower, /p_patient_id::text \|\| ':cmv3_plan_write:' \|\| v_client_event_id/);
assert.match(lower, /v_physical_event_prefix := 'plan:' \|\| p_patient_id::text/);
assert.match(lower, /v_sync_batch_id := 'plan:' \|\| encode/);
assert.match(lower, /clinical_measurement_targets_v3/);
assert.match(lower, /source_kind = 'plan_goal'/);
assert.match(lower, /source_kind = 'therapeutic_objective'/);
assert.match(lower, /cmv3_plan_write_semantic_family_conflict/);
assert.match(lower, /clinical_measurement_definition_versions_v3/);
assert.match(lower, /clinical_measurement_definition_activations_v3/);
assert.match(lower, /clinical_collection_protocol_snapshots_v3/);
assert.match(lower, /clinical_measurement_sessions_v3/);
assert.match(lower, /clinical_measurement_session_expectations_v3/);
assert.match(lower, /clinical_measurement_collection_streams_v3/);
assert.match(lower, /sync_clinical_measurements_bulk_v3/);
assert.match(lower, /recompute_clinical_measurement_projection_batch_v3/);
assert.match(lower, /processed_generation = queue\.generation/);
assert.match(lower, /idempotent_replay/);
assert.match(lower, /supported_families/);
assert.match(lower, /cmv3_generic_plan_writer_installed/);
assert.match(lower, /next','cmv3_plan_read_model_bulk'/);

assert.match(lower, /revoke all on function public\.write_clinical_plan_measurement_v3[\s\S]*from public, anon, authenticated/);
assert.match(lower, /grant execute on function public\.write_clinical_plan_measurement_v3[\s\S]*to service_role/);
assert.doesNotMatch(lower, /grant execute on function public\.write_clinical_plan_measurement_v3[\s\S]*to authenticated/);

for (const legacyTable of ['clinical_observations','aba_sessions','aba_trials','aba_trials_v3','patient_therapeutic_plans','patient_therapeutic_objectives']) {
  assert.doesNotMatch(lower, new RegExp(`insert\\s+into\\s+public\\.${legacyTable}(?:\\s|\\()`), `${legacyTable} must not receive writer evidence`);
  assert.doesNotMatch(lower, new RegExp(`delete\\s+from\\s+public\\.${legacyTable}(?:\\s|\\n)`), `${legacyTable} must not be deleted`);
}
assert.doesNotMatch(lower, /\bforeach\b/);
assert.doesNotMatch(lower, /\bloop\b/);

assert.match(routes, /\/api\/clinical-measurement-v3\/patients\/:patientId\/plan-measurements/);
assert.match(routes, /requireClinicCapability\('clinical\.notes\.create'\)/);
assert.match(routes, /checkPatientAccess/);
assert.match(routes, /enforcePayloadLimit\(req,res,32\*1024/);
assert.match(routes, /clinic_memberships/);
assert.match(routes, /patient_professional_links/);
assert.match(routes, /canEditTherapeuticPlanScope/);
assert.match(routes, /THERAPEUTIC_PLAN_MANAGER_ROLES/);
assert.match(routes, /aba_programs/);
assert.match(routes, /therapeutic_objective_id/);
assert.match(routes, /objectivePlanIds/);
assert.match(routes, /observedRaw&&Number\.isNaN/);
assert.match(routes, /supabase\.rpc\('write_clinical_plan_measurement_v3'/);
assert.match(routes, /CMV3_PLAN_WRITE_SEMANTICS_NOT_READY/);
assert.doesNotMatch(routes, /clinical_observations[^\n]*insert/i);

assert.match(dataService, /saveClinicalPlanMeasurementV3/);
assert.match(dataService, /plan-measurements/);
assert.match(server, /registerClinicalMeasurementV3Routes\(app,[\s\S]{0,500}enforcePayloadLimit,[\s\S]{0,200}canEditTherapeuticPlanScope/);

console.log('clinicalMeasurementV3GenericPlanWriter.test.mjs: ok');
