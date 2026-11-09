import assert from 'node:assert/strict';
import { shiftGroupFixtureDates } from './helpers/groupSessionFixtureDates.mjs';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL 17, real PL/pgSQL and constraints. No production/staging credentials.
// The schema snapshot contains definitions only, captured from Staging 2026-10-16.
const db = new PGlite();
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1), otherClinic=id(2), actor=id(3), therapist=id(4), patient=id(5), room=id(6);
const query = async (sql, args=[]) => (await db.query(shiftGroupFixtureDates(sql),args.map(shiftGroupFixtureDates))).rows;
const scalar = async (sql,args=[]) => Object.values((await query(sql,args))[0])[0];
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(fs.readFileSync('tests/fixtures/groupSessions/staging-schema.sql','utf8'));
  await db.exec(fs.readFileSync('tests/fixtures/groupSessions/staging-support-functions.sql','utf8'));
  for (const name of fs.readdirSync('supabase/operations/promotion_staging_sources').filter(name=>/^20261015.*group_/.test(name)).sort()) {
    await db.exec(fs.readFileSync('supabase/operations/promotion_staging_sources/'+name,'utf8'));
  }
  await query('insert into clinics(id,name,school_organization_id) values ($1,\'Teste Grupo\',$1),($2,\'Outra clínica fictícia\',$2)',[clinic,otherClinic]);
  await query('insert into users(id,email,clinic_id) values ($1,\'group-actor@example.invalid\',$3),($2,\'group-therapist@example.invalid\',$3)',[actor,therapist,clinic]);
  await query("insert into clinic_memberships(user_id,clinic_id,role,status,specialty) values ($1,$3,'director','active',null),($2,$3,'therapist','active','Fonoaudiólogo')",[actor,therapist,clinic]);
  await query("insert into patients(id,name,clinic_id) values ($1,'Paciente fictício',$2)",[patient,clinic]);
  await query("insert into clinic_rooms(id,clinic_id,organization_id,name,capacity) values ($1,$2,$2,'Sala fictícia',4)",[room,clinic]);
  const reconcile=async plans=>scalar('select reconcile_patient_financial_plans_v2($1,$2,$3,$4::jsonb,false)',[clinic,patient,actor,JSON.stringify(plans)]);
  const row={id:id(7),client_plan_key:id(7),service_type:'SPEECH_THERAPY',service_name_snapshot:'Fonoaudiólogo',billing_mode:'PRIVATE',amount_cents:15000,group_amount_cents:8000};
  assert.equal((await reconcile([row])).success,true);
  let plan=(await query('select * from patient_financial_plans where patient_id=$1 and status=\'ACTIVE\'',[patient]))[0];
  assert.equal(plan.group_amount_cents,8000);
  const legacy={...plan};delete legacy.group_amount_cents;
  await reconcile([legacy]);
  assert.equal(await scalar('select group_amount_cents from patient_financial_plans where id=$1',[plan.id]),8000,'omitted group price survives legacy Save');
  assert.equal(await scalar('select amount_cents from patient_financial_plans where id=$1',[plan.id]),15000);
  const resolve=async (scope=clinic,specialty='Fonoaudiólogo')=>scalar("select resolve_group_patient_private_rate_v1($1,$2,$3,'2026-11-02T13:00:00Z')",[scope,patient,specialty]);
  assert.equal((await resolve()).group_amount_cents,8000);
  assert.equal((await resolve(otherClinic)).code,'GROUP_RATE_PATIENT_OUT_OF_SCOPE');
  assert.equal((await resolve(clinic,'Nutricionista')).code,'GROUP_RATE_PLAN_MISSING');
  // Freeze the plan in the actual GROUP ledger before any payment exists.
  const booking=id(8),appointment=id(9);
  await query("insert into group_session_bookings(id,organization_id,booking_key,payload_hash,specialty,scheduled_start_at,scheduled_end_at,room_id,professional_ids,created_by) values ($1,$2,'postgres-test-group',repeat('a',64),'Fonoaudiólogo','2026-11-02T13:00:00Z','2026-11-02T13:50:00Z',$3,array[$4]::uuid[],$5)",[booking,clinic,room,therapist,actor]);
  await query("insert into appointments(id,clinic_id,patient_id,therapist_id,scheduled_at,scheduled_start_at,scheduled_end_at,scheduled_duration_minutes,duration_minutes,room_id,service_type,source_payload) values ($1,$2,$3,$4,'2026-11-02T13:00:00Z','2026-11-02T13:00:00Z','2026-11-02T13:50:00Z',50,50,$5,'Fonoaudiólogo',$6::jsonb)",[appointment,clinic,patient,therapist,room,JSON.stringify({sessionGroupId:booking,sessionModality:'GROUP',professionalIds:[therapist]})]);
  await query('insert into group_session_participants(booking_id,organization_id,patient_id,appointment_id,financial_plan_id,unit_amount_cents) values ($1,$2,$3,$4,$5,8000)',[booking,clinic,patient,appointment,plan.id]);
  const update=async (planId,cents,scope=clinic,who=actor)=>scalar('select update_patient_specialty_group_rate_v1($1,$2,$3,$4,$5)',[scope,patient,planId,who,cents]);
  const updated=await update(plan.id,9500);
  assert.equal(updated.success,true);
  assert.notEqual(updated.financial_plan_id,plan.id,'referenced plan must be versioned');
  assert.equal(await scalar('select group_amount_cents from patient_financial_plans where id=$1',[plan.id]),8000,'historical plan unchanged');
  assert.equal(await scalar('select amount_cents from patient_financial_plans where id=$1',[updated.financial_plan_id]),15000,'individual price unchanged');
  assert.equal((await update(plan.id,9500)).success,true,'identical retry is safe');
  assert.equal((await update(plan.id,9000)).code,'GROUP_RATE_STALE_PLAN');
  assert.equal((await update(updated.financial_plan_id,0)).success,true);
  assert.equal((await resolve()).code,'GROUP_RATE_NOT_CONFIGURED','never fall back to the individual rate');
  assert.equal((await update(updated.financial_plan_id,9000,otherClinic)).success,false);
  assert.equal((await update(updated.financial_plan_id,9000,clinic,id(99))).success,false);
  // Removing a plan that is already linked must end it rather than delete history.
  await reconcile([]);
  assert.equal(await scalar('select count(*)::int from patient_financial_plans where id=$1',[plan.id]),1);
  assert.equal(await scalar('select unit_amount_cents from group_session_participants where booking_id=$1',[booking]),8000);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(()=>query('select * from group_session_participants'),/permission denied/);
    await assert.rejects(()=>resolve(),/permission denied/);
    await assert.rejects(()=>update(plan.id,9000),/permission denied/);
    await db.exec('reset role');
  }
  console.log('groupSessionPostgres: 5 migrations, Save/reload, independent prices, tenant scope, plan history, retries, stale writes and RPC privileges passed');
} finally {await db.close();}
