import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260821165500_clinical_measurement_v3_dashboard_converged_reader_scope_type_fix.sql',
  'utf8',
);

assert.match(sql, /create or replace function public\.read_clinical_outcomes_converged_v3\(/);
assert.match(
  sql,
  /plan\.organization_id\s*=\s*point\.organization_id::text/,
  'legacy therapeutic-plan organization_id TEXT must be compared against ABA V3 UUID through an explicit text boundary',
);
assert.doesNotMatch(
  sql,
  /plan\.organization_id\s*=\s*point\.organization_id(?:\s|$)/,
  'unsafe TEXT = UUID comparison must not return',
);
assert.match(sql, /program\.organization_id::text\s*=\s*point\.organization_id::text/);
assert.match(sql, /CMV3_CLINICAL_OUTCOMES_SCOPE_TYPE_FIX_INSTALLED/);
assert.match(sql, /text_uuid_boundary_fixed'[\s\S]*true/);
assert.match(sql, /clinical_rows_written'[\s\S]*false/);
assert.match(sql, /revoke all on function public\.read_clinical_outcomes_converged_v3[\s\S]*from public, anon, authenticated/);
assert.match(sql, /grant execute on function public\.read_clinical_outcomes_converged_v3[\s\S]*to service_role/);
assert.doesNotMatch(sql, /from public\.aba_trials_v3|from public\.clinical_measurement_raw_events_v3/i);

console.log('clinicalMeasurementV3DashboardScopeTypeFix.test.mjs: ok');
