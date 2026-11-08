import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const original = execFileSync('git', ['cat-file', 'blob', 'a0239f8a845fff675a8a0e353a8cd137520a19ba'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const source = readFileSync('services/peiMaintenanceTargetEnsureHandler.ts', 'utf8');
const header = "  app.post('/api/aba/patients/:patientId/maintenance-targets/ensure', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), checkPatientAccess, async (req: any, res) => {";
const start = original.indexOf(header), end = original.indexOf('\n  });', start + header.length);
const bodyStart = source.indexOf('\n    try {'), bodyEnd = source.lastIndexOf('\n  };');
assert.ok(start >= 0 && end > start && bodyStart > 0 && bodyEnd > bodyStart);
assert.equal(source.slice(bodyStart, bodyEnd), original.slice(start + header.length, end), 'clinical handler must be a byte-exact move');
const registration = "  app.post('/api/aba/patients/:patientId/maintenance-targets/ensure', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.maintenance.manage'), checkPatientAccess, createPeiMaintenanceTargetEnsureHandler(() => ({ enforcePayloadLimit, sanitizeString, currentClinicId, isUuid, canAccessPatientInCurrentClinic, ensurePeiMaintenanceTargetForPatient, cleanObject })));";
assert.equal(server.split(registration).length, 2, 'middleware chain unchanged and route once');
assert.equal(server.split(header).length, 1, 'inline handler removed');
assert.ok(server.includes("import { createPeiMaintenanceTargetEnsureHandler } from './services/peiMaintenanceTargetEnsureHandler';"));
assert.ok(server.indexOf("'/api/aba/patients/:patientId/future-appointments'") < server.indexOf(registration));
assert.ok(server.indexOf(registration) < server.indexOf("'/api/aba/targets/:targetId/maintenance-schedules'"));
assert.ok(server.includes('const ensurePeiMaintenanceTargetForPatient = async'), 'shared helper untouched');
assert.ok(!source.includes("from '../server'"), 'no circular dependency');

const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, process: { env: { NODE_ENV: 'production' } }, console };
vm.runInNewContext(compiled, sandbox);
const factory = sandbox.exports.createPeiMaintenanceTargetEnsureHandler;
assert.equal(typeof factory, 'function');
const ids = {
 clinic: '11111111-1111-4111-8111-111111111111',
 patient: '22222222-2222-4222-8222-222222222222',
 target: '33333333-3333-4333-8333-333333333333',
 actor: '44444444-4444-4444-8444-444444444444',
 other: '55555555-5555-4555-8555-555555555555'
};
const isUuid = value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value));
const response = () => ({ statusCode: 200, payload: null, status(n) { this.statusCode=n; return this; }, json(v) { this.payload=v; return this; } });
const request = (extra={}) => ({ params:{patientId:ids.patient}, resolvedPatientId:ids.patient, body:{patientId:ids.other, clinicId:ids.other, peiGoalId:ids.target}, session:{user:{id:ids.actor,clinicId:ids.clinic,organizationId:ids.clinic}}, ...extra });
function harness({ allowed=true, payloadOk=true, ensureResult, throwWrite=false }={}) {
 const calls={access:[], writes:[],limits:[]};
 const deps={
   enforcePayloadLimit(req,res,n,label) { calls.limits.push(n); if(!payloadOk){res.status(413).json({success:false});return false;} return true; },
   sanitizeString(v,max) { return String(v??'').trim().slice(0,max); },
   currentClinicId(user) { return user.clinicId; },
   isUuid,
   async canAccessPatientInCurrentClinic(id,user) { calls.access.push({id,clinic:user.clinicId}); return allowed && id===ids.patient && user.clinicId===ids.clinic; },
   async ensurePeiMaintenanceTargetForPatient(data) { calls.writes.push(data); if(throwWrite) throw Error('synthetic failure'); return ensureResult ?? {ok:true,targetId:ids.target,masteryEvaluationId:ids.other,materialized:false,target:{id:ids.target,name:'Meta sintética',mastery_criteria:{peiGoalId:ids.target,skillId:ids.other,localTargetRef:'PEI-LOCAL'}}}; },
   cleanObject(value) {return value;}
 };
 return {handler:factory(()=>deps),calls};
}
{
 const h=harness(),res=response();
 await h.handler(request(),res);
 assert.equal(res.statusCode,200);
 assert.equal(res.payload.success,true);
 assert.equal(res.payload.targetId,ids.target);
 assert.equal(res.payload.target.peiGoalId,ids.target);
 assert.equal(res.payload.target.skillId,ids.other);
 assert.equal(res.payload.target.localTargetRef,'PEI-LOCAL');
 assert.equal(h.calls.writes.length,1);
 assert.equal(h.calls.access.length,1);
 assert.deepEqual(h.calls.limits,[65536]);
 assert.equal(h.calls.writes[0].patientId,ids.patient);
 assert.equal(h.calls.writes[0].clinicId,ids.clinic);
 assert.equal(h.calls.writes[0].organizationId,ids.clinic);
 assert.equal(h.calls.writes[0].sessionUser.id,ids.actor);
}
{
 const h=harness(),res=response();
 await h.handler(request({params:{patientId:ids.other}}),res);
 assert.equal(res.statusCode,200,'resolved patient identity authoritative');
 assert.equal(h.calls.writes[0].patientId,ids.patient);
}
for(const badId of ['not-a-uuid',ids.other]) {
 const h=harness(),res=response();
 await h.handler(request({resolvedPatientId:badId}),res);
 assert.equal(res.statusCode,403);
 assert.equal(h.calls.writes.length,0);
}
{
 const h=harness({allowed:false}),res=response();await h.handler(request(),res);
 assert.equal(res.statusCode,403);
 assert.equal(h.calls.writes.length,0);
}
{
 const h=harness({payloadOk:false}),res=response();await h.handler(request(),res);
 assert.equal(res.statusCode,413);
 assert.equal(h.calls.access.length,0);
 assert.equal(h.calls.writes.length,0);
}
for(const [status,code] of [[404,'PEI_SKILL_NOT_FOUND'],[409,'TARGET_ENSURE_FAILED']]) {
 const h=harness({ensureResult:{ok:false,status,error:'synthetic'}}),res=response();
 await h.handler(request(),res);
 assert.equal(res.statusCode,status);assert.equal(res.payload.error,code);
}
{
 const h=harness({throwWrite:true}),res=response();await h.handler(request(),res);
 assert.equal(res.statusCode,500);assert.equal(res.payload.success,false);
}
console.log('ABA-M11: literal parity, middleware, negative clinic/patient/payload and response contracts PASS');
