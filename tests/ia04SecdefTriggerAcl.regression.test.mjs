import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261115042000_ia04_secdef_trigger_execute_lockdown.sql'),
  'utf8',
);

test('IA-04 restricts exactly 34 installed trigger functions and no RLS helpers', () => {
  const match = migration.match(/FOR v_name IN SELECT unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\)/);
  assert.ok(match, 'Must use an explicit and reviewable trigger allowlist');
  const names = [...match[1].matchAll(/'([a-z][a-z0-9_]+)'/g)].map((item) => item[1]);
  assert.equal(names.length, 34);
  assert.equal(new Set(names).size, 34);
  assert.ok(names.includes('aba_summary_after_trial_insert'));
  assert.ok(names.includes('guard_aba_session_specialty_isolation_v1'));
  assert.ok(names.includes('enforce_patient_file_acl_write_v1'));
  for (const protectedHelper of [
    'can_access_clinic', 'can_manage_clinic', 'is_admin_or_owner',
    'is_platform_admin', 'is_platform_sales_admin',
    'patient_file_current_actor_can_read_v1',
    'school_actor_can_access_patient', 'school_actor_has_role',
    'therapeutic_plan_version_current_actor_can_read_v1',
    'therapeutic_program_row_actor_can_access_v1',
  ]) {
    assert.ok(!names.includes(protectedHelper), 'Do not block RLS/access helper ' + protectedHelper);
  }
});

test('IA-04 checks function type, owners, bindings, policy references, ACL and baseline', () => {
  for (const condition of [
    /IA04_TRIGGER_BASELINE_DRIFT/,
    /v_count <> 34/,
    /IA04_MISSING_OR_OVERLOADED_TRIGGER/,
    /p\.prosecdef/,
    /p\.prorettype = 'pg_catalog\.trigger'::regtype/,
    /pg_catalog\.pg_get_userbyid\(p\.proowner\) = 'postgres'/,
    /FROM pg_catalog\.pg_trigger t WHERE t\.tgfoid = v_oid AND NOT t\.tgisinternal/,
    /IA04_MISSING_INSTALLED_TRIGGER/,
    /FROM pg_catalog\.pg_policies pol/,
    /IA04_UNEXPECTED_POLICY_DEPENDENCY/,
    /REVOKE ALL ON FUNCTION public\.%I\(\) FROM PUBLIC, anon, authenticated/,
    /GRANT EXECUTE ON FUNCTION public\.%I\(\) TO service_role/,
    /has_function_privilege\('anon', v_oid, 'EXECUTE'\)/,
    /has_function_privilege\('authenticated', v_oid, 'EXECUTE'\)/,
    /has_function_privilege\('service_role', v_oid, 'EXECUTE'\)/,
  ]) {
    assert.match(migration, condition);
  }
});

test('IA-04 has no clinical writes, function rewrites, or trigger/policy changes', () => {
  const sql = migration.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+(?:or replace\s+)?(?:function|trigger|table|policy)\b/i);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(sql, /\b(?:disable|enable)\s+row\s+level\s+security\b/i);
});

// The dedicated PostgreSQL CI service proves that revoking direct EXECUTE
// does not stop an already-installed trigger firing under a low-privilege role.
// All sample DDL/DML is wrapped in a transaction that is always rolled back.
test('IA-04 PostgreSQL: trigger keeps firing when invoking role cannot EXECUTE function', {
  skip: process.env.VERTO_IA04_POSTGRES_TEST !== '1',
}, async () => {
  const client = new pg.Client();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE ROLE ia04_ci_actor NOLOGIN');
    await client.query('CREATE TABLE public.ia04_ci_probe (value integer NOT NULL)');
    await client.query(`
      CREATE FUNCTION public.ia04_ci_probe_fn() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
      AS $$
        BEGIN
          NEW.value := NEW.value + 1;
          RETURN NEW;
        END;
      $$;
    `);
    await client.query(`
      CREATE TRIGGER ia04_ci_before_insert BEFORE INSERT ON public.ia04_ci_probe
      FOR EACH ROW EXECUTE FUNCTION public.ia04_ci_probe_fn();
    `);
    await client.query('GRANT INSERT ON TABLE public.ia04_ci_probe TO ia04_ci_actor');
    await client.query('REVOKE ALL ON FUNCTION public.ia04_ci_probe_fn() FROM PUBLIC, ia04_ci_actor');

    const acl = await client.query(
      "SELECT has_function_privilege('ia04_ci_actor', 'public.ia04_ci_probe_fn()', 'EXECUTE') AS allowed",
    );
    assert.equal(acl.rows[0].allowed, false);

    await client.query('SET LOCAL ROLE ia04_ci_actor');
    await client.query('INSERT INTO public.ia04_ci_probe (value) VALUES (1)');
    await client.query('RESET ROLE');
    const after = await client.query('SELECT value FROM public.ia04_ci_probe');
    assert.deepEqual(after.rows.map((row) => row.value), [2]);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  }
});
