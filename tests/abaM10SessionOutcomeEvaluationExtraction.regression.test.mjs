import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// ABA-M10 must preserve both clinical writers byte-for-byte against the pre-extraction staging blob.
const before = execFileSync('git', ['cat-file', 'blob', '6de204c2c780c0c0d655e3e40ab615c1526fde25'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = readFileSync('server.ts', 'utf8');
const moduleSource = readFileSync('services/abaSessionOutcomeEvaluators.ts', 'utf8');
const start = '  const evaluateAndPersistSessionMastery = async (params: {';
const oldEnd = '\n  const resolveAbaSessionReadScope = async';
const moduleEnd = '\n  return { evaluateAndPersistSessionMastery, evaluateAndPersistSessionMaintenance };';
const startOld = before.indexOf(start), endOld = before.indexOf(oldEnd, startOld);
const startNew = moduleSource.indexOf(start), endNew = moduleSource.indexOf(moduleEnd, startNew);
assert.ok(startOld > 0 && endOld > startOld && startNew > 0 && endNew > startNew, 'both evaluators must exist');
assert.equal(moduleSource.slice(startNew, endNew), before.slice(startOld, endOld), 'clinical evaluator bodies remain byte-identical');
assert.ok(server.includes("import { createAbaSessionOutcomeEvaluators } from './services/abaSessionOutcomeEvaluators';"));
const register = 'const { evaluateAndPersistSessionMastery, evaluateAndPersistSessionMaintenance } = createAbaSessionOutcomeEvaluators(() => ({';
assert.equal(server.split(register).length, 2, 'one registration, no duplicate evaluation');
assert.ok(server.indexOf('const fetchAbaMasteryCriterion = async') < server.indexOf(register));
assert.ok(server.indexOf(register) < server.indexOf('const resolveAbaSessionReadScope = async'));
assert.ok(!server.includes(start), 'old inline evaluation must be removed');
assert.ok(!moduleSource.includes("from '../server'"), 'no import cycle');
for (const call of ['await evaluateAndPersistSessionMastery({', 'await evaluateAndPersistSessionMaintenance({']) {
  assert.equal(server.split(call).length, 3, 'both original session flows must still use the evaluator: ' + call);
}
for (const clause of [
  ".eq('session_id', sessionId)", ".eq('patient_id', patientId)", ".eq('clinic_id', clinicId)",
  ".eq('organization_id', organizationId)", ".eq('target_id', targetId)",
  "hasPersistedMaintenanceScheduleId(trialScheduleId)",
  "writeAbaRowWithSchemaFallback('aba_mastery_evaluations', payload, 'upsert')",
  "writeAbaRowWithSchemaFallback('aba_maintenance_probe_results', payload, 'upsert')",
  "completeMaintenanceScheduleAfterProbe({", "updateAbaScheduleWithSchemaFallback("
]) assert.ok(moduleSource.includes(clause), 'preserve guard or write: ' + clause);

const compiled = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const scope = { exports: {} };
vm.runInNewContext(compiled, scope);
const factory = scope.exports.createAbaSessionOutcomeEvaluators;
assert.equal(typeof factory, 'function');

const clinic = '11111111-1111-4111-8111-111111111111';
const patient = '22222222-2222-4222-8222-222222222222';
const target = '33333333-3333-4333-8333-333333333333';
const scheduleId = '44444444-4444-4444-8444-444444444444';
const appointmentId = '55555555-5555-4555-8555-555555555555';
const other = '66666666-6666-4666-8666-666666666666';
const evaluatedAt = '2026-11-08T12:00:00.000Z';
const ids = {sessionId:'session-test', patientId:patient, clinicId:clinic, therapistId:other, evaluatedAt, appointmentId};
const string = (v, max = 1000) => String(v ?? '').slice(0, max);
const isUuid = v => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v));
const trial = { id:'trial-1', organization_id:clinic, clinic_id:clinic, patient_id:patient, session_id:ids.sessionId, target_id:target, target_name:'Meta sintética', program_id:other, therapist_id:other, collection_type:'teaching', maintenance_schedule_id:scheduleId, occurred_at:evaluatedAt };
const baseEvaluation = { status:'MET_TODAY', criteriaId:'criterion-1', suggestedPhase:'MAINTENANCE', totalTrials:1, independentTrials:1, promptedTrials:0, errorTrials:0, accuracyPercent:100, independencePercent:100, criterionProgressCount:1, consecutiveSuccessfulDays:1, criterionRequiredCount:3, coldProbeTrialsCount:0, distinctTherapistsCount:1, firstTrialIndependent:true, reasons:[], evaluatedAt, criterionLabel:'Critério', criterionProgressLabel:'1/3', performanceText:'1/1', successfulSessions:1 };
const maintenanceEvaluation = { ...baseEvaluation, status:'MAINTAINED', occurredAt:evaluatedAt, consecutiveFailureCount:0, shouldCreateRegressionAlert:false, suggestedClinicalStatus:'MAINTENANCE', minAccuracyPercent:80, minIndependencePercent:80 };
function harness({ kind='mastery', invalidSchedule=false, foreignSchedule=false, status='MAINTAINED', writeError=null } = {}) {
  const events = { reads:[], writes:[], scheduleUpdates:[], completions:[], criteria:[], evaluations:[] };
  const schedule = { id:scheduleId, organization_id:foreignSchedule?other:clinic, clinic_id:clinic, patient_id:patient, target_id:target, raw_payload:{} };
  const rowSet = kind==='mastery'
    ? [{ ...trial }, { ...trial, id:'maintenance-trial', collection_type:'maintenance_probe' }]
    : [{ ...trial, collection_type:'maintenance_probe', maintenance_schedule_id:invalidSchedule?'bad-schedule':scheduleId }];
  const read = (table, filters) => {
    events.reads.push({ table, filters:filters.map(([k,v]) => [k,v]) });
    if (table==='aba_trials') return { data:rowSet, error:null };
    if (table==='aba_mastery_evaluations' || table==='aba_maintenance_probe_results') return { data:[], error:null };
    if (table==='aba_sessions') return { data:{ id:ids.sessionId, appointment_id:appointmentId }, error:null };
    if (table==='aba_maintenance_schedules') {
      const scoped = filters.every(([k,v]) => String(schedule[k])===String(v));
      return { data:scoped?schedule:null, error:null };
    }
    throw Error('Unexpected read table: '+table);
  };
  const supabase = { from(table) {
    const filters = [];
    const query = {
      select() { return query; },
      eq(k,v) { filters.push([k,v]); return query; },
      neq() { return query; },
      order() { return query; },
      limit() { return query; },
      maybeSingle() { return Promise.resolve(read(table,filters)); },
      then(resolve,reject) { return Promise.resolve(read(table,filters)).then(resolve,reject); }
    };
    return query;
  }};
  const deps = {
    sanitizeString:string, sanitizeTextField:string, sanitizeDate:v=>string(v).slice(0,10),
    isUuid, sanitizeClinicalPayload:v=>v, cleanObject:v=>v, supabase,
    hasMissingFinancialSchema:err=>err?.code==='42P01',
    fetchAbaMasteryCriterion:async p=>{events.criteria.push(p);return { criterion:{ id:'criterion-1' }, target:{ phase:'teaching' } };},
    evaluateTargetMastery:p=>{events.evaluations.push(p);return baseEvaluation;},
    normalizeAbaMasteryStatusForLegacy:v=>v,
    writeAbaRowWithSchemaFallback:async (table,payload,method)=>{events.writes.push({table,payload,method});return {error:writeError};},
    formatAbaMasteryCriterion:()=> 'Critério', abaMasteryStatusLabel:v=>v,
    hasPersistedMaintenanceScheduleId:v=>isUuid(v),
    ABA_MAINTENANCE_SCHEDULE_SELECT:'id,organization_id,clinic_id,patient_id,target_id,raw_payload',
    ABA_MAINTENANCE_PROBE_RESULT_SELECT:'id,organization_id',
    evaluateMaintenanceStatus:p=>{events.evaluations.push(p);return {...maintenanceEvaluation,status};},
    completeMaintenanceScheduleAfterProbe:async p=>{events.completions.push(p);},
    updateAbaScheduleWithSchemaFallback:async (...p)=>{events.scheduleUpdates.push(p);return {error:null};},
    readMaintenanceStoredPayload:v=>v||{}
  };
  let dependencyReads=0;
  const evaluators=factory(()=>{dependencyReads++;return deps;});
  return { events, evaluators, dependencyReads:()=>dependencyReads };
}

{
  const h=harness();
  const result=await h.evaluators.evaluateAndPersistSessionMastery({ ...ids, patientId:'not-a-uuid' });
  assert.equal(result.length,0);assert.equal(h.events.reads.length,0);assert.equal(h.events.writes.length,0,'invalid tenant/patient cannot write');
}
{
  const h=harness();
  const result=await h.evaluators.evaluateAndPersistSessionMastery(ids);
  assert.equal(result.length,1,'maintenance probe excluded from mastery');
  assert.equal(h.events.reads.length,2,'trials and previous history only');
  assert.equal(h.events.criteria.length,1);
  assert.equal(h.events.evaluations[0].trials.length,1);
  assert.equal(h.events.writes.length,1);
  assert.equal(h.events.writes[0].table,'aba_mastery_evaluations');
  assert.equal(h.events.writes[0].method,'upsert');
  assert.equal(h.events.writes[0].payload.clinic_id,clinic);
  assert.equal(h.events.writes[0].payload.patient_id,patient);
  assert.equal(h.events.writes[0].payload.target_id,target);
  const trialScope=h.events.reads.find(x=>x.table==='aba_trials').filters;
  assert.ok(trialScope.some(([k,v])=>k==='clinic_id'&&v===clinic));
  assert.ok(trialScope.some(([k,v])=>k==='patient_id'&&v===patient));
  assert.ok(trialScope.some(([k,v])=>k==='session_id'&&v===ids.sessionId));
  await h.evaluators.evaluateAndPersistSessionMastery(ids);
  assert.equal(h.events.writes[0].payload.id,h.events.writes[1].payload.id,'stable upsert ID on repeated evaluation');
  assert.equal(h.dependencyReads(),1,'same dependency snapshot, no new backend initialization per call');
}
{
  const h=harness({kind:'maintenance'});
  const result=await h.evaluators.evaluateAndPersistSessionMaintenance(ids);
  assert.equal(result.length,1);
  assert.equal(h.events.reads.length,3,'trial, scoped schedule and historical probes; no extra session lookup when appointment provided');
  assert.equal(h.events.writes.length,1);
  assert.equal(h.events.writes[0].table,'aba_maintenance_probe_results');
  assert.equal(h.events.writes[0].method,'upsert');
  assert.equal(h.events.writes[0].payload.appointment_id,appointmentId);
  assert.equal(h.events.writes[0].payload.clinic_id,clinic);
  assert.equal(h.events.writes[0].payload.patient_id,patient);
  assert.equal(h.events.completions.length,1,'maintained schedule completes after persisted probe');
  assert.equal(h.events.scheduleUpdates.length,0);
  const filter=h.events.reads.find(x=>x.table==='aba_maintenance_schedules').filters;
  for(const [key,val] of [['organization_id',clinic],['clinic_id',clinic],['patient_id',patient],['target_id',target]]) assert.ok(filter.some(([k,v])=>k===key&&v===val));
}
{
  const h=harness({kind:'maintenance',status:'NEEDS_REVIEW'});
  await h.evaluators.evaluateAndPersistSessionMaintenance(ids);
  assert.equal(h.events.completions.length,0,'failed maintenance does not complete schedule');
  assert.equal(h.events.scheduleUpdates.length,1,'status is updated only after result write');
  assert.equal(h.events.scheduleUpdates[0][2],clinic);
  assert.equal(h.events.scheduleUpdates[0][4],patient);
}
for (const opts of [{kind:'maintenance',invalidSchedule:true},{kind:'maintenance',foreignSchedule:true}]) {
  const h=harness(opts);
  const out=await h.evaluators.evaluateAndPersistSessionMaintenance(ids);
  assert.equal(out.length,0,'invalid or foreign schedule must not produce a result');
  assert.equal(h.events.writes.length,0,'invalid or foreign schedule cannot be persisted');
  assert.equal(h.events.completions.length,0);
}
for(const kind of ['mastery','maintenance']) {
  const h=harness({kind,writeError:{code:'23505'}});
  const evaluate=kind==='mastery' ? h.evaluators.evaluateAndPersistSessionMastery : h.evaluators.evaluateAndPersistSessionMaintenance;
  await assert.rejects(()=>evaluate(ids), /object|23505/, 'write failure must propagate without success');
  assert.equal(h.events.completions.length,0,'failed write must not close maintenance');
  assert.equal(h.events.scheduleUpdates.length,0,'failed write must not update maintenance status');
}
console.log('ABA-M10: byte parity, call sites, scoped reads, stable upserts, maintenance FSM, invalid IDs, cross-clinic scope, write failures PASS');