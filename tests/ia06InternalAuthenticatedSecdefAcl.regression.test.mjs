import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261115230206_ia06_restrict_internal_authenticated_secdef_helpers.sql'), 'utf8');
const expected = new Map([
  ['patient_case_team_actor_can_manage_v1', '4a2f6c7bcda6443b01fac0135f920d4c'],
  ['school_actor_can_access_patient', 'b9887899e542dea01914eb50c4deb902'],
  ['school_actor_has_role', 'a124e1935eac3d672a17732a04767752'],
  ['school_consent_current_status', '279b75cd83b443563db3814b14978079'],
  ['guard_clinic_timezone_v1', '49d135135635138d4062f343699756e1'],
]);

test('IA-06 only restricts four reviewed authenticated helper RPCs and one installed trigger', () => {
  const rows = [...sql.matchAll(/\('([a-z][a-z0-9_]+)','([^']*)','([0-9a-f]{32})',(true|false),(\d+)\)/g)];
  assert.equal(rows.length, 5, 'Each target must be in the full preflight allowlist');
  for (const row of rows) {
    assert.equal(row[3], expected.get(row[1]), 'Exact function definition hash must be pinned: ' + row[1]);
    assert.ok(expected.has(row[1]));
  }
  assert.equal(new Set(rows.map((row) => row[1])).size, 5);
  assert.match(sql, /v_total <> 48 OR v_direct <> 47 OR v_trigger <> 1/);
  assert.match(sql, /IA06_FUNCTION_SIGNATURE_BODY_OR_ACL_DRIFT/);
  assert.match(sql, /IA06_POLICY_INVOKER_OR_VIEW_DEPENDENCY/);
  assert.match(sql, /IA06_DEFINER_CALLER_DRIFT/);
  assert.match(sql, /IA06_INSTALLED_TRIGGER_DRIFT/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /NOT has_function_privilege\('service_role',v_oid,'EXECUTE'\)/);
  assert.match(sql, /IA06_ACL_POSTCHECK_FAILED/);
  assert.match(sql, /IA06_AUTH_SECDEF_POSTCHECK_DRIFT/);
});

test('IA-06 never changes RLS, function implementations, clinical records or table DML grants', () => {
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(?:CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?(?:TABLE|FUNCTION|TRIGGER|POLICY|VIEW)\b/i);
  assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\./i);
  assert.doesNotMatch(executable, /REVOKE (?:ALL|SELECT|INSERT|UPDATE|DELETE|TRIGGER) ON TABLE/i);
});

test('IA-06 PostgreSQL: authenticated user cannot directly invoke helper, while installed privileged caller still can', {
  skip: process.env.VERTO_IA06_POSTGRES_TEST !== '1',
}, async () => {
  const client = new pg.Client();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE ROLE ia06_ci_actor NOLOGIN');
    await client.query('GRANT USAGE ON SCHEMA public TO ia06_ci_actor');
    await client.query(`
      CREATE FUNCTION public.ia06_ci_private(actor uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$ SELECT actor IS NOT NULL $$;
    `);
    await client.query(`
      CREATE FUNCTION public.ia06_ci_privileged_wrapper(actor uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$ SELECT public.ia06_ci_private(actor) $$;
    `);
    await client.query('GRANT EXECUTE ON FUNCTION public.ia06_ci_privileged_wrapper(uuid) TO ia06_ci_actor');
    await client.query('REVOKE EXECUTE ON FUNCTION public.ia06_ci_private(uuid) FROM PUBLIC, ia06_ci_actor');
    const granted = await client.query(
      "SELECT has_function_privilege('ia06_ci_actor','public.ia06_ci_private(uuid)','EXECUTE') AS allowed",
    );
    assert.equal(granted.rows[0].allowed, false);

    await client.query('SET LOCAL ROLE ia06_ci_actor');
    await client.query('SAVEPOINT ia06_denied');
    try {
      await client.query("SELECT public.ia06_ci_private('00000000-0000-4000-8000-000000000001'::uuid)");
      assert.fail('Direct privileged helper must not run for ordinary authenticated role');
    } catch (err) {
      assert.equal(err.code, '42501', 'Direct call must fail with insufficient privileges');
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT ia06_denied');
    }
    const viaPrivilegedCaller = await client.query(
      "SELECT public.ia06_ci_privileged_wrapper('00000000-0000-4000-8000-000000000001'::uuid) AS allowed",
    );
    assert.equal(viaPrivilegedCaller.rows[0].allowed, true);
    await client.query('RESET ROLE');
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { await client.end(); }
  }
});
