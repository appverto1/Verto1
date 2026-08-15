import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260815223000_aba_measurement_v3_pr10_charts_rollout_pilot.sql', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const workspace = readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const chartPanel = readFileSync('src/components/AbaV3ClinicalChartPanel.tsx', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const adr = readFileSync('docs/architecture/ADR-ABA-V3-011-pr10-charts-rollout-pilot.md', 'utf8');

assert.match(migration, /create or replace view public\.aba_target_chart_points_v3/i);
assert.match(migration, /get_aba_patient_chart_catalog_v3/);
assert.match(migration, /get_aba_target_chart_series_v3[\s\S]*BREAK_ON_PHASE_OR_MODEL_CHANGE/);
assert.match(migration, /legacy_history_separate', true/);
assert.match(migration, /DTT_NET_PROBE[\s\S]*TASK_ANALYSIS[\s\S]*MAINTENANCE_PROBE[\s\S]*BEHAVIOR[\s\S]*INTERVAL/);
assert.doesNotMatch(migration, /from public\.aba_trials\b|from public\.aba_behavior_events\b/i, 'PR10 chart path must not read Legacy raw tables');
assert.match(migration, /v_measurement_type = 'abc' and new\.status = 'ACTIVE'[\s\S]*ABA_V3_ABC_LEGACY_ONLY/);
assert.match(migration, /create or replace function public\.get_aba_v3_pilot_readiness/);
assert.match(migration, /MISSING_PUBLISHED_COLLECTION_DEFINITION[\s\S]*MISSING_ACTIVE_TARGET_PHASE[\s\S]*TASK_ANALYSIS_STEPS_MISSING[\s\S]*ABC_V3_MAPPING_FORBIDDEN[\s\S]*UNRESOLVED_SYNC_QUARANTINE/);
assert.match(migration, /create or replace function public\.set_aba_measurement_rollout_state_v3/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*ABA_V3_ROLLOUT_STATE_VERSION_CONFLICT/);
assert.match(migration, /ABA_V3_ROLLOUT_PREFLIGHT_BLOCKED/);
assert.match(migration, /no_v3_rollout_enabled/);

assert.match(server, /FEATURE_ABA_V3_ROLLOUT_ADMIN/);
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/chart-catalog/);
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/targets\/:targetId\/chart-series/);
assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/pilot-readiness/);
assert.match(server, /\/api\/aba\/v3\/admin\/rollout-state/);
assert.match(server, /ABA_V3_RUNTIME_NOT_READY/);
assert.match(server, /pilot-readiness'[\s\S]*checkPlatformAdmin/);
assert.match(server, /admin\/rollout-state'[\s\S]*checkPlatformAdmin/);
assert.match(migration, /platform_admins[\s\S]*ABA_V3_ROLLOUT_PLATFORM_ADMIN_REQUIRED/);
assert.match(dataService, /getAbaV3ChartCatalog/);
assert.match(dataService, /getAbaV3TargetChartSeries/);
assert.match(workspace, /ABA Legacy[\s\S]*ABA V3/);
assert.match(chartPanel, /connectNulls=\{false\}/);
assert.match(chartPanel, /histórico Legacy V2 permanece separado/i);
assert.match(envExample, /FEATURE_ABA_V3_ROLLOUT_ADMIN=false/);
assert.match(adr, /Rollback sem perder offline[\s\S]*allow_new_v3_sessions=false[\s\S]*accept_v3_sync=true/i);

console.log('abaMeasurementV3ProductionReadiness.test.mjs: ok');
