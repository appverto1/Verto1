import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261115040709_ia03_privileged_direct_rpc_execute_lockdown.sql'),
  'utf8',
);

const expected = [
  'aba_refresh_patient_maintenance_summary',
  'aba_upsert_behavior_daily_duration',
  'complete_active_patient_billing_sync_job',
  'create_tiss_official_document',
  'enqueue_active_patient_billing_sync',
  'fail_active_patient_billing_sync_job',
  'reconcile_active_patient_billing_sync_queue',
  'school_assert_professional_availability',
  'school_audit_append',
  'school_idempotency_existing',
  'school_idempotency_store',
];

test('IA-03 targets exactly the audited direct-call functions', () => {
  const namesBlock = sql.match(/FOR v_name IN SELECT unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\)/);
  assert.ok(namesBlock, 'Expected an explicit allowlisted set of functions');
  const actual = [...namesBlock[1].matchAll(/'([a-z][a-z0-9_]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(new Set(actual).size, 11, 'No duplicates or surprise functions');

  for (const keep of [
    'can_access_clinic', 'can_manage_clinic', 'is_admin_or_owner',
    'is_platform_admin', 'is_platform_sales_admin',
    'patient_file_current_actor_can_read_v1',
    'therapeutic_plan_version_current_actor_can_read_v1',
    'therapeutic_program_row_actor_can_access_v1',
  ]) {
    assert.ok(!actual.includes(keep), 'Never revoke RLS/auth helper ' + keep);
  }
});

test('IA-03 verifies signatures and leaves server-owned callers working', () => {
  assert.match(sql, /v_count <> 1/);
  assert.match(sql, /p\.prosecdef/);
  assert.match(sql, /pg_catalog\.trigger/);
  assert.match(sql, /pg_catalog\.oidvectortypes\(p\.proargtypes\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
  assert.match(sql, /has_function_privilege\('anon', v_oid, 'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('authenticated', v_oid, 'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('service_role', v_oid, 'EXECUTE'\)/);
  assert.match(sql, /RAISE EXCEPTION 'IA03_PRIVILEGE_VERIFICATION_FAILED/);
});

test('IA-03 changes only grants, not business logic or RLS', () => {
  const code = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\b(?:create|alter|drop)\s+(?:or replace\s+)?(?:function|trigger|table|policy)\b/i);
  assert.doesNotMatch(code, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(code, /\b(?:disable|enable)\s+row\s+level\s+security\b/i);
});
