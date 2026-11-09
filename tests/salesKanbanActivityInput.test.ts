import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  parseSalesHistoryLeadIds,parseSalesKanbanMovementInput,parseSalesProspectingAttemptInput,
  parseSalesProspectingAttemptTimeInput,parseSalesDecisorContactInput,
  parseSalesFollowupInput,parseSalesMarkLostInput,
} from '../services/salesKanbanActivityInput';

const actor='11111111-1111-4111-8111-111111111111';
const lead='22222222-2222-4222-8222-222222222222';
const column='33333333-3333-4333-8333-333333333333';
const reason='44444444-4444-4444-8444-444444444444';
const script='55555555-5555-4555-8555-555555555555';
const key='critical-03-idempotency-key';
const iso='2026-11-05T14:00:00.000Z';
const isUuid=(value:string)=>[actor,lead,column,reason,script].includes(value);
const deps={isUuid,sanitizeString:(value:unknown,max:number)=>String(value??'').trim().slice(0,max)};
const req=(body:Record<string,unknown>={},overrides:Record<string,any>={})=>({
  params:{leadId:lead},session:{user:{id:actor}},
  headers:{'x-idempotency-key':key},body,...overrides,
});

test('history preserves capped distinct UUID list and rejects invalid, empty or excessive selections',()=>{
  assert.deepEqual(parseSalesHistoryLeadIds(lead+','+lead,isUuid),{ok:true,leadIds:[lead]});
  for(const value of ['', 'not-a-uuid',Array.from({length:101},(_,i)=>'invalid-'+i).join(',')])
    assert.equal(parseSalesHistoryLeadIds(value,isUuid).ok,false);
  assert.equal(parseSalesHistoryLeadIds([lead,actor,column,reason,script].join(','),isUuid).ok,true);
});

test('Kanban movement preserves original input contract and idempotency header',()=>{
  assert.deepEqual(parseSalesKanbanMovementInput(req({columnId:column}),deps),{
    ok:true,leadId:lead,columnId:column,actorId:actor,key,
  });
  assert.equal(parseSalesKanbanMovementInput(req({columnId:'other-tenant-column'}),deps).ok,false);
  assert.equal(parseSalesKanbanMovementInput(req({columnId:column},{session:{user:{id:'forged'}}}),deps).ok,false);
  assert.equal(parseSalesKanbanMovementInput(req({columnId:column},{headers:{'x-idempotency-key':'short'}}),deps).ok,false);
});

test('attempts reject unknown channel, outcome, actor and short idempotency key',()=>{
  const valid={channel:'phone',outcome:'no_decisor'};
  assert.equal(parseSalesProspectingAttemptInput(req(valid),deps).ok,true);
  assert.equal(parseSalesProspectingAttemptInput(req({...valid,channel:'whatsapp_message'}),deps).ok,false);
  assert.equal(parseSalesProspectingAttemptInput(req({...valid,outcome:'unknown'}),deps).ok,false);
  assert.equal(parseSalesProspectingAttemptInput(req(valid,{session:{user:{id:'other'}}}),deps).ok,false);
  assert.equal(parseSalesProspectingAttemptInput(req(valid,{headers:{'x-idempotency-key':'short'}}),deps).ok,false);
});

test('attempt timestamps require a real offset-aware ISO timestamp and controlled script version',()=>{
  const valid={channel:'whatsapp_call',occurredAt:iso,attemptId:null,scriptVersionId:script};
  const parsed=parseSalesProspectingAttemptTimeInput(req(valid),deps);
  assert.equal(parsed.ok,true);
  if(parsed.ok)assert.equal(parsed.scriptVersionId,script);
  for(const value of ['2026-11-05T14:00','nonsense','2026-11-05T25:99:00Z','A'.repeat(41)])
    assert.equal(parseSalesProspectingAttemptTimeInput(req({...valid,occurredAt:value}),deps).ok,false);
  assert.equal(parseSalesProspectingAttemptTimeInput(req({...valid,scriptVersionId:'outside'}),deps).ok,false);
  assert.equal(parseSalesProspectingAttemptTimeInput(req({...valid,channel:'whatsapp_message'}),deps).ok,false);
});

test('decisor contact keeps message channel, allowed outcomes and optional historic result',()=>{
  const valid={channel:'whatsapp_message',occurredAt:iso,contactResult:'interested'};
  const parsed=parseSalesDecisorContactInput(req(valid),deps);
  assert.equal(parsed.ok,true);
  assert.equal(parseSalesDecisorContactInput(req({...valid,contactResult:'not_interested'}),deps).ok,true);
  assert.equal(parseSalesDecisorContactInput(req({...valid,contactResult:null}),deps).ok,true);
  assert.equal(parseSalesDecisorContactInput(req({...valid,contactResult:'invented'}),deps).ok,false);
  assert.equal(parseSalesDecisorContactInput(req({...valid,channel:'email'}),deps).ok,false);
  assert.equal(parseSalesDecisorContactInput(req({...valid,attemptId:'not-uuid'}),deps).ok,false);
});

test('follow-up saves explicit valid timestamp or null for cancellation, but never undefined',()=>{
  assert.deepEqual(parseSalesFollowupInput(req({contactDueAt:iso}),deps),{
    ok:true,leadId:lead,actorId:actor,key,due:iso,
  });
  assert.equal(parseSalesFollowupInput(req({contactDueAt:null}),deps).ok,true);
  assert.equal(parseSalesFollowupInput(req({}),deps).ok,false);
  assert.equal(parseSalesFollowupInput(req({contactDueAt:'tomorrow'}),deps).ok,false);
});

test('marking a lead lost requires a valid reason, actor and idempotency key',()=>{
  assert.deepEqual(parseSalesMarkLostInput(req({reasonId:reason}),deps),{
    ok:true,leadId:lead,key,actorId:actor,reasonId:reason,
  });
  assert.equal(parseSalesMarkLostInput(req({reasonId:'other-tenant-reason'}),deps).ok,false);
  assert.equal(parseSalesMarkLostInput(req({reasonId:reason},{params:{leadId:'bad'}}),deps).ok,false);
  assert.equal(parseSalesMarkLostInput(req({reasonId:reason},{headers:{}}),deps).ok,false);
});
