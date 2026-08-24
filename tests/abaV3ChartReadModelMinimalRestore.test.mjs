import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260821164500_aba_v3_chart_read_model_minimal_restore.sql',
  'utf8',
);

assert.match(sql, /create or replace view public\.aba_target_chart_points_v3/);
assert.match(sql, /with \(security_invoker = true\)/);
assert.match(sql, /from public\.aba_session_target_read_v3/);
assert.match(sql, /from public\.aba_session_task_analysis_read_v3/);
assert.match(sql, /from public\.aba_maintenance_probe_read_v3/);
assert.match(sql, /from public\.aba_session_behavior_read_v3/);
assert.match(sql, /from public\.aba_session_interval_read_v3/);
assert.match(sql, /create or replace function public\.get_aba_target_chart_series_v3\(/);
assert.match(sql, /BREAK_ON_PHASE_OR_MODEL_CHANGE/);
assert.match(sql, /revoke all on public\.aba_target_chart_points_v3 from public, anon, authenticated/);
assert.match(sql, /grant select on public\.aba_target_chart_points_v3 to service_role/);
assert.match(sql, /grant execute on function public\.get_aba_target_chart_series_v3[\s\S]*to service_role/);
assert.match(sql, /ABA_V3_CHART_READ_MODEL_MINIMAL_RESTORE_INSTALLED/);
assert.match(sql, /'clinical_rows_written', false/);
assert.match(sql, /'rollout_state_mutated', false/);
assert.doesNotMatch(sql, /insert\s+into\s+public\.(?:aba_trials_v3|aba_sessions_v3|aba_measurement_rollout_states_v3)/i);
assert.doesNotMatch(sql, /update\s+public\.aba_measurement_rollout_states_v3/i);
assert.doesNotMatch(sql, /delete\s+from\s+public\./i);

console.log('abaV3ChartReadModelMinimalRestore.test.mjs: ok');
