import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),patient=id(2),actor=id(3),foreign=id(4);
const read=async(q,v=[])=>(await db.query(q,v)).rows;
const invoke=async a=>(await read('select public.cancel_portal_appointment_from_sent_24h_v1($1,$2,$3,$4,$5,$6) as out',[org,a,patient,actor,'staging','cancelar']))[0].out;
try {
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table users(id uuid primary key,email text);
create table appointments(id uuid primary key,clinic_id uuid,organization_id uuid,patient_id uuid,
scheduled_at timestamptz,status text,is_active boolean default true,deleted_at timestamptz,
patient_response text,patient_confirmation_status text,patient_confirmation_source text,
patient_responded_at timestamptz,patient_confirmation_at timestamptz,
notification_24h_sent_at timestamptz,notification_12h_sent_at timestamptz,
notification_sent boolean,notification_sent_at timestamptz,notification_12h_sent boolean,updated_at timestamptz);
create table notification_jobs(id uuid primary key,organization_id uuid,clinic_id uuid,patient_id uuid,
source_id uuid,source_type text,notification_kind text,status text,sent_at timestamptz,deployment_env text,payload jsonb);
create table portal_notifications(id uuid primary key,appointment_id uuid,clinic_id uuid,patient_id uuid,
recipient_user_id uuid,recipient_email text,deployment_env text,idempotency_key text,type text,metadata jsonb,sent_at timestamptz);
create table appointment_action_requests(id uuid primary key default gen_random_uuid(),organization_id uuid,
appointment_id uuid,patient_id uuid,requested_by text,request_type text,status text,reason text,note text,
resolved_by text,resolved_at timestamptz,resolution_note text,metadata jsonb default '{}'::jsonb,
created_at timestamptz default now(),updated_at timestamptz default now());
create table appointment_status_audit_logs(id uuid primary key default gen_random_uuid(),organization_id uuid,
appointment_id uuid,patient_id uuid,action text,previous_status text,new_status text,performed_by text,
performed_by_role text,performed_at timestamptz default now(),metadata jsonb default '{}'::jsonb);
`);
await read('insert into users(id,email) values ($1,$2),($3,$4)',[actor,'actor@example.invalid',foreign,'foreign@example.invalid']);
await db.exec(fs.readFileSync('supabase/migrations/20261022033000_portal_24h_reminder_atomic_cancel_v1.sql','utf8'));
const seed=async (n,opts={})=>{
const a=id(100+n),j=id(200+n),now=new Date(Date.now()+20*3600000).toISOString();
await read("insert into appointments(id,clinic_id,organization_id,patient_id,scheduled_at,status) values ($1,$2,$2,$3,$4,'scheduled')",[a,org,patient,now]);
await read("insert into notification_jobs(id,clinic_id,organization_id,patient_id,source_id,source_type,notification_kind,status,sent_at,deployment_env,payload) values($1,$2,$2,$3,$4,'APPOINTMENT','APPOINTMENT_REMINDER_24H',$5,now(),'staging',jsonb_build_object('scheduledAt',$6::timestamptz))",[j,org,patient,a,opts.status||'SENT',now]);
await read("insert into portal_notifications(id,appointment_id,clinic_id,patient_id,recipient_user_id,deployment_env,idempotency_key,type,metadata,sent_at) values($1,$2,$3,$4,$5,'staging',$6,'appointment_reminder',jsonb_build_object('reminderKind',$7::text,'scheduledAt',$8::timestamptz),now())",[id(300+n),a,org,patient,opts.recipient||actor,`staging:notification-job:${j}`,opts.kind||'24h',now]);
if(opts.sent12h) await read("insert into notification_jobs(id,clinic_id,organization_id,patient_id,source_id,source_type,notification_kind,status,sent_at,deployment_env,payload) values($1,$2,$2,$3,$4,'APPOINTMENT','APPOINTMENT_REMINDER_12H','SENT',now(),'staging',jsonb_build_object('scheduledAt',$5::timestamptz))",[id(400+n),org,patient,a,now]);
return a;
};
const valid=await seed(1);
assert.equal((await invoke(valid)).automatic,true);
assert.equal((await invoke(valid)).idempotent,true);
assert.equal((await read('select count(*)::int as n from appointment_status_audit_logs where appointment_id=$1',[valid]))[0].n,1);
for(const [n,opts] of [[2,{status:'SCHEDULED'}],[3,{kind:'12h'}],[4,{recipient:foreign}],[5,{sent12h:true}]]){
const a=await seed(n,opts);assert.equal((await invoke(a)).automatic,false);
assert.equal((await read('select status from appointments where id=$1',[a]))[0].status,'scheduled');
}
const changed=await seed(6);
await read("update appointments set scheduled_at=scheduled_at+interval '1 day' where id=$1",[changed]);
assert.equal((await invoke(changed)).automatic,false);
const complete=await seed(7);await read("update appointments set status='completed' where id=$1",[complete]);
assert.equal((await invoke(complete)).automatic,false);
for(const role of ['anon','authenticated']) {
const v=await read("select has_function_privilege($1,'public.cancel_portal_appointment_from_sent_24h_v1(uuid,uuid,uuid,uuid,text,text)','EXECUTE') as yes",[role]);
assert.equal(v[0].yes,false);
}
console.log('p1Auto24hCancellation.postgres: PASS');
}finally{await db.close();}
