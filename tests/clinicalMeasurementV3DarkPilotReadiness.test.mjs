import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/verification/20260821003000_clinical_measurement_v3_dark_pilot_readiness.sql','utf8');

assert.match(sql,/begin transaction read only/i,'final readiness gate must be transaction-level read-only');
assert.match(sql,/get_clinical_measurement_v3_security_preflight\(\)/,'must include schema security attestation');
assert.match(sql,/sync_clinical_measurements_bulk_v3\(uuid,uuid,uuid,text,jsonb\)/,'must explicitly attest the service-only universal writer');
assert.match(sql,/process_clinical_measurement_projection_queue_v3\(integer\)/,'must explicitly attest the projection worker');
assert.match(sql,/run_clinical_measurement_v3_aba_shadow_mirror\(uuid,uuid,text,date,date\)/,'must explicitly attest the shadow writer');
assert.match(sql,/get_clinical_measurement_v3_shadow_comparison\(/,'must recompute canonical shadow parity instead of trusting a stored PASS');
assert.match(sql,/BLOCKED_SHADOW_PARITY/,'parity failure must block');
assert.match(sql,/BLOCKED_PROJECTION_QUEUE/,'failed or stale projections must block');
assert.match(sql,/READY_FOR_DARK_PILOT/,'must expose an explicit dark-pilot gate');
assert.match(sql,/One clean comparison is sufficient for dark-pilot readiness only/,'must not overclaim broad production readiness from narrow coverage');
assert.doesNotMatch(sql,/\b(insert|update|delete|truncate|alter|drop|create)\s+(table|into|from|public\.)/i,'readiness gate must not mutate persistent schema/data');

console.log('clinicalMeasurementV3DarkPilotReadiness contract: OK');
