import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerSalesKanbanOpportunityCreationRoutes} from '../services/salesKanbanOpportunityCreationRoutes';

const owner='11111111-1111-4111-8111-111111111111';
const channel='22222222-2222-4222-8222-222222222222';
const lead='33333333-3333-4333-8333-333333333333';
const phone='11 99999-9999';
type Registered={path:string;handlers:Function[]};

function setup({existing=[],rpcResult={data:[{id:lead,phone,channelIds:[]}],error:null}}:{
  existing?:any[];
  rpcResult?:{data:any;error:any};
}={}){
  const routes:Registered[]=[];
  const dbCalls:any[]=[];
  const rpcCalls:any[]=[];
  const authorize=(_req:any,_res:any,next:Function)=>next();
  const mfa=(_req:any,_res:any,next:Function)=>next();
  const supabase={
    from:(table:string)=>{
      dbCalls.push({method:'from',table});
      return {
        select(columns:string){dbCalls.push({method:'select',columns});return this;},
        in(field:string,values:string[]){dbCalls.push({method:'in',field,values});return this;},
        is(field:string,value:any){dbCalls.push({method:'is',field,value});return this;},
        async limit(limit:number){dbCalls.push({method:'limit',limit});return {data:existing,error:null};},
      };
    },
    rpc:async(name:string,args:any)=>{rpcCalls.push({name,args});return rpcResult;},
  };
  registerSalesKanbanOpportunityCreationRoutes(
    {post:(path:string,...handlers:Function[])=>{routes.push({path,handlers});}},
    {supabase,salesGuard:[authorize,mfa],
     sanitizeString:(v:unknown,max:number)=>String(v??'').trim().slice(0,max),
     isUuid:(v:string)=>[owner,channel,lead].includes(v),
     boardError:(res:any,message:string)=>res.status(500).json({success:false,error:message}),
    }
  );
  const run=async(path:string,body:any,header='test-key-123456')=>{
    const route=routes.find(x=>x.path===path);
    assert.ok(route);
    let code=200,headers:Record<string,string>={},result:any;
    const req={body,headers:{'x-idempotency-key':header},session:{user:{id:owner}}};
    const res={
      status(v:number){code=v;return this;},
      json(v:any){result=v;return this;},
      setHeader(k:string,v:string){headers[k]=v;return this;},
    };
    await route.handlers[2](req,res);
    return {code,headers,result};
  };
  return {routes,authorize,mfa,dbCalls,rpcCalls,run};
}
const duplicates='/api/owner/sales/kanban/opportunities/duplicates';
const create='/api/owner/sales/kanban/opportunities';

test('each endpoint retains the canonical two owner guards',()=>{
  const h=setup();
  assert.equal(h.routes.length,2);
  assert.deepEqual(h.routes.map(r=>r.path),[duplicates,create]);
  for(const route of h.routes){
    assert.equal(route.handlers.length,3);
    assert.equal(route.handlers[0],h.authorize);
    assert.equal(route.handlers[1],h.mfa);
  }
});

test('preview normalizes 10/11-digit phones with one indexed batch lookup',async()=>{
  const h=setup();
  const result=await h.run(duplicates,{phones:[phone,'21 98888-8888']});
  assert.equal(result.code,200);
  assert.equal(result.result.success,true);
  assert.equal(result.result.matches.length,2);
  assert.equal(result.result.matches[0].normalizedPhone,'5511999999999');
  assert.equal(result.result.matches[1].normalizedPhone,'5521988888888');
  assert.equal(result.headers['Cache-Control'],'private, no-store');
  assert.deepEqual(h.dbCalls.filter(q=>q.method==='from').map(q=>q.table),['sales_leads']);
  assert.equal(h.dbCalls.filter(q=>q.method==='in').length,1);
  assert.equal(h.dbCalls.find(q=>q.method==='limit').limit,101);
});

test('duplicates inside the same batch and stored records are visible without writes',async()=>{
  const h=setup({existing:[{normalized_phone:'5511999999999',id:lead,name:'Contato já cadastrado',phone,status:'prospecting'}]});
  const res=await h.run(duplicates,{phones:[phone,phone]});
  assert.equal(res.code,200);
  assert.equal(res.result.matches[0].inBatch,true);
  assert.equal(res.result.matches[1].inBatch,true);
  assert.equal(res.result.matches[0].existing.id,lead);
  assert.equal(h.rpcCalls.length,0);
});

test('invalid and oversized previews fail before querying the database',async()=>{
  const h=setup();
  assert.equal((await h.run(duplicates,{phones:[]})).code,400);
  assert.equal((await h.run(duplicates,{phones:Array(101).fill(phone)})).code,400);
  assert.equal((await h.run(duplicates,{phones:[42]})).code,400);
  assert.equal((await h.run(duplicates,{phones:['x'.repeat(41)]})).code,400);
  assert.equal(h.dbCalls.length,0);
});

test('owner Save persists atomically through the single existing RPC with idempotency',async()=>{
  const h=setup();
  const res=await h.run(create,{phones:[phone,'21 98888-8888'],channelsByPhone:[[channel],[]]});
  assert.equal(res.code,201);
  assert.equal(res.result.leads.length,1);
  assert.equal(h.rpcCalls.length,1);
  assert.equal(h.rpcCalls[0].name,'create_sales_kanban_opportunities_v2');
  assert.deepEqual(h.rpcCalls[0].args,{
    p_phones:[phone,'21 98888-8888'],p_actor_id:owner,
    p_action_key:'test-key-123456',p_channels:[[channel],[]],
  });
  assert.equal(h.dbCalls.length,0);
});

test('bad role identifier, key and per-phone channel shape never call the RPC',async()=>{
  const h=setup();
  const bad=[
    [{phones:[],channelsByPhone:[]},'test-key-123456'],
    [{phones:[phone],channelsByPhone:[]},'test-key-123456'],
    [{phones:[phone],channelsByPhone:[[channel,channel]]},'test-key-123456'],
    [{phones:[phone],channelsByPhone:[['fake-id']]},'test-key-123456'],
    [{phones:[phone],channelsByPhone:[[]]},'short'],
    [{phones:Array(101).fill(phone),channelsByPhone:Array(101).fill([])},'test-key-123456'],
  ] as const;
  for(const [body,key] of bad)assert.equal((await h.run(create,body,key)).code,400);
  assert.equal(h.rpcCalls.length,0);
});

test('unique phone conflict and channel unavailability remain atomic HTTP 409',async()=>{
  const duplicate=setup({rpcResult:{data:null,error:{message:'PHONE_ALREADY_EXISTS',code:'23505'}}});
  assert.equal((await duplicate.run(create,{phones:[phone],channelsByPhone:[[]]})).code,409);
  const channelInactive=setup({rpcResult:{data:null,error:{message:'ACQUISITION_CHANNEL_UNAVAILABLE',code:'P0001'}}});
  assert.equal((await channelInactive.run(create,{phones:[phone],channelsByPhone:[[]]})).code,409);
  const invalid=setup({rpcResult:{data:null,error:{message:'INVALID_PHONE',code:'P0001'}}});
  assert.equal((await invalid.run(create,{phones:[phone],channelsByPhone:[[]]})).code,400);
});


test('Save with contact identification uses one atomic v3 RPC and no extra queries',async()=>{
  const h=setup();
  const details=[
    {name:'Contato Teste',clinicName:'Clínica Exemplo',email:'contato@example.test'},
    {name:'Outro Contato',clinicName:'Clínica Exemplo',email:''},
  ];
  const response=await h.run(create,{phones:[phone,'21 98888-8888'],channelsByPhone:[[channel],[]],detailsByPhone:details});
  assert.equal(response.code,201);
  assert.equal(h.rpcCalls.length,1);
  assert.equal(h.rpcCalls[0].name,'create_sales_kanban_opportunities_v3');
  assert.deepEqual(h.rpcCalls[0].args,{
    p_phones:[phone,'21 98888-8888'],p_actor_id:owner,p_action_key:'test-key-123456',
    p_channels:[[channel],[]],p_details:details,
  });
  assert.equal(h.dbCalls.length,0);
});

test('malicious, oversized, malformed and duplicate contact fields fail before any write',async()=>{
  const h=setup();
  const valid={phones:[phone],channelsByPhone:[[]]};
  const invalid=[
    null,[],
    [{name:'A'}],
    [{clinicName:'A'.repeat(181)}],
    [{name:'A'.repeat(181)}],
    [{email:'not-an-email'}],
    [{email:'x'.repeat(255)+'@test.com'}],
    [{name:'Valid',role:'director'}],
    [{name:'Nave\nControl'}],
    [42],
    [{name:'A pessoa'},{}],
  ];
  for(const detailsByPhone of invalid){
    const result=await h.run(create,{...valid,detailsByPhone});
    assert.equal(result.code,400,'invalid shape must be rejected by server');
  }
  const dup=await h.run(create,{
    phones:[phone,'21 98888-8888'],channelsByPhone:[[],[]],
    detailsByPhone:[{email:'TEST@EXAMPLE.COM'},{email:'test@example.com'}],
  });
  assert.equal(dup.code,400,'duplicate emails cannot be created in one atomic batch');
  assert.equal(h.rpcCalls.length,0);
  assert.equal(h.dbCalls.length,0);
});

test('v3 duplicate email and replay conflicts roll back the entire Save',async()=>{
  for(const errorCode of ['DUPLICATE_EMAIL_IN_BATCH','IDEMPOTENCY_CONFLICT','23505']){
    const h=setup({rpcResult:{data:null,error:{code:errorCode,message:errorCode}}});
    const r=await h.run(create,{phones:[phone],channelsByPhone:[[]],detailsByPhone:[{name:'Contato Teste'}]});
    assert.equal(r.code,409);
    assert.equal(h.rpcCalls.length,1);
  }
});

test('legacy phone-only v2 caller remains unchanged',async()=>{
  const h=setup();
  const r=await h.run(create,{phones:[phone],channelsByPhone:[[]]});
  assert.equal(r.code,201);
  assert.equal(h.rpcCalls[0].name,'create_sales_kanban_opportunities_v2');
  assert.equal('p_details' in h.rpcCalls[0].args,false);
});
