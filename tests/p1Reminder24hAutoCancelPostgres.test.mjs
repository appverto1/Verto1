import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL 17, synthetic patients only. This exercises the exact
// migration without Supabase credentials, network or real patient records.
const db = new PGlite();
const id = n => `70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1), patient=id(2), actor=id(3), outsider=id(4);
const appt=id(5), notice=id(6), sentJob=id(7), notice12=id(8);
const otherAppt=id(9);
const env='staging';
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const count=async table=>Number((await q('select count(*)::integer as n from '+table))[0].n);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.users (id uuid primary key,email text);
    create table public.appointments (
      id uuid primary key,clinic_id uuid,organization_id uuid,patient_id uuid,
      is_active boolean default true,deleted_at timestamptz,
      scheduled_at timestamptz,status text default 'scheduled',
      patient_response text,patient_responded_at timestamptz,
      patient_confirmation_status text,patient_confirmation_at timestamptz,
      patient_confirmation_by text,patient_confirmation_source text,
      cancel_requested_at timestamptz,cancel_requested_by text,
      notification_24h_sent_at timestamptz,notification_12h_sent_at timestamptz,
      notification_sent boolean,notification_sent_at timestamptz,
      notification_12h_sent boolean,updated_at timestamptz
    );
    create table public.portal_notifications (
      id uuid primary key,deployment_env text,organization_id uuid,clinic_id uuid,
      patient_id uuid,appointment_id uuid,recipient_user_id uuid,recipient_email text,
      type text,metadata jsonb,sent_at timestamptz,idempotency_key text
    );
    create table public.notification_jobs (
      id uuid primary key,deployment_env text,organization_id uuid,clinic_id uuid,
      patient_id uuid,source_type text,source_id uuid,notification_kind text,
      status text,sent_at timestamptz,scheduled_for timestamptz,
      created_at timestamptz,payload jsonb,idempotency_key text
    );
    create table public.appointment_action_requests (
      id uuid primary key,organization_id uuid,appointment_id uuid,patient_id uuid,
      requested_by text,request_type text,status text,reason text,note text,
      resolved_by text,resolved_at timestamptz,resolution_note text,
      metadata jsonb default '{}'::jsonb,created_at timestamptz,updated_at timestamptz
    );
    create table public.appointment_status_audit_logs (
      id uuid primary key,organization_id uuid,appointment_id uuid,patient_id uuid,
      action text,previous_status text,new_status text,performed_by text,
      performed_by_role text,performed_at timestamptz,metadata jsonb
    );
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261021235000_portal_24h_reminder_atomic_cancellation_v1.sql','utf8'));
  await q('insert into users values($1,\'guardian@example.invalid\'),($2,\'stranger@example.invalid\')',[actor,outsider]);
  const ts=(await q("select (now()+interval '18 hours')::text as scheduled, (now()+interval '11 hours')::text as late"))[0];
  await q("insert into appointments(id,clinic_id,organization_id,patient_id,scheduled_at,status) values($1,$2,$2,$3,$4,'scheduled'),($5,$2,$2,$3,$6,'scheduled')",
    [appt,clinic,patient,ts.scheduled,otherAppt,ts.late]);
  await q(`insert into notification_jobs (
    id,deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,
    notification_kind,status,sent_at,scheduled_for,created_at,payload,idempotency_key
  ) values (
    $1,$2,$3,$3,$4,'APPOINTMENT',$5,'APPOINTMENT_REMINDER_24H','SENT',
    now()-interval '2 hours',now()-interval '3 hours',now()-interval '4 hours',
    jsonb_build_object('scheduledAt',$6::timestamptz),$2||':notification-job:'||$1::text
  )`,[sentJob,env,clinic,patient,appt,ts.scheduled]);
  await q(`insert into portal_notifications
    (id,deployment_env,organization_id,clinic_id,patient_id,appointment_id,recipient_user_id,
      recipient_email,type,metadata,sent_at,idempotency_key)
    values($1,$2,$3,$3,$4,$5,$6,'guardian@example.invalid','appointment_reminder',
     jsonb_build_object('deploymentEnv',$2,'reminderKind','24h',
       'scheduledAt',$7::timestamptz),
     now()-interval '2 hours',$2||':notification-job:'||$8::text)`,
    [notice,env,clinic,patient,appt,actor,ts.scheduled,sentJob]);

  const invoke=async(appointment,notification,user=actor,clinicId=clinic)=>
    (await q('select cancel_appointment_from_24h_reminder_v1($1,$2,$3,$4,$5,$6,$7,$8) as data',
      [clinicId,appointment,patient,user,notification,env,'Test synthetic','No actual clinical data']))[0].data;
  // Negative requests neither cancel nor write an action request.
  assert.equal((await invoke(appt,notice,outsider)).autoCanceled,false,'other recipient denied');
  assert.equal((await invoke(otherAppt,notice)).autoCanceled,false,'cross-appointment notification denied');
  assert.equal((await invoke(appt,notice,actor,id(44))).autoCanceled,false,'cross-tenant denied');
  await q("insert into portal_notifications(id,deployment_env,organization_id,clinic_id,patient_id,appointment_id,recipient_user_id,type,metadata,sent_at,idempotency_key) values($1,$2,$3,$3,$4,$5,$6,'appointment_reminder',jsonb_build_object('deploymentEnv',$2,'reminderKind','12h','scheduledAt',$7::timestamptz),now(),$2||':notification-job:'||$8::text)",
    [notice12,env,clinic,patient,appt,actor,ts.scheduled,sentJob]);
  assert.equal((await invoke(appt,notice12)).autoCanceled,false,'12h must use manual approval');
  assert.equal(await count('appointment_action_requests'),0,'denied attempts have no side effects');
  assert.equal((await q('select status from appointments where id=$1',[appt]))[0].status,'scheduled');

  const good=await invoke(appt,notice);
  assert.equal(good.autoCanceled,true,'valid sent 24h reminder can cancel atomically');
  assert.equal(good.idempotent,false);
  assert.equal((await q('select status from appointments where id=$1',[appt]))[0].status,'cancelled');
  assert.equal(await count('appointment_action_requests'),1);
  assert.equal(await count('appointment_status_audit_logs'),1);
  assert.equal((await q('select status from appointment_action_requests'))[0].status,'APPROVED');
  const replay=await invoke(appt,notice);
  assert.equal(replay.autoCanceled,true);
  assert.equal(replay.idempotent,true);
  assert.equal(await count('appointment_action_requests'),1,'retry has one durable request');
  assert.equal(await count('appointment_status_audit_logs'),1,'retry has one audit event');

  await q(`insert into notification_jobs (id,deployment_env,organization_id,clinic_id,patient_id,source_type,
    source_id,notification_kind,status,sent_at,scheduled_for,created_at,payload,idempotency_key)
    select $1,deployment_env,organization_id,clinic_id,patient_id,source_type,$2,notification_kind,
      status,sent_at,scheduled_for,created_at,
      jsonb_build_object('scheduledAt',$3::timestamptz),
      $4||':notification-job:'||$1::text
    from notification_jobs where id=$5`,[id(10),otherAppt,ts.late,env,sentJob]);
  await q(`insert into portal_notifications (id,deployment_env,organization_id,clinic_id,patient_id,
    appointment_id,recipient_user_id,type,metadata,sent_at,idempotency_key)
    select $1,deployment_env,organization_id,clinic_id,patient_id,$2,recipient_user_id,
      type,jsonb_build_object('deploymentEnv',$3,'reminderKind','24h','scheduledAt',$4::timestamptz),
      sent_at,$3||':notification-job:'||$5::text from portal_notifications where id=$6`,
    [id(11),otherAppt,env,ts.late,id(10),notice]);
  assert.equal((await invoke(otherAppt,id(11))).autoCanceled,false,
    'opening the older 24h reminder within 12h of appointment cannot bypass clinic approval');
  assert.equal((await q('select status from appointments where id=$1',[otherAppt]))[0].status,'scheduled');
  assert.equal((await q(`select has_function_privilege('anon',
    'public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE') as permitted`))[0].permitted,false);
  assert.equal((await q(`select has_function_privilege('authenticated',
    'public.cancel_appointment_from_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE') as permitted`))[0].permitted,false);
  console.log('P1-27: isolated Postgres 24h cancellation, audit, scope and 12h boundary PASS');
} finally {
  await db.close();
}
