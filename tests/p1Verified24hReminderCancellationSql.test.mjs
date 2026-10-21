import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const id = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = id(1), patient = id(2), actor = id(3), stranger = id(4), env = 'staging';
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await query(sql, args))[0])[0];

try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(`
    create table appointments(
      id uuid primary key, clinic_id uuid, organization_id uuid, patient_id uuid,
      status text not null default 'scheduled', scheduled_at timestamptz,
      is_active boolean default true, deleted_at timestamptz,
      cancel_requested_at timestamptz, cancel_requested_by text,
      patient_response text, patient_confirmation_status text,
      patient_confirmation_source text, patient_responded_at timestamptz,
      patient_confirmation_at timestamptz, patient_confirmation_by text,
      notification_24h_sent_at timestamptz, notification_12h_sent_at timestamptz,
      notification_sent boolean default false, notification_sent_at timestamptz,
      notification_12h_sent boolean default false, updated_at timestamptz default now()
    );
    create table appointment_action_requests (
      id uuid primary key default gen_random_uuid(), organization_id uuid,
      appointment_id uuid, patient_id uuid, requested_by text,
      request_type text not null, status text not null default 'PENDING',
      reason text, note text, resolved_by text, resolved_at timestamptz,
      resolution_note text, metadata jsonb default '{}'::jsonb,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create unique index one_pending_action on appointment_action_requests
      (organization_id, appointment_id, request_type) where status='PENDING';
    create table appointment_status_audit_logs(
      id uuid primary key default gen_random_uuid(), organization_id uuid,
      appointment_id uuid, patient_id uuid, action text, previous_status text,
      new_status text, performed_by text, performed_by_role text,
      performed_at timestamptz, metadata jsonb
    );
    create table notification_jobs(
      id uuid primary key, source_type text, source_id uuid, patient_id uuid,
      clinic_id uuid, notification_kind text, status text,
      sent_at timestamptz, scheduled_for timestamptz, payload jsonb
    );
    create table portal_notifications(
      id uuid primary key, deployment_env text, organization_id uuid,
      clinic_id uuid, patient_id uuid, appointment_id uuid, type text,
      metadata jsonb, recipient_user_id uuid, recipient_email text,
      sent_at timestamptz, idempotency_key text
    );
    create table group_session_participants (appointment_id uuid);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20261021235500_portal_verified_24h_reminder_cancellation_v1.sql','utf8'));

  const sentJob = async ({n,kind='24h',recipient=actor,hoursAhead=20,stale=false,group=false}) => {
    const appointment=id(100+n), notice=id(200+n), job=id(300+n);
    const scheduledAt=new Date(Date.now()+hoursAhead*3600000);
    // Normalize the schedule to one second in PostgreSQL and JavaScript.
    scheduledAt.setMilliseconds(0);
    const canonical=scheduledAt.toISOString();
    await query('insert into appointments(id,clinic_id,organization_id,patient_id,scheduled_at) values($1,$2,$2,$3,$4)',
      [appointment,org,patient,canonical]);
    if(group) await query('insert into group_session_participants(appointment_id) values($1)',[appointment]);
    const cycle=stale ? new Date(scheduledAt.getTime()-86400000).toISOString():canonical;
    await query(`insert into notification_jobs(id,source_type,source_id,patient_id,clinic_id,
      notification_kind,status,sent_at,scheduled_for,payload)
      values($1,'APPOINTMENT',$2,$3,$4,$5,'SENT',now()-interval '60 minutes',
      now()-interval '90 minutes',$6::jsonb)`,
      [job,appointment,patient,org,kind==='24h'?'APPOINTMENT_REMINDER_24H':'APPOINTMENT_REMINDER_12H',
       JSON.stringify({scheduledAt:cycle})]);
    await query(`insert into portal_notifications(id,deployment_env,organization_id,clinic_id,
      patient_id,appointment_id,type,metadata,recipient_user_id,sent_at,idempotency_key)
      values($1,$2,$3,$3,$4,$5,'appointment_reminder',$6::jsonb,$7,
      now()-interval '60 minutes',$8)`,
      [notice,env,org,patient,appointment,
       JSON.stringify({deploymentEnv:env,reminderKind:kind,scheduledAt:cycle}),
       recipient,`${env}:notification-job:${job}`]);
    return {appointment,notice,job};
  };
  const run = async (f, userId=actor, runtimeEnv=env) => (
    await query('select public.cancel_appointment_from_verified_24h_reminder_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as data',
      [org,org,patient,f.appointment,userId,'person@example.invalid',f.notice,runtimeEnv,'Solicitação de teste','Sem dados reais'])
  )[0].data;
  const good=await sentJob({n:1});
  const result=await run(good);
  assert.equal(result.applied,true,'24h reminder actually SENT may authorize automatic cancellation');
  assert.equal(result.appointment.status,'cancelled');
  assert.equal((await query('select count(*)::int as n from appointment_action_requests where appointment_id=$1 and status=\'APPROVED\'',[good.appointment]))[0].n,1);
  assert.equal((await query('select count(*)::int as n from appointment_status_audit_logs where appointment_id=$1 and action=\'CANCEL_APPROVED\'',[good.appointment]))[0].n,1);
  assert.equal((await run(good)).idempotent,true,'retry must not add financial actions or duplicate logs');
  assert.equal((await query('select count(*)::int as n from appointment_status_audit_logs where appointment_id=$1',[good.appointment]))[0].n,1);
  const cases=[
    {n:2,kind:'12h'},
    {n:3,recipient:stranger},
    {n:4,stale:true},
    {n:5,hoursAhead:11},
    {n:6,group:true}
  ];
  for (const c of cases){
    const f=await sentJob(c);
    assert.equal((await run(f)).applied,false,'a non-eligible notification may not cancel');
    assert.equal((await scalar('select status from appointments where id=$1',[f.appointment])),'scheduled');
    assert.equal((await scalar('select count(*)::int from appointment_action_requests where appointment_id=$1',[f.appointment])),0);
  }
  const wrongEnv=await sentJob({n:7});
  assert.equal((await run(wrongEnv,actor,'production')).applied,false,'different Railway environment denied');
  const wrongActor=await sentJob({n:8});
  assert.equal((await run(wrongActor,stranger)).applied,false,'other recipient denied');
  const pending=await sentJob({n:9});
  await query(`insert into appointment_action_requests(organization_id,appointment_id,patient_id,
    requested_by,request_type,status) values($1,$2,$3,$4,'RESCHEDULE','PENDING')`,
    [org,pending.appointment,patient,actor]);
  assert.equal((await run(pending)).applied,true);
  assert.equal(await scalar(`select status from appointment_action_requests where appointment_id=$1 and request_type='RESCHEDULE'`,
    [pending.appointment]),'CANCELLED','superseded reschedule must not remain pending');
  assert.equal(await scalar(`select count(*)::int from appointment_status_audit_logs
    where appointment_id=$1 and action='RESCHEDULE_REJECTED'`,[pending.appointment]),1,
    'concurrent reschedule invalidation must have a separate audit event');
  for (const role of ['anon','authenticated']){
    assert.equal(await scalar(`select has_function_privilege('${role}',
      'public.cancel_appointment_from_verified_24h_reminder_v1(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text)','EXECUTE')`),false);
  }
  console.log('P1-27 PostgreSQL source proof, idempotency, race and scope PASS');
} finally {await db.close();}
