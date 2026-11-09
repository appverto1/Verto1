import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {buildGroupStagingMigrationBundle} from '../scripts/build-group-staging-migration-bundle.mjs';

const sql=buildGroupStagingMigrationBundle();
assert.equal(sql,fs.readFileSync('supabase/operations/group_sessions_staging_remaining.sql','utf8'),'delivered SQL exactly matches the reviewed sources');
const db=new PGlite();
const scalar=async text=>Object.values((await db.query(text)).rows[0])[0];
async function rejects(script,pattern){await assert.rejects(()=>db.exec(script),pattern);await db.exec('rollback');}
try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);");
  for(const file of ['staging-schema.sql','staging-clinic-state.sql','staging-support-functions.sql','staging-finance.sql','staging-finance-triggers.sql','staging-finance-side-triggers.sql'])await db.exec(fs.readFileSync('tests/fixtures/groupSessions/'+file,'utf8'));
  const first=fs.readdirSync('supabase/migrations').filter(name=>/^2026101[56].*group_.*\.sql$/.test(name)).sort().slice(0,3);
  for(const file of first)await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261016150342','group_session_specialty_rates'),('20261016150343','group_session_private_rate_authority'),('20261016150345','group_financial_rate_atomic_update');");
  await rejects(sql,/VERTO_STAGING_TARGET_REQUIRED/);
  await db.exec("insert into clinics(id,name,school_organization_id,is_demo,billing_model) values('db03af60-8804-49f3-ba45-b47b67712077','HOMOLOGAÇÃO FICTÍCIA SESSÕES EM GRUPO','db03af60-8804-49f3-ba45-b47b67712077',true,'demo');");
  await db.exec("insert into supabase_migrations.schema_migrations(version,name) values('20261015211500','group_session_booking_ledger');");
  await rejects(sql,/VERTO_GROUP_PARTIAL_MIGRATION/);
  await db.exec("delete from supabase_migrations.schema_migrations where version='20261015211500';");
  await rejects(sql.replace("notify pgrst,'reload schema';","select 1/0;"),/division by zero/);
  assert.equal(await scalar("select to_regclass('public.group_session_bookings')::text"),null,'final-step failure rolls back all DDL');
  assert.equal(await scalar('select count(*)::int from supabase_migrations.schema_migrations'),3,'final-step failure rolls back history');
  await db.exec(sql);
  assert.equal(await scalar('select count(*)::int from supabase_migrations.schema_migrations'),12);
  assert.ok(await scalar("select to_regprocedure('public.join_group_session_v1(uuid,uuid,uuid,uuid[],text)')::text"));
  assert.equal(await scalar("select has_function_privilege('authenticated','public.reserve_group_sessions_v1(uuid,uuid,uuid[],uuid[],text,uuid,jsonb,integer,text)','EXECUTE')"),false);
  await db.exec(sql);assert.equal(await scalar('select count(*)::int from supabase_migrations.schema_migrations'),12,'complete replay is a no-op');
  await db.exec("update clinics set is_demo=false where id='db03af60-8804-49f3-ba45-b47b67712077';");
  await rejects(sql,/VERTO_STAGING_TARGET_REQUIRED/);
  console.log('groupSessionMigrationBundle: exact source parity, Staging-only guard, partial-history denial, all-nine atomic rollback, private RPC grants and idempotent replay passed');
}finally{await db.close();}
