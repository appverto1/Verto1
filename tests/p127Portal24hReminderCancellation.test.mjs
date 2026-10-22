import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db=new PGlite();
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),otherClinic=id(2),patient=id(3),actor=id(4),appointment=id(5),job=id(6),notification=id(7),wrongKindNotification=id(8),wrongKindJob=id(9);
const deployment='staging';
const query=async(q,args=[])=>(await db.query(q,args)).rows;
const scalar=async(q,args=[])=>(await query(q,args))[0];
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(`
  create table public.appointments(
    id uuid primary key,organization_id uuid,clinic_id uuid not null,patient_id uuid not null,
    scheduled_at timestamptz not null,status text not null,
    is_active boolean default true,deleted_at timestamptz,
    cancel_requested_at timestamptz,cancel_requested_by text,patient_response text,
    patient_responded_at timestamptz,patient_confirmation_status text,
    patient_confirmation_source text,patient_confirmation_at timestamptz,
    patient_confirmation_by text,notification_24h_sent_at timestamptz,
    notification_12h_sent_at timestamptz,notification_sent boolean,
    notification_sent_at timestamptz,notification_12h_sent boolean,
    updated_at timestamptz);
  create table public.appointment_action_requests(
    id uuid primary key default gen_random_uuid(),organization_id uuid not null,
    appointment_id uuid not null,patient_id uuid not null,
    requested_by text,request_type text not null,status text not null default 'PENDING',
    reason text,note text,resolved_by text,resolved_at timestamptz,
    resolution_note text,metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),updated_at timestamptz not null default now());
  create table public.appointment_status_audit_logs(
    id uuid primary key default gen_random_uuid(),organization_id uuid not null,
    appointment_id uuid not null,patient_id uuid,action text not null,
    previous_status text,new_status text,performed_by text,performed_by_role text,
    performed_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb);
  create table public.notification_jobs(
    id uuid primary key,organization_id uuid,clinic_id uuid,patient_id uuid,
    source_id uuid not null,source_type text not null,notification_kind text not null,
    deployment_env text,status text not null,sent_at timestamptz,
    scheduled_for timestamptz not null,payload jsonb not null default '{}'::jsonb);
  create table public.portal_notifications(
    id uuid primary key,organization_id uuid,clinic_id uuid,patient_id uuid not null,
    appointment_id uuid,type text not null,deployment_env text,
    sent_at timestamptz not null,idempotency_key text not null,
    metadata jsonb not null default '{}'::jsonb);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261022091000_portal_24h_reminder_atomic_cancellation_v1.sql','utf8'));
  await query("insert into appointments(id,organization_id,clinic_id,patient_id,scheduled_at,status) values($1,$2,$2,$3,now()+interval '30 hours','scheduled')",[appointment,clinic,patient]);
  await query(`insert into notification_jobs
    (id,organization_id,clinic_id,patient_id,source_id,source_type,notification_kind,deployment_env,status,sent_at,scheduled_for,payload)
    select $1,$2,$2,$3,$4,'APPOINTMENT','APPOINTMENT_REMINDER_24H',$5,'SENT',
      now()-interval '1 hour',now()-interval '1 hour',jsonb_build_object('scheduledAt',a.scheduled_at)
    from appointments a where a.id=$4`,[job,clinic,patient,appointment,deployment]);
  await query(`insert into portal_notifications
    (id,organization_id,clinic_id,patient_id,appointment_id,type,deployment_env,sent_at,idempotency_key,metadata)
    select $1,$2,$2,$3,$4,'appointment_reminder',$5,now()-interval '1 hour',
      $5||':notification-job:'||$6::text,jsonb_build_object('reminderKind','24h','scheduledAt',a.scheduled_at)
    from appointments a where a.id=$4`,[notification,clinic,patient,appointment,deployment,job]);
  await query("insert into notification_jobs select $1,organization_id,clinic_id,patient_id,source_id,source_type,'APPOINTMENT_REMINDER_12H',deployment_env,status,sent_at,scheduled_for,payload from notification_jobs where id=$2",[wrongKindJob,job]);
  await query(`insert into portal_notifications select $1,organization_id,clinic_id,patient_id,appointment_id,type,deployment_env,sent_at,
     $2||':notification-job:'||$3::text,jsonb_set(metadata,'{reminderKind}','"12h"')
    from portal_notifications where id=$4`,[wrongKindNotification,deployment,wrongKindJob,notification]);
  const call=async (notificationId,clinicId=clinic,environment=deployment,appointmentId=appointment)=>
    (await scalar('select public.cancel_appointment_from_24h_reminder_v1($1,$2,$3,$4,$5,$6,$7,null,null) as result',
      [clinicId,clinicId,patient,appointmentId,notificationId,actor,environment])).result;

  assert.equal((await call(wrongKindNotification)).autoCancelled,false,'12h must not cancel');
  assert.equal((await call(notification,clinic,'production')).autoCancelled,false,'environment isolation');
  assert.equal((await call(notification,otherClinic)).autoCancelled,false,'tenant isolation');
  assert.equal((await call(id(999))).autoCancelled,false,'forged notification');
  assert.equal((await scalar('select status from appointments where id=$1',[appointment])).status,'scheduled','negative probes must not modify appointment');
  assert.equal((await scalar('select count(*)::int as total from appointment_action_requests')).total,0,'negative probes create no pending requests');

  await query(`insert into appointment_action_requests(organization_id,appointment_id,patient_id,requested_by,request_type,status)
    values($1,$2,$3,$4,'RESCHEDULE','PENDING')`,[clinic,appointment,patient,actor]);
  const accepted=await call(notification);
  assert.equal(accepted.autoCancelled,true,'delivered 24h leads to immediate cancellation');
  assert.equal(accepted.idempotent,false);
  assert.equal((await scalar('select status from appointments where id=$1',[appointment])).status,'cancelled');
  assert.equal((await scalar("select count(*)::int as n from appointment_action_requests where request_type='CANCEL' and status='APPROVED'")).n,1);
  assert.equal((await scalar("select count(*)::int as n from appointment_action_requests where request_type='RESCHEDULE' and status='CANCELLED'")).n,1);
  assert.equal((await scalar("select count(*)::int as n from appointment_status_audit_logs where action='CANCEL_APPROVED'")).n,1);
  const replay=await call(notification);
  assert.equal(replay.autoCancelled,true);
  assert.equal(replay.idempotent,true,'retry preserves same transaction');
  assert.equal((await scalar("select count(*)::int as n from appointment_status_audit_logs where action='CANCEL_APPROVED'")).n,1,'retry must not duplicate audit');

  assert.equal((await scalar(`select has_function_privilege('anon',
    'public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') as granted`)).granted,false);
  assert.equal((await scalar(`select has_function_privilege('authenticated',
    'public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') as granted`)).granted,false);
  console.log('P1-27 24h reminder atomic PostgreSQL cancellation: PASS');
} finally {await db.close();}
