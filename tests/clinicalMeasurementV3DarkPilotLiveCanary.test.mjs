import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/verification/20260821004000_clinical_measurement_v3_dark_pilot_live_canary.sql', 'utf8');

assert.match(sql, /BLOCKED_NO_NEW_PILOT_DATA/);
assert.match(sql, /BLOCKED_CANARY_SAMPLE_TOO_SMALL/);
assert.match(sql, /primary_candidate_count<2/);
assert.match(sql, /support_only_candidate_count<1/);
assert.match(sql, /primary_correct_count<1/);
assert.match(sql, /primary_non_correct_count<1/);
assert.match(sql, /run_clinical_measurement_v3_aba_shadow_mirror/);
assert.match(sql, /get_clinical_measurement_v3_shadow_comparison/);
assert.match(sql, /get_clinical_measurement_v3_security_preflight/);
assert.match(sql, /rollout_mutated_by_this_script',false/);
assert.match(sql, /browser_writer_enabled',false/);
assert.match(sql, /CMV3_DARK_PILOT_CANARY_PARITY_BLOCKED/);
assert.doesNotMatch(sql, /update\s+public\.aba_/i);
assert.doesNotMatch(sql, /delete\s+from\s+public\.aba_/i);

console.log('clinicalMeasurementV3DarkPilotLiveCanary: ok');
