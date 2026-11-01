import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {registerP0504ContinuationPreviewRoutes} from '../services/p0504ContinuationPreviewRoutes';

const U=(n:number)=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0');
const clinic=U(1), otherClinic=U(2), patient=U(3), otherPatient=U(4),
  actor=U(5), appointmentId=U(6), sessionId='session-504';
const canonicalSession:any={
  id:sessionId,clinic_id:clinic,organization_id:clinic,patient_id:patient,
  therapist_id:actor,appointment_id:appointmentId,status:'in_progress',
  service_type:'Fonoaudiologia',therapeutic_plan_id:U(7),
  actual_start_at:'2026-11-02T18:00:00Z',started_at:'2026-11-02T18:00:00Z'
};
const canonicalAppointment:any={
  id:appointmentId,clinic_id:clinic,organization_id:clinic,patient_id:patient,
  therapist_id:actor,status:'in_progress',service_type:'Fonoaudiologia',
  source_payload:{specialty:'Fonoaudiologia',therapeuticPlanId:U(7)},
  scheduled_at:'2026-11-02T18:00:00Z',scheduled_start_at:'2026-11-02T18:00:00Z',
  scheduled_end_at:'2026-11-02T18:50:00Z',scheduled_duration_minutes:50,
  duration_minutes:50,room_id:'room-1',is_active:true,deleted_at:null
};
const conflictB:any={
  id:U(8),clinic_id:clinic,patient_id:otherPatient,therapist_id:actor,
  status:'scheduled',scheduled_at:'2026-11-02T18:50:00Z',
  scheduled_start_at:'2026-11-02T18:50:00Z',
  scheduled_end_at:'2026-11-02T19:40:00Z',scheduled_duration_minutes:50,
  room_id:'room-2',is_active:true,deleted_at:null,
};
let session:any=structuredClone(canonicalSession), appointment:any=structuredClone(canonicalAppointment);
let nearby:any[]=[],engine='AT_SESSION',price:any=180,writeCount=0,readCount=0;
const supabase:any={
  from:(table:string)=>{
    const filters:any={},range:any={},q:any={};
    q.select=()=>q;q.eq=(k:string,v:any)=>{filters[k]=v;return q;};
    q.gte=(k:string,v:any)=>{range.min=v;return q;};
    q.lt=(k:string,v:any)=>{range.max=v;return q;};
    q.limit=()=>q;q.order=()=>q;
    const resolve=()=>{
      readCount++;
      if(table==='aba_sessions')
        return {data:session && session.id===filters.id && session.clinic_id===filters.clinic_id?session:null,error:null};
      if(table==='appointments' && filters.id)
        return {data:appointment && appointment.id===filters.id && appointment.clinic_id===filters.clinic_id?appointment:null,error:null};
      if(table==='appointments')
        return {data:nearby.filter(a=>a.clinic_id===filters.clinic_id&&
          a.scheduled_at>=range.min&&a.scheduled_at<range.max),error:null};
      if(table==='appointment_private_financial_snapshots')
        return {data:price===null?null:{final_amount:price},error:null};
      throw Error('Unexpected table '+table);
    };
    q.maybeSingle=async()=>resolve();
    q.then=(ok:any,fail:any)=>Promise.resolve(resolve()).then(ok,fail);
    q.insert=q.update=q.delete=()=>{writeCount++;throw Error('Preview attempted write');};
    return q;
  },
  rpc:async(name:string,args:any)=>{
    assert.equal(name,'resolve_appointment_financial_engine_v1');
    assert.equal(args.p_organization_id,clinic);
    assert.equal(args.p_appointment_id,appointmentId);
    return {data:engine,error:null};
  }
};
const app=express();
registerP0504ContinuationPreviewRoutes(app,{
  supabase,noStoreDynamicResponse:(_req:any,res:any,next:any)=>{res.setHeader('Cache-Control','private, no-store');next();},
  checkAuth:(req:any,res:any,next:any)=>{if(req.get('x-auth')==='no')return res.sendStatus(401);
    req.session={user:{id:req.get('x-actor')||actor,clinicId:req.get('x-clinic')||clinic,role:'therapist'}};next();},
  requireClinicCapability:()=> (req:any,res:any,next:any)=>{
    if(req.get('x-capability')==='no')return res.sendStatus(403);
    req.authorizationContext={role:'therapist'};next();
  },
  sanitizeString:(v:any,max=180)=>String(v||'').trim().slice(0,max),
  currentClinicId:(u:any)=>u.clinicId
});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();assert.ok(address&&typeof address!=='string');
const endpoint='http://127.0.0.1:'+address.port+'/api/clinic/sessions/'+sessionId+'/continuation-preview';
const call=async(headers:any={})=>{const res=await fetch(endpoint,{headers});return {status:res.status,body:await res.json(),headers:res.headers};};
try {
  let r=await call();
  assert.equal(r.status,200);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');
  assert.equal(r.body.data.effectiveEndAt,'2026-11-02T18:50:00.000Z');
  assert.equal(r.body.data.choices[3].proposedEndAt,'2026-11-02T19:40:00.000Z');
  assert.equal(r.body.data.choices[3].conflictCount,0);
  assert.equal(r.body.data.financial.additionalCents,18000);
  assert.equal(r.body.data.financial.quotedTotalCents,36000);
  assert.equal(r.body.data.previewOnly,true);
  assert.equal(r.body.data.commitAuthorized,false);
  assert.equal(writeCount,0);
  assert.ok(readCount<=5,'bounded reads, no N+1');

  nearby=[structuredClone(conflictB)];
  r=await call();
  assert.equal(r.status,200);
  assert.equal(r.body.data.choices[0].conflictCount,1);
  assert.equal(r.body.data.choices[3].canCommitWithoutConflict,false);
  assert.equal(r.body.data.choices[3].canCancelConflicts,false);
  assert.ok(!JSON.stringify(r.body).includes(otherPatient),'do not leak third-party identity');
  assert.ok(!JSON.stringify(r.body).includes(conflictB.id),'do not leak third-party appointment ID');

  nearby=[{...conflictB,clinic_id:otherClinic}];
  r=await call();assert.equal(r.body.data.choices[3].conflictCount,0);
  nearby=[{...conflictB,therapist_id:U(21),room_id:'room-1'}];
  r=await call();assert.equal(r.body.data.choices[3].conflictCount,1,'shared room conflict');
  nearby=[{...conflictB,therapist_id:U(21),room_id:'room-99'}];
  r=await call();assert.equal(r.body.data.choices[3].conflictCount,0);
  nearby=[];
  engine='MONTHLY_SESSION';r=await call();
  assert.equal(r.body.data.financialPreviewAvailable,false,'monthly price must not be guessed');
  assert.equal(r.body.data.financial,null);
  engine='AT_SESSION';price=null;r=await call();
  assert.equal(r.body.data.financialPreviewAvailable,false,'no canonical snapshot must fail closed');
  price=180;
  r=await call({'x-clinic':otherClinic});
  assert.equal(r.status,409,'clinic isolation');
  r=await call({'x-actor':U(30)});
  assert.equal(r.status,403,'professional isolation');
  r=await call({'x-capability':'no'});assert.equal(r.status,403);
  r=await call({'x-auth':'no'});assert.equal(r.status,401);
  session={...session,service_type:'Terapia Ocupacional'};
  r=await call();assert.equal(r.status,409,'specialty isolation');
  session=structuredClone(canonicalSession);
  session.appointment_id=null;r=await call();assert.equal(r.status,409,'legacy unlinked rejected');
  session=structuredClone(canonicalSession);
  appointment={...appointment,source_payload:{therapeuticPlanId:U(30),specialty:'Fonoaudiologia'}};
  r=await call();assert.equal(r.status,409,'plan isolation');
  assert.equal(writeCount,0,'read-only preflight never writes');
  console.log('P0-504 continuation read-only preflight: PASS');
} finally {await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
