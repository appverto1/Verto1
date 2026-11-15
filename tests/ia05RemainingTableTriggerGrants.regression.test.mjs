import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const migration=readFileSync(join(process.cwd(),'supabase/migrations/20261115224110_ia05_remaining_public_table_trigger_grants_and_postgres_defaults.sql'),'utf8');

test('IA-05 removes only TRIGGER privileges from the reviewed remaining 120/140 table grants',()=>{
  assert.match(migration,/v_anon <> 120 OR v_auth <> 140/);
  assert.match(migration,/v_count <> 374/);
  assert.match(migration,/IA05_TABLE_OWNER_DRIFT/);
  assert.match(migration,/REVOKE TRIGGER ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(migration,/IA05_EXISTING_TRIGGER_BINDING_CHANGED/);
  assert.match(migration,/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated/);
  const executable=migration.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\./i);
  assert.doesNotMatch(executable,/REVOKE (?:ALL|SELECT|INSERT|UPDATE|DELETE) ON TABLE/i);
  assert.doesNotMatch(executable,/\b(?:CREATE|DROP|ALTER)\s+(?:OR REPLACE\s+)?(?:FUNCTION|TRIGGER|POLICY)\b/i);
});

test('IA-05 PostgreSQL: default grants stop giving TRIGGER to future tables', {
  skip:process.env.VERTO_IA05_POSTGRES_TEST!=='1',
},async()=>{
  const client=new pg.Client();
  await client.connect();
  try{
    await client.query('BEGIN');
    await client.query('CREATE ROLE ia05_ci_future NOLOGIN');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRIGGER ON TABLES TO ia05_ci_future');
    await client.query('CREATE TABLE public.ia05_future_before(x integer)');
    let x=await client.query("SELECT has_table_privilege('ia05_ci_future','public.ia05_future_before','TRIGGER') allowed");
    assert.equal(x.rows[0].allowed,true);
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRIGGER ON TABLES FROM ia05_ci_future');
    await client.query('CREATE TABLE public.ia05_future_after(x integer)');
    x=await client.query("SELECT has_table_privilege('ia05_ci_future','public.ia05_future_after','TRIGGER') allowed");
    assert.equal(x.rows[0].allowed,false);
  }finally{
    try{await client.query('ROLLBACK')}finally{await client.end()}
  }
});

const financialViewSql=readFileSync(join(process.cwd(),'supabase/migrations/20261115224340_ia05_financial_summary_view_trigger_acl.sql'),'utf8');

test('IA-05 financial view removes only public TRIGGER, retaining service_role',()=>{
  assert.match(financialViewSql,/patient_financial_appointment_summaries/);
  assert.match(financialViewSql,/c\.relkind='v'/);
  assert.match(financialViewSql,/REVOKE TRIGGER ON TABLE public\.patient_financial_appointment_summaries FROM PUBLIC, anon, authenticated/);
  assert.match(financialViewSql,/has_table_privilege\('service_role',v_oid,'TRIGGER'\)/);
  const executable=financialViewSql.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/i);
  assert.doesNotMatch(executable,/\b(?:CREATE|ALTER|DROP)\s+(?:VIEW|POLICY|TRIGGER|FUNCTION)\b/i);
});
