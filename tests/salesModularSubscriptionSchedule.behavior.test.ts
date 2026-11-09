import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSalesModularSubscriptionSchedule} from '../services/salesModularSubscriptionSchedule';

const baseMetadata = {
 flowType:'sales_modular_assisted',
 environment:'test',
 offerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 leadId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const session=(metadata:Record<string,unknown>=baseMetadata,subscription='sub_fixture')=>({
 id:'cs_fixture',metadata,subscription,customer:'cus_fixture',
}) as any;
const setup=(opts:{link?:any;env?:string}={})=>{
 const writes:any[]=[];
 const calls:string[]=[];
 const link=opts.link===undefined?{
   id:'link_fixture',offer_id:baseMetadata.offerId,lead_id:baseMetadata.leadId,
   environment:'test',stripe_subscription_id:null,status:'completed',
   checkout_plan_snapshot:{schedulePhases:[]}
 }:opts.link;
 const supabase={from:(table:string)=>{
   assert.equal(table,'sales_checkout_links');
   return {
     select:(_columns:string)=>({
       eq(_field:string,_value:string){return this;},
       async maybeSingle(){calls.push('link:lookup');return {data:link,error:null};},
     }),
     update(patch:any){
       writes.push(patch);
       return {
         eq(_field:string,_value:string){return this;},
         or(_value:string){return this;},
         select(_columns:string){
           return {maybeSingle:async()=>({data:{
              id:link?.id,stripe_subscription_id:patch.stripe_subscription_id
            },error:null})};
         },
       };
     },
   };
 }};
 const stripe:any={
   subscriptions:{retrieve:async()=>{calls.push('stripe:subscription.retrieve');throw Error('UNEXPECTED_STRIPE_REQUEST');}},
   subscriptionSchedules:{create:async()=>{calls.push('stripe:schedule.create');throw Error('UNEXPECTED_STRIPE_REQUEST');}},
 };
 const handlers=createSalesModularSubscriptionSchedule({
   supabase,stripe,resolveStripeEnvironment:()=>opts.env||'test',
   validateStripeSecretForEnvironment:()=> 'test-fixture',
   sanitizeString:(value:unknown,max=500)=>String(value??'').slice(0,max),
 } as any);
 return {handlers,stripe,calls,writes};
};
test('non-sales Stripe event cannot read billing data or create a schedule',async()=>{
 const s=setup();
 const r=await s.handlers.ensureModularSubscriptionSchedule(s.stripe,session({flowType:'other',environment:'test'}));
 assert.equal(r,null);assert.deepEqual(s.calls,[]);assert.deepEqual(s.writes,[]);
});
test('wrong Stripe environment fails closed before SQL and Stripe calls',async()=>{
 const s=setup({env:'live'});
 await assert.rejects(()=>s.handlers.ensureModularSubscriptionSchedule(s.stripe,session()),/MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH/);
 assert.deepEqual(s.calls,[]);assert.deepEqual(s.writes,[]);
});
test('a missing canonical Stripe subscription ID does not create a schedule',async()=>{
 const s=setup();
 await assert.rejects(()=>s.handlers.ensureModularSubscriptionSchedule(s.stripe,session(baseMetadata,'')),/MODULAR_SUBSCRIPTION_MISSING/);
 assert.deepEqual(s.calls,[]);assert.deepEqual(s.writes,[]);
});
test('missing checkout link does not create a subscription or schedule',async()=>{
 const s=setup({link:null});
 await assert.rejects(()=>s.handlers.ensureModularSubscriptionSchedule(s.stripe,session()),/MODULAR_CHECKOUT_LINK_MISSING/);
 assert.deepEqual(s.calls,['link:lookup']);assert.deepEqual(s.writes,[]);
});
test('cross-offer or cross-lead Stripe metadata is rejected before mutation',async()=>{
 for(const changed of [{offer_id:'different'},{lead_id:'different'},{environment:'live'}]){
   const s=setup({link:{
     id:'link_fixture',offer_id:baseMetadata.offerId,lead_id:baseMetadata.leadId,
     environment:'test',stripe_subscription_id:null,status:'completed',
     checkout_plan_snapshot:{schedulePhases:[]},...changed,
   }});
   await assert.rejects(()=>s.handlers.ensureModularSubscriptionSchedule(s.stripe,session()),/MODULAR_CHECKOUT_RECONCILIATION_MISMATCH/);
   assert.deepEqual(s.writes,[]);
 }
});
test('a checkout linked to a different subscription is rejected without a duplicate',async()=>{
 const s=setup({link:{
  id:'link_fixture',offer_id:baseMetadata.offerId,lead_id:baseMetadata.leadId,
  environment:'test',stripe_subscription_id:'sub_other',status:'completed',
  checkout_plan_snapshot:{schedulePhases:[]}
 }});
 await assert.rejects(()=>s.handlers.ensureModularSubscriptionSchedule(s.stripe,session()),/MODULAR_SUBSCRIPTION_LINKAGE_INVALID/);
 assert.deepEqual(s.writes,[]);assert.deepEqual(s.calls,['link:lookup']);
});
test('one-phase subscription link is persisted without creating another Stripe subscription',async()=>{
 const s=setup();
 const result=await s.handlers.ensureModularSubscriptionSchedule(s.stripe,session());
 assert.equal(result,null);
 assert.equal(s.writes.length,1);
 assert.equal(s.writes[0].stripe_subscription_id,'sub_fixture');
 assert.equal(s.writes[0].status,'completed');
 assert.deepEqual(s.calls,['link:lookup']);
});
