import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerSalesKanbanMovementRoutes} from '../services/salesKanbanMovementRoutes';

const leadId='11111111-1111-4111-8111-111111111111';
const columnId='22222222-2222-4222-8222-222222222222';
const actorId='33333333-3333-4333-8333-333333333333';
const key='task-03-idempotency-key';
const endpoint='/api/owner/sales/kanban/leads/:leadId/move';

function setup(options:{kind?:string;columnError?:any;rpcData?:any;rpcError?:any}={}){
  const databaseCalls:any[]=[];const rpcCalls:any[]=[];const registered:any[]=[];
  const firstGuard=()=>{},secondGuard=()=>{};
  const supabase={
    from:(table:string)=>{
      databaseCalls.push({action:'from',table});
      return {
        select(columns:string){databaseCalls.push({action:'select',columns});return this;},
        eq(field:string,value:any){databaseCalls.push({action:'eq',field,value});return this;},
        async maybeSingle(){
          databaseCalls.push({action:'maybeSingle'});
          return {data:options.columnError?null:{kind:options.kind??'contact'},error:options.columnError??null};
        }
      };
    },
    rpc:async(name:string,args:any)=>{
      rpcCalls.push({name,args});
      return {data:options.rpcData??{status:'contact_started',lostAt:null,updatedAt:'2026-11-04T12:00:00Z'},error:options.rpcError??null};
    }
  };
  registerSalesKanbanMovementRoutes({post:(path:string,...handlers:any[])=>registered.push({path,handlers})},{
    supabase,salesGuard:[firstGuard,secondGuard],
    isUuid:(value:string)=>[leadId,columnId,actorId].includes(value),
    sanitizeString:(value:unknown,max:number)=>String(value??'').trim().slice(0,max),
    boardError:(res:any,message:string)=>res.status(500).json({success:false,error:message}),
  });
  const invoke=async(body:any={columnId},headers:any={'x-idempotency-key':key},params:any={leadId},session:any={user:{id:actorId}})=>{
    let status=200,data:any;
    const res={status(code:number){status=code;return this;},json(value:any){data=value;return this;}};
    await registered[0].handlers[2]({body,headers,params,session},res);
    return {status,data};
  };
  return {databaseCalls,rpcCalls,registered,firstGuard,secondGuard,invoke};
}

test('stage movement retains authentication and platform admin MFA guards',()=>{
  const h=setup();
  assert.equal(h.registered.length,1);
  assert.equal(h.registered[0].path,endpoint);
  assert.equal(h.registered[0].handlers.length,3);
  assert.equal(h.registered[0].handlers[0],h.firstGuard);
  assert.equal(h.registered[0].handlers[1],h.secondGuard);
});

test('successful movement queries column kind once and writes once via atomic RPC',async()=>{
  const h=setup();
  const response=await h.invoke();
  assert.equal(response.status,200);
  assert.equal(response.data.success,true);
  assert.equal(response.data.data.status,'contact_started');
  assert.deepEqual(h.databaseCalls,[
    {action:'from',table:'sales_kanban_columns'},
    {action:'select',columns:'kind'},
    {action:'eq',field:'id',value:columnId},
    {action:'maybeSingle'},
  ]);
  assert.deepEqual(h.rpcCalls,[{name:'move_sales_kanban_lead_v1',args:{
    p_lead_id:leadId,p_column_id:columnId,p_actor_id:actorId,p_action_key:key,
  }}]);
});

test('invalid user/lead/column, short key, and lost stage fail before any mutation',async()=>{
  const h=setup();
  assert.equal((await h.invoke({columnId},{'x-idempotency-key':'short'})).status,400);
  assert.equal((await h.invoke({columnId:'untrusted-id'})).status,400);
  assert.equal((await h.invoke({columnId},{'x-idempotency-key':key},{leadId:'untrusted-id'})).status,400);
  assert.equal((await h.invoke({columnId},{'x-idempotency-key':key},{leadId},{user:{id:'untrusted-id'}})).status,400);
  assert.equal(h.rpcCalls.length,0);
  assert.equal(h.databaseCalls.length,0);
  const lost=setup({kind:'lost'});
  assert.equal((await lost.invoke()).status,409);
  assert.equal(lost.rpcCalls.length,0);
});

test('converted/payment, conflict and stale IDs preserve explicit error statuses',async()=>{
  for(const error of ['CONVERTED_LEAD_IMMUTABLE','PAYMENT_REQUIRED_FOR_CONVERSION','IDEMPOTENCY_CONFLICT']){
    const h=setup({rpcError:{message:error}});
    assert.equal((await h.invoke()).status,409);
    assert.equal(h.rpcCalls.length,1);
  }
  const missing=setup({rpcError:{message:'LEAD_NOT_FOUND'}});
  assert.equal((await missing.invoke()).status,404);
  const db=setup({columnError:{message:'DB unavailable'}});
  assert.equal((await db.invoke()).status,500);
  assert.equal(db.rpcCalls.length,0);
});
