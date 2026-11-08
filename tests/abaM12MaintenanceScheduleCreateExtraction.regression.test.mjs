import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const original = execFileSync('git', ['cat-file', 'blob', 'b82667a64fdb036a2111dd329dfb0c18527cf2dd'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const source = readFileSync('services/abaMaintenanceScheduleCreateHandlers.ts', 'utf8');
const headers = [
  "  app.post('/api/aba/targets/:targetId/maintenance-schedules', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), async (req: any, res) => {",
  "  app.post('/api/aba/targets/:targetId/maintenance-schedules/next-session', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), async (req: any, res) => {",
];
const registrations = [
  "  app.post('/api/aba/targets/:targetId/maintenance-schedules', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), createAbaMaintenanceScheduleCreateHandler(() => ({",
  "  app.post('/api/aba/targets/:targetId/maintenance-schedules/next-session', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), createAbaMaintenanceNextSessionScheduleHandler(() => ({",
];
assert.ok(server.includes("import { createAbaMaintenanceScheduleCreateHandler, createAbaMaintenanceNextSessionScheduleHandler } from './services/abaMaintenanceScheduleCreateHandlers';"));
let moduleOffset = 0;
for (let i=0; i<headers.length; i++) {
  const start = original.indexOf(headers[i]);
  const end = original.indexOf('\n  });', start+headers[i].length);
  const bodyStart = source.indexOf('\n    try {', moduleOffset);
  const bodyEnd = source.indexOf('\n  };', bodyStart);
  assert.ok(start>=0 && end>start && bodyStart>=0 && bodyEnd>bodyStart);
  assert.equal(source.slice(bodyStart, bodyEnd), original.slice(start+headers[i].length,end), 'M12 clinical route body must be byte-identical');
  moduleOffset=bodyEnd+6;
  assert.equal(server.split(registrations[i]).length,2,'one registration only');
  assert.equal(server.split(headers[i]).length,1,'old inline route removed');
}
assert.ok(server.indexOf("'/api/aba/patients/:patientId/maintenance-targets/ensure'") < server.indexOf(registrations[0]));
assert.ok(server.indexOf(registrations[0]) < server.indexOf(registrations[1]));
assert.ok(server.indexOf(registrations[1]) < server.indexOf("'/api/aba/maintenance-schedules/:scheduleId'"));
assert.ok(!source.includes("from '../server'"), 'no circular import');
assert.ok(!source.includes('service_role'), 'no secrets');
const compiled=ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sandbox={exports:{},process:{env:{NODE_ENV:'production'}},console};
vm.runInNewContext(compiled,sandbox);
const create=sandbox.exports.createAbaMaintenanceScheduleCreateHandler;
const next=sandbox.exports.createAbaMaintenanceNextSessionScheduleHandler;
assert.equal(typeof create,'function');
assert.equal(typeof next,'function');
const ids={
 clinic:'11111111-1111-4111-8111-111111111111',
 otherClinic:'99999999-9999-4999-8999-999999999999',
 patient:'22222222-2222-4222-8222-222222222222',
 target:'33333333-3333-4333-8333-333333333333',
 other:'44444444-4444-4444-8444-444444444444',
 schedule:'55555555-5555-4555-8555-555555555555'
};
const isUuid=value=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value));
const response=()=>({statusCode:200,payload:null,status(code){this.statusCode=code;return this;},json(data){this.payload=data;return this;}});
const request=(body={},overrides={})=>({
 params:{targetId:ids.target},
 body:{patientId:ids.patient,...body},
 session:{user:{id:ids.other,clinicId:ids.clinic,organizationId:ids.clinic}},
 ...overrides
});
const defaultSchedule={id:ids.schedule,targetId:ids.target,status:'SCHEDULED',clinic_id:ids.clinic,patient_id:ids.patient};
function harness({allowed=true,payloadOk=true,dbPatient=ids.patient,dbClinic=ids.clinic,result={ok:true,data:[defaultSchedule]},throwWrite=false}={}) {
 const trace={limits:[],access:[],reads:[],writes:[],errors:[],tenant:[]};
 const deps={
  enforcePayloadLimit(req,res,limit) {trace.limits.push(limit);if(!payloadOk){res.status(413).json({success:false});return false;}return true;},
  sanitizeString:(v,n)=>String(v??'').trim().slice(0,n),
  currentClinicId:user=>user.clinicId,
  isUuid,
  supabase:{from(table){
    assert.equal(table,'aba_targets');
    const conditions=[];
    return {select(){return this;},eq(k,v){conditions.push([k,v]);return this;},limit(){return this;},
     async maybeSingle(){trace.reads.push(conditions);const matching=conditions.every(([k,v])=>k==='id'?v===ids.target:k==='clinic_id'?v===dbClinic:true);
       return {error:null,data:matching?{id:ids.target,patient_id:dbPatient,clinic_id:dbClinic}:null};}
    };
  }},
  applyAbaTenantScope(q,user,clinicId,organizationId){trace.tenant.push({clinicId,organizationId});return q.eq('clinic_id',clinicId);},
  hasMissingFinancialSchema:()=>false,
  async canAccessPatientInCurrentClinic(id,user){trace.access.push({id,clinicId:user.clinicId});return allowed&&id===ids.patient&&user.clinicId===ids.clinic;},
  async createMaintenanceScheduleForTarget(args){trace.writes.push(args);if(throwWrite)throw Error('synthetic write');return result;},
  readMaintenanceStoredPayload:()=>({}),
  sanitizePeiLocalIdentifier:(v,n)=>String(v??'').trim().slice(0,n),
  cleanObject:v=>v,
  logRouteDbError:(route,error,details)=>trace.errors.push({route,details})
 };
 return {createHandler:create(()=>deps),nextHandler:next(()=>deps),trace};
}
{
 const h=harness(),res=response();await h.createHandler(request({clinicId:ids.otherClinic,organizationId:ids.otherClinic}),res);
 assert.equal(res.statusCode,200);
 assert.equal(res.payload.success,true);
 assert.equal(res.payload.schedule.id,ids.schedule);
 assert.equal(res.payload.schedule.targetId,ids.target);
 assert.equal(res.payload.schedule.persisted,true);
 assert.equal(h.trace.writes.length,1);
 assert.equal(h.trace.writes[0].clinicId,ids.clinic,'server session is authoritative');
 assert.equal(h.trace.writes[0].organizationId,ids.clinic,'body cannot change tenant');
 assert.equal(h.trace.writes[0].patientId,ids.patient);
 assert.equal(h.trace.reads.length,0,'known patient does not introduce extra query');
 assert.equal(h.trace.limits[0],65536);
}
for (const [body,expected] of [
 [{targetId:ids.other},'TARGET_ID_MISMATCH'],
 [{mode:'invalid'},'INVALID_MODE'],
 [{mode:'APPOINTMENT'},'MISSING_APPOINTMENT_ID'],
 [{mode:'DATE'},'MISSING_DUE_DATE'],
]) {
 const h=harness(),res=response();await h.createHandler(request(body),res);
 assert.equal(res.statusCode,400);
 assert.equal(res.payload.error,expected);
 assert.equal(h.trace.writes.length,0);
}
{
 const h=harness(),res=response();await h.createHandler(request({}, {params:{targetId:'not-an-id'}}),res);
 assert.equal(res.statusCode,400);assert.equal(h.trace.writes.length,0);
}
{
 const h=harness({allowed:false}),res=response();await h.createHandler(request(),res);
 assert.equal(res.statusCode,403);assert.equal(h.trace.writes.length,0);
}
{
 const h=harness({payloadOk:false}),res=response();await h.createHandler(request(),res);
 assert.equal(res.statusCode,413);assert.equal(h.trace.access.length,0);assert.equal(h.trace.writes.length,0);
}
{
 const h=harness(),res=response();await h.createHandler(request({patientId:''}),res);
 assert.equal(res.statusCode,200);
 assert.equal(h.trace.reads.length,1);
 assert.deepEqual(h.trace.tenant.map(t=>t.clinicId),[ids.clinic]);
 assert.equal(h.trace.writes[0].patientId,ids.patient);
}
{
 const h=harness({dbClinic:ids.otherClinic}),res=response();await h.createHandler(request({patientId:''}),res);
 assert.equal(res.statusCode,403);
 assert.equal(h.trace.writes.length,0,'out-of-tenant target must not schedule');
}
{
 const h=harness({result:{ok:false,status:409,error:'Conflito de agenda'}}),res=response();
 await h.createHandler(request(),res);
 assert.equal(res.statusCode,409);assert.equal(res.payload.error,'MAINTENANCE_SCHEDULE_CONFLICT');
}
{
 const h=harness({result:{ok:true,data:[]}}),res=response();await h.createHandler(request(),res);
 assert.equal(res.statusCode,500);assert.equal(res.payload.error,'PERSISTENCE_NOT_CONFIRMED');
}
{
 const h=harness({throwWrite:true}),res=response();await h.createHandler(request(),res);
 assert.equal(res.statusCode,500);assert.equal(h.trace.errors.length,1);
}
{
 const h=harness(),res=response();await h.nextHandler(request({clinicId:ids.otherClinic}),res);
 assert.equal(res.statusCode,200);assert.equal(res.payload.schedule.id,ids.schedule);
 assert.equal(h.trace.writes.length,1);
 assert.equal(h.trace.writes[0].scheduleMode,'NEXT_PATIENT_SESSION');
 assert.equal(h.trace.writes[0].clinicId,ids.clinic);
 assert.equal(h.trace.limits[0],49152);
}
{
 const h=harness({allowed:false}),res=response();await h.nextHandler(request(),res);
 assert.equal(res.statusCode,403);assert.equal(h.trace.writes.length,0);
}
{
 const h=harness({payloadOk:false}),res=response();await h.nextHandler(request(),res);
 assert.equal(res.statusCode,413);assert.equal(h.trace.writes.length,0);
}
{
 const h=harness(),res=response();await h.nextHandler(request({}, {params:{targetId:ids.otherClinic},body:{patientId:'invalid'}}),res);
 assert.equal(res.statusCode,403);assert.equal(h.trace.writes.length,0);
}
{
 const h=harness({result:{ok:false,status:404,error:'target missing'}}),res=response();await h.nextHandler(request(),res);
 assert.equal(res.statusCode,404);assert.equal(res.payload.error,'TARGET_NOT_FOUND');
}
console.log('ABA-M12: byte parity, middleware and route order, tenant/patient scope, payload limits, no false create ACK PASS');
