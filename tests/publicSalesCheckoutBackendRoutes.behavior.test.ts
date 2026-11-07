import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {registerPublicSalesCheckoutRoutes} from '../services/publicSalesCheckoutRoutes';
import {createModularCheckoutCore} from '../services/salesModularCheckoutCore';

const offerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const leadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const makeResponse = () => {
  const r: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode=code;return this; },
    json(body: unknown) { this.body=body;return this; },
  };
  return r;
};
const makePublicRoutes = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string,(req:any,res:any)=>Promise<any>>();
  let loadedCount = 0;
  let stripeCount = 0;
  const params: any[] = [];
  const deps = {
    app:{post:(path:string,_limiter:any,handler:any)=>handlers.set(path,handler)},
    publicSalesLeadIpLimiter:()=>undefined,
    loadPublicSalesOffer:async()=>{
      loadedCount++;
      return {
        offer:{
          id:offerId,lead_id:leadId,offer_type:'modular',
          created_by:actorId,accepted_at:'2026-11-06T00:00:00.000Z'
        },lead:{id:leadId},tokenHash:'f'.repeat(64),token:'opaque-server-token'
      };
    },
    sanitizeString:(v:any,max=1000)=>String(v??'').slice(0,max),
    isUuid:(v:string)=>v===actorId,
    resolveStripeEnvironment:()=> 'test',
    validateStripeSecretForEnvironment:()=> 'valid-fixture',
    crypto:{createHash:()=>createHash('sha256')},
    getStripe:()=>{stripeCount++;throw Error('STRIPE_SHOULD_NOT_BE_CALLED');},
    createOrReuseModularCheckout:async(_req:any,res:any,p:any)=>{
      params.push(p); return res.json({success:true,url:'https://checkout.stripe.com/fixture',idempotent:true});
    },
    ...overrides,
  };
  registerPublicSalesCheckoutRoutes(deps as any);
  const call = async(suffix:'accept'|'checkout',body:any,reqOverrides:Record<string,unknown>={})=>{
    const h=handlers.get('/api/public/sales-offers/:token/'+suffix);
    assert.ok(h,'both public routes must be registered');
    const res=makeResponse();
    await h!({body,params:{token:'opaque-server-token'},...reqOverrides},res);
    return res;
  };
  return {call,params,get counts(){return {loadedCount,stripeCount}},handlers};
};

test('missing consent and terms fail before token resolution or Stripe access',async()=>{
  const s=makePublicRoutes();
  const consent=await s.call('accept',{commercialValuesConsent:false});
  const terms=await s.call('checkout',{acceptTerms:false});
  assert.equal(consent.statusCode,400);
  assert.equal(consent.body.error,'COMMERCIAL_VALUES_CONSENT_REQUIRED');
  assert.equal(terms.statusCode,400);
  assert.equal(terms.body.error,'TERMS_REQUIRED');
  assert.deepEqual(s.counts,{loadedCount:0,stripeCount:0});
});
test('expired or unknown tokens cannot start Checkout or register acceptance',async()=>{
  const s=makePublicRoutes({loadPublicSalesOffer:async()=>({error:'unavailable'})});
  const a=await s.call('accept',{commercialValuesConsent:true});
  const c=await s.call('checkout',{acceptTerms:true});
  assert.equal(a.statusCode,404);
  assert.equal(c.statusCode,404);
  assert.equal(s.params.length,0);
  assert.equal(s.counts.stripeCount,0);
});
test('malicious browser prices, tenant, modules or environment are rejected',async()=>{
  const s=makePublicRoutes();
  for(const field of ['amount','price','prices','discount','lineItems','organizationId','modules','trialDays','environment']){
    const res=await s.call('checkout',{acceptTerms:true,[field]:field});
    assert.equal(res.statusCode,400,field);
    assert.equal(res.body.error,'MODULAR_CHECKOUT_BROWSER_VALUES_REJECTED',field);
  }
  assert.equal(s.params.length,0);
  assert.equal(s.counts.stripeCount,0);
});
test('unaccepted offer never starts a Stripe session',async()=>{
  const s=makePublicRoutes({loadPublicSalesOffer:async()=>({
    offer:{id:offerId,offer_type:'modular',created_by:actorId,accepted_at:null},
    lead:{id:leadId},tokenHash:'f'.repeat(64),token:'opaque'
  })});
  const res=await s.call('checkout',{acceptTerms:true});
  assert.equal(res.statusCode,409);
  assert.equal(res.body.error,'MODULAR_OFFER_ACCEPTANCE_REQUIRED');
  assert.equal(s.params.length,0);
});
test('Checkout derives actor and deterministic key from server-frozen offer, never browser IDs',async()=>{
  const s=makePublicRoutes();
  const body={acceptTerms:true,actorUserId:'spoofed-client-id'};
  const r=await s.call('checkout',body);
  assert.equal(r.statusCode,200);
  assert.equal(r.body.success,true);
  assert.equal(s.params.length,1);
  assert.equal(s.params[0].actorUserId,actorId);
  assert.equal(s.params[0].offerId,offerId);
  assert.equal(s.params[0].publicMode,true);
  assert.equal(s.params[0].publicOfferToken,'opaque-server-token');
  assert.equal(s.params[0].idempotencyKey,createHash('sha256').update('public-modular-checkout:'+offerId+':test:'+'f'.repeat(64)).digest('hex'));
  const retry=await s.call('checkout',body);
  assert.equal(retry.statusCode,200);
  assert.equal(s.params.length,2);
  assert.equal(s.params[0].idempotencyKey,s.params[1].idempotencyKey);
  assert.equal(s.counts.stripeCount,0);
});
test('invalid frozen author or wrong Stripe environment fail closed before session creation',async()=>{
  const invalid=makePublicRoutes({isUuid:()=>false});
  const a=await invalid.call('checkout',{acceptTerms:true});
  assert.equal(a.statusCode,503);
  assert.equal(a.body.error,'MODULAR_CHECKOUT_RECONCILIATION_FAILED');
  const wrong=makePublicRoutes({validateStripeSecretForEnvironment:()=>{throw Error('LIVE_KEY_IN_TEST');}});
  const b=await wrong.call('checkout',{acceptTerms:true});
  assert.equal(b.statusCode,503);
  assert.equal(b.body.error,'STRIPE_ENVIRONMENT_CONFIGURATION_INVALID');
  assert.equal(wrong.params.length,0);
});
test('core rejects an unknown offer without creating Stripe session, subscription or records',async()=>{
  let stripeCalls=0;
  const noRecord={select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null}),order:async()=>({data:[],error:null})})})};
  const listRecord={select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})};
  const handler=createModularCheckoutCore({
    sanitizeString:(v:any)=>String(v??''),
    resolveStripeEnvironment:()=> 'test',
    validateStripeSecretForEnvironment:()=>undefined,
    supabase:{from:(table:string)=>table==='sales_offer_items'?listRecord:noRecord},
    getStripe:()=>{stripeCalls++;throw Error('SHOULD_NOT_BE_CALLED');},
  } as any);
  const res=makeResponse();
  await handler({},res,{offerId,actorUserId:actorId,idempotencyKey:'valid-key-12345'});
  assert.equal(res.statusCode,404);
  assert.equal(res.body.code,'MODULAR_OFFER_NOT_FOUND');
  assert.equal(stripeCalls,0);
});
