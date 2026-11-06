import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  SALES_PATIENT_CAPACITY_BLOCKS, SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS,
  isSalesFunctionalModuleItemKey, commercialCapacityForDemand,
  commercialPlanLabelForCapacity, commercialCapacityForExactDemand,
  itemTierForQuantity, selectionForItem, normalizeBuilderInputForCalculation
} from '../src/utils/salesModularProposalBuilderInput';
import type {SalesPricingCatalogSnapshot, SalesPricingCatalogItem, SalesModularProposalInput} from '../src/utils/salesModularProposal';

const tier=(id:string,min:number,max:number|null, custom=false)=>({
  id,minimumQuantity:min,maximumQuantity:max,sortOrder:min,isCustom:custom,
  recurringAmountCents:12000
});
const coreTier=tier('core-custom',1,null,true);
const firstTier=tier('small',1,50);
const secondTier=tier('large',51,100);
const core={itemKey:'clinical_core',billingInterval:'monthly',pricingMode:'package_limit',tiers:[coreTier],recurringAmountCents:12000};
const modules={itemKey:'appointments_communication',billingInterval:'monthly',pricingMode:'package_limit',tiers:[secondTier,firstTier],recurringAmountCents:14000};
const tiss={itemKey:'insurance_tiss',billingInterval:'one_time',pricingMode:'package_limit',tiers:[tier('tiss',1,200)],recurringAmountCents:0};
const catalog={items:[core,modules,tiss]} as unknown as SalesPricingCatalogSnapshot;
const line=(itemKey:string,fields:Record<string,unknown>={})=>({itemKey,tierId:null,quantity:0,...fields});
const makeInput=(values:Record<string,unknown>={})=>({
 exactPerPatientBilling:true,patientQuantity:51,basePackageTierId:'core-custom',
 customBasePackageLimit:80,commercialPricingMode:'manual_module_prices',
 lines:[line('clinical_core',{tierId:'wrong',quantity:1,proposedPricePerPatientCents:123.6,customRecurringAmountCents:77}),
        line('appointments_communication',{tierId:'small',quantity:5,pricingEditMode:'monthly_total',customRecurringAmountCents:999.7,proposedPricePerPatientCents:7}),
        line('insurance_tiss',{tierId:'tiss',quantity:100})],
 ...values,
}) as unknown as SalesModularProposalInput;

test('50-seat bands remain separate from legacy block limits and customer-facing modules',()=>{
 assert.deepEqual(SALES_PATIENT_CAPACITY_BLOCKS,[10,20,30,40,50]);
 assert.equal(SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS,50);
 assert.equal(commercialCapacityForDemand(45),50);
 assert.equal(commercialCapacityForDemand(51),null);
 for(const [demand,expected] of [[1,50],[50,50],[51,100],[100,100],[101,150],[151,200]])
   assert.equal(commercialCapacityForExactDemand(demand),expected);
 assert.equal(commercialPlanLabelForCapacity(50),'Plano Essencial · 1 a 50 pacientes');
 assert.equal(commercialPlanLabelForCapacity(100),'Enterprise 1 · 51 a 100 pacientes');
 for(const key of ['clinical_core','appointments_communication','financial_management','insurance_tiss','school_management'])
   assert.equal(isSalesFunctionalModuleItemKey(key),true);
 assert.equal(isSalesFunctionalModuleItemKey('platform_foundation'),false);
});

test('tier selection uses original sorted catalog tiers and legacy fallback',()=>{
 assert.equal(itemTierForQuantity(modules as SalesPricingCatalogItem,30)?.id,'small');
 assert.equal(itemTierForQuantity(modules as SalesPricingCatalogItem,51)?.id,'large');
 assert.equal(itemTierForQuantity(core as SalesPricingCatalogItem,999)?.id,'core-custom');
 assert.equal(selectionForItem(core as SalesPricingCatalogItem,51,coreTier as any,true,true).tierId,'core-custom');
 assert.equal(selectionForItem(tiss as SalesPricingCatalogItem,51,coreTier as any,false,false).quantity,100);
});

test('legacy snapshots remain exact same object without normalization',()=>{
 const input=makeInput({exactPerPatientBilling:false});
 assert.equal(normalizeBuilderInputForCalculation(input,catalog),input);
});

test('exact patient draft normalizes only proposed copy and preserves source snapshots',()=>{
 const input=makeInput();
 const source=JSON.stringify(input);
 const result=normalizeBuilderInputForCalculation(input,catalog);
 assert.notEqual(result,input);
 assert.equal(JSON.stringify(input),source,'input and previous historical snapshots must not mutate');
 assert.equal(result.customBasePackageLimit,100);
 assert.equal(result.lines[0].tierId,'core-custom');
 assert.equal(result.lines[0].quantity,51);
 assert.equal(result.lines[0].pricingEditMode,'per_patient');
 assert.equal(result.lines[0].proposedPricePerPatientCents,124);
 assert.equal(result.lines[0].customRecurringAmountCents,null);
 assert.equal(result.lines[1].tierId,'large');
 assert.equal(result.lines[1].quantity,51);
 assert.equal(result.lines[1].pricingEditMode,'monthly_total');
 assert.equal(result.lines[1].customRecurringAmountCents,1000);
 assert.equal(result.lines[1].proposedPricePerPatientCents,null);
 assert.equal(result.lines[2].quantity,100,'one-time insurance quantity remains untouched');
 assert.equal(result.lines[2].pricingEditMode,undefined);
});

test('missing catalog core or missing base tier do not rewrite an existing proposal',()=>{
 const input=makeInput();
 assert.equal(normalizeBuilderInputForCalculation(input,{items:[]} as unknown as SalesPricingCatalogSnapshot),input);
 const wrong=makeInput({basePackageTierId:'missing'});
 assert.equal(normalizeBuilderInputForCalculation(wrong,catalog),wrong);
});
