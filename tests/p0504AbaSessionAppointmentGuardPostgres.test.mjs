import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
// This test only uses the disposable GitHub Actions PostgreSQL service.
assert.equal(process.env.VERTO_GROUP_POSTGRES_TEST,'1');
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));
assert.equal(process.env.PGDATABASE,'verto_group_regression');
const client=new pg.Client({application_name:'p0504_aba_scope_regression',statement_timeout:10000});
const id=n=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0');
const clinic=id(1),otherClinic=id(2),patient=id(3),otherPatient=id(4);
const therapist=id(5),appointment=id(6);
async function deny(sql,args,marker){
  await client.query('SAVEPOINT expected_rejection');
  try {await client.query(sql,args);assert.fail('Expected '+marker);}
  catch(error){if(error?.code==='ERR_ASSERTION')throw error;assert.match(String(error.message),new RegExp(marker));}
  finally {await client.query('ROLLBACK TO SAVEPOINT expected_rejection');await client.query('RELEASE SAVEPOINT expected_rejection');}
}
try {
  await client.connect();await client.query('BEGIN');
  await client.query([
    'create role anon;create role authenticated;create role service_role;',
    'create table public.appointments(id uuid primary key,patient_id uuid,clinic_id uuid,organization_id uuid,therapist_id uuid,scheduled_at timestamptz,scheduled_start_at timestamptz,scheduled_end_at timestamptz,scheduled_duration_minutes integer,duration_minutes integer,room_id text,service_type text,approach text,source_payload jsonb,status text,deleted_at timestamptz,is_active boolean);',
    'create table public.aba_sessions(id text primary key,appointment_id uuid,patient_id uuid,clinic_id text,organization_id text,therapist_id text,service_type text,scheduled_start_at timestamptz,scheduled_end_at timestamptz,scheduled_duration_minutes integer,room_id text,status text);',
    "create function public.clinical_specialty_scope_key_v1(value text) returns text language sql immutable as $fn$select case when lower(coalesce(value,'')) like 'fono%' then 'speech_therapy' when lower(coalesce(value,'')) like 'terapia ocupacional%' or lower(coalesce(value,''))='to' then 'occupational_therapy' else null end$fn$;"
  ].join('\n'));
  const migration=fs.readFileSync('supabase/migrations/20261101184000_p0504_aba_session_canonical_appointment_guard_v1.sql','utf8').replace(/^begin;\s*/m,'').replace(/\s*commit;\s*$/,'');
  await client.query(migration);
  await client.query("insert into public.appointments(id,patient_id,clinic_id,organization_id,therapist_id,scheduled_at,scheduled_start_at,scheduled_end_at,duration_minutes,scheduled_duration_minutes,room_id,service_type,source_payload,status,is_active) values ($1,$2,$3,$3,$4,'2026-11-02T18:00:00Z','2026-11-02T18:00:00Z','2026-11-02T18:50:00Z',50,50,'room-server','Fonoaudiologia','{\"specialty\":\"Fonoaudiologia\"}'::jsonb,'in_progress',true)",[appointment,patient,clinic,therapist]);
  const insert="insert into public.aba_sessions(id,appointment_id,patient_id,clinic_id,organization_id,therapist_id,service_type,scheduled_start_at,scheduled_end_at,scheduled_duration_minutes,room_id,status) values($1,$2,$3,$4,$5,$6,$7,'2099-01-01T00:00:00Z','2099-01-01T01:00:00Z',60,'forged-room','in_progress') returning *";
  const row=(await client.query(insert,['canonical',appointment,patient,clinic,clinic,therapist,'ABA'])).rows[0];
  assert.equal(row.scheduled_start_at.toISOString(),'2026-11-02T18:00:00.000Z');
  assert.equal(row.scheduled_end_at.toISOString(),'2026-11-02T18:50:00.000Z');
  assert.equal(row.scheduled_duration_minutes,50);assert.equal(row.room_id,'room-server');
  assert.equal(row.service_type,'Fonoaudiologia');assert.equal(row.therapist_id,therapist);
  await deny(insert,['bad-patient',appointment,otherPatient,clinic,clinic,therapist,'ABA'],'P0504_SESSION_APPOINTMENT_SCOPE_INVALID');
  await deny(insert,['bad-clinic',appointment,patient,otherClinic,otherClinic,therapist,'ABA'],'P0504_SESSION_APPOINTMENT_SCOPE_INVALID');
  await deny(insert,['bad-org',appointment,patient,clinic,otherClinic,therapist,'ABA'],'P0504_SESSION_APPOINTMENT_SCOPE_INVALID');
  await deny(insert,['bad-therapist',appointment,patient,clinic,clinic,id(20),'ABA'],'P0504_SESSION_PROFESSIONAL_MISMATCH');
  await deny(insert,['bad-specialty',appointment,patient,clinic,clinic,therapist,'Terapia Ocupacional'],'P0504_SESSION_SPECIALTY_MISMATCH');
  await deny(insert,['bad-appointment',id(30),patient,clinic,clinic,therapist,'ABA'],'P0504_SESSION_APPOINTMENT_SCOPE_INVALID');
  await deny('update public.aba_sessions set room_id=$1 where id=$2',['attacker-room','canonical'],'P0504_SESSION_CANONICAL_SNAPSHOT_IMMUTABLE');
  await deny('update public.aba_sessions set patient_id=$1 where id=$2',[otherPatient,'canonical'],'P0504_SESSION_SCOPE_IMMUTABLE');
  await client.query("update public.aba_sessions set status='completed' where id='canonical'");
  const legacy=(await client.query("insert into public.aba_sessions(id,clinic_id,patient_id,status) values('legacy',$1,$2,'active') returning id",[clinic,patient])).rows[0];
  assert.equal(legacy.id,'legacy');
  assert.equal((await client.query('select count(*)::integer as n from public.appointments')).rows[0].n,1);
  console.log('P0-504 PostgreSQL canonical appointment guard: PASS');
} finally {try{await client.query('ROLLBACK');}finally{await client.end();}}
