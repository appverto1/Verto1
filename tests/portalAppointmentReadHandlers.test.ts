import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPortalAppointmentsListHandler,createPortalAppointmentDetailHandler,createPortalRescheduleSlotsHandler } from '../services/portalAppointmentReadHandlers';
const manifest=JSON.parse(readFileSync('docs/backend-modularization/20261013-portal-appointment-read-manifest.json','utf8'));
const server=readFileSync('server.ts','utf8');
assert.equal(manifest.routes.length,3);
const factories=[createPortalAppointmentsListHandler,createPortalAppointmentDetailHandler,createPortalRescheduleSlotsHandler];
for(let i=0;i<manifest.routes.length;i++){
  const r=manifest.routes[i];
  const signature=r.originalHeader.replace(/, async \(req: any, res\) => \{$/,'');
  assert.ok(server.includes(signature + ', '+r.factory+'(() => ({'), 'preserve registration middleware and order');
  assert.equal(server.split(signature+', '+r.factory).length,2,'unique original route');
  assert.equal(typeof factories[i],'function');
}
assert.ok(server.indexOf("app.get('/api/portal/appointments',")<server.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'"));
assert.ok(server.indexOf("app.get('/api/portal/appointments/:appointmentId/reschedule-slots',")>server.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'"));
function responder(){ const r:any={code:200,payload:null,status(code:number){this.code=code;return this},json(v:any){this.payload=v;return this}};return r}
let dbCalls=0;let serializeCalls=0;
const mocks:any={
  getPortalPatientIdsForUser: async () => [], isResponsiblePortalRole: (r:string) => r==='responsible',
  sanitizeString:(v:any,n=240)=>String(v||'').trim().slice(0,n),
  sanitizeEmail:(v:any)=>String(v||'').trim().toLowerCase(),
  currentClinicId:()=>null,
  isUuid:(v:any)=> /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')),
  portalSafeError:(status:number)=>({success:false,error:'PORTAL_ERROR_'+status}),
  supabase:{from(){dbCalls++;throw new Error('unexpected database call')}},
  serializePortalAppointmentForFamilyView: async()=>{serializeCalls++;return {}},
  fetchPortalAppointmentForUser: async()=>({ok:false,status:404}),
  readClinicPatientReschedulePolicy: async()=> false,
  patientRescheduleDisabledResponse:()=>({success:false,code:'RESCHEDULING_DISABLED'}),
  normalizeOperationalAppointmentStatus:(v:any)=>String(v),
  isAppointmentTerminalForPortalAction:(status:any)=>status==='CANCELLED',
  buildPortalRescheduleAvailabilityForAppointment: async()=>{throw Error('should not run')}
};
{
 const fn=createPortalAppointmentsListHandler(()=>mocks);const r=responder();
 await fn({session:{user:{role:'responsible',id:'actor'}}},r);
 assert.equal(r.code,200);assert.deepEqual(r.payload,{success:true,data:[]});assert.equal(dbCalls,0);
}
for(const factory of [createPortalAppointmentDetailHandler,createPortalRescheduleSlotsHandler]){
 const fn=factory(()=>mocks);
 const r=responder();await fn({params:{appointmentId:'foreign'},session:{user:{id:'actor'}}},r);
 assert.equal(r.code,404);assert.equal(r.payload.error,'PORTAL_ERROR_404');assert.equal(dbCalls,0);
}
{
 const fn=createPortalRescheduleSlotsHandler(()=>({...mocks,fetchPortalAppointmentForUser:async()=>({ok:true,appointment:{id:'a',clinic_id:'clinic-a',status:'scheduled'}})}));
 const r=responder();await fn({params:{appointmentId:'a'},session:{user:{id:'actor'}}},r);
 assert.equal(r.code,403);assert.equal(r.payload.code,'RESCHEDULING_DISABLED');assert.equal(dbCalls,0);
}
{
 const fn=createPortalRescheduleSlotsHandler(()=>({...mocks,fetchPortalAppointmentForUser:async()=>({ok:true,appointment:{id:'a',clinic_id:'clinic-a',status:'CANCELLED'}}),readClinicPatientReschedulePolicy:async()=>true}));
 const r=responder();await fn({params:{appointmentId:'a'},session:{user:{id:'actor'}}},r);
 assert.equal(r.code,409);assert.equal(r.payload.error,'PORTAL_ERROR_409');
}
{
 const fn=createPortalRescheduleSlotsHandler(()=>({...mocks,fetchPortalAppointmentForUser:async()=>({ok:true,appointment:{id:'a',clinic_id:'clinic-a',status:'scheduled'}}),readClinicPatientReschedulePolicy:async()=>true,buildPortalRescheduleAvailabilityForAppointment:async()=>({success:true,slots:[{id:'slot'}]})}));
 const r=responder();await fn({params:{appointmentId:'a'},session:{user:{id:'actor'}},query:{}},r);
 assert.equal(r.code,200);assert.deepEqual(r.payload,{success:true,slots:[{id:'slot'}]});
}
assert.equal(serializeCalls,0);
console.log('portalAppointmentReadHandlers: 6 read-only mock scenarios + 3 registration parity assertions passed');
