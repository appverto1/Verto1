import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260820233000_clinical_measurement_v3_security_shadow_hardening.sql', 'utf8');
const lower = migration.toLowerCase();
const routes = readFileSync('services/clinicalMeasurementV3Routes.ts', 'utf8');
const threatModel = readFileSync('docs/architecture/clinical-measurement-v3/security/threat-model.md', 'utf8');
const matrix = readFileSync('docs/architecture/clinical-measurement-v3/verification/architecture-test-matrix.md', 'utf8');

// PostgreSQL PUBLIC EXECUTE is closed globally for CMV3 function families.
assert.match(lower, /revoke all on function %i\.%i\(%s\) from public, anon, authenticated/);
assert.match(lower, /p\.proname like 'clinical_measurement\\_%\\_v3'/);
assert.match(lower, /p\.proname like 'clinical_aba\\_%\\_v3'/);
assert.match(lower, /p\.proname like 'cmv3\\_%'/);

// The concrete SECURITY DEFINER helpers found by the audit stay server-only.
for (const fn of [
  'publish_clinical_aba_prompt_hierarchy_version_v3',
  'publish_clinical_aba_chaining_policy_version_v3'
]) {
  assert.match(lower, new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to service_role`));
}
assert.doesNotMatch(lower, /grant execute on function public\.resolve_clinical_measurement_payload_kind_v3\(uuid\) to authenticated/);

// Recurring attestation itself is service-only.
assert.match(lower, /create or replace function public\.get_clinical_measurement_v3_security_preflight\(\)/);
assert.match(lower, /has_table_privilege\('authenticated'/);
assert.match(lower, /has_function_privilege\('authenticated'/);
assert.match(lower, /revoke all on function public\.get_clinical_measurement_v3_security_preflight\(\) from public, anon, authenticated/);
assert.match(lower, /grant execute on function public\.get_clinical_measurement_v3_security_preflight\(\) to service_role/);

// Shadow comparison has two explicit authorities: canonical ABA V3 is parity;
// Legacy V2 remains observational and cannot silently redefine V3 semantics.
assert.match(lower, /create or replace function public\.get_clinical_measurement_v3_shadow_comparison/);
assert.match(lower, /clinical_measurement_session_proportion_summaries_v3/);
assert.match(lower, /aba_session_target_summaries_v3/);
assert.match(lower, /public\.aba_trials/);
assert.match(lower, /OBSERVATIONAL_ONLY_NOT_A_RELEASE_BLOCKER/i);
assert.match(lower, /NOT_DIRECTLY_COMPARABLE_MULTI_SEGMENT/i);
assert.match(lower, /parity_clean/i);
assert.match(lower, /revoke all on function public\.get_clinical_measurement_v3_shadow_comparison[\s\S]*from public, anon, authenticated/);
assert.match(lower, /grant execute on function public\.get_clinical_measurement_v3_shadow_comparison[\s\S]*to service_role/);

// Read routes consume the patient ID already authorized/canonicalized by middleware.
const resolvedUses = routes.match(/req\.resolvedPatientId\|\|req\.params\.patientId/g) || [];
assert.equal(resolvedUses.length, 4, 'all current CMV3 patient routes must use the middleware-resolved patient id');
assert.match(routes, /req\.resolvedPatientClinicId/);
assert.match(routes, /CMV3_PATIENT_SCOPE_MISMATCH/);

// Migration remains read-only toward legacy sources.
for (const legacy of ['aba_trials', 'aba_session_target_summaries_v3', 'aba_sessions']) {
  assert.doesNotMatch(lower, new RegExp(`insert\\s+into\\s+public\\.${legacy}`));
  assert.doesNotMatch(lower, new RegExp(`update\\s+public\\.${legacy}`));
  assert.doesNotMatch(lower, new RegExp(`delete\\s+from\\s+public\\.${legacy}`));
  assert.doesNotMatch(lower, new RegExp(`alter\\s+table\\s+public\\.${legacy}`));
}

assert.match(threatModel, /TM-026/);
assert.match(threatModel, /TM-027/);
assert.match(threatModel, /TM-028/);
assert.match(matrix, /TEST-SEC-001/);
assert.match(matrix, /TEST-AUTH-004/);
assert.match(matrix, /TEST-SHADOW-001/);

console.log('Clinical Measurement Engine V3 security + shadow contracts: OK');
