import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const source=fs.readFileSync(new URL('../src/components/SessionMode.tsx',import.meta.url),'utf8');
function extract(source,name) {
 const tree=ts.createSourceFile('test.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expr;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)expr=n.initializer?.getText(tree);ts.forEachChild(n,visit);}visit(tree);assert.ok(expr,name);
 return ts.transpileModule('const tested='+expr+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'\ntested;';
}
const helper={exports:{},setTimeout,Date,Set,Number,Error};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/utils/sessionAutoFinalization.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,helper);
const {therapeuticTimerCompletion,isQueuedRecordForSession,waitForSessionWrites,AUTOMATIC_SESSION_CLOSURE_KEYS}=helper.exports;
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
await test('paused time is excluded; milliseconds preserved; invalid timestamp rejected',()=>{
 const r=therapeuticTimerCompletion({startedAt:'2026-10-01T10:00:00Z',runningSince:'2026-10-01T10:01:30Z',accumulatedMs:5250},'2026-10-01T10:02:00Z');assert.equal(r.totalMs,35250);assert.equal(r.seconds,35.25);assert.equal(r.effectiveStartedAt,'2026-10-01T10:01:24.750Z');assert.throws(()=>therapeuticTimerCompletion({startedAt:'bad',runningSince:null,accumulatedMs:10},'2026-10-01T10:02:00Z'));
});
await test('scope excludes another session even if entity id matches',()=>{
 const r={id:'q',entity_id:'trial',type:'aba',endpoint:'/api/aba/trials',data:{sessionId:'s2'}};assert.equal(isQueuedRecordForSession(r,'s1',['trial']),false);assert.equal(isQueuedRecordForSession({...r,data:{sessionId:'s1'}},'s1'),true);assert.equal(isQueuedRecordForSession({...r,type:'payment',data:{sessionId:'s1'}},'s1'),false);
});
await test('inflight write is awaited; stuck write times out',async()=>{let pending=true;setTimeout(()=>pending=false,5);await waitForSessionWrites(()=>pending,100);await assert.rejects(waitForSessionWrites(()=>true,1));});
await test('timer retry uses the same id, value and frozen end timestamp',async()=>{
 const ref={current:{g:{goalKey:'g',startedAt:'2026-10-01T10:00:00Z',runningSince:'2026-10-01T10:00:00Z',accumulatedMs:0,measurementType:'latency'}}};const writes=[];
 const ctx={therapeuticTimersRef:ref,therapeuticGoalKey:g=>g.id,therapeuticTimerCompletion,globalThis:{crypto:{randomUUID:()=> 'stable-id'}},setTherapeuticTimers:f=>ref.current=f(ref.current),formatDurationSeconds:String,persistTherapeuticMeasurement:async p=>{writes.push(p);return writes.length>1;}};
 const f=vm.runInNewContext(extract(source,'finishTherapeuticTimer'),ctx);assert.equal(await f({id:'g'},'2026-10-01T10:00:10Z',true),false);assert.equal(await f({id:'g'},'2026-10-01T10:01:00Z',true),true);assert.equal(writes[0].measurementId,writes[1].measurementId);assert.equal(writes[1].measurementValue,10);assert.equal(writes[1].endedAt,writes[0].endedAt);assert.equal(Object.keys(ref.current).length,0);
});
function fixture(options={}) {
 const events=[],requests=[],timers={current:{g1:{goalKey:'g1',goalSnapshot:{id:'g1'}},g2:{goalKey:'g2',goalSnapshot:{id:'g2'}}}},records={current:[{id:'trial-1',kind:'trial',syncStatus:'local'}]};let completed=false,error='';
 const c={Date,Set,Error,Promise,console:{error:()=>{},warn:()=>{}},AUTOMATIC_SESSION_CLOSURE_KEYS,waitForSessionWrites,endingSessionRef:{current:false},completionRequestRef:{current:null},completionIdempotencyKeyRef:{current:'same-key'},therapeuticTimersRef:timers,recordsRef:records,openDurationsRef:{current:[]},rateWindowRef:{current:null},intervalRunRef:{current:null},sessionGoals:[],sessionId:'session-1',patientId:'synthetic',patientDisplayName:'synthetic',resolvedTherapistId:'therapist',therapistDisplayName:'synthetic',activeSessionCareSetting:null,activeSessionLocationName:null,activeSession:{startedAt:'2026-10-01T10:00:00Z'},maintenanceTimeZone:'UTC',resolvedClinicId:'clinic',activeAppointmentId:null,sessionClinicalDate:'2026-10-01',attendanceStatus:'ATTENDED',sessionNote:'note',teachingMasteryRows:[],maintenanceProbeRows:[],NON_ATTENDANCE_STATUSES:new Set(),onSessionSummaryPersisted:null,
 setEndingSession:v=>c.endingSessionRef.current=v,setReinforcerClosureSyncing:()=>{},setSessionWarning:()=>{},setSessionEndError:v=>error=v,setRecords:v=>records.current=typeof v==='function'?v(records.current):v,setOpenDurations:v=>c.openDurationsRef.current=v,setRateWindow:v=>c.rateWindowRef.current=v,setIntervalRun:v=>c.intervalRunRef.current=v,
 flushReinforcerDeliveries:async()=>{events.push('reinforcer');return options.reinforcerFailure?{ok:false,pending:1,terminal:0}:{ok:true,pending:0,terminal:0};},
 buildSessionClosureIssues:()=>({blockers:options.mandatory?[{key:'absence_reason_required',label:'motivo'}]:[...(Object.keys(timers.current).length?[{key:'therapeutic_measurement_timer_open'}]:[]),...(records.current.some(r=>r.syncStatus!=='synced')?[{key:'server_sync_required'}]:[]),...(c.openDurationsRef.current.length?[{key:'open_duration'}]:[])],warnings:[]}),
 finishTherapeuticTimer:async g=>{events.push('timer:'+g.id);if(options.timerFailure&&g.id==='g2')return false;delete timers.current[g.id];records.current.push({id:g.id,kind:'trial',therapeuticMeasurement:true,syncStatus:'synced'});return true;},syncOfflineData:async()=>events.push('sync'),getSessionQueuedRecords:async()=>options.queueFailure?[{entity_id:'trial-1'}]:[],getRecordById:async()=>({sync_status:'synced'}),retryFailedV3Trial:async()=>{},isCancelledIntervalClinicalRecord:()=>false,calculateSessionSummary:(_,p)=>p,createSessionCompletionKey:()=> 'same-key',
 dataService:{completeAbaSession:async(_,p)=>{events.push('complete');requests.push(p);if(options.networkFailure&&requests.length===1)throw new Error('network');return {success:true,data:{}};}},
 setSessionEndPreviewAt:()=>{},setPostClosureSummary:()=>{},setOperationalClosure:()=>{},setSessionCompleted:v=>completed=v,setShowPostClosureReport:()=>{},setShowComplementEditor:()=>{},setShowSessionSummary:()=>{},showClinicalToast:()=>{},buildClinicalActionToast:()=>({}),buildClinicalSaveErrorToast:()=>({})};
 return {c,events,requests,timers,records,get completed(){return completed;},get error(){return error;}};
}
await test('two timers + one pending record close automatically; double click sends once',async()=>{const f=fixture(),close=vm.runInNewContext(extract(source,'confirmEndSession'),f.c);await Promise.all([close(),close()]);assert.deepEqual(f.events,['timer:g1','timer:g2','reinforcer','sync','complete']);assert.equal(f.requests.length,1);assert.equal(f.completed,true);assert.equal(f.records.current.every(r=>r.syncStatus==='synced'),true);});
await test('failed timer, unconfirmed queue and mandatory reason preserve session',async()=>{for(const o of [{timerFailure:true},{queueFailure:true},{reinforcerFailure:true},{mandatory:true}]){const f=fixture(o);await vm.runInNewContext(extract(source,'confirmEndSession'),f.c)();assert.equal(f.requests.length,0);assert.equal(f.completed,false);assert.ok(f.error);assert.equal(f.c.endingSessionRef.current,false);}});
await test('network retry reuses exact payload and never repeats saved measurements',async()=>{const f=fixture({networkFailure:true}),close=vm.runInNewContext(extract(source,'confirmEndSession'),f.c);await close();await close();assert.equal(f.requests.length,2);assert.equal(JSON.stringify(f.requests[0]),JSON.stringify(f.requests[1]));assert.deepEqual(f.events,['timer:g1','timer:g2','reinforcer','sync','complete','complete']);assert.equal(f.completed,true);});
await test('V3 duration stays owned by atomic completion and is marked censored',async()=>{const f=fixture();f.c.openDurationsRef.current=[{id:'d',measurementModelVersion:'V3',startedAt:'2026-10-01T10:00:00Z'}];f.records.current.push({id:'d',kind:'behavior',measurementType:'duration',syncStatus:'synced'});f.c.endDuration=()=>{throw Error('false USER_STOP');};await vm.runInNewContext(extract(source,'confirmEndSession'),f.c)();assert.equal(f.completed,true);assert.equal(f.requests[0].summary.behaviorEvents[0].rawPayload.isCensored,true);});
await test('forced flush awaits active background pass then reads fresh scoped queue',async()=>{let pass=0,release;const gate=new Promise(r=>release=r),opts=[];const c={navigator:{onLine:true},Date,runOfflineSync:async o=>{opts.push(o);if(++pass===1)await gate;},activeSync:null,lastSyncAttempt:0,SYNC_COOLDOWN:5000};const q=fs.readFileSync(new URL('../src/services/localDb.ts',import.meta.url),'utf8');const sync=vm.runInNewContext(extract(q,'syncOfflineData'),c);const a=sync(),b=sync({force:true,sessionId:'s1'});assert.equal(pass,1);release();await Promise.all([a,b]);assert.equal(pass,2);assert.equal(opts[1].sessionId,'s1');});

await test('legacy duration timer is finalized automatically at session close',async()=>{
 const f=fixture();f.timers.current={};f.records.current=[{id:'duration-1',kind:'behavior',syncStatus:'synced'}];
 f.c.openDurationsRef.current=[{id:'duration-1',measurementModelVersion:'LEGACY_V2',startedAt:'2026-10-01T10:00:00Z'}];
 f.c.endDuration=async(id,endedAt,sessionFinalization)=>{f.events.push('duration:'+id+':'+sessionFinalization);f.c.openDurationsRef.current=[];return {success:true,durable:true};};
 await vm.runInNewContext(extract(source,'confirmEndSession'),f.c)();
 assert.equal(f.completed,true);assert.ok(f.events.includes('duration:duration-1:true'));assert.ok(f.events.indexOf('duration:duration-1:true')<f.events.indexOf('complete'));
});
await test('legacy rate timer is finalized automatically at session close',async()=>{
 const f=fixture();f.timers.current={};f.records.current=[{id:'rate-record',kind:'behavior',syncStatus:'synced'}];
 f.c.rateWindowRef.current={id:'rate-1',measurementModelVersion:'LEGACY_V2',startedAt:'2026-10-01T10:00:00Z',count:2};
 f.c.finishRateWindow=async()=>{f.events.push('rate:rate-1');f.c.rateWindowRef.current=null;return true;};
 await vm.runInNewContext(extract(source,'confirmEndSession'),f.c)();
 assert.equal(f.completed,true);assert.ok(f.events.includes('rate:rate-1'));assert.ok(f.events.indexOf('rate:rate-1')<f.events.indexOf('complete'));
});
await test('legacy interval timer is closed as partial collection at session close',async()=>{
 const f=fixture();f.timers.current={};f.records.current=[{id:'interval-record',kind:'behavior',syncStatus:'synced'}];
 f.c.intervalRunRef.current={id:'interval-1',measurementModelVersion:'LEGACY_V2',completedCount:2,occurredCount:1,totalIntervals:5};
 f.c.saveIntervalAggregateV2=(run,completed,occurred,endedAt,status,reason)=>{f.events.push('interval:'+run.id+':'+status+':'+reason);return {};};
 await vm.runInNewContext(extract(source,'confirmEndSession'),f.c)();
 assert.equal(f.completed,true);assert.equal(f.c.intervalRunRef.current,null);assert.ok(f.events.includes('interval:interval-1:PARTIALLY_COMPLETED:SESSION_FINALIZATION'));assert.ok(f.events.indexOf('interval:interval-1:PARTIALLY_COMPLETED:SESSION_FINALIZATION')<f.events.indexOf('complete'));
});
await test('V3 duration, rate observation and interval timers are owned by atomic server finalization',()=>{
 const behaviorSql=fs.readFileSync(new URL('../supabase/migrations/20260815163000_aba_measurement_v3_behavior_engine.sql',import.meta.url),'utf8');
 const intervalSql=fs.readFileSync(new URL('../supabase/migrations/20260815183000_aba_measurement_v3_task_interval_ioa.sql',import.meta.url),'utf8');
 assert.match(behaviorSql,/aba_behavior_observation_slices_v3[\s\S]*close_reason = 'SESSION_FINALIZATION'/);
 assert.match(behaviorSql,/measurement_kind = 'DURATION'[\s\S]*end_reason = 'SESSION_FINALIZATION'/);
 assert.match(intervalSql,/finalize_aba_interval_runs_for_session_v3[\s\S]*finalize_aba_interval_run_v3\(v_run_id, p_actor_id, p_session_ended_at, 'SESSION_FINALIZATION'\)/);
 assert.match(intervalSql,/finalize_aba_behavior_timers_v3\(p_session_id, v_effective_end\)/);
});

console.log(`${checks} behavioral checks passed.`);
