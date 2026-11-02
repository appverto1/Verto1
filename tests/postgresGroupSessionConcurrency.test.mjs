import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { shiftGroupFixtureDates } from './helpers/groupSessionFixtureDates.mjs';

// This test requires the disposable PostgreSQL 17 CI service, never Supabase.
assert.equal(process.env.VERTO_GROUP_POSTGRES_TEST,'1','requires the isolated CI PostgreSQL service');
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST),'refuse remote databases');
assert.equal(process.env.PGDATABASE,'verto_group_regression','refuse non-test databases');
const pool=new pg.Pool({max:8,application_name:'verto_group_concurrency',statement_timeout:10000});
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),actor=id(2),primary=id(3),secondary=id(4),room=id(5);
const patients=[id(10),id(11),id(12),id(13)];
const scalar=async(client,sql,args=[])=>Object.values((await client.query(shiftGroupFixtureDates(sql),args.map(shiftGroupFixtureDates))).rows[0])[0];
const create=(client,key,date,selected=patients.slice(0,2))=>scalar(client,
  'select reserve_group_sessions_v1($1,$2,$3::uuid[],$4::uuid[],$5,$6,$7::jsonb,50,$8)',
  [clinic,actor,selected,[primary,secondary],'Fonoaudiólogo',room,JSON.stringify([{date,time:'10:00'}]),key]);
const counts=async()=>Object.fromEntries(await Promise.all(['appointments','payments','group_session_bookings','group_session_participants','group_session_operations'].map(async table=>[table,await scalar(pool,'select count(*)::int from '+table)])));
const clients=[];
async function transactionClient(){const client=await pool.connect();clients.push(client);await client.query('begin');return client;}
async function finish(client,action='commit'){await client.query(action);client.release();clients.splice(clients.indexOf(client),1);}
// Verify a second connection actually waits for the lock before releasing it.
async function waitForLock(){
  for(let n=0;n<100;n++){
    if(await scalar(pool,"select exists(select 1 from pg_stat_activity where application_name='verto_group_concurrency' and wait_event_type='Lock')"))return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error('expected concurrent connection to wait for the transactional lock');
}
try{
  await pool.query("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;");
  for(const file of ['staging-schema.sql','staging-clinic-state.sql','staging-support-functions.sql','staging-finance.sql','staging-finance-triggers.sql','staging-finance-side-triggers.sql'])await pool.query(fs.readFileSync('tests/fixtures/groupSessions/'+file,'utf8'));
  for(const file of fs.readdirSync('supabase/migrations').filter(name=>/^2026101[56].*group_/.test(name)).sort())await pool.query(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await pool.query("insert into clinics(id,name,school_organization_id) values ($1,'Concurrency fictitious clinic',$1)",[clinic]);
  for(const [who,role]of [[actor,'director'],[primary,'therapist'],[secondary,'therapist']]){
    await pool.query('insert into users(id,email,clinic_id) values ($1,$2,$3)',[who,who+'@example.invalid',clinic]);
    await pool.query("insert into clinic_memberships(user_id,clinic_id,role,status,specialty) values ($1,$2,$3,'active','Fonoaudiólogo')",[who,clinic,role]);
  }
  await pool.query("insert into clinic_rooms(id,clinic_id,organization_id,name,capacity) values($1,$2,$2,'Concurrency fictitious room',3)",[room,clinic]);
  for(let n=0;n<patients.length;n++){
    await pool.query("insert into patients(id,name,clinic_id) values($1,$2,$3)",[patients[n],'Fictitious participant '+n,clinic]);
    await scalar(pool,'select reconcile_patient_financial_plans_v2($1,$2,$3,$4::jsonb,false)',[clinic,patients[n],actor,JSON.stringify([{id:id(20+n),client_plan_key:id(20+n),service_type:'SPEECH_THERAPY',service_name_snapshot:'Fonoaudiólogo',billing_mode:'PRIVATE',billing_frequency:'AT_SESSION',pricing_unit:'SESSION',amount_cents:15000,group_amount_cents:8000}])]);
  }
  // Duplicate request: second connection waits, then replays the same identity.
  let a=await transactionClient();const first=await create(a,'concurrent-identical-key','2026-11-02');
  const duplicate=create(pool,'concurrent-identical-key','2026-11-02');await waitForLock();await finish(a);
  const replay=await duplicate;assert.equal(replay.idempotent,true);assert.equal(replay.bookings[0].id,first.bookings[0].id);
  assert.deepEqual(await counts(),{appointments:2,payments:2,group_session_bookings:1,group_session_participants:2,group_session_operations:1});
  // Distinct keys cannot reserve one room/team twice.
  a=await transactionClient();await create(a,'concurrent-distinct-first','2026-11-03');
  let competing=create(pool,'concurrent-distinct-second','2026-11-03').then(value=>({value}),error=>({error}));
  await waitForLock();await finish(a);assert.match((await competing).error?.message||'',/GROUP_BOOKING_(SLOT|PROFESSIONAL|ROOM)_BUSY/);
  // GROUP commits before an individual insert that was waiting on its lock.
  a=await transactionClient();await create(a,'concurrent-group-v-individual','2026-11-04');
  competing=pool.query(shiftGroupFixtureDates("insert into appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,service_type,approach,room_id,care_setting) values($1,$1,$2,$3,'2026-11-04T13:00:00Z','Fonoaudiólogo','Fonoaudiólogo',$4,'CLINIC')"),[clinic,patients[2],secondary,room]).then(value=>({value}),error=>({error}));
  await waitForLock();await finish(a);assert.match((await competing).error?.message||'',/GROUP_BOOKING_SLOT_BUSY/);
  // Individual commits first; the GROUP transaction must see it after waiting.
  a=await transactionClient();await a.query(shiftGroupFixtureDates("insert into appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,service_type,approach,room_id,care_setting) values($1,$1,$2,$3,'2026-11-05T13:00:00Z','Fonoaudiólogo','Fonoaudiólogo',$4,'CLINIC')"),[clinic,patients[2],secondary,room]);
  competing=create(pool,'concurrent-individual-v-group','2026-11-05').then(value=>({value}),error=>({error}));
  await waitForLock();await finish(a);assert.match((await competing).error?.message||'',/GROUP_BOOKING_(PROFESSIONAL|ROOM)_BUSY/);
  // Only one of two concurrent joins can consume the final room place.
  const group=await create(pool,'concurrent-capacity-base','2026-11-06');const booking=group.bookings[0].id;
  const join=(client,patient,key)=>scalar(client,'select join_group_session_v1($1,$2,$3,array[$4]::uuid[],$5)',[clinic,actor,booking,patient,key]);
  a=await transactionClient();await join(a,patients[2],'concurrent-capacity-join-a');
  competing=join(pool,patients[3],'concurrent-capacity-join-b').then(value=>({value}),error=>({error}));
  await waitForLock();await finish(a);assert.match((await competing).error?.message||'',/GROUP_ROOM_CAPACITY_EXCEEDED/);
  assert.equal(await scalar(pool,'select count(*)::int from group_session_participants where booking_id=$1',[booking]),3);
  // Price edit holds the patient lock; reservation must use the committed rate.
  a=await transactionClient();const plan=await scalar(a,"select id from patient_financial_plans where patient_id=$1 and status='ACTIVE'",[patients[0]]);
  await scalar(a,'select update_patient_specialty_group_rate_v1($1,$2,$3,$4,9500)',[clinic,patients[0],plan,actor]);
  const priceRace=create(pool,'concurrent-canonical-price','2026-11-09');await waitForLock();await finish(a);
  const priced=await priceRace;assert.equal(priced.participants.find(p=>p.patient_id===patients[0]).unit_amount_cents,9500);
  // Denied calls cannot fabricate clinic membership or invoke service-only RPCs.
  const beforeDenied=await counts();
  await assert.rejects(()=>scalar(pool,"select reserve_group_sessions_v1($1,$2,$3::uuid[],$4::uuid[],'Fonoaudiólogo',$5,$6::jsonb,50,'concurrent-unauthorized')",[clinic,id(99),patients.slice(0,2),[primary],room,JSON.stringify([{date:'2026-11-10',time:'10:00'}])]),/GROUP_ACTOR_OUT_OF_SCOPE/);
  for(const role of ['anon','authenticated']){
    a=await transactionClient();await a.query('set local role '+role);
    await assert.rejects(()=>create(a,'concurrent-role-denied','2026-11-10'),/permission denied/);await finish(a,'rollback');
  }
  assert.deepEqual(await counts(),beforeDenied);
  console.log('PostgreSQL 17 multi-connection: duplicate/distinct keys, GROUP↔individual, join capacity, canonical price race and permissions passed');
}finally{
  for(const client of clients){await client.query('rollback').catch(()=>{});client.release();}
  await pool.end();
}
