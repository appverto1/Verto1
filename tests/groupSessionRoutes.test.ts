import assert from 'node:assert/strict';
import {registerGroupSessionRoutes} from '../services/groupSessions/groupSessionRoutes';
import {groupCalendarMetadata,groupCalendarMatchesProfessional,groupCalendarProfessionalFilter} from '../services/groupSessions/groupSessionCalendar';

const id=(n:number)=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),actor=id(2),patient=id(3),otherPatient=id(4),professional=id(5),room=id(6),booking=id(7);
const routes=new Map<string,any[]>();const calls:any[]=[];
const middleware=(key:string)=>(req:any,res:any,next:any)=>req.allowed?.has(key)?next():res.status(key==='auth'?401:403).json({success:false});
const deps:any={portalActionLimiter:(_q:any,_s:any,n:any)=>n(),noStoreDynamicResponse:(_q:any,_s:any,n:any)=>n(),
  checkAuth:middleware('auth'),requireClinicModule:(key:string)=>middleware(key),requireClinicCapability:middleware,
  currentClinicId:(user:any)=>user.clinicId,enforcePayloadLimit:()=>true,
  serializeGroupAppointment:(row:any)=>({...row,patientId:row.patient_id}),
  supabase:{rpc:async(name:string,params:any)=>{calls.push({name,params});return {data:{success:true,bookings:[{id:booking}],appointments:[{id:id(9),patient_id:patient,privatePricingResolution:{secret:'private quote'}}]},error:null};},
    from:()=>({select(){return this;},eq(){return this;},in(){return this;},limit:async()=>({data:[]})})}};
registerGroupSessionRoutes(Object.fromEntries(['get','post','patch'].map(method=>[method,(path:string,...handlers:any[])=>routes.set(`${method} ${path}`,handlers)])) as any,deps);
const allowed=new Set(['auth','appointments_communication','calendar.clinic.view','patient.demographics.edit','finance.entries.view','finance.entries.manage','calendar.appointment.create','calendar.appointment.edit','calendar.appointment.cancel']);
async function run(key:string,changes:any={}){
  const req:any={allowed,session:{user:{id:actor,clinicId:clinic}},params:{bookingId:booking},query:{from:'2026-11-01',to:'2026-11-30'},body:{patientIds:[patient,otherPatient],professionalIds:[professional],specialty:'Fonoaudiólogo',roomId:room,slots:[{date:'2026-11-02',time:'10:00'}],durationMinutes:50,idempotencyKey:'group-route-test-key'},...changes};
  const res:any={statusCode:200,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};
  const handlers=routes.get(key)!;let i=0;const next=async()=>{if(i<handlers.length)await handlers[i++](req,res,next);};await next();return res;
}
for(const [key] of routes){
  for(const missing of ['auth','appointments_communication','calendar.clinic.view','patient.demographics.edit',key.startsWith('get')?'finance.entries.view':'finance.entries.manage']){
    const permissions=new Set(allowed);permissions.delete(missing);const before=calls.length;
    assert.equal((await run(key,{allowed:permissions})).statusCode,missing==='auth'?401:403,key+' '+missing);
    assert.equal(calls.length,before,'denied middleware never calls RPC');
  }
}
for(const [key,capability] of [['post /api/appointments/groups','calendar.appointment.create'],['post /api/appointments/groups/:bookingId/participants','calendar.appointment.create'],['patch /api/appointments/groups/:bookingId','calendar.appointment.edit'],['post /api/appointments/groups/:bookingId/cancel','calendar.appointment.cancel']]){
  const permissions=new Set(allowed);permissions.delete(capability);const before=calls.length;
  assert.equal((await run(key,{allowed:permissions})).statusCode,403);assert.equal(calls.length,before);
}
const body={patientIds:[patient,otherPatient],professionalIds:[professional],roomId:room,specialty:'Fonoaudiólogo',slots:[{date:'2026-11-02',time:'10:00'}],durationMinutes:50,idempotencyKey:'group-route-test-key',clinicId:id(80),organizationId:id(80),actorId:id(81),groupId:id(82),sessionModality:'INDIVIDUAL',amountCents:1,privatePricingResolution:{final_amount:0}};
const result=await run('post /api/appointments/groups',{body});assert.equal(result.statusCode,200);
assert.deepEqual(calls.at(-1),{name:'reserve_group_sessions_v1',params:{p_patient_ids:body.patientIds,p_professional_ids:body.professionalIds,p_specialty:body.specialty,p_room_id:room,p_local_slots:body.slots,p_duration_minutes:50,p_organization_id:clinic,p_actor_id:actor,p_idempotency_key:body.idempotencyKey}});
assert.equal(result.body.items[0].privatePricingResolution,undefined,'calendar response omits pricing quote');
for(const invalid of [{...body,patientIds:[patient,patient]},{...body,professionalIds:['arbitrary']},{...body,idempotencyKey:'bad'},{...body,roomId:'forged'}]){
  const before=calls.length;assert.equal((await run('post /api/appointments/groups',{body:invalid})).statusCode,422);assert.equal(calls.length,before);
}
assert.equal((await run('get /api/appointments/groups',{query:{from:'2026-01-01',to:'2027-01-01'}})).statusCode,422);
assert.equal((await run('post /api/appointments/groups',{session:{user:{id:actor,clinicId:'invalid'}}})).statusCode,403);
const canonical={therapist_id:professional,source_payload:{sessionModality:'GROUP',sessionGroupId:booking,professionalIds:[professional,id(11)],professionalNames:['Primary','Secondary']}};
assert.equal(groupCalendarMatchesProfessional(canonical,new Set([id(11)])),true);
assert.equal(groupCalendarMatchesProfessional(canonical,new Set([id(12)])),false);
assert.deepEqual(groupCalendarMetadata({...canonical,source_payload:{...canonical.source_payload,sessionModality:'INDIVIDUAL'}}),{});
assert.equal(groupCalendarMatchesProfessional({...canonical,source_payload:{...canonical.source_payload,sessionGroupId:'forged'}},new Set([id(11)])),false);
assert.equal(groupCalendarProfessionalFilter(['x),clinic_id.neq.null']), 'id.is.null');
assert.ok(groupCalendarProfessionalFilter([professional]).includes(`professionalIds.cs.["${professional}"]`));
console.log('groupSessionRoutes: full middleware denial, authenticated tenant/actor, whitelist, idempotency, private payload and secondary-professional scope passed');
