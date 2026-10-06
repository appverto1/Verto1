import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration = fs.readFileSync('supabase/migrations/20260820220000_clinical_measurement_v3_semantic_api_decisions.sql','utf8');
const route = [
  fs.readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8'),
  fs.readFileSync('services/clinicalMeasurementV3PlanRoutes.ts', 'utf8'),
  fs.readFileSync('services/clinicalMeasurementV3CatalogRoutes.ts', 'utf8'),
  fs.readFileSync('services/clinicalMeasurementV3Shared.ts', 'utf8'),
].join('\n');
const server = fs.readFileSync('server.ts','utf8');

for (const table of [
  'clinical_measurement_criterion_epochs_v3',
  'clinical_measurement_evidence_revisions_v3',
  'clinical_measurement_clinical_decision_events_v3',
  'clinical_measurement_target_states_v3'
]) assert.match(migration,new RegExp(table));
assert.match(migration,/clinical_state text not null/);
assert.match(migration,/evidence_support_state text not null/);
assert.match(migration,/workflow_attention_state text not null/);
assert.match(migration,/CMV3_APPEND_ONLY_ENTITY/);
assert.match(route,/SemanticMeasurementResponse/);
assert.match(route,/CANONICAL/);
assert.match(route,/BREAK_ON_PHASE_EPOCH/);
assert.match(route,/REQUIRES_ANALYTICAL_DRILLDOWN/);
assert.doesNotMatch(route,/\.select\(['"]\*['"]\)/);
assert.match(server,/registerClinicalMeasurementV3Routes/);
console.log('clinicalMeasurementV3SemanticApiDecisions: ok');
