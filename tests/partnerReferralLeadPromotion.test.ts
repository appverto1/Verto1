import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPublicSalesLeadRoute } from '../services/publicSalesLeadRoutes';

const leadId='11111111-1111-4111-8111-111111111111';
function fixture(referralError: any = null) {
  const calls: Array<{name: string; args: any}>=[];
  let handler: (req:any,res:any)=>Promise<any>;
  registerPublicSalesLeadRoute({
    post: (_path:string, ...handlers:any[]) => { handler=handlers[handlers.length-1]; }
  },{
    supabase:{rpc:async(name:string,args:any)=>{
      calls.push({name,args});
      if(name==='upsert_public_sales_lead')
        return {data:{lead_id:leadId,event_created:true},error:null};
      if(name==='verto_claim_partner_referral_v1')
        return {data:!referralError,error:referralError};
      throw new Error('UNEXPECTED_RPC');
    }},
    publicSalesLeadIpLimiter:(_req:any,_res:any,next:any)=>next(),
    publicSalesLeadIdentityLimiter:(_req:any,_res:any,next:any)=>next(),
    sanitizeString:(v:unknown,max:number)=>String(v??'').trim().slice(0,max),
    sanitizeEmail:(v:unknown)=>String(v??'').trim().toLowerCase()||null,
    normalizeSalesPhone:(v:unknown)=>{
      const digits=String(v??'').replace(/\D/g,'');
      return digits.length===11?'55'+digits:digits.startsWith('55')&&digits.length===13?digits:null;
    },
    normalizeSalesInteger:(v:unknown,max:number)=>
      v==null||v===''?null:Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=max?Number(v):null,
    isUuid:(v:unknown)=>v===leadId,
    isMissingRelationError:(err:any)=>err?.code==='42P01',
    notifySalesOwnerForLead:async()=>{},
    SALES_PUBLIC_PAYLOAD_MAX_BYTES:24*1024,
    SALES_ESTIMATED_ACTIVE_PATIENTS_MAX:100000,
    SALES_ESTIMATED_PROFESSIONALS_MAX:10000,
    SALES_CONTACT_CONSENT_VERSION:'sales-contact-v1',
    SALES_OPERATION_TYPES:new Set(['clinic','independent_professional','multidisciplinary_team']),
    SALES_PREFERRED_CONTACT_PERIODS:new Set(['','morning','afternoon','evening']),
    BRAZIL_STATE_CODES:new Set(['SP','RJ']),
  });
  const invoke=async(partnerCode?:unknown)=>{
    const req:any={headers:{'x-idempotency-key':'test-referral-key-20261116'},
      body:{name:'Clínica Sintética',clinicName:'Clínica Sintética',phone:'(11) 99999-9999',
        source:'public_landing',acquisitionChannel:'organic',formStartedAt:Date.now()-2000,website:''}};
    if(partnerCode!==undefined)req.body.partnerCode=partnerCode;
    let status=200,body:any;
    const res={status(n:number){status=n;return this;},json(value:any){body=value;return this;}};
    await handler!(req,res);
    return {status,body};
  };
  return {calls,invoke};
}

test('ordinary lead stays one canonical save, with no extra referral RPC',async()=>{
  const f=fixture();
  const result=await f.invoke();
  assert.equal(result.status,201);
  assert.equal(result.body.success,true);
  assert.deepEqual(f.calls.map(call=>call.name),['upsert_public_sales_lead']);
  assert.equal(result.body.referralRecorded,undefined);
});

test('approved coupon is claimed only after canonical lead save, with same idempotency key',async()=>{
  const f=fixture();
  const result=await f.invoke('fratelli10');
  assert.equal(result.status,201);
  assert.equal(result.body.referralRecorded,true);
  assert.deepEqual(f.calls.map(call=>call.name),
    ['upsert_public_sales_lead','verto_claim_partner_referral_v1']);
  assert.equal(f.calls[1].args.p_lead_id,leadId);
  assert.equal(f.calls[1].args.p_referral_code,'FRATELLI10');
  assert.equal(f.calls[1].args.p_idempotency_key,f.calls[0].args.p_idempotency_key);
});

test('invalid coupon rejects before any database write',async()=>{
  const f=fixture();
  assert.equal((await f.invoke('a-unsafe-code')).status,400);
  assert.equal((await f.invoke({coupon:'OTHER'})).status,400);
  assert.equal(f.calls.length,0);
});

test('unavailable referral RPC never undoes a saved lead or reports referral confirmed',async()=>{
  const f=fixture({code:'PGRST202'});
  const result=await f.invoke('FRATELLI10');
  assert.equal(result.status,201);
  assert.equal(result.body.success,true);
  assert.equal(result.body.referralRecorded,false);
  assert.equal(typeof result.body.referralWarning,'string');
  assert.equal(f.calls[0].name,'upsert_public_sales_lead');
});
