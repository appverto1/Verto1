import assert from 'node:assert/strict';
import { shiftGroupFixtureDates } from './helpers/groupSessionFixtureDates.mjs';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),actor=id(2),therapist=id(3),secondary=id(4),room=id(5);
const patients=[id(10),id(11),id(12),id(13)];
const query=async(sql,args=[]) => (await db.query(shiftGroupFixtureDates(sql),args.map(shiftGroupFixtureDates))).rows;
const scalar=async(sql,args=[]) => Object.values((await query(sql,args))[0])[0];
let step='bootstrap';
try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;");
  for(const file of ['staging-schema.sql','staging-clinic-state.sql','staging-support-functions.sql','staging-finance.sql','staging-finance-triggers.sql','staging-finance-side-triggers.sql']){
    step=file;await db.exec(fs.readFileSync('tests/fixtures/groupSessions/'+file,'utf8'));
  }
  for(const name of fs.readdirSync('supabase/migrations').filter(name=>/^2026101[56].*group_/.test(name)).sort()){
    step=name;await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  }
  step='fixtures';
  await query("insert into clinics(id,name,school_organization_id) values ($1,'Clínica fictícia atômica',$1)",[clinic]);
  for(const [who,role]of [[actor,'director'],[therapist,'therapist'],[secondary,'therapist']]){
    await query("insert into users(id,email,clinic_id) values ($1,$2,$3)",[who,who+'@example.invalid',clinic]);
    await query("insert into clinic_memberships(user_id,clinic_id,role,status,specialty) values ($1,$2,$3,'active','Fonoaudiólogo')",[who,clinic,role]);
  }
  await query("insert into clinic_rooms(id,clinic_id,organization_id,name,capacity) values ($1,$2,$2,'Sala coletiva fictícia',5)",[room,clinic]);
  for(let i=0;i<patients.length;i++){
    await query("insert into patients(id,name,clinic_id) values ($1,$2,$3)",[patients[i],'Paciente fictício '+i,clinic]);
    const plan={id:id(20+i),client_plan_key:id(20+i),service_type:'SPEECH_THERAPY',service_name_snapshot:'Fonoaudiólogo',billing_mode:'PRIVATE',amount_cents:15000+i*1000,group_amount_cents:8000-i*1000,
      billing_frequency:i<2?'AT_SESSION':'MONTHLY',pricing_unit:'SESSION',aggregation_method:i<2?null:'ELIGIBLE_COMPLETED_SESSIONS',due_day:i<2?null:10};
    await scalar('select reconcile_patient_financial_plans_v2($1,$2,$3,$4::jsonb,false)',[clinic,patients[i],actor,JSON.stringify([plan])]);
  }
  const book=(key,day='2026-11-02',selected=patients.slice(0,2),team=[therapist,secondary])=>scalar('select reserve_group_sessions_v1($1,$2,$3::uuid[],$4::uuid[],$5,$6,$7::jsonb,50,$8)',[clinic,actor,selected,team,'Fonoaudiólogo',room,JSON.stringify([{date:day,time:'10:00'}]),key]);
  const counts=async()=>({appointments:await scalar('select count(*)::int from appointments'),bookings:await scalar('select count(*)::int from group_session_bookings'),participants:await scalar('select count(*)::int from group_session_participants'),payments:await scalar('select count(*)::int from payments'),snapshots:await scalar('select count(*)::int from appointment_private_financial_snapshots'),operations:await scalar('select count(*)::int from group_session_operations')});
  step='atomic booking';
  const first=await book('atomic-reservation-first');
  assert.equal(first.success,true);assert.equal(first.bookings.length,1);assert.equal(first.appointments.length,2);
  assert.deepEqual((await query('select unit_amount from payment_appointment_items order by patient_id')).map(r=>Number(r.unit_amount)),[80,70]);
  assert.deepEqual((await query('select final_amount from appointment_private_financial_snapshots order by patient_id')).map(r=>Number(r.final_amount)),[80,70]);
  assert.equal(first.bookings[0].scheduled_start_at,shiftGroupFixtureDates('2026-11-02T13:00:00+00:00'),'clinic timezone is authoritative');
  const initialCounts=await counts();
  assert.equal((await book('atomic-reservation-first')).idempotent,true);assert.deepEqual(await counts(),initialCounts);
  await assert.rejects(()=>book('atomic-reservation-first','2026-11-03'),/GROUP_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(()=>book('atomic-reservation-other'),/GROUP_BOOKING_(SLOT|PROFESSIONAL|ROOM)_BUSY/);
  await assert.rejects(()=>book('atomic-reservation-tenant','2026-11-03',[patients[0],id(99)]),/GROUP_PATIENT_OUT_OF_SCOPE/);
  step='rollback after first patient charge';
  await query('update patient_financial_plans set group_amount_cents=0 where patient_id=$1',[patients[1]]);
  await assert.rejects(()=>book('atomic-reservation-failure','2026-11-03'),/GROUP_RATE_NOT_CONFIGURED/);
  assert.deepEqual(await counts(),initialCounts,'all headers, appointments, snapshots, charges and operation keys roll back');
  await query('update patient_financial_plans set group_amount_cents=7000 where patient_id=$1',[patients[1]]);
  step='GROUP vs individual';
  await assert.rejects(()=>query("insert into appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,service_type,approach,room_id,care_setting,source_payload) values ($1,$1,$2,$3,'2026-11-02T13:00:00Z','Fonoaudiólogo','Fonoaudiólogo',$4,'CLINIC','{}')",[clinic,patients[2],secondary,room]),/GROUP_BOOKING_SLOT_BUSY/);
  assert.deepEqual(await counts(),initialCounts);
  step='join canonical GROUP';
  const bookingId=first.bookings[0].id;
  const join=(selected,key='atomic-join-first')=>scalar('select join_group_session_v1($1,$2,$3,$4::uuid[],$5)',[clinic,actor,bookingId,selected,key]);
  const joined=await join([patients[2]]);
  assert.equal(joined.bookings.length,1,'join reuses the canonical booking');
  assert.equal(joined.bookings[0].id,bookingId);
  assert.equal(joined.participants.length,3);
  assert.equal(joined.participants.find(p=>p.patient_id===patients[2]).unit_amount_cents,6000);
  const afterJoin=await counts();
  assert.equal(afterJoin.bookings,1);assert.equal(afterJoin.appointments,3);
  assert.equal((await join([patients[2]])).idempotent,true);assert.deepEqual(await counts(),afterJoin);
  await assert.rejects(()=>join([patients[2]],'atomic-join-duplicate'),/GROUP_PATIENT_ALREADY_PARTICIPATING/);
  await query('update clinic_rooms set capacity=3 where id=$1',[room]);
  await assert.rejects(()=>join([patients[3]],'atomic-join-capacity'),/GROUP_ROOM_CAPACITY_EXCEEDED/);
  assert.deepEqual(await counts(),afterJoin);
  await query('update clinic_rooms set capacity=5 where id=$1',[room]);
  await query('update clinic_memberships set work_schedule=$1::jsonb where user_id=$2',[JSON.stringify({active:true,days:{monday:{enabled:true,periods:[{start:'14:00',end:'18:00'}]}}}),therapist]);
  await assert.rejects(()=>join([patients[3]],'atomic-join-work-hours'),/GROUP_PROFESSIONAL_SCHEDULE_UNAVAILABLE/);
  assert.deepEqual(await counts(),afterJoin);
  await query('update clinic_memberships set work_schedule=null where user_id=$1',[therapist]);
  await assert.rejects(()=>query("insert into appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,service_type,room_id,care_setting,source_payload) values ($1,$1,$2,$3,'2026-11-02T13:00:00Z','Fonoaudiólogo',$4,'CLINIC',$5::jsonb)",[clinic,patients[3],therapist,room,JSON.stringify({sessionModality:'GROUP',sessionGroupId:bookingId,professionalIds:[therapist,secondary]})]),/GROUP_APPOINTMENT_(RPC_REQUIRED|CANONICAL_SLOT_REQUIRED)/);
  await assert.rejects(()=>query("update appointments set source_payload=jsonb_set(source_payload,'{privatePricingResolution,final_amount}','1'::jsonb) where id=$1",[first.appointments[0].id]),/GROUP_APPOINTMENT_FINANCE_IMMUTABLE/);
  step='individual regression';
  const individual=await query("insert into appointments(clinic_id,organization_id,patient_id,therapist_id,scheduled_at,scheduled_start_at,scheduled_end_at,service_type,approach,room_id,care_setting,source_payload,financial_event_actor_id) values ($1,$1,$2,$3,'2026-11-10T13:00:00Z','2026-11-10T13:00:00Z','2026-11-10T13:50:00Z','Fonoaudiólogo','Fonoaudiólogo',$4,'CLINIC',$5::jsonb,$6) returning id",[clinic,patients[0],therapist,room,JSON.stringify({financialContextType:'PRIVATE',privatePricingActorId:actor}),actor]);
  // The existing individual API revalidates billing after durable persistence.
  await query('update appointments set source_payload=source_payload where id=$1',[individual[0].id]);
  assert.equal(Number(await scalar("select final_amount from appointment_private_financial_snapshots where appointment_id=$1",[individual[0].id])),150,'individual pricing remains independent');
  await assert.rejects(()=>query("update payments set status='paid',paid_amount=amount,payment_date=null where organization_id=$1",[clinic]),/payments_settled_receipt_fields_required/);
  step='monthly GROUP';
  const monthly=await book('atomic-reservation-monthly','2026-11-04',patients.slice(2));
  assert.equal(await scalar('select count(*)::int from payments'),3,'monthly reservation does not create a per-session charge');
  const frozenPlan=monthly.participants.find(p=>p.patient_id===patients[2]).financial_plan_id;
  const repriced=await scalar('select update_patient_specialty_group_rate_v1($1,$2,$3,$4,9500)',[clinic,patients[2],frozenPlan,actor]);
  assert.equal(repriced.success,true);assert.notEqual(repriced.financial_plan_id,frozenPlan);
  for(const appointment of monthly.appointments){await query("update appointments set status='completed',actual_end_at=scheduled_end_at,updated_at=clock_timestamp() where id=$1",[appointment.id]);}
  assert.deepEqual((await query("select unit_amount from payment_appointment_items where billing_item_type='MONTHLY_SESSION' order by patient_id")).map(r=>Number(r.unit_amount)),[60,50]);
  for(const appointment of monthly.appointments){await query("update appointments set status='completed' where id=$1",[appointment.id]);}
  assert.equal(await scalar("select count(*)::int from payment_appointment_items where billing_item_type='MONTHLY_SESSION' and active"),2,'repeat completion is idempotent');
  step='atomic recurrence';
  const recurring=(key,slots)=>scalar('select reserve_group_sessions_v1($1,$2,$3::uuid[],$4::uuid[],$5,$6,$7::jsonb,50,$8)',[clinic,actor,patients.slice(0,2),[therapist,secondary],'Fonoaudiólogo',room,JSON.stringify(slots),key]);
  const seriesSlots=[{date:'2026-11-16',time:'10:00'},{date:'2026-11-23',time:'10:00'}];
  const series=await recurring('atomic-recurrence-valid',seriesSlots);
  assert.equal(series.bookings.length,2);assert.equal(series.appointments.length,4);
  assert.equal(new Set(series.appointments.map(a=>a.source_payload.recurrenceGroupId)).size,1);
  const afterSeries=await counts();
  assert.equal((await recurring('atomic-recurrence-valid',seriesSlots)).idempotent,true);assert.deepEqual(await counts(),afterSeries);
  await assert.rejects(()=>recurring('atomic-recurrence-rollback',[{date:'2026-11-30',time:'10:00'},{date:'2026-11-02',time:'10:00'}]),/GROUP_BOOKING_(SLOT|PROFESSIONAL|ROOM)_BUSY/);
  assert.deepEqual(await counts(),afterSeries,'one conflicting occurrence rolls the entire series back');
  step='required finance trigger missing';
  await db.exec('alter table appointments disable trigger appointments_sync_private_finance');
  await assert.rejects(()=>book('atomic-missing-finance-trigger','2026-12-01'),/GROUP_FINANCIAL_PERSISTENCE_UNCONFIRMED/);
  assert.deepEqual(await counts(),afterSeries,'missing finance must not leave a partial reservation');
  await db.exec('alter table appointments enable trigger appointments_sync_private_finance');
  console.log('groupSessionAtomicReservation: real finance triggers, per-patient GROUP charges, monthly GROUP prices, canonical join, work schedules, capacity, rollback, idempotency, tenant scope, spoof protection and individual regression passed');
}catch(error){console.error('groupSessionAtomicReservation failed at',step,':',error.message,error.detail||'');process.exitCode=1;}finally{await db.close();}
