import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/verification/20260820234500_clinical_measurement_v3_real_shadow_validation.sql','utf8');

assert.match(sql, /begin transaction read only/i, 'shadow validation must be transaction-level read-only');
assert.match(sql, /get_clinical_measurement_v3_security_preflight\(\)/, 'security preflight must run first');
assert.match(sql, /get_clinical_measurement_v3_shadow_comparison\(/, 'must use the hardened shadow comparator');
assert.match(sql, /BLOCKED_NO_COMPARABLE_DATA/, 'zero comparable data must block, not pass');
assert.match(sql, /BLOCKED_PARITY_FAILURE/, 'mismatch or incomplete parity must block');
assert.match(sql, /'PASS'/, 'clean parity must have an explicit PASS gate');
assert.match(sql, /legacy_v2'\s*,\s*'OBSERVATIONAL_ONLY'/, 'legacy V2 must remain observational only');
assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|create)\s+(table|into|from|public\.)/i, 'shadow validation must not mutate persistent schema/data');

console.log('clinicalMeasurementV3RealShadowValidation contract: OK');
