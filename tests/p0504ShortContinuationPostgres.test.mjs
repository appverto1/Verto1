import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

// No cloud database. Abort unless the existing disposable CI pg container is in use.
assert.equal(process.env.VERTO_GROUP_POSTGRES_TEST, '1');
assert.ok(['127.0.0.1', 'localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE, 'verto_group_regression');
const client = new pg.Client({application_name:'p0504_short_extension_fixture',statement_timeout:10000});
const uid=n=>'45000000-0000-4000-8000-'+String(n).padStart(12,'0');
const clinic=uid(1),otherClinic=uid(2),patient=uid(3),otherPatient=uid(4),
  professional=uid(5),otherProfessional=uid(6),original=uid(7),sessionId='p0504-synthetic-session';
const start=new Date(Date.now()-10*60_000);
const startIso=start.toISOString();
const end=new Date(start.getTime()+50*60_000);
const endIso=end.toISOString();
const call=async(id,minutes,key,actor=professional,clinicId=clinic)=>{
  const q=await client.query(
    'select public.extend_aba_session_short_v1($1,$2,$3,$4,$5) as result',
    [clinicId,actor,id,minutes,key]
  );return q.rows[0].result;
};
async function deny(fn, expected){
  await client.query('savepoint test_denied');
  try {await fn();assert.fail('Unexpected accepted request: '+expected);}
  catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,new RegExp(expected));}
  finally {await client.query('rollback to savepoint test_denied');await client.query('release savepoint test_denied');}
}
try{
  await client.connect();
  await client.query('begin');
  await client.query([
    'create role anon;create role authenticated;create role service_role;',
    'create schema auth;create function auth.uid() returns uuid language sql stable as $uid$select null::uuid$uid$;',
    'create table public.aba_sessions(id text primary key,clinic_id text,organization_id text,patient_id uuid,therapist_id text,appointment_id uuid,status text,started_at timestamptz,actual_start_at timestamptz,effective_end_at timestamptz,updated_at timestamptz);',
    'create table public.appointments(id uuid primary key,clinic_id uuid,organization_id uuid,patient_id uuid,therapist_id uuid,active_aba_session_id text,deleted_at timestamptz,is_active boolean,status text,source_payload jsonb,service_type text,scheduled_at timestamptz,scheduled_start_at timestamptz,scheduled_end_at timestamptz,scheduled_duration_minutes int,duration_minutes int,actual_start_at timestamptz,room_id text);',
    'create table public.test_roles(actor_id uuid,clinic_id uuid,role text,primary key(actor_id,clinic_id));',
    'create function public.verto_clinic_actor_role_v1(p_actor uuid,p_clinic uuid) returns text language sql stable as $role$select role from public.test_roles where actor_id=p_actor and clinic_id=p_clinic$role$;',
    "create function public.clinical_specialty_scope_key_v1(value text) returns text language sql immutable as $spec$select case when lower(coalesce(value,'')) like 'fono%' then 'speech_therapy' when lower(coalesce(value,'')) like 'terapia ocupacional%' then 'occupational_therapy' else null end$spec$;"
  ].join('\n'));
  const migration=fs.readFileSync('supabase/migrations/20261101194500_p0504_short_aba_continuation_v1.sql','utf8')
    .replace(/^begin;\s*/m,'').replace(/\s*commit;\s*$/,'');
  await client.query(migration);
  await client.query('insert into public.test_roles(actor_id,clinic_id,role) values ($1,$2,$3),($4,$5,$6)',
    [professional,clinic,'therapist',otherProfessional,clinic,'therapist']);
  await client.query("insert into public.aba_sessions(id,clinic_id,organization_id,patient_id,therapist_id,appointment_id,status,started_at,actual_start_at) values($1,$2,$2,$3,$4,$5,'in_progress',$6,$6)",
    [sessionId,clinic,patient,professional,original,startIso]);
  await client.query("insert into public.appointments(id,clinic_id,organization_id,patient_id,therapist_id,active_aba_session_id,is_active,status,source_payload,service_type,scheduled_at,scheduled_start_at,scheduled_end_at,scheduled_duration_minutes,duration_minutes,room_id) values($1,$2,$2,$3,$4,$5,true,'in_progress','{}'::jsonb,'Fonoaudiologia',$6,$6,$7,50,50,'Room A')",
    [original,clinic,patient,professional,sessionId,startIso,endIso]);
  const first=await call(sessionId,5,'synthetic-key-1');
  assert.equal(first.success,true);assert.equal(first.billableUnitsCreated,0);
  assert.equal(first.calendarReservationConfirmed,false);
  assert.equal(first.idempotentReplay,false);
  assert.equal(first.effectiveEndAt,new Date(end.getTime()+5*60_000).toISOString());
  const same=await call(sessionId,5,'synthetic-key-1');
  assert.equal(same.idempotentReplay,true);
  assert.equal(same.effectiveEndAt,first.effectiveEndAt);
  await deny(()=>call(sessionId,10,'synthetic-key-1'),'P0504_SHORT_EXTENSION_IDEMPOTENCY_CONFLICT');
  await deny(()=>call(sessionId,5,'synthetic-key-unauthorized',otherProfessional),'P0504_SHORT_EXTENSION_ACCESS_DENIED');
  await deny(()=>call(sessionId,5,'synthetic-key-tenant',professional,otherClinic),'P0504_SHORT_EXTENSION_ACCESS_DENIED');
  await deny(()=>call(sessionId,20,'synthetic-key-invalid'),'P0504_SHORT_EXTENSION_INVALID_INPUT');
  const count=(await client.query('select count(*)::integer as n from public.aba_session_continuation_operations_v1')).rows[0].n;
  assert.equal(count,1,'one immutable audit entry per successful request');
  const b=uid(8);
  await client.query("insert into public.appointments(id,clinic_id,organization_id,patient_id,therapist_id,is_active,status,source_payload,service_type,scheduled_at,scheduled_start_at,scheduled_end_at,scheduled_duration_minutes,duration_minutes,room_id) values($1,$2,$2,$3,$4,true,'scheduled','{}'::jsonb,'Fonoaudiologia',$5,$5,$6,50,50,'Room B')",
    [b,otherClinic,otherPatient,professional,
      new Date(end.getTime()+12*60_000).toISOString(),
      new Date(end.getTime()+62*60_000).toISOString()]);
  await deny(()=>call(sessionId,10,'synthetic-key-cross-clinic'),'P0504_SHORT_EXTENSION_CONFLICT_REQUIRES_REVIEW');
  assert.equal((await client.query('select status from public.appointments where id=$1',[b])).rows[0].status,'scheduled','B must never be cancelled');
  await client.query('delete from public.appointments where id=$1',[b]);
  const second=await call(sessionId,10,'synthetic-key-2');
  assert.equal(second.effectiveEndAt,new Date(end.getTime()+15*60_000).toISOString());
  assert.equal(second.billableUnitsCreated,0);
  assert.equal((await client.query('select count(*)::integer n from public.appointments')).rows[0].n,1);
  assert.equal((await client.query('select count(*)::integer n from public.aba_session_continuation_operations_v1')).rows[0].n,2);
  console.log('P0-504 short extension PostgreSQL: PASS (idempotency, cross-clinic conflict, role and no billing).');
} finally {try{await client.query('rollback');}finally{await client.end();}}
