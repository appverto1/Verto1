import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');
const control = fs.readFileSync(new URL('../src/components/AbaV3RolloutControlCenter.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260821006700_aba_v3_operational_cohort_control.sql', import.meta.url), 'utf8');

assert.match(server, /\/api\/aba\/v3\/admin\/cohort-catalog/);
assert.match(server, /\/api\/aba\/v3\/admin\/cohort-snapshot/);
assert.match(server, /\/api\/aba\/v3\/admin\/cohort-control/);
assert.match(server, /requireAbaV3RolloutAdminFeature[\s\S]*checkPlatformAdmin/);
assert.match(server, /set_aba_v3_exact_target_cohort_v1/);
assert.match(server, /expected_state_versions/);

assert.match(dashboard, /AbaV3RolloutControlCenter/);
assert.match(dashboard, /Rollout ABA V3/);
assert.match(control, /FEATURE_ABA_V3_ROLLOUT_ADMIN=true/);
assert.match(control, /ATIVAR V3/);
assert.match(control, /DESATIVAR V3/);
assert.match(control, /expected_state_versions/);
assert.match(control, /Sessões já abertas nunca mudam de modelo/);

assert.match(migration, /create or replace function public\.get_aba_v3_exact_target_cohort_snapshot_v1/);
assert.match(migration, /create or replace function public\.set_aba_v3_exact_target_cohort_v1/);

assert.match(migration, /get_aba_v3_exact_target_cohort_snapshot_v1[\s\S]*language plpgsql\s+volatile/);
assert.match(migration, /resolve_aba_measurement_rollout_snapshot_v3\([\s\S]*clock_timestamp\(\)/);
assert.match(migration, /ABA_V3_COHORT_STATE_VERSION_CONFLICT/);
assert.match(migration, /get_aba_v3_pilot_readiness/);
assert.match(migration, /get_aba_v3_rollout_drain_status/);
assert.match(migration, /set_aba_measurement_rollout_state_v3/);
assert.match(migration, /false, true, v_reason/); // disable new sessions, preserve sync
assert.match(migration, /revoke all on function public\.set_aba_v3_exact_target_cohort_v1[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.set_aba_v3_exact_target_cohort_v1[\s\S]*to service_role/);

console.log('abaV3OperationalRolloutControl: PASS');
