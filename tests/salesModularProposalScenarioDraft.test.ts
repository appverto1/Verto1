import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSalesModularProposalDuplicateDraft} from '../src/utils/salesModularProposalScenarioDraft';
import type {SalesModularProposalInput, SalesModularProposalResult, SalesPricingCatalogSnapshot} from '../src/utils/salesModularProposal';

const tier=(id:string,maximumQuantity:number|null,isCustom=false)=>({
  id,minimumQuantity:1,maximumQuantity,isCustom,sortOrder:1,recurringAmountCents:15000,
});
const catalog={
  items:[
    {itemKey:'clinical_core',tiers:[tier('legacy-core',50),tier('modern-core',null,true)],billingInterval:'monthly',recurringAmountCents:19000},
    {itemKey:'appointments_communication',tiers:[tier('legacy-module',50),tier('modern-module',null,true)],billingInterval:'monthly',recurringAmountCents:10000},
    {itemKey:'insurance_tiss',tiers:[tier('one-time',null)],billingInterval:'one_time',recurringAmountCents:0},
  ],
} as unknown as SalesPricingCatalogSnapshot;
const initialInput={
  patientQuantity:75,
  exactPerPatientBilling:true,
  basePackageTierId:'legacy-core',
  basePackageSelectionMode:'automatic',
  customBasePackageLimit:75,
  trialDays:7,
  platformFoundationPricingMode:'catalog',
  platformFoundationMonthlyAmountCents:5000,
  commercialPricingMode:'catalog',
  usageProfile:'usual',
  driverOverrides:{historic:1},
  lines:[
    {itemKey:'clinical_core',tierId:'legacy-core',quantity:75},
    {itemKey:'appointments_communication',tierId:'legacy-module',quantity:75,pricingEditMode:'monthly_total',customRecurringAmountCents:12000},
    {itemKey:'insurance_tiss',tierId:'one-time',quantity:1},
    {itemKey:'platform_foundation',tierId:null,quantity:1},
    {itemKey:'onboarding',tierId:null,quantity:1},
  ],
} as unknown as SalesModularProposalInput;
const stored={
  modular_input_snapshot:initialInput,
  results_snapshot:{basePackage:{limitQuantity:75}} as unknown as SalesModularProposalResult,
};

test('duplicate produces a new editable scenario without changing any historical input or result snapshot',()=>{
  const originalInput=JSON.stringify(stored.modular_input_snapshot);
  const originalResult=JSON.stringify(stored.results_snapshot);
  const draft=buildSalesModularProposalDuplicateDraft(stored,catalog);
  assert.notEqual(draft,initialInput);
  assert.notEqual(draft.lines,initialInput.lines);
  assert.equal(JSON.stringify(stored.modular_input_snapshot),originalInput);
  assert.equal(JSON.stringify(stored.results_snapshot),originalResult);
  assert.equal(draft.trialDays,7);
  assert.equal(draft.patientQuantity,75);
  assert.equal(draft.commercialPricingMode,'manual_module_prices');
  assert.equal(draft.commercialCapacityBasis,'current_patients');
  assert.equal(draft.platformFoundationPricingMode,'manual');
  assert.equal(draft.platformFoundationMonthlyAmountCents,0);
  assert.equal(draft.usageProfile,'intensive');
  assert.deepEqual(draft.driverOverrides,{});
  assert.equal(draft.basePackageTierId,'modern-core');
  assert.equal(draft.basePackageSelectionMode,'manual');
  assert.equal(draft.customBasePackageLimit,100);
  assert.equal(draft.customCapacityBlocks,null);
  assert.equal(draft.customCapacitySelectionMode,'automatic');
  assert.deepEqual(draft.lines.map(x=>x.itemKey),['clinical_core','appointments_communication','insurance_tiss']);
  assert.equal(draft.lines[0].tierId,'modern-core');
  assert.equal(draft.lines[1].tierId,'modern-module');
  assert.equal(draft.lines[1].customRecurringAmountCents,12000);
  assert.equal(draft.lines[2].tierId,'one-time');
});

test('duplicate retains explicit per-patient pricing and does not mutate old scenario',()=>{
  const perPatientInput={
    ...initialInput,
    lines:[{itemKey:'appointments_communication',tierId:'legacy-module',quantity:75,
      pricingEditMode:'per_patient' as const,proposedPricePerPatientCents:250,
      customRecurringAmountCents:888}],
  };
  const scenario={...stored,modular_input_snapshot:perPatientInput};
  const source=JSON.stringify(scenario);
  const result=buildSalesModularProposalDuplicateDraft(scenario,catalog);
  assert.equal(result.lines[0].pricingEditMode,'per_patient');
  assert.equal(result.lines[0].proposedPricePerPatientCents,250);
  assert.equal(result.lines[0].customRecurringAmountCents,888);
  assert.equal(JSON.stringify(scenario),source);
});

test('missing catalog does not authorize a different tenant or silently mutate frozen history',()=>{
  const original=JSON.stringify(stored);
  const result=buildSalesModularProposalDuplicateDraft(stored,null);
  assert.equal(result.basePackageTierId,'legacy-core');
  assert.equal(result.basePackageSelectionMode,'automatic');
  assert.equal(result.customBasePackageLimit,null);
  assert.equal(JSON.stringify(stored),original);
});
