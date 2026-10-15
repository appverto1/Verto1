import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readPatientPlanServerSource();
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const dashboard = readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260916113530_aba_history_version_snapshot_v1.sql', 'utf8');

assert.match(migration, /before insert on public\.aba_session_target_measurement_bindings/i);
assert.match(migration, /program_version_id is not null[\s\S]*measurement_type_snapshot[\s\S]*target_status_snapshot/i);
assert.match(migration, /ABA_V3_HISTORY_SNAPSHOT_PROGRAM_VERSION_NOT_FOUND/);
assert.doesNotMatch(migration, /update\s+public\.aba_session_target_measurement_bindings/i, 'legacy bindings must never be backfilled');

assert.match(routes, /clinical_supervision_links/);
assert.match(routes, /supervisionLinks:supervisionResult\.data\|\|\[\]/);
assert.match(routes, /history_version_status:binding\?\.program_version_id\?'VERSION_BOUND':'LEGACY_UNVERSIONED'/);
assert.match(routes, /queryCount:5/);

assert.match(server, /historyBindingBySessionTarget/);
assert.match(server, /historyVersionStatus = sourceKind === 'ABA_TARGET'/);
assert.match(server, /targetPhase: sourceKind === 'ABA_TARGET' \? \(historyBinding\?\.target_status_snapshot \|\| null\)/);
assert.match(server, /programMeasurementType: sourceKind === 'ABA_TARGET' \? \(historyBinding\?\.measurement_type_snapshot \|\| null\)/);
assert.match(server, /supervisionLinks: supervisionResult\.data \|\| \[\]/);

assert.match(dashboard, /Histórico sem versão/);
assert.match(dashboard, /historyVersionStatus/);

console.log('ptsPeiVersionedGraphIntegration.regression.test.mjs: ok');
