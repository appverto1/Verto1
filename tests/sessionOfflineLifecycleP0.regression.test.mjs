import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ast=(p)=>ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const compile=(s)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const getInitializer=(p,name)=>{const t=ast(p);let result;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(t)===name)result=n.initializer?.getText(t);ts.forEachChild(n,visit);}visit(t);assert.ok(result,name);return result;};
const resilience={exports:{}};vm.runInNewContext(compile(read('src/utils/offlineSyncResilience.ts')),resilience);
const helper={exports:{},require:id=>{assert.equal(id,'./offlineSyncResilience');return resilience.exports;}};
vm.runInNewContext(compile(read('src/utils/sessionAutoFinalization.ts')),helper);
const {queuedSessionId,isSessionCompletionQueueRecord,hasUnresolvedSessionPredecessor}=helper.exports;
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
await test('all unresolved records for same session block closure regardless of their queue timestamp',()=>{
 const end={id:'end',type:'aba',method:'POST',sync_status:'pending',last_updated:11,endpoint:'/api/aba/sessions/s1/complete',data:{sessionId:'s1'}};
 const late={id:'late',type:'aba_v3',method:'POST',sync_status:'pending',last_updated:12,endpoint:'/api/aba/v3/trials',data:{sessionId:'s1'}};
 assert.equal(hasUnresolvedSessionPredecessor(end,[end,late]),true);
 assert.equal(hasUnresolvedSessionPredecessor(end,[end,{...late,sync_status:'synced'}]),false);
 assert.equal(hasUnresolvedSessionPredecessor(end,[end,{...late,data:{sessionId:'other'}}]),false);
});
await test('durable reinforcers allow local closure; terminal failure is not hidden',async()=>{
 const source=ast('src/services/abaReinforcers.ts');
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='flushReinforcerDeliveries');
 assert.ok(fn);
 const rows=[{id:'reinforcer',endpoint:'supabase-rpc:record_aba_reinforcer_delivery_authenticated_v1',sync_status:'pending',data:{kind:'reinforcer_delivery_v1',sessionId:'s1'}}];
 const flush=vm.runInNewContext(compile(fn.getText(source).replace(/^export /,'')+'\nflushReinforcerDeliveries;'),{
   navigator:{onLine:false},getRecordsByType:async()=>rows,ENDPOINT:rows[0].endpoint
 });
 const ok=await flush('s1');assert.equal(ok.ok,true);assert.equal(ok.pending,1);assert.equal(ok.deferred,true);assert.equal(rows[0].sync_status,'pending');
 rows[0].sync_status='failed';const fail=await flush('s1');assert.equal(fail.ok,false);assert.equal(fail.terminal,1);
});
await test('reconnect retries clinical event, then closes only after reinforcer RPC and event ACK',async()=>{
 const original=getInitializer('src/services/localDb.ts','runOfflineSync');
 const prepared=original.replace("await import('./abaReinforcers')",'Promise.resolve({flushReinforcerDeliveries})');
 assert.notEqual(prepared,original);
 const rows=[
 {id:'t',entity_id:'trial',type:'aba_v3',method:'POST',sync_status:'pending',last_updated:10,endpoint:'/api/aba/v3/trials',data:{sessionId:'s1'}},
 {id:'r',entity_id:'reinforcer',type:'aba',method:'POST',sync_status:'pending',last_updated:11,endpoint:'supabase-rpc:record_aba_reinforcer_delivery_authenticated_v1',data:{sessionId:'s1'}},
 {id:'c',entity_id:'end',type:'aba',method:'POST',sync_status:'pending',last_updated:12,endpoint:'/api/aba/sessions/s1/complete',data:{sessionId:'s1',idempotencyKey:'stable'}},
 ];
 const event=[];let failFirst=true;
 const byId=id=>rows.find(r=>r.id===id);
 const ctx={
 Date,Set,JSON,console:{log(){},warn(){},error(){}},
 getPendingRecords:async()=>rows.filter(r=>r.sync_status==='pending').map(r=>({...r,data:{...r.data}})),
 getSessionQueuedRecords:async(id)=>rows.filter(r=>r.sync_status!=='synced'&&queuedSessionId(r)===id).map(r=>({...r,data:{...r.data}})),
 isSessionCompletionQueueRecord,queuedSessionId,hasUnresolvedSessionPredecessor,
 entityIdForRecord:r=>r.entity_id,
 ensureFreshSession:async()=>({access_token:'synthetic'}),
 markRecordSyncStatus:async(id,status)=>{byId(id).sync_status=status;},
 markRecordSyncFailure:async(id)=>{byId(id).sync_status='pending';return{sync_status:'pending',retry_count:1};},
 isIdempotentConflictPayload:()=>false,
 flushReinforcerDeliveries:async()=>{event.push('reinforcer');byId('r').sync_status='synced';return{ok:true,pending:0,terminal:0};},
 fetch:async(url,opts)=>{if(url.includes('/trials')&&failFirst){failFirst=false;throw new TypeError('Failed to fetch');}
 event.push(url.includes('/complete')?'end':'trial');
 if(url.includes('/complete'))assert.equal(opts.headers['X-Idempotency-Key'],'stable');
 return{ok:true,status:200,json:async()=>({success:true})};}
 };
 const run=vm.runInNewContext(compile('const run = '+prepared+';\nrun;'),ctx);
 await run({force:true});assert.equal(byId('c').sync_status,'pending');assert.deepEqual(event,['reinforcer']);
 await run({force:true});assert.deepEqual(event,['reinforcer','trial','end']);assert.equal(rows.every(r=>r.sync_status==='synced'),true);
 await run({force:true});assert.deepEqual(event,['reinforcer','trial','end']);
});
console.log('sessionOfflineLifecycleP0.regression: '+checks+' passed');
