import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerPublicSalesActivationPasswordRoute } from '../services/publicSalesActivationPasswordRoute.ts';

const offerId = '11111111-1111-4111-8111-111111111111';
function makeHarness({status='incomplete',offerType='modular',stripeSubscriptionId='sub_test_initial_paid',lookupError=false}={}) {
  let authLookups=0, stripeReads=0, userWrites=0, finalizeCalls=0;
  const handlers=[];
  const app={post:(path,limiter,handler)=>{assert.equal(path,'/api/public/sales-activations/:token/password'); handlers.push(handler);}};
  const deps={
    supabase: { auth: { admin: { createUser: async()=>{userWrites++;throw Error('UNEXPECTED_AUTH_WRITE');}, updateUserById: async()=>{userWrites++;throw Error('UNEXPECTED_AUTH_WRITE');} } }, from:()=>{userWrites++;throw Error('UNEXPECTED_DB_WRITE');} },
    getStripe:()=>({subscriptions:{retrieve:async(id)=>{stripeReads++;assert.equal(id,stripeSubscriptionId);return {id,status};}}}),
    stripeSubscriptionToEntitlementStatus: value=>value==='active'?'active':value==='trialing'?'trial':'inactive',
    publicSalesActivationLimiter: (_req,_res,next)=>next?.(),
    validateStrongPassword: value=>value==='CorrectHorseBattery1!'?value:null,
    loadPublicSalesActivation:async()=>({offer:{offer_type:offerType,stripe_subscription_id:stripeSubscriptionId},offerId,leadId:'22222222-2222-4222-8222-222222222222',checkoutSessionId:'cs_test_paid',email:'test@example.invalid'}),
    findAuthUserByEmail:async()=>{authLookups++;if(lookupError)throw Error('AUTH_LOOKUP_REACHED');return null;},
    finalizeSalesActivationForUser:async()=>{finalizeCalls++;throw Error('UNEXPECTED_FINALIZATION');},
    maskEmail:v=>'[masked]',sanitizeEmail:v=>String(v).toLowerCase(),sanitizeString:(v,n=240)=>String(v??'').slice(0,n),
  };
  registerPublicSalesActivationPasswordRoute(app,deps);
  return {
    invoke:async()=>{
      let result;
      const res={status(n){this.code=n;return this;},json(payload){result={status:this.code??200,payload};return this;},setHeader(){}};
      await handlers[0]({params:{token:'synthetic_paid_token'},body:{password:'CorrectHorseBattery1!'}},res);
      return result;
    },
    counts:()=>({authLookups,stripeReads,userWrites,finalizeCalls}),
  };
}
test('unpaid / ineligible Stripe status denies password route before Auth, user profile or clinic', async()=>{
  for(const status of ['incomplete','past_due','canceled','unpaid','trialing']){
    const h=makeHarness({status});
    const result=await h.invoke();
    assert.equal(result.status,503);
    assert.equal(result.payload.success,false);
    assert.deepEqual(h.counts(),{authLookups:0,stripeReads:1,userWrites:0,finalizeCalls:0});
  }
});
test('missing subscription prevents creating password/director, without Stripe read',async()=>{
 const h=makeHarness({stripeSubscriptionId:''});
 const result=await h.invoke();
 assert.equal(result.status,503);
 assert.deepEqual(h.counts(),{authLookups:0,stripeReads:0,userWrites:0,finalizeCalls:0});
});
test('eligible subscription reaches only the existing Auth flow after verification',async()=>{
 const h=makeHarness({status:'active',lookupError:true});
 const result=await h.invoke();
 assert.equal(result.status,500);
 assert.deepEqual(h.counts(),{authLookups:1,stripeReads:1,userWrites:0,finalizeCalls:0});
});
test('legacy paid activation retains existing flow without adding Stripe reads',async()=>{
 const h=makeHarness({offerType:'legacy',lookupError:true});
 await h.invoke();
 assert.deepEqual(h.counts(),{authLookups:1,stripeReads:0,userWrites:0,finalizeCalls:0});
});
test('server scope for password activation is paid offer, contract email and subscription ID',()=>{
 const server=readFileSync('server.ts','utf8');
 assert.match(server,/id,lead_id,status,stripe_checkout_session_id,stripe_subscription_id,offer_type,contract_email/);
 assert.match(server,/registerPublicSalesActivationPasswordRoute\(app, \{[\s\S]*?stripeSubscriptionToEntitlementStatus: \(status\) => stripeSubscriptionToEntitlementStatus\(status\)/);
 const src=readFileSync('services/publicSalesActivationPasswordRoute.ts','utf8');
 assert.match(src,/verifiedSubscription,/);
 assert.match(src,/app_metadata: \{ sales_activation_offer_id: loaded.offerId \}/);
});
