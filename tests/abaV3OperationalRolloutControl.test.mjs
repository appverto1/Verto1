import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');
const control = fs.readFileSync(new URL('../src/components/AbaV3RolloutControlCenter.tsx', import.meta.url), 'utf8');
const baseMigration = fs.readFileSync(new URL('../supabase/migrations/20260821006700_aba_v3_operational_cohort_control.sql', import.meta.url), 'utf8');
const clockHotfix = fs.readFileSync(new URL('../supabase/migrations/20260821006701_aba_v3_operational_snapshot_clock_hotfix.sql', import.meta.url), 'utf8');
const defaultOnLifecycle = fs.readFileSync(new URL('../supabase/migrations/20260821006810_aba_v3_default_on_override_lifecycle.sql', import.meta.url), 'utf8');

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

// 06700 is historical installation. 06701 fixed the snapshot volatility/clock contract,
// and 06810 is the current DEFAULT_ON/INHERIT operational definition. Tests must
// validate the effective migration chain instead of freezing an obsolete definition.
assert.match(baseMigration, /create or replace function public\.get_aba_v3_exact_target_cohort_snapshot_v1/);
assert.match(baseMigration, /create or replace function public\.set_aba_v3_exact_target_cohort_v1/);
assert.match(clockHotfix, /get_aba_v3_exact_target_cohort_snapshot_v1[\s\S]*language plpgsql\s+volatile/);
assert.match(clockHotfix, /resolve_aba_measurement_rollout_snapshot_v3\([\s\S]*clock_timestamp\(\)/);

assert.match(defaultOnLifecycle, /get_aba_v3_exact_target_cohort_snapshot_v1[\s\S]*language plpgsql\s+volatile/);
assert.match(defaultOnLifecycle, /resolve_aba_measurement_rollout_snapshot_v3\([\s\S]*clock_timestamp\(\)/);
assert.match(defaultOnLifecycle, /ABA_V3_COHORT_STATE_VERSION_CONFLICT/);
assert.match(defaultOnLifecycle, /get_aba_v3_pilot_readiness/);
assert.match(defaultOnLifecycle, /get_aba_v3_rollout_drain_status/);
assert.match(defaultOnLifecycle, /control_mode[\s\S]*DEFAULT_INHERIT/);
assert.match(defaultOnLifecycle, /p_enable=false[\s\S]*TARGET kill switch/);
assert.match(defaultOnLifecycle, /p_enable=true[\s\S]*DEFAULT\/INHERIT/);
assert.match(defaultOnLifecycle, /clear_aba_measurement_rollout_override_v3/);
assert.match(defaultOnLifecycle, /false, true, v_reason/); // kill switch: block new V3 sessions while preserving sync drain
assert.match(defaultOnLifecycle, /revoke all on function public\.set_aba_v3_exact_target_cohort_v1[\s\S]*from public, anon, authenticated/);
assert.match(defaultOnLifecycle, /grant execute on function public\.set_aba_v3_exact_target_cohort_v1[\s\S]*to service_role/);

console.log('abaV3OperationalRolloutControl: PASS');
