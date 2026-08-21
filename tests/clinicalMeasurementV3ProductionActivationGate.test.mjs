import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'supabase/verification/20260821006000_clinical_measurement_v3_production_activation_readiness.sql';
const sql = readFileSync(path, 'utf8');

assert.match(sql, /begin transaction read only;/i);
assert.match(sql, /rollback;/i);
assert.match(sql, /get_clinical_measurement_v3_security_preflight\(\)/i);
assert.match(sql, /set_aba_measurement_rollout_state_v3\(uuid,text,uuid,text,text,boolean,boolean,text,uuid,bigint\)/i);
assert.match(sql, /get_aba_v3_rollout_drain_status\(uuid,text,uuid,text,text\)/i);
assert.match(sql, /record_aba_trial_action_v3\(uuid,uuid,jsonb,text,uuid\)/i);
assert.match(sql, /allow_new_v3_sessions_count/i);
assert.match(sql, /BLOCKED_PREEXISTING_V3_ROLLOUT/i);
assert.match(sql, /BLOCKED_PREEXISTING_LIVE_V3_ACTIVITY/i);
assert.match(sql, /BLOCKED_SYNC_QUARANTINE/i);
assert.match(sql, /BLOCKED_PROJECTION_QUEUE/i);
assert.match(sql, /READY_FOR_CONTROLLED_PRODUCTION_COHORT_SELECTION/i);
assert.match(sql, /PRESERVE_LEGACY_V2_AS_FALLBACK_AND_HISTORY/i);
assert.match(sql, /broad_rollout_enabled_by_this_gate',false/i);
assert.match(sql, /'writes',false/i);

// The verification gate must never invoke the rollout writer or perform DML/DDL.
assert.doesNotMatch(sql, /select\s+public\.set_aba_measurement_rollout_state_v3\s*\(/i);
const withoutComments = sql
  .replace(/--.*$/gm, '')
  .replace(/\$cmv3_required_schema\$[\s\S]*?\$cmv3_required_schema\$/g, '')
  .replace(/'(?:''|[^'])*'/g, "''");
assert.doesNotMatch(withoutComments, /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i);

console.log('clinicalMeasurementV3ProductionActivationGate.test.mjs: ok');
