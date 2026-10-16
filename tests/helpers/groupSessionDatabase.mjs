import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

export async function createGroupSessionTestDatabase(){
  const db=new PGlite();
  const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const clinic=id(1),actor=id(2),therapist=id(3),secondary=id(4),room=id(5);
  const patients=[id(10),id(11),id(12),id(13)];
  const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar=async(sql,args=[]) => Object.values((await query(sql,args))[0])[0];
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;");
  for(const file of ['staging-schema.sql','staging-clinic-state.sql','staging-support-functions.sql','staging-finance.sql','staging-finance-triggers.sql','staging-finance-side-triggers.sql'])await db.exec(fs.readFileSync('tests/fixtures/groupSessions/'+file,'utf8'));
  for(const name of fs.readdirSync('supabase/migrations').filter(name=>/^2026101[56].*group_/.test(name)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  await query("insert into clinics(id,name,school_organization_id) values($1,'Lifecycle fictitious clinic',$1)",[clinic]);
  for(const [who,role]of [[actor,'director'],[therapist,'therapist'],[secondary,'therapist']]){
    await query('insert into users(id,email,name,clinic_id) values($1,$2,$3,$4)',[who,who+'@example.invalid','Fictitious '+role,clinic]);
    await query("insert into clinic_memberships(user_id,clinic_id,role,status,specialty) values($1,$2,$3,'active','Fonoaudiólogo')",[who,clinic,role]);
  }
  await query("insert into clinic_rooms(id,clinic_id,organization_id,name,capacity) values($1,$2,$2,'Lifecycle fictitious room',5)",[room,clinic]);
  for(let i=0;i<patients.length;i++){
    await query('insert into patients(id,name,clinic_id) values($1,$2,$3)',[patients[i],'Fictitious lifecycle patient '+i,clinic]);
    await scalar('select reconcile_patient_financial_plans_v2($1,$2,$3,$4::jsonb,false)',[clinic,patients[i],actor,JSON.stringify([{id:id(20+i),client_plan_key:id(20+i),service_type:'SPEECH_THERAPY',service_name_snapshot:'Fonoaudiólogo',billing_mode:'PRIVATE',amount_cents:15000+i*1000,group_amount_cents:8000-i*1000,billing_frequency:i<2?'AT_SESSION':'MONTHLY',pricing_unit:'SESSION',aggregation_method:i<2?null:'ELIGIBLE_COMPLETED_SESSIONS',due_day:i<2?null:10}])]);
  }
  const book=(key,date='2026-11-02',selected=patients.slice(0,2),time='10:00')=>scalar('select reserve_group_sessions_v1($1,$2,$3::uuid[],$4::uuid[],$5,$6,$7::jsonb,50,$8)',[clinic,actor,selected,[therapist,secondary],'Fonoaudiólogo',room,JSON.stringify([{date,time}]),key]);
  return{db,id,clinic,actor,therapist,secondary,room,patients,query,scalar,book};
}
