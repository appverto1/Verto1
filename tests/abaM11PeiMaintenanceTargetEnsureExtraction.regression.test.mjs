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
assert.ok(server.includes('const ensurePeiMaintenanceTargetForPatient = createPeiMaintenanceTargetResolver(() => ({'), 'same helper binding remains at the original position');
const resolverSource = readFileSync('services/peiMaintenanceTargetResolver.ts', 'utf8');
assert.ok(server.includes("import { createPeiMaintenanceTargetResolver } from './services/peiMaintenanceTargetResolver';"));
const helperHead = "  const ensurePeiMaintenanceTargetForPatient = async (params: {\n    patientId: string;\n    clinicId: string;\n    organizationId: string;\n    sessionUser: any;\n    payload: any;\n  }) => {";
const helperStart = original.indexOf(helperHead), helperEnd = original.indexOf('\n  };', helperStart + helperHead.length);
const extractedStart = resolverSource.indexOf('\n    const patientId ='), extractedEnd = resolverSource.lastIndexOf('\n  };');
assert.ok(helperStart >= 0 && helperEnd > helperStart && extractedStart > 0 && extractedEnd > extractedStart);
assert.equal(resolverSource.slice(extractedStart, extractedEnd), original.slice(helperStart + helperHead.length, helperEnd), 'PEI target resolution helper must remain byte exact');
assert.ok(!resolverSource.includes("from '../server'"));
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

const resolverCompiled = ts.transpileModule(resolverSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const resolverScope = { exports: {} };
vm.runInNewContext(resolverCompiled, resolverScope);
const resolverFactory = resolverScope.exports.createPeiMaintenanceTargetResolver;
assert.equal(typeof resolverFactory, 'function');
function resolverHarness({ existingTarget = null, requestedTargetId = ids.target, sourceEligible = true, queryError = null } = {}) {
 const trace={queries:[], events:[], materializations:[], peiReads:[]};
 const deps={
   sanitizeString: (v,max) => String(v??'').trim().slice(0,max),
   isUuid,
   readPeiMaintenanceEnsureSource: () => ({targetId:requestedTargetId,targetName:'Meta sintética',eligibleForMaintenance:sourceEligible}),
   supabase: { from(table) {
     const conditions=[];
     const chain={
       select() {return this;}, eq(key,value){ conditions.push([key,value]);return this;},limit(){return this;},
       then(resolve,reject) {
         trace.queries.push({table,conditions});
         const filtered=existingTarget && conditions.every(([key,value])=>String(existingTarget[key])===String(value)) ? [existingTarget] : [];
         return Promise.resolve({error:queryError,data:filtered}).then(resolve,reject);
       }
     };
     return chain;
   }},
   ABA_TARGET_RECOMMENDATION_SELECT:'id,organization_id,clinic_id,patient_id',
   applyAbaTenantScope: (query,user,clinicId) => query.eq('clinic_id',clinicId),
   hasMissingFinancialSchema: err => err?.code==='MISSING_SCHEMA',
   isMissingRelationError: err => err?.code==='MISSING_RELATION',
   async persistPeiSkillAcquiredMasteryEvent(value) { trace.events.push(value);return ids.other; },
   async getPatientPeiTargets(patientId,clinicId) { trace.peiReads.push({patientId,clinicId});return []; },
   resolvePeiMaintenanceSourceTarget: () => null,
   async materializePeiTargetsForMaintenance(value) {
     trace.materializations.push(value);
     return {peiTargets:[{targetId:ids.target}],targets:[{id:ids.target,name:'Meta sintética'}],materializedTargets:[{id:ids.target}]};
   },
   async fetchTargetForMaintenance() { throw Error('unexpected extra read'); }
 };
 return {resolve:resolverFactory(()=>deps),trace};
}
const params={patientId:ids.patient,clinicId:ids.clinic,organizationId:ids.clinic,sessionUser:{id:ids.actor,clinicId:ids.clinic},payload:{}};
{
 const row={id:ids.target,patient_id:ids.patient,clinic_id:ids.clinic,organization_id:ids.clinic,name:'Meta sintética'};
 const h=resolverHarness({existingTarget:row}),result=await h.resolve(params);
 assert.equal(result.ok,true);
 assert.equal(result.targetId,ids.target);
 assert.equal(result.materialized,false,'existing PEI target is reused');
 assert.equal(h.trace.materializations.length,0,'no duplicate target materialization');
 assert.equal(h.trace.queries.length,1);
 assert.deepEqual(h.trace.queries[0].conditions,[['organization_id',ids.clinic],['patient_id',ids.patient],['clinic_id',ids.clinic]]);
 assert.equal(h.trace.events.length,1);
}
{
 const h=resolverHarness(),result=await h.resolve(params);
 assert.equal(result.ok,true);
 assert.equal(result.targetId,ids.target);
 assert.equal(result.materialized,true);
 assert.equal(h.trace.materializations.length,1);
 assert.equal(h.trace.events.length,1);
}
{
 const h=resolverHarness({requestedTargetId:'invalid',sourceEligible:false}),result=await h.resolve(params);
 assert.equal(result.status,404);
 assert.equal(h.trace.materializations.length,0);
}
{
 const h=resolverHarness(),result=await h.resolve({...params,patientId:'invalid'});
 assert.equal(result.status,400);
 assert.equal(h.trace.queries.length,0);
}
{
 const h=resolverHarness({queryError:{code:'READ_DENIED'}});
 await assert.rejects(()=>h.resolve(params),/READ_DENIED|object Object/);
 assert.equal(h.trace.materializations.length,0);
}

console.log('ABA-M11: literal parity, middleware, negative clinic/patient/payload and response contracts PASS');
