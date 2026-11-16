import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPublicSalesLeadRoute } from '../services/publicSalesLeadRoutes';

const syntheticId = '11111111-1111-4111-8111-111111111111';
const makeReq = () => ({
  headers: {'x-idempotency-key': 'synthetic-key-123456'},
  body: {
    name: 'Pessoa Sintética',
    phone: '(11) 99999-9999',
    clinicName: 'Clínica Sintética',
    source: 'public_landing',
    acquisitionChannel: 'organic',
    formStartedAt: Date.now() - 2000,
    website: '',
  },
});
const setup = (rpcResult: any = {data:{lead_id:syntheticId,event_created:false},error:null}) => {
  const calls: Array<{name:string;args:any}> = [];
  const alerts: any[]=[];
  const ip = (_req:any,_res:any,_next:any)=>{};
  const identity = (_req:any,_res:any,_next:any)=>{};
  let endpoint='';
  let handlers:any[] = [];
  registerPublicSalesLeadRoute({post(path:string,...fns:any[]){endpoint=path;handlers=fns;}},{
    supabase:{rpc:async(name:string,args:any)=>{calls.push({name,args});return rpcResult;}},
    publicSalesLeadIpLimiter:ip,
    publicSalesLeadIdentityLimiter:identity,
    sanitizeString:(v:unknown,max:number)=>String(v??'').trim().slice(0,max),
    sanitizeEmail:(v:unknown)=>String(v??'').trim().toLowerCase()||null,
    normalizeSalesPhone:(v:unknown)=>{
      const num=String(v??'').replace(/\D/g,'');
      return num.length===11?'55'+num:num.startsWith('55')&&num.length===13?num:null;
    },
    normalizeSalesInteger:(v:unknown,max:number)=>{
      if(v===undefined||v===null||v==='')return null;
      const n=Number(v);
      return Number.isInteger(n)&&n>=0&&n<=max?n:null;
    },
    isUuid:(v:string|null|undefined)=>v===syntheticId,
    isMissingRelationError:(e:any)=>e?.code==='42P01',
    notifySalesOwnerForLead:async(v:any)=>{alerts.push(v);},
    SALES_PUBLIC_PAYLOAD_MAX_BYTES:24*1024,
    SALES_ESTIMATED_ACTIVE_PATIENTS_MAX:100000,
    SALES_ESTIMATED_PROFESSIONALS_MAX:10000,
    SALES_CONTACT_CONSENT_VERSION:'sales-contact-v1',
    SALES_OPERATION_TYPES:new Set(['clinic','independent_professional','multidisciplinary_team']),
    SALES_PREFERRED_CONTACT_PERIODS:new Set(['','morning','afternoon','evening']),
    BRAZIL_STATE_CODES:new Set(['SP','RJ']),
  });
  const invoke=async(req:any)=>{
    let status=200,body:any;
    const res={status(n:number){status=n;return this;},json(v:any){body=v;return this;}};
    await handlers[2](req,res);
    return {status,body};
  };
  return {endpoint,handlers,ip,identity,calls,alerts,invoke};
};

test('public API remains guarded, idempotent and persisted before 201',async()=>{
  const h=setup();
  assert.equal(h.endpoint,'/api/public/sales-leads');
  assert.equal(h.handlers.length,3);
  assert.equal(h.handlers[0],h.ip);
  assert.equal(h.handlers[1],h.identity);
  const result=await h.invoke(makeReq());
  assert.equal(result.status,201);
  assert.equal(result.body.success,true);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].name,'upsert_public_sales_lead');
  assert.equal(h.calls[0].args.p_idempotency_key,'public-sales:synthetic-key-123456');
  assert.equal(h.calls[0].args.p_source,'public_landing');
  assert.equal(h.alerts.length,0);
});
test('bot, invalid and oversized input fail before database',async()=>{
  const h=setup();
  const bot=makeReq();bot.body.website='bot';assert.equal((await h.invoke(bot)).status,400);
  const early=makeReq();early.body.formStartedAt=Date.now();assert.equal((await h.invoke(early)).status,400);
  const bad=makeReq();bad.body.name='X';assert.equal((await h.invoke(bad)).status,400);
  const oversized=makeReq();(oversized.body as any).notes='x'.repeat(25*1024);
  assert.equal((await h.invoke(oversized)).status,413);
  assert.equal(h.calls.length,0);
});
test('new event triggers notification, duplicated event does not',async()=>{
  const h=setup({data:{lead_id:syntheticId,event_created:true},error:null});
  assert.equal((await h.invoke(makeReq())).status,201);
  assert.equal(h.alerts.length,1);
  assert.equal(h.alerts[0].leadId,syntheticId);
});
test('schema missing and identity conflict preserve 503 and 409',async()=>{
  const missing=setup({data:null,error:{code:'42P01',message:'relation missing'}});
  assert.equal((await missing.invoke(makeReq())).status,503);
  const conflict=setup({data:null,error:{message:'SALES_LEAD_IDENTITY_CONFLICT'}});
  assert.equal((await conflict.invoke(makeReq())).status,409);
});
