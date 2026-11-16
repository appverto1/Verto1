import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260821162500_clinical_measurement_v3_dashboard_converged_reader.sql',
  'utf8',
);
const routes = [
  fs.readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8'),
  fs.readFileSync('services/clinicalMeasurementV3PlanRoutes.ts', 'utf8'),
  fs.readFileSync('services/clinicalMeasurementV3CatalogRoutes.ts', 'utf8'),
  fs.readFileSync('services/clinicalMeasurementV3Shared.ts', 'utf8'),
].join('\n');
const server = readModularServerSource();

assert.match(sql, /create or replace function public\.read_clinical_outcomes_converged_v3\(/);
assert.match(sql, /from public\.read_clinical_plan_outcomes_v3\(/, 'generic PTS/specialty CMV3 projections must be reused, not rebuilt');
assert.match(sql, /from public\.aba_target_chart_points_v3 point/, 'Default-On ABA must be bridged from its canonical read model');
assert.match(sql, /program\.id = any\(coalesce\(p_program_ids/, 'ABA rows must be scoped by exact visible programs');
assert.match(sql, /plan\.id = any\(coalesce\(p_plan_ids/, 'ABA rows must stay inside visible plans');
assert.match(sql, /program\.therapeutic_objective_id = any\(coalesce\(p_therapeutic_objective_ids/, 'ABA objective scope must be bounded when an objective exists');
assert.match(sql, /point\.series_key \|\| ':phase:'/, 'ABA series must break at V3 phase boundaries instead of drawing across phases');
assert.match(sql, /ABA_V3_TARGET_CHART_READ_MODEL/);
assert.match(sql, /CMV3_TYPED_SESSION_PROJECTION/);
assert.match(sql, /raw_aba_v3_events_read', false/);
assert.match(sql, /legacy_v2_rows_read', false/);
assert.match(sql, /clinical_rows_written', false/);
assert.match(sql, /single_bulk_rpc', true/);
assert.match(sql, /revoke all on function public\.read_clinical_outcomes_converged_v3[\s\S]*from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.read_clinical_outcomes_converged_v3[\s\S]*to service_role/);
assert.doesNotMatch(sql, /from public\.aba_trials_v3|from public\.aba_trial_steps_v3|from public\.clinical_measurement_raw_events_v3/i, 'converged reader must not load raw clinical events');
assert.doesNotMatch(sql, /from public\.aba_session_metric_snapshots|from public\.clinical_observations/i, 'legacy fallback belongs to the server dashboard layer, not the canonical V3 reader');

assert.match(server, /supabase\.rpc\('read_clinical_outcomes_converged_v3'/);
assert.match(server, /p_program_ids:\s*visibleProgramIdList/);
assert.match(server, /CMV3_PLAN_PROJECTIONS_PLUS_ABA_V3_READ_MODEL/);
assert.match(routes, /supabase\.rpc\('read_clinical_outcomes_converged_v3'/);
assert.match(routes, /p_program_ids:visibleProgramIds/);

console.log('clinicalMeasurementV3DashboardConvergedReader.test.mjs: ok');
