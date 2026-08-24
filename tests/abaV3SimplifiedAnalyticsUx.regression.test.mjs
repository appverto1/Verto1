import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260823192500_aba_v3_chart_series_bundle.sql', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const panel = readFileSync('src/components/AbaV3ClinicalChartPanel.tsx', 'utf8');

assert.match(migration, /create or replace function public\.get_aba_chart_series_bundle_v3/);
assert.match(migration, /create or replace function public\.get_aba_patient_overview_v3[\s\S]*patient\.clinic_id = p_organization_id/);
assert.match(migration, /cardinality\(v_target_ids\)[\s\S]*v_requested_count < 1 or v_requested_count > 3/);
assert.match(migration, /from public\.aba_target_chart_points_v3 point/);
assert.match(migration, /partition by point\.target_id, point\.measurement_model_version,[\s\S]*point\.phase_assignment_id, point\.metric_key, point\.series_key/);
assert.match(migration, /'continuity_policy', 'BREAK_ON_PHASE_OR_MODEL_CHANGE'/);
assert.match(migration, /'legacy_history_separate', true/);
assert.match(migration, /stable[\s\S]*security definer[\s\S]*set row_security = off/i);
assert.doesNotMatch(migration, /\binsert\s+into\s+public\.(?:aba_trials|aba_behavior|aba_sessions|aba_measurement_rollout|aba_target_clinical_states)/i);
assert.doesNotMatch(migration, /\bupdate\s+public\.(?:aba_trials|aba_behavior|aba_sessions|aba_measurement_rollout|aba_target_clinical_states)/i);
assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.(?:aba_trials|aba_behavior|aba_sessions|aba_measurement_rollout|aba_target_clinical_states)/i);
assert.match(migration, /revoke all on function public\.get_aba_chart_series_bundle_v3[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.get_aba_chart_series_bundle_v3[\s\S]*to service_role/);

assert.match(server, /\/api\/aba\/v3\/patients\/:patientId\/chart-series-bundle[\s\S]*requireAbaV3ReadFeature[\s\S]*requireClinicCapability\('aba\.analytics\.view'\)[\s\S]*checkPatientAccess/);
assert.match(server, /targetIds\.length < 1 \|\| targetIds\.length > 3 \|\| rawTargetIds\.length > 3/);
assert.match(server, /supabase\.rpc\('get_aba_chart_series_bundle_v3'/);
assert.match(dataService, /async getAbaV3PatientOverview/);
assert.match(dataService, /async getAbaV3ChartSeriesBundle/);
assert.match(dataService, /targetIds: safeTargetIds\.join\(','\)/);
assert.doesNotMatch(panel, /getAbaV3TargetChartSeries\(/, 'the simplified ABA V3 UX must not issue one chart request per selected target');
assert.match(panel, /getAbaV3ChartSeriesBundle\(patientId, selectedTargetIds/);

for (const label of ['Visão geral', 'Habilidades', 'Comportamentos', 'Maestria', 'Manutenção', 'Mudanças por sessão']) {
  assert.match(panel, new RegExp(label));
}
assert.match(panel, /Por data/);
assert.match(panel, /Por sessão/);
assert.match(panel, /Comparar anteriores/);
assert.match(panel, /Alvos no gráfico · até 3/);
assert.match(panel, /PRIMARY_INDEPENDENCE_PERCENT/);
assert.match(panel, /FINAL_COMPLETION_ACCURACY_PERCENT/);
assert.match(panel, /EFFECTIVE_TRIAL_COUNT/);
assert.match(panel, /BEHAVIOR_DURATION_EPISODES/);
assert.match(panel, /BEHAVIOR_DURATION_AVG/);
assert.match(panel, /INTERVAL_OCCURRENCE_PERCENT_/);
assert.match(panel, /type="linear"/);
assert.doesNotMatch(panel, /type="monotone"/);
assert.match(panel, /connectNulls=\{false\}/);
assert.match(panel, /meta\?\.denominator[\s\S]*elegíveis/);
assert.match(panel, /Revisão recomendada/);
assert.match(panel, /A interface não recalcula maestria nem reaquisição/);
assert.match(panel, /histórico Legacy V2 permanece separado/i);
assert.match(panel, /não soma unidades incompatíveis/i);
assert.match(panel, /DOMAIN_COLORS = \{[\s\S]*skills: \['#10B981'[\s\S]*behaviors: \['#0EA5E9'[\s\S]*mastery: \['#8B5CF6'[\s\S]*maintenance: \['#F59E0B'[\s\S]*alerts: \['#EF4444'/);

console.log('abaV3SimplifiedAnalyticsUx.regression.test.mjs: ok');
