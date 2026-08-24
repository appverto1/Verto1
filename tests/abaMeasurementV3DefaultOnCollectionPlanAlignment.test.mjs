import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260821006806_aba_v3_default_on_session_collection_plan_alignment.sql', import.meta.url), 'utf8');

assert.match(sql, /create or replace function public\.get_aba_v3_session_collection_plan/);
assert.match(sql, /missing rollout rows inherit ON/i);
assert.match(sql, /clinic_rollout\.after_state is not null[\s\S]*allow_new_v3_sessions/);
assert.match(sql, /patient_rollout\.after_state is not null[\s\S]*allow_new_v3_sessions/);
assert.match(sql, /program_rollout\.after_state is not null[\s\S]*allow_new_v3_sessions/);
assert.match(sql, /target_rollout\.after_state is not null[\s\S]*allow_new_v3_sessions/);
assert.match(sql, /else 'LEGACY_V2'[\s\S]*end as planned_model/);
assert.match(sql, /DEFAULT_ON_ELIGIBLE_PREVIEW/);
assert.match(sql, /EXPLICIT_KILL_SWITCH_AT_SESSION_START/);
assert.match(sql, /ABC_V3_MAPPING_FORBIDDEN_FALLBACK/);
assert.match(sql, /revoke all on function public\.get_aba_v3_session_collection_plan\(uuid,uuid,text,text\[\]\) from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.get_aba_v3_session_collection_plan\(uuid,uuid,text,text\[\]\) to service_role/);

const oldOptIn = "coalesce((clinic_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false)\n        and coalesce((patient_rollout.after_state ->> 'allow_new_v3_sessions')::boolean, false)";
assert.ok(!sql.includes(oldOptIn), 'legacy opt-in collection-plan expression must not return');

console.log('abaMeasurementV3DefaultOnCollectionPlanAlignment: PASS');
