import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerSalesProspectingActivityRoutes} from '../services/salesProspectingActivityRoutes';

const actor='11111111-1111-4111-8111-111111111111';
const lead='22222222-2222-4222-8222-222222222222';
const reason='33333333-3333-4333-8333-333333333333';
const key='task03-idempotency-12345';
const stamp='2026-11-04T14:00:00.000Z';

const setup=(error:any=null)=>{
  const registered:any[]=[];const calls:any[]=[];
  const auth=()=>{},admin=()=>{};
  const supabase={
    rpc:async(name:string,args:any)=>{calls.push({kind:'rpc',name,args});return {data:{id:lead},error};},
    from:(table:string)=>({
      select(columns:string){calls.push({kind:'select',table,columns});return this;},
      in(){return this;},eq(){return this;},is(){return this;},order(){return this;},
      async limit(n:number){calls.push({kind:'limit',table,n});return {data:[],error:null};},
    })
  };
  const app={
    get:(path:string,...handlers:any[])=>registered.push({verb:'GET',path,handlers}),
    post:(path:string,...handlers:any[])=>registered.push({verb:'POST',path,handlers}),
    put:(path:string,...handlers:any[])=>registered.push({verb:'PUT',path,handlers}),
  };
  registerSalesProspectingActivityRoutes(app,{supabase,checkAuth:auth,checkPlatformAdmin:admin,
    isUuid:(value:string)=>[actor,lead,reason].includes(value),
    sanitizeString:(value:unknown,max:number)=>String(value??'').trim().slice(0,max),
  });
  const call=async(path:string,verb:string,body:any={},query:any={})=>{
    const route=registered.find(r=>r.path===path&&r.verb===verb);
    assert.ok(route);let status=200,json:any;
    const res={status(value:number){status=value;return this;},json(value:any){json=value;return this;}};
    await route.handlers[2]({session:{user:{id:actor}},params:{leadId:lead},headers:{'x-idempotency-key':key},body,query},res);
    return {status,json};
  };
  return {registered,calls,auth,admin,call};
};

test('activity history and mutations keep the canonical two owner guards',()=>{
  const h=setup();
  assert.equal(h.registered.length,6);
  for(const route of h.registered){
    assert.equal(route.handlers.length,3);
    assert.equal(route.handlers[0],h.auth);
    assert.equal(route.handlers[1],h.admin);
  }
});
test('history reads only the three capped datasets without extra RPC',async()=>{
  const h=setup();const path='/api/owner/sales/prospecting/attempts';
  assert.equal((await h.call(path,'GET',{},{})).status,400);
  assert.equal((await h.call(path,'GET',{}, {leadIds:lead})).status,200);
  assert.deepEqual(h.calls.filter(c=>c.kind==='select').map(c=>c.table).sort(),
    ['sales_contact_followups','sales_leads','sales_prospecting_attempts']);
  assert.deepEqual(h.calls.filter(c=>c.kind==='limit').map(c=>c.n).sort((a:number,b:number)=>a-b),[100,100,1000]);
  assert.equal(h.calls.filter(c=>c.kind==='rpc').length,0);
});
test('attempt, contact, follow-up and manual-loss writes remain one RPC each',async()=>{
  const h=setup();
  const root='/api/owner/sales/leads/:leadId/';
  assert.equal((await h.call(root+'prospecting-attempts','POST',{channel:'phone',outcome:'no_decisor'})).status,200);
  assert.equal((await h.call(root+'prospecting-attempt-time','PUT',{channel:'phone',occurredAt:stamp,scriptVersionId:null})).status,200);
  assert.equal((await h.call(root+'decisor-contact','PUT',{channel:'phone',occurredAt:stamp,contactResult:'interested'})).status,200);
  assert.equal((await h.call(root+'followup','PUT',{contactDueAt:stamp})).status,200);
  assert.equal((await h.call(root+'mark-lost','POST',{reasonId:reason})).status,200);
  const writes=h.calls.filter(c=>c.kind==='rpc');
  assert.deepEqual(writes.map(c=>c.name),[
    'record_sales_prospecting_attempt_v1','save_sales_prospecting_attempt_time_v2',
    'save_sales_decisor_contact_v2','save_sales_contact_followup_v1','mark_sales_lead_lost_with_reason_v1'
  ]);
  assert.ok(writes.every(c=>c.args.p_action_key===key&&c.args.p_actor_user_id===actor));
});
test('loss without reason fails before any write and idempotency conflicts remain 409',async()=>{
  const h=setup();
  assert.equal((await h.call('/api/owner/sales/leads/:leadId/mark-lost','POST',{reasonId:'bad'})).status,400);
  assert.equal(h.calls.length,0);
  const conflict=setup({message:'IDEMPOTENCY_CONFLICT'});
  assert.equal((await conflict.call('/api/owner/sales/leads/:leadId/decisor-contact','PUT',{
    channel:'phone',occurredAt:stamp,contactResult:'interested'
  })).status,409);
});
