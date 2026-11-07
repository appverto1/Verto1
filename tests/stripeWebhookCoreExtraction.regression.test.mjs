import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const server=readFileSync('server.ts','utf8');
const digest=x=>createHash('sha256').update(x).digest('hex');
const parts=[
  {path:'services/stripeWebhookEventState.ts',hash:'5fbe9a6520d2e47044c51446909e830392e0cf187b10590c246fa05a7da8b179',factory:'createStripeWebhookEventState',names:["reserveStripeWebhookEvent", "markStripeWebhookEventStatus"]},
  {path:'services/salesSubscriptionDiscountSync.ts',hash:'1e722fcf5eaf97d319335628afe5097510c5badd812e5d59bf5d3aaf7c75b97e',factory:'createSalesSubscriptionDiscountSync',names:["syncSalesSubscriptionDiscount", "eventTypeSubscriptionIsActive"]},
  {path:'services/salesAssistedCheckoutPaymentProcessor.ts',hash:'2d7eaef361c90bc341440bf29e952fb29414fd151a48ccc0a147748dd4c1736d',factory:'createSalesAssistedCheckoutPaymentProcessor',names:["processSalesAssistedCheckoutCompleted"]},
  {path:'services/salesSubscriptionFinancialReconciliation.ts',hash:'37755ffb175026e4c24e94301c08fa8865ab3a236bbc838c1520b1daf53e419a',factory:'createSalesSubscriptionFinancialReconciliation',names:["stripeInvoiceSubscriptionId", "stripeTimestampToIso", "stripeInvoicePeriodBounds", "persistPlatformSubscriptionFinancialState", "persistPlatformBillingInvoiceLedger", "salesAssistedFlowType"]},
  {path:'services/salesModularSubscriptionSchedule.ts',hash:'babd3769776948a2ea1e4d33f7425a64433905075245180cdef8242df2ba12bb',factory:'createSalesModularSubscriptionSchedule',names:["stripeExpandableId", "sanitizeStripeScheduleMetadata", "preserveStripeSchedulePhaseForUpdate", "buildStripeScheduleContinuationPhase", "normalizeModularSchedulePhaseBoundaries", "ensureModularSubscriptionSchedule", "reconcileSalesAssistedCheckout"]},
  {path:'services/salesSubscriptionEntitlementTransitions.ts',hash:'d68a22da079a4b42b437794843e220a48afa1316801bdd64e3f07780397c978d',factory:'createSalesSubscriptionEntitlementTransitions',names:["stripeSubscriptionToEntitlementStatus", "applyModularEntitlementsForOrganization"]},

];
test('all six Stripe groups retain exact audited source content and run from module factories',()=>{
 for(const section of parts){
   const content=readFileSync(section.path,'utf8');
   const a='  // ITEM09_SOURCE_BEGIN\n',b='  // ITEM09_SOURCE_END\n';
   assert.equal(content.split(a).length,2,section.path);
   assert.equal(content.split(b).length,2,section.path);
   const original=content.split(a)[1].split(b)[0];
   // TS-only cast for Stripe SDK: stripped before checking the pinned source hash.
   const normalized = section.path.endsWith('/salesModularSubscriptionSchedule.ts')
     ? original.replace('as unknown as Stripe.SubscriptionScheduleUpdateParams','as Stripe.SubscriptionScheduleUpdateParams')
     : original;
   if(section.path.endsWith('/salesModularSubscriptionSchedule.ts'))
     assert.equal((original.match(/as unknown as Stripe\.SubscriptionScheduleUpdateParams/g)||[]).length,1);
   assert.equal(digest(normalized),section.hash,section.path+' original runtime source must remain unchanged');
   assert.match(server,new RegExp(section.factory+'\\(\\{'),section.path+' factory must be wired in server');
   for(const name of section.names){
     assert.match(original,new RegExp('\\b'+name+'\\b'));
     assert.doesNotMatch(server,new RegExp('(?:async function|const)\\s+'+name+'\\s*(?:=|\\()'),name+' cannot be duplicated');
   }
 }
});
test('Stripe webhook registrations retain their precise order, raw signature and idempotent reserve',()=>{
 const legacy=server.indexOf('registerLegacySalesActivationStripeWebhookRoute(app, {');
 const canonical=server.indexOf('registerStripeCanonicalWebhookRoute(app, {');
 const handlers=server.indexOf('createSalesAssistedStripeEventHandlers({');
 const states=server.indexOf('createStripeWebhookEventState({');
 assert.ok(states>=0&&handlers>states&&legacy>handlers&&canonical>legacy);
 assert.match(server,/reserveStripeWebhookEvent/);
 assert.match(server,/markStripeWebhookEventStatus/);
 assert.match(readFileSync('services/legacySalesActivationStripeWebhookRoute.ts','utf8'),/express\.raw\(\{ type: "application\/json" \}\)/);
 assert.match(readFileSync('services/stripeCanonicalWebhookRoute.ts','utf8'),/stripe\.webhooks\.constructEvent/);
 const state=readFileSync('services/stripeWebhookEventState.ts','utf8');
 assert.match(state,/\.insert\(\[\{/);
 assert.match(state,/code !== '23505'/);
 assert.match(state,/\.eq\('status', sanitizeString\(existing\.status, 40\)\)/);
 assert.match(state,/\.lt\('processed_at', staleBefore\)/);
});
test('subscription schedule and paid-state authority stay in backend without new payment creation',()=>{
 const mod=readFileSync('services/salesModularSubscriptionSchedule.ts','utf8');
 const paid=readFileSync('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
 const entitlement=readFileSync('services/salesSubscriptionEntitlementTransitions.ts','utf8');
 assert.match(mod,/MODULAR_CHECKOUT_ENVIRONMENT_MISMATCH/);
 assert.match(mod,/MODULAR_SUBSCRIPTION_LINKAGE_CONFLICT/);
 assert.match(mod,/subscriptionSchedules\.create/);
 assert.match(mod,/subscriptionSchedules\.update/);
 assert.match(mod,/modular-schedule-configure:/);
 assert.doesNotMatch(mod,/checkout\.sessions\.create|subscriptions\.create\(/);
 assert.match(paid,/confirm_sales_assisted_checkout_payment/);
 assert.match(paid,/\.neq\("status", "converted"\)/);
 assert.match(paid,/payment-completed:\$\{session\.id\}/);
 assert.match(entitlement,/apply_sales_offer_module_entitlements_v2/);
});
