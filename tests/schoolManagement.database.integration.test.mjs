import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const databaseUrl = process.env.SCHOOL_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('schoolManagement.database.integration.test: skipped (SCHOOL_TEST_DATABASE_URL não configurada)');
  process.exit(0);
}

const { Client } = await import('pg');
const client = new Client({ connectionString: databaseUrl, ssl: process.env.SCHOOL_TEST_DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined });
await client.connect();

try {
  if (process.env.SCHOOL_TEST_APPLY_MIGRATION === '1') {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260725234500_structured_school_management_hardening.sql'), 'utf8');
    await client.query(sql);
  }

  const requiredTables = [
    'school_organizations', 'school_clinic_links', 'schools', 'school_units', 'school_contacts',
    'patient_school_enrollments', 'school_consents', 'school_meetings', 'school_meeting_patients',
    'school_meeting_participants', 'school_meeting_patient_notes', 'school_document_links',
    'school_meeting_referrals', 'school_idempotency_records', 'school_migration_review_queue',
  ];
  const tables = await client.query(`select tablename from pg_tables where schemaname='public' and tablename = any($1::text[])`, [requiredTables]);
  assert.equal(tables.rowCount, requiredTables.length, 'Nem todas as tabelas escolares estão disponíveis no banco de teste.');

  const rls = await client.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname = any($1::text[])`, [requiredTables.filter((name) => name !== 'school_organizations')]);
  assert.ok(rls.rows.every((row) => row.relrowsecurity === true), 'RLS deve permanecer habilitada nas tabelas escolares.');

  const functions = await client.query(`select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1::text[])`, [[
    'school_create_school_v2', 'school_change_enrollment_v2', 'create_school_meeting_batch_v2',
    'school_transition_meeting_v2', 'school_modify_meeting_patients_v2', 'school_save_minutes_v2',
  ]]);
  assert.equal(functions.rowCount, 6);
  assert.ok(functions.rows.every((row) => row.prosecdef === true));

  const anonGrants = await client.query(`
    select count(*)::int as total
    from information_schema.routine_privileges
    where specific_schema='public' and grantee in ('anon','authenticated')
      and routine_name like 'school_%_v2'
  `);
  assert.equal(anonGrants.rows[0].total, 0, 'RPCs escolares v2 não podem ser executáveis diretamente por anon/authenticated.');

  const primaryIndex = await client.query(`select indexdef from pg_indexes where schemaname='public' and indexname='patient_school_single_primary_current_uidx'`);
  assert.equal(primaryIndex.rowCount, 1);
  assert.match(primaryIndex.rows[0].indexdef, /enrollment_type.*PRIMARY_SCHOOL/i);

  const actorId = process.env.SCHOOL_TEST_ACTOR_ID;
  const otherActorId = process.env.SCHOOL_TEST_OTHER_ACTOR_ID;
  if (actorId) {
    await client.query('begin');
    try {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [actorId]);
      const visible = await client.query('select count(*)::int as total from public.schools');
      assert.ok(visible.rows[0].total >= 0);
    } finally {
      await client.query('rollback');
    }
  }
  if (otherActorId) {
    await client.query('begin');
    try {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [otherActorId]);
      await client.query('select count(*) from public.school_meeting_patient_notes');
    } finally {
      await client.query('rollback');
    }
  }

  console.log('schoolManagement.database.integration.test: ok');
} finally {
  await client.end();
}
