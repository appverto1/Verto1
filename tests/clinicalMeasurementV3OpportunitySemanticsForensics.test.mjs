import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/verification/20260820235930_clinical_measurement_v3_opportunity_semantics_forensics.sql', import.meta.url), 'utf8');
const lower = sql.toLowerCase();

assert.match(lower, /begin transaction read only/);
assert.match(lower, /rollback/);
assert.match(lower, /stable_by_trial_type/);
assert.match(lower, /stable_after_excluding_revised/);
assert.match(lower, /blocked_true_opportunity_ambiguity/);
assert.match(lower, /aba_trial_revisions_v3/);
assert.match(lower, /opportunity_role\s*=\s*'primary_independent'/);
assert.match(lower, /group by[\s\S]*trial_type/);
assert.doesNotMatch(lower, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/);

console.log('clinicalMeasurementV3OpportunitySemanticsForensics contract OK');
