import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/verification/20260820235500_clinical_measurement_v3_shadow_mirror_readiness.sql', import.meta.url), 'utf8');
const lower = sql.toLowerCase();
assert.match(lower, /begin transaction read only/);
assert.match(lower, /rollback/);
assert.match(lower, /ready_for_dark_mirror/);
assert.match(lower, /aba_trials_v3/);
assert.match(lower, /aba_trial_revisions_v3/);
assert.match(lower, /clinic_memberships/);
assert.match(lower, /min\(has_primary\)[\s\S]*max\(has_primary\)/);
assert.doesNotMatch(lower, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/);
console.log('clinicalMeasurementV3ShadowMirrorReadiness contract OK');
