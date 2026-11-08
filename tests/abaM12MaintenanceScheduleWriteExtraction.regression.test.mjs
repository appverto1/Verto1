import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const previous = execFileSync('git', ['cat-file', 'blob', 'b82667a64fdb036a2111dd329dfb0c18527cf2dd'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const extracted = readFileSync('services/abaMaintenanceScheduleWriteHandlers.ts', 'utf8');
const cases = [
  {
    "path": "/api/aba/targets/:targetId/maintenance-schedules",
    "exportName": "createAbaMaintenanceScheduleWriteHandler",
    "deps": [
      "enforcePayloadLimit",
      "sanitizeString",
      "currentClinicId",
      "isUuid",
      "supabase",
      "applyAbaTenantScope",
      "hasMissingFinancialSchema",
      "canAccessPatientInCurrentClinic",
      "createMaintenanceScheduleForTarget",
      "readMaintenanceStoredPayload",
      "sanitizePeiLocalIdentifier",
      "cleanObject",
      "logRouteDbError"
    ]
  },
  {
    "path": "/api/aba/targets/:targetId/maintenance-schedules/next-session",
    "exportName": "createAbaMaintenanceNextSessionWriteHandler",
    "deps": [
      "enforcePayloadLimit",
      "sanitizeString",
      "currentClinicId",
      "isUuid",
      "canAccessPatientInCurrentClinic",
      "createMaintenanceScheduleForTarget"
    ]
  }
];
for (const item of cases) {
  const header = "  app.post('" + item.path + "', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), async (req: any, res) => {";
  const start = previous.indexOf(header);
  const end = previous.indexOf('\n  });', start + header.length);
  assert.ok(start >= 0 && end > start, 'previous route found: ' + item.path);
  const originalBody = previous.slice(start + header.length, end);
  const factory = 'export function ' + item.exportName + '(getDeps: () => any) {';
  const factoryStart = extracted.indexOf(factory);
  const beginBody = extracted.indexOf('\n    try {', factoryStart);
  const finishBody = extracted.indexOf('\n  };', beginBody);
  assert.ok(factoryStart >= 0 && beginBody > factoryStart && finishBody > beginBody);
  assert.equal(extracted.slice(beginBody, finishBody), originalBody, 'literal byte-parity for ' + item.path);
  const register = "  app.post('" + item.path + "', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), " + item.exportName + '(() => ({ ' + item.deps.join(', ') + ' })));';
  assert.equal(server.split(register).length, 2, 'route registered once: ' + item.path);
  assert.ok(!server.includes(header), 'inline handler removed');
}
assert.ok(server.includes("import { createAbaMaintenanceScheduleWriteHandler, createAbaMaintenanceNextSessionWriteHandler } from './services/abaMaintenanceScheduleWriteHandlers';"));
assert.ok(server.indexOf("'/api/aba/patients/:patientId/maintenance-targets/ensure'") < server.indexOf("'/api/aba/targets/:targetId/maintenance-schedules'"));
assert.ok(server.indexOf("'/api/aba/targets/:targetId/maintenance-schedules/next-session'") < server.indexOf("'/api/aba/maintenance-schedules/:scheduleId'"));
assert.ok(!extracted.includes("from '../server'"), 'no circular dependency');
const compiled = ts.transpileModule(extracted, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const scope = { exports: {}, process: { env: { NODE_ENV: 'production' } }, console };
vm.runInNewContext(compiled, scope);
const createSchedule = scope.exports.createAbaMaintenanceScheduleWriteHandler;
const createNext = scope.exports.createAbaMaintenanceNextSessionWriteHandler;
assert.equal(typeof createSchedule, 'function');
assert.equal(typeof createNext, 'function');
const ids = { clinic:'11111111-1111-4111-8111-111111111111', patient:'22222222-2222-4222-8222-222222222222', target:'33333333-3333-4333-8333-333333333333', other:'55555555-5555-4555-8555-555555555555', schedule:'66666666-6666-4666-8666-666666666666' };
const response = () => ({statusCode:200,payload:null,status(n){this.statusCode=n;return this;},json(v){this.payload=v;return this;}});
const request=(body={},params={targetId:ids.target})=>({body,params,session:{user:{id:ids.other,clinicId:ids.clinic,organizationId:ids.clinic}}});
const isUuid=v=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v));
function harness({ access=true, limit=true, result={ok:true,data:[{id:ids.schedule,status:'SCHEDULED'}]}, throwWrite=false }={}) {
 const calls={writes:[],access:[],limits:[]};
 const deps={
  enforcePayloadLimit(req,res,n){calls.limits.push(n);if(!limit){res.status(413).json({success:false});return false;}return true;},
  sanitizeString(v,max){return String(v??'').trim().slice(0,max);},
  currentClinicId(user){return user.clinicId;},
  isUuid,
  async canAccessPatientInCurrentClinic(id,user){calls.access.push({id,clinic:user.clinicId});return access && id===ids.patient && user.clinicId===ids.clinic;},
  async createMaintenanceScheduleForTarget(input){calls.writes.push(input);if(throwWrite)throw Error('synthetic database failure');return result;},
  readMaintenanceStoredPayload(v){return v||{};},
  sanitizePeiLocalIdentifier(v,max){return String(v??'').slice(0,max);},
  cleanObject(v){return v;},
  logRouteDbError(){},
  hasMissingFinancialSchema(){return false;},
  applyAbaTenantScope(q){return q;},
  supabase:{from(){throw Error('Unexpected DB fallback query');}}
 };
 return {calls,create: createSchedule(()=>deps),next:createNext(()=>deps)};
}
async function call(handler,body={},params={targetId:ids.target}){const res=response();await handler(request(body,params),res);return res;}
{
 const h=harness();const res=await call(h.create,{patientId:ids.patient,mode:'NEXT_SESSION'});
 assert.equal(res.statusCode,200);assert.equal(res.payload.success,true);assert.equal(res.payload.schedule.id,ids.schedule);
 assert.equal(h.calls.writes.length,1);assert.equal(h.calls.writes[0].clinicId,ids.clinic);assert.equal(h.calls.writes[0].patientId,ids.patient);
 assert.equal(h.calls.writes[0].scheduleMode,'NEXT_PATIENT_SESSION');assert.equal(h.calls.writes[0].targetId,ids.target);
 assert.deepEqual(h.calls.limits,[65536]);
}
for (const [body,params,status,code] of [
 [{patientId:ids.patient},{targetId:'invalid'},400,'MISSING_TARGET_ID'],
 [{patientId:ids.patient,targetId:ids.other},undefined,400,'TARGET_ID_MISMATCH'],
 [{patientId:ids.other},undefined,403,'FORBIDDEN'],
 [{patientId:ids.patient,mode:'unrecognized'},undefined,400,'INVALID_MODE'],
 [{patientId:ids.patient,mode:'DATE'},undefined,400,'MISSING_DUE_DATE'],
 [{patientId:ids.patient,mode:'APPOINTMENT'},undefined,400,'MISSING_APPOINTMENT_ID']
]){
 const h=harness();const res=await call(h.create,body,params||{targetId:ids.target});
 assert.equal(res.statusCode,status);assert.equal(res.payload.error,code);assert.equal(h.calls.writes.length,0);
}
{
 const h=harness({access:false});const res=await call(h.create,{patientId:ids.patient});
 assert.equal(res.statusCode,403);assert.equal(h.calls.writes.length,0);
}
{
 const h=harness({limit:false});const res=await call(h.create,{patientId:ids.patient});
 assert.equal(res.statusCode,413);assert.equal(h.calls.access.length,0);assert.equal(h.calls.writes.length,0);
}
{
 const h=harness({result:{ok:false,status:409,error:'conflict'}});const res=await call(h.create,{patientId:ids.patient});
 assert.equal(res.statusCode,409);assert.equal(res.payload.error,'MAINTENANCE_SCHEDULE_CONFLICT');
}
{
 const h=harness({result:{ok:true,data:[{status:'SCHEDULED'}]}});const res=await call(h.create,{patientId:ids.patient});
 assert.equal(res.statusCode,500);assert.equal(res.payload.error,'PERSISTENCE_NOT_CONFIRMED');
}
{
 const h=harness({throwWrite:true});const res=await call(h.create,{patientId:ids.patient});
 assert.equal(res.statusCode,500);assert.equal(res.payload.error,'UNEXPECTED_ERROR');
}
{
 const h=harness();const res=await call(h.next,{patientId:ids.patient});
 assert.equal(res.statusCode,200);assert.equal(res.payload.success,true);
 assert.equal(h.calls.writes[0].scheduleMode,'NEXT_PATIENT_SESSION');
 assert.equal(h.calls.writes[0].clinicId,ids.clinic);assert.deepEqual(h.calls.limits,[49152]);
}
{
 const h=harness();const res=await call(h.next,{patientId:ids.other});
 assert.equal(res.statusCode,403);assert.equal(h.calls.writes.length,0);
}
{
 const h=harness();const res=await call(h.next,{patientId:ids.patient},{targetId:'invalid'});
 assert.equal(res.statusCode,400);assert.equal(h.calls.writes.length,0);
}
{
 const h=harness({result:{ok:false,status:404,error:'not found'}});const res=await call(h.next,{patientId:ids.patient});
 assert.equal(res.statusCode,404);assert.equal(res.payload.error,'TARGET_NOT_FOUND');
}
{
 const h=harness({throwWrite:true});const res=await call(h.next,{patientId:ids.patient});
 assert.equal(res.statusCode,500);assert.equal(res.payload.success,false);
}
console.log('ABA-M12 byte-parity and request regressions passed');
