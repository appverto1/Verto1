import assert from 'node:assert/strict';
import { syncExactPerPatientBillingContract } from '../services/stripeService';

const moduleKeys = ['clinical_core', 'appointments_communication', 'financial_management'];
let currentQuantity = 40;
let scheduleId: string | null = null;
const changes: Array<{target: number; via: string}> = [];
const writes: Array<{table: string; patch: any}> = [];
const makeItems = () => moduleKeys.map((key, index) => ({
  id: 'si_' + key,
  quantity: currentQuantity,
  price: {
    id: 'price_' + key,
    unit_amount: 1000,
    recurring: {interval: 'month'},
    product: {
      id: 'prod_' + index,
      metadata: {revenue_line: key, billing_model: 'modular_exact_per_patient_v1'}
    }
  }
}));
let subscription: any = {
  id: 'sub_p0000_mock',
  status: 'active',
  metadata: {flowType:'sales_modular_assisted',offerId:'offer_p0000'},
  items: {data: makeItems()},
  schedule: null
};
const refresh = () => {
  subscription = {...subscription, schedule: scheduleId, items:{data:makeItems()}};
  return subscription;
};
const supabase: any = {
  from(table: string){
    return {
      update(patch: any) {
        return {
          eq(_key: string,_id: string) {
            writes.push({table,patch});
            return Promise.resolve({error:null});
          }
        };
      }
    };
  }
};
let phaseData = [
  {start_date:1700000000,end_date:1800000000,items:makeItems().map((it)=>({price:it.price,quantity:currentQuantity})),metadata:{phase:'first'}},
  {start_date:1800000000,end_date:1900000000,items:makeItems().map((it)=>({price:it.price,quantity:currentQuantity})),metadata:{phase:'second'}}
];
const stripe: any = {
  subscriptions: {
    async update(id: string, opts: any) {
      assert.equal(id,subscription.id);
      assert.equal(opts.proration_behavior,'none');
      assert.equal(opts.items.length,3);
      const quantities=new Set(opts.items.map((item:any)=>item.quantity));
      assert.equal(quantities.size,1);
      currentQuantity=opts.items[0].quantity;
      changes.push({target:currentQuantity,via:'subscription'});
      return refresh();
    },
    async retrieve(){return refresh();}
  },
  subscriptionSchedules: {
    async retrieve(){
      return {
        id:scheduleId,status:'active',subscription:subscription.id,
        end_behavior:'release',metadata:{flowType:'sales_modular_assisted'},
        current_phase:{start_date:1700000000,end_date:1800000000},
        phases:phaseData
      };
    },
    async update(_id: string,params: any){
      assert.equal(params.proration_behavior,'none');
      assert.equal(params.phases.length,2);
      const quantities=params.phases.flatMap((phase:any)=>phase.items.map((item:any)=>item.quantity));
      assert.ok(quantities.every((quantity:any)=>quantity===quantities[0]));
      currentQuantity=quantities[0];
      changes.push({target:currentQuantity,via:'schedule'});
      phaseData=params.phases.map((phase:any)=>({...phase,items:phase.items.map((item:any)=>({
        ...item,price:makeItems().find((x)=>x.price.id===item.price)?.price
      }))}));
      refresh();
      return {id:scheduleId};
    }
  }
};
const contract: any = {
  id:'contract_p0000',
  organizationId:'clinic_p0000',
  salesOfferId:'offer_p0000',
  stripeSubscriptionId:subscription.id,
  stripeScheduleId:null,
  sourceSnapshot:{
    billingModelVersion:'modular_exact_per_patient_v1',
    exactRecurringModuleKeys:moduleKeys
  }
};
const sync = async (target: number) => syncExactPerPatientBillingContract({
  supabase,stripe,contract,clinicId:'clinic_p0000',
  subscription:refresh(),activePatients:target,
  trigger:'test',logger:{log(){},warn(){},error(){}}
});
let result=await sync(41);
assert.equal(result.billableQuantity,41);
assert.deepEqual(changes,[{target:41,via:'subscription'}]);
assert.equal(writes.findLast((x)=>x.table==='clinics')?.patch.pending_billing_quantity,41);
result=await sync(40);
assert.equal(result.billableQuantity,40);
assert.deepEqual(changes,[{target:41,via:'subscription'},{target:40,via:'subscription'}]);
await sync(40);
assert.equal(changes.length,2,'idempotent repeat may not generate new Stripe writes');
await sync(0);
assert.equal(currentQuantity,0,'no patients means no patient charge');
assert.equal(changes.at(-1)?.target,0);
scheduleId='sub_sched_p0000';
currentQuantity=40;
refresh();
result=await sync(39);
assert.equal(result.billableQuantity,39);
assert.equal(changes.at(-1)?.via,'schedule');
assert.equal(currentQuantity,39);
const before=changes.length;
await assert.rejects(
  () => syncExactPerPatientBillingContract({
    supabase,stripe,contract:{...contract,salesOfferId:'wrong_offer'},
    clinicId:'clinic_p0000',subscription:refresh(),activePatients:40,
    trigger:'scope-test',logger:{log(){},warn(){},error(){}}
  }),
  /EXACT_PER_PATIENT_SUBSCRIPTION_SCOPE_INVALID/
);
assert.equal(changes.length,before,'scope mismatch must never touch Stripe');
const extra={...subscription,items:{data:[...makeItems(),{id:'si_extra',quantity:39,price:{
  recurring:{interval:'month'},product:{metadata:{revenue_line:'other'}}}}]}};
await assert.rejects(
  () => syncExactPerPatientBillingContract({
    supabase,stripe,contract,clinicId:'clinic_p0000',subscription:extra,activePatients:40,
    trigger:'extra-test',logger:{log(){},warn(){},error(){}}
  }),
  /EXACT_PER_PATIENT_STRIPE_ITEMS_MISMATCH/
);
assert.equal(changes.length,before,'unrecognized Stripe items must not be mutated');
console.log('salesExactPerPatientStripeQuantityP0000.test.ts: PASS');