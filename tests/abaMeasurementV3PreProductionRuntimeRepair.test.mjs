import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260816173500_aba_v3_runtime_uuid_scope_repair.sql';
const migration = readFileSync(migrationPath, 'utf8');
const smoke = readFileSync('scripts/aba-v3-pilot-smoke.mjs', 'utf8');

const functionBlock = (name) => {
  const marker = `create or replace function public.${name}`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `${name} must be repaired by the post-PR12 migration`);
  const end = migration.indexOf('$function$;', start);
  assert.notEqual(end, -1, `${name} function body must be complete`);
  return migration.slice(start, end + '$function$;'.length);
};

const chartCatalog = functionBlock('get_aba_patient_chart_catalog_v3');
const readiness = functionBlock('get_aba_v3_pilot_readiness');
const rollout = functionBlock('set_aba_measurement_rollout_state_v3');
const preflight = functionBlock('get_aba_v3_preflight_scope_snapshot');

for (const [name, block] of [
  ['chart catalog', chartCatalog],
  ['pilot readiness', readiness],
  ['rollout writer', rollout],
  ['preflight snapshot', preflight]
]) {
  assert.match(block, /patient\.clinic_id\s*=\s*p_organization_id(?!::text)/, `${name} must compare patients.clinic_id as UUID`);
  assert.doesNotMatch(block, /patient\.clinic_id\s*=\s*p_organization_id::text/, `${name} must not cast the UUID organization id to text for patients`);
}

// The repair is intentionally narrow. Legacy ABA tables still store clinic_id as TEXT.
assert.match(readiness, /target\.clinic_id\s*=\s*p_organization_id::text/);
assert.match(readiness, /session_row\.clinic_id\s*=\s*p_organization_id::text/);

// Replacing the rollout writer must preserve the PR11 drain-first rollback contract.
assert.match(rollout, /if p_allow_new_v3_sessions then[\s\S]*get_aba_v3_pilot_readiness/);
assert.match(rollout, /if not p_accept_v3_sync then[\s\S]*get_aba_v3_rollout_drain_status/);
assert.doesNotMatch(rollout, /if p_allow_new_v3_sessions or p_accept_v3_sync then/);

assert.match(migration, /ABA_V3_PATIENT_CLINIC_ID_TYPE_UNEXPECTED/);
assert.match(migration, /revoke all on function public\.get_aba_v3_pilot_readiness/);
assert.match(migration, /grant execute on function public\.get_aba_v3_preflight_scope_snapshot\(uuid,uuid\) to service_role/);

// Cookie-authenticated state-changing smoke requests must satisfy the server CSRF proof.
assert.match(smoke, /const requestOrigin = new URL\(baseUrl\)\.origin/);
assert.match(smoke, /const requiresCsrfProof = !\['GET', 'HEAD', 'OPTIONS'\]\.includes\(method\)/);
assert.match(smoke, /requiresCsrfProof \? \{ Origin: requestOrigin, Referer: `\$\{requestOrigin\}\/` \} : \{\}/);
assert.match(smoke, /session-collection-plan[\s\S]*method: 'POST'/);

console.log('ABA Measurement V3 post-PR12 runtime UUID + smoke CSRF repair contracts: OK');
