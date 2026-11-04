import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  loadSalesModularProposalData,saveSalesModularScenario,selectSalesModularScenario,
  renameSalesModularScenario,archiveSalesModularScenario
} from '../src/services/salesModularProposalPersistence';

const lead='lead/with ?spaces',simulation='scenario/?with spaces';
const base='/api/owner/sales/leads/'+encodeURIComponent(lead);
const key='task-04-key';
test('three initial reads only: catalog, new proposal assumptions and paginated scenarios',async()=>{
  const calls:any[]=[];const request=async(url:string,init?:RequestInit)=>{calls.push({url,init});return {url};};
  const data=await loadSalesModularProposalData(request,lead);
  assert.deepEqual(calls.map(x=>x.url),[
    '/api/owner/sales/pricing-catalogs?compact=1',
    '/api/owner/sales/profitability-assumptions?context=new_proposal',
    base+'/modular-simulations?page=1&pageSize=50'
  ]);
  assert.equal(data.length,3);assert.equal(calls.length,3);
  assert.ok(calls.every(x=>x.init===undefined));
});
test('Salvar preserves exact modules, prices, conditions and idempotency header without re-pricing',async()=>{
  const snapshot={
    proposalMode:'modular',catalogVersionId:'catalog-id',assumptionSetId:'assumption-id',
    scenarioName:'Cenário',input:{patientQuantity:51,exactPerPatientBilling:true,
      lines:[{itemKey:'clinical_core',offerDiscount:{discountedPriceCents:12345}}],
      offerValidityDays:14,trialDays:7,onboardingInstallments:1},
    internalJustification:'',approveCommercialException:false,
    commercialExceptionConfirmed:false,commercialExceptionType:'margin_policy_override',
    internalNotes:'interno',publicNotes:'público'
  };
  const calls:any[]=[];const request=async(url:string,init?:RequestInit)=>{
    calls.push({url,init});return {simulation:{id:simulation,results_snapshot:{frozen:true}}};
  };
  const result=await saveSalesModularScenario(request,lead,key,snapshot);
  assert.equal(calls.length,1);assert.equal(calls[0].url,base+'/modular-simulations');
  assert.equal(calls[0].init.method,'POST');
  assert.deepEqual(calls[0].init.headers,{'X-Idempotency-Key':key});
  assert.equal(calls[0].init.body,JSON.stringify(snapshot));
  assert.equal(result.simulation.results_snapshot.frozen,true);
});
test('selection, renaming and archiving preserve distinct paths and bodies',async()=>{
  const calls:any[]=[];const request=async(url:string,init?:RequestInit)=>{calls.push({url,init});return {success:true};};
  await selectSalesModularScenario(request,lead,simulation);
  await renameSalesModularScenario(request,lead,simulation,'Novo nome');
  await archiveSalesModularScenario(request,lead,simulation);
  assert.deepEqual(calls.map(x=>x.url),[
    base+'/simulations/'+encodeURIComponent(simulation)+'/select',
    base+'/modular-simulations/'+encodeURIComponent(simulation),
    base+'/modular-simulations/'+encodeURIComponent(simulation)
  ]);
  assert.deepEqual(calls.map(x=>x.init.method),['POST','PATCH','PATCH']);
  assert.deepEqual(calls.map(x=>JSON.parse(x.init.body)),[
    {},{action:'rename',scenarioName:'Novo nome'},{action:'archive'}
  ]);
});
test('server conflict/error propagates once with no retries or state changes',async()=>{
  let calls=0;const request=async()=>{calls++;throw Object.assign(new Error('PROPOSAL_SNAPSHOT_CONFLICT'),{code:'PROPOSAL_SNAPSHOT_CONFLICT'});};
  await assert.rejects(saveSalesModularScenario(request,lead,key,{}),{code:'PROPOSAL_SNAPSHOT_CONFLICT'});
  assert.equal(calls,1);
});
