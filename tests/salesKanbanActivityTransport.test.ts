import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  loadSalesProspectingHistory,moveSalesKanbanLead,persistSalesAttemptTime,
  persistSalesDecisorContact,persistSalesFollowup,persistSalesLoss,
} from '../src/services/salesKanbanActivity';

const id='11111111-1111-4111-8111-111111111111';
const columnId='22222222-2222-4222-8222-222222222222';
const key='task-03-idempotency-key';

test('one history read per existing paginated chunk, with no added auth or RPC call',async()=>{
  const calls:any[]=[];const req=async(url:string,opts?:RequestInit)=>{calls.push({url,opts});return {data:[],leads:[]};};
  await loadSalesProspectingHistory(req,'lead-a%2Clead-b');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/owner/sales/prospecting/attempts?leadIds=lead-a%2Clead-b');
  assert.equal(calls[0].opts,undefined);
});

test('movement preserves endpoint, POST, header, request body and server authority',async()=>{
  const calls:any[]=[];const req=async(url:string,opts?:RequestInit)=>{calls.push({url,opts});return {success:true,data:{status:'contact_started'}};};
  const r=await moveSalesKanbanLead(req,id,columnId,key);
  assert.equal(r.data.status,'contact_started');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/owner/sales/kanban/leads/'+id+'/move');
  assert.equal(calls[0].opts.method,'POST');
  assert.deepEqual(calls[0].opts.headers,{'X-Idempotency-Key':key});
  assert.deepEqual(JSON.parse(calls[0].opts.body),{columnId});
});

test('contact attempts, follow-up and explicit loss preserve their exact HTTP contracts',async()=>{
  const calls:any[]=[];const req=async(url:string,opts?:RequestInit)=>{calls.push({url,opts});return {success:true};};
  const iso='2026-11-04T14:00:00.000Z';
  const attempt={attemptId:null,channel:'phone',occurredAt:iso,scriptVersionId:null};
  const contact={channel:'whatsapp_call',attemptId:null,occurredAt:iso,scriptVersionId:null,contactResult:'interested'};
  await persistSalesAttemptTime(req,id,key,attempt);
  await persistSalesDecisorContact(req,id,key,contact);
  await persistSalesFollowup(req,id,key,iso);
  await persistSalesFollowup(req,id,key,null);
  await persistSalesLoss(req,id,key,columnId);
  assert.deepEqual(calls.map(c=>c.url),[
    '/api/owner/sales/leads/'+id+'/prospecting-attempt-time',
    '/api/owner/sales/leads/'+id+'/decisor-contact',
    '/api/owner/sales/leads/'+id+'/followup',
    '/api/owner/sales/leads/'+id+'/followup',
    '/api/owner/sales/leads/'+id+'/mark-lost',
  ]);
  assert.deepEqual(calls.map(c=>c.opts.method),['PUT','PUT','PUT','PUT','POST']);
  assert.ok(calls.every(c=>c.opts.headers['X-Idempotency-Key']===key));
  assert.deepEqual(calls.map(c=>JSON.parse(c.opts.body)),[attempt,contact,{contactDueAt:iso},{contactDueAt:null},{reasonId:columnId}]);
});

test('server errors propagate without optimistic success or second requests',async()=>{
  let calls=0;
  const req=async()=>{calls++;throw new Error('Pagamento necessário para conversão');};
  await assert.rejects(moveSalesKanbanLead(req,id,columnId,key),/Pagamento necessário/);
  assert.equal(calls,1);
});
