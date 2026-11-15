import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261115233141_ia06_bind_secdef_role_queries_to_session_actor.sql'), 'utf8');
const names = [
  'can_access_clinic',
  'can_manage_clinic',
  'is_platform_admin',
  'school_actor_effective_role',
];
const functionDefinitions = migration.match(
  /CREATE OR REPLACE FUNCTION public\.(?:can_access_clinic|can_manage_clinic|is_platform_admin|school_actor_effective_role)\([\s\S]*?\$function\$;/g,
) ?? [];

test('IA-06 limits exactly four identity-bearing helpers to current actor or service role', () => {
  assert.equal(functionDefinitions.length, 4);
  for (const name of names) {
    assert.ok(functionDefinitions.some((definition) => definition.startsWith('CREATE OR REPLACE FUNCTION public.' + name + '(')));
  }
  assert.match(migration, /IA06_AUTH_FUNCTION_BASELINE_DRIFT/);
  assert.match(migration, /IA06_AUTH_HELPER_DEFINITION_DRIFT/);
  assert.match(migration, /IA06_RLS_ACTOR_ARGUMENT_DRIFT/);
  assert.match(migration, /IA06_UNEXPECTED_INVOKER_OR_VIEW/);
  assert.match(migration, /IA06_SELF_ACTOR_GUARD_POSTCHECK_FAILED/);
  for (const def of functionDefinitions) {
    assert.match(def, /auth\.uid\(\) IS NOT NULL/);
    assert.match(def, /(?:target_user|p_actor_id) = auth\.uid\(\)/);
    assert.match(def, /current_setting\('request\.jwt\.claim\.role', true\) = 'service_role'/);
    assert.match(def, /STABLE SECURITY DEFINER/);
    assert.match(def, /SET search_path TO 'public'/);
  }
});

test('IA-06 does not change policies, ACL grants, tables or clinical records', () => {
  assert.equal((migration.match(/\bCREATE OR REPLACE FUNCTION public\./g) || []).length, 4);
  assert.doesNotMatch(migration, /\b(?:CREATE|ALTER|DROP) POLICY\b/i);
  assert.doesNotMatch(migration, /\b(?:CREATE|DROP|ALTER) TABLE\b/i);
  assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE)\b\s+(?:ALL|EXECUTE|SELECT|INSERT|UPDATE|DELETE|TRIGGER)\s+ON\b/i);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\./i);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
});

// Executes the SAME function definitions as the staging migration against
// transaction-scoped fixtures, with a mock Supabase auth.uid() and two clinics.
test('IA-06 PostgreSQL: own actor passes, forged actor fails, existing RLS and service path remain', {
  skip: process.env.VERTO_IA06_POSTGRES_TEST !== '1',
}, async () => {
  const client = new pg.Client();
  const actorA = '11111111-1111-4111-8111-111111111111';
  const actorB = '22222222-2222-4222-8222-222222222222';
  const clinicA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clinicB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS auth');
    await client.query(`
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $auth$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $auth$;
    `);
    await client.query('CREATE ROLE ia06_ci_actor NOLOGIN');
    await client.query('CREATE TABLE public.clinic_memberships (user_id uuid NOT NULL, clinic_id uuid NOT NULL, status text NOT NULL, role text NOT NULL)');
    await client.query('CREATE TABLE public.platform_admins (user_id uuid NOT NULL, active boolean NOT NULL)');
    await client.query('CREATE TABLE public.clinics (id uuid PRIMARY KEY, owner_user_id uuid)');
    await client.query('CREATE TABLE public.users (id uuid NOT NULL, clinic_id uuid NOT NULL, role text NOT NULL)');
    await client.query(
      'INSERT INTO public.clinic_memberships(user_id,clinic_id,status,role) VALUES ($1,$3,$5,$6),($2,$4,$5,$6)',
      [actorA, actorB, clinicA, clinicB, 'active', 'coordinator'],
    );
    await client.query('INSERT INTO public.platform_admins(user_id,active) VALUES($1,true)', [actorB]);
    await client.query('INSERT INTO public.clinics(id,owner_user_id) VALUES($1,null),($2,$3)', [clinicA,clinicB,actorB]);
    for (const definition of functionDefinitions) await client.query(definition);
    await client.query('GRANT USAGE ON SCHEMA public, auth TO ia06_ci_actor');
    await client.query('GRANT EXECUTE ON FUNCTION public.can_access_clinic(uuid,uuid) TO ia06_ci_actor');
    await client.query('GRANT EXECUTE ON FUNCTION public.can_manage_clinic(uuid,uuid) TO ia06_ci_actor');
    await client.query('GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO ia06_ci_actor');
    await client.query('GRANT EXECUTE ON FUNCTION public.school_actor_effective_role(uuid,uuid) TO ia06_ci_actor');

    await client.query('CREATE TABLE public.ia06_ci_records(clinic_id uuid NOT NULL, label text)');
    await client.query('INSERT INTO public.ia06_ci_records VALUES($1,$2),($3,$4)',[clinicA,'own',clinicB,'other']);
    await client.query('GRANT SELECT ON public.ia06_ci_records TO ia06_ci_actor');
    await client.query('ALTER TABLE public.ia06_ci_records ENABLE ROW LEVEL SECURITY');
    await client.query('CREATE POLICY ia06_ci_actor_scope ON public.ia06_ci_records FOR SELECT TO ia06_ci_actor USING(public.can_access_clinic(clinic_id,auth.uid()))');

    await client.query("SELECT set_config('request.jwt.claim.role','authenticated',true)");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actorA]);
    await client.query('SET LOCAL ROLE ia06_ci_actor');
    const own = (await client.query(
      `SELECT public.can_access_clinic($1,$2) AS access,
        public.can_manage_clinic($1,$2) AS manage,
        public.school_actor_effective_role($2,$1) AS role,
        public.is_platform_admin($2) AS admin`, [clinicA,actorA],
    )).rows[0];
    assert.deepEqual(own,{access:true,manage:true,role:'coordinator',admin:false});

    const forged = (await client.query(
      `SELECT public.can_access_clinic($1,$2) AS access,
        public.can_manage_clinic($1,$2) AS manage,
        public.school_actor_effective_role($2,$1) AS role,
        public.is_platform_admin($2) AS admin`,[clinicB,actorB],
    )).rows[0];
    assert.deepEqual(forged,{access:false,manage:false,role:null,admin:false});

    const scoped = await client.query('SELECT label FROM public.ia06_ci_records ORDER BY label');
    assert.deepEqual(scoped.rows.map(row=>row.label),['own']);

    await client.query("SELECT set_config('request.jwt.claim.sub','',true)");
    const withoutSession = (await client.query(
      'SELECT public.can_access_clinic($1,$2) AS allowed,public.school_actor_effective_role($2,$1) AS role',
      [clinicA,actorA],
    )).rows[0];
    assert.deepEqual(withoutSession,{allowed:false,role:null});

    await client.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
    const service = (await client.query(
      'SELECT public.can_access_clinic($1,$2) AS allowed,public.is_platform_admin($2) AS admin,public.school_actor_effective_role($2,$1) AS role',
      [clinicB,actorB],
    )).rows[0];
    assert.deepEqual(service,{allowed:true,admin:true,role:'owner'});
    await client.query('RESET ROLE');
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { await client.end(); }
  }
});
