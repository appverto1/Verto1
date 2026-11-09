import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const builder=readFileSync('src/components/SalesModularProposalBuilder.tsx','utf8');
const transport=readFileSync('src/services/salesModularProposalPersistence.ts','utf8');
test('Salvar is authority and frozen selection retains original snapshots without optimistic updates',()=>{
  const save=builder.split('const saveSimulation = async () => {')[1]?.split('const selectSimulation = async')[0]||'';
  assert.match(save,/if \(!hasValidVersionedProfitabilityPolicy\)/);
  assert.match(save,/requestKey\('modular-simulation'\)/);
  assert.match(save,/saveSalesModularScenario\(/);
  assert.ok(save.indexOf('await saveSalesModularScenario(')<save.indexOf('setSimulations('));
  assert.match(save,/data\.simulation/);
  assert.match(builder,/selectedSimulation\?\.results_snapshot \|\| preview/);
  assert.match(builder,/selectedSimulation\?\.modular_input_snapshot \|\| calculationInput/);
  assert.match(builder,/selectedSimulation\.assumptions_snapshot \|\| null/);
  assert.match(builder,/summaryPreview\.postPromotionRecurringRevenueCents/);
  assert.match(builder,/selectedSimulation\.modular_input_snapshot\?\.exactPerPatientBilling !== true/);
});
test('transport cannot bypass auth, duplicate fetch, touch checkout or replace server pricing',()=>{
  assert.match(builder,/getSupabase/);
  assert.match(builder,/credentials: 'include'/);
  assert.match(builder,/Authorization: `Bearer \$\{session\.access_token\}`/);
  assert.match(builder,/const prepareOffer = async/);
  assert.match(builder,/const generateCheckoutLink = async/);
  assert.doesNotMatch(transport,/\bfetch\s*\(|getSupabase|Stripe|checkout|calculateSalesModularProposal/);
  assert.match(builder,/loadSalesModularProposalData\(authenticatedFetch, lead\.id\)/);
});
