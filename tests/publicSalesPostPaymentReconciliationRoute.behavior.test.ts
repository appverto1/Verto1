import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerPublicSalesPostPaymentReconciliationRoute} from '../services/publicSalesPostPaymentReconciliationRoute';

const offerId='11111111-1111-4111-8111-111111111111';
const leadId='22222222-2222-4222-8222-222222222222';
const token='t'.repeat(48);
const sessionId='cs_test_safe_opaque';
const response=()=>{
 const r:any={statusCode:200,headers:{} as Record<string,string>,body:null,
   setHeader(key:string,value:string){this.headers[key]=value;return this;},
   status(status:number){this.statusCode=status;return this;},
   json(body:any){this.body=body;return this;}};
 return r;
};
function fixture(overrides: Record<string, any>={}){
 let endpoint:any;
 let lookups=0,retrievals=0,reconciliations=0;
 const deps:any={
   app:{post:(path:string,_limiter:any,handler:any)=>{
     assert.equal(path,'/api/public/sales-offers/:token/prepare-activation');
     endpoint=handler;
   }},
   publicSalesPostPaymentLimiter:()=>undefined,
   sanitizeString:(v:any,max=1000)=>String(v??'').slice(0,max),
   resolveSalesPostPaymentContextToken:async()=>({offerId,leadId}),
   supabase:{from:(table:string)=>{
     assert.equal(table,'sales_offers');lookups++;
     return {select:(_columns:string)=>({
       eq(_key:string,_val:any){return this;},
       async maybeSingle(){return {data:{id:offerId,lead_id:leadId,status:'paid',provisioning_status:'completed',stripe_checkout_session_id:sessionId},error:null};},
     })};
   }},
   getStripe:()=>{
     return {checkout:{sessions:{retrieve:async()=>{
       retrievals++;
       return {id:sessionId,metadata:{offerId,leadId}};
     }}}};
   },
   reconcileSalesAssistedCheckout:async()=>{
     reconciliations++;
     return {paymentConfirmed:true,accountActivated:true,directorSessionReady:true,sessionClaimed:false,reviewRequired:false,settledPaymentMethod:'card',cardActivationPath:'/ativacao-comercial/'+'a'.repeat(48)};
   },
   ...overrides,
 };
 registerPublicSalesPostPaymentReconciliationRoute(deps);
 const call=async(opts:{token?:string;sessionId?:string;extra?:Record<string,any>}={})=>{
   const res=response();
   await endpoint({params:{token:opts.token??token},body:{sessionId:opts.sessionId??sessionId,...opts.extra}},res);
   return res;
 };
 return {call,get stats(){return {lookups,retrievals,reconciliations}}};
}
test('malformed return token cannot trigger Supabase or Stripe access',async()=>{
 const s=fixture();
 const res=await s.call({token:'too-short'});
 assert.equal(res.statusCode,400);
 assert.equal(res.body.error,'SALES_DIRECTOR_PROVISIONING_CONTEXT_INVALID');
 assert.deepEqual(s.stats,{lookups:0,retrievals:0,reconciliations:0});
});
test('unknown session or token cannot enumerate offers or trigger Stripe',async()=>{
 const s=fixture({resolveSalesPostPaymentContextToken:async()=>null});
 const res=await s.call();
 assert.equal(res.statusCode,404);
 assert.equal(res.body.error,'SALES_DIRECTOR_PROVISIONING_CONTEXT_NOT_FOUND');
 assert.deepEqual(s.stats,{lookups:0,retrievals:0,reconciliations:0});
});
test('missing persisted offer cannot be reconciled by forged browser ID',async()=>{
 const s=fixture({supabase:{from:()=>({select:()=>({eq(){return this;},async maybeSingle(){return {data:null,error:null};}})})}});
 const res=await s.call({extra:{offerId:'forged-offer',userId:'forged-user',organizationId:'forged-clinic'}});
 assert.equal(res.statusCode,404);
 assert.deepEqual(s.stats,{lookups:0,retrievals:0,reconciliations:0});
});
test('server checks Stripe offer/lead metadata against canonical DB context',async()=>{
 const s=fixture({getStripe:()=>({checkout:{sessions:{retrieve:async()=>({metadata:{offerId:'another-offer',leadId}})}}})});
 const res=await s.call();
 assert.equal(res.statusCode,409);
 assert.equal(res.body.error,'SALES_CHECKOUT_RECONCILIATION_MISMATCH');
 assert.equal(s.stats.reconciliations,0);
});
test('pending payment does not become authorized Director access',async()=>{
 const s=fixture({reconcileSalesAssistedCheckout:async()=>({paymentConfirmed:false,accountActivated:false,directorSessionReady:false,reviewRequired:false})});
 const res=await s.call();
 assert.equal(res.statusCode,202);
 assert.equal(res.body.state,'payment_pending');
 assert.equal(res.body.directorSessionReady,false);
 assert.equal(res.headers['Cache-Control'],'no-store');
});
test('paid but incomplete provisioning remains non-authorized',async()=>{
 const s=fixture({reconcileSalesAssistedCheckout:async()=>({paymentConfirmed:true,accountActivated:false,directorSessionReady:false,reviewRequired:false})});
 const res=await s.call();
 assert.equal(res.statusCode,202);
 assert.equal(res.body.state,'provisioning');
 assert.equal(res.body.directorSessionReady,false);
});
test('server-authorized Director can become ready without new Checkout or additional invoice',async()=>{
 const s=fixture();
 const res=await s.call({extra:{role:'patient',clinicId:'other',amount:0}});
 assert.equal(res.statusCode,200);
 assert.equal(res.body.state,'director_ready');
 assert.equal(res.body.directorSessionReady,true);
 assert.deepEqual(s.stats,{lookups:1,retrievals:1,reconciliations:1});
});
test('ready flag alone cannot grant activation without an authorized payment method and path',async()=>{
 const s=fixture({reconcileSalesAssistedCheckout:async()=>({paymentConfirmed:true,accountActivated:true,directorSessionReady:true,sessionClaimed:false,reviewRequired:false})});
 const res=await s.call();
 assert.equal(res.statusCode,202);
 assert.equal(res.body.state,'provisioning');
 assert.equal(res.body.directorSessionReady,false);
 assert.equal(res.body.cardActivationPath,null);
});
test('settled boleto requires an activation email and never returns a card activation path',async()=>{
 const s=fixture({reconcileSalesAssistedCheckout:async()=>({paymentConfirmed:true,accountActivated:true,directorSessionReady:true,settledPaymentMethod:'boleto',activationEmailSent:true,cardActivationPath:'/ativacao-comercial/'+'a'.repeat(48)})});
 const res=await s.call();
 assert.equal(res.statusCode,200);
 assert.equal(res.body.state,'director_ready');
 assert.equal(res.body.cardActivationPath,null);
});
test('boleto email cannot make an unpaid or unprovisioned account ready',async()=>{
 for (const result of [
  {paymentConfirmed:false,accountActivated:true},
  {paymentConfirmed:true,accountActivated:false},
 ]) {
  const s=fixture({reconcileSalesAssistedCheckout:async()=>({...result,directorSessionReady:true,settledPaymentMethod:'boleto',activationEmailSent:true})});
  const res=await s.call();
  assert.equal(res.statusCode,202);
  assert.equal(res.body.directorSessionReady,false);
 }
});
test('contract review takes precedence over even a claimed or ready session',async()=>{
 const s=fixture({reconcileSalesAssistedCheckout:async()=>({paymentConfirmed:true,accountActivated:true,directorSessionReady:true,sessionClaimed:true,reviewRequired:true})});
 const res=await s.call();
 assert.equal(res.statusCode,200);
 assert.equal(res.body.state,'review_required');
});
test('Stripe reconciliation exception fails closed with a stable 503 response',async()=>{
 const s=fixture({getStripe:()=>{throw new Error('STRIPE_UNAVAILABLE')}});
 const res=await s.call();
 assert.equal(res.statusCode,503);
 assert.equal(res.body.error,'SALES_DIRECTOR_PROVISIONING_FAILED');
 assert.equal(res.body.success,false);
});
