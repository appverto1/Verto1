import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const builder=readFileSync('src/components/SalesModularProposalBuilder.tsx','utf8');
const transport=readFileSync('src/services/salesPublicOfferLinks.ts','utf8');
const legacy=readFileSync('src/components/SalesProfitabilitySimulator.tsx','utf8');
test('a different historical selection cannot retain a link from previous offer after API success',()=>{
  const select=builder.split('const selectSimulation = async')[1]?.split('const renameSimulation = async')[0]||'';
  assert.ok(select.indexOf('await selectSalesModularScenario(')>=0);
  assert.ok(select.indexOf('setPreparedOffer(null)')>select.indexOf('await selectSalesModularScenario('));
  assert.ok(select.indexOf('setSelectedSimulationId(simulation.id)')>select.indexOf('setPreparedOffer(null)'));
  assert.match(select,/simulation\.id !== selectedSimulationId/);
  assert.match(select,/setCheckoutLink\(null\)/);
  assert.match(select,/setOfferAccepted\(false\)/);
  const archive=builder.split('const archiveSimulation = async')[1]?.split('const duplicateSimulation = ')[0]||'';
  assert.match(archive,/if \(selectedSimulationId === simulationId\) \{[\s\S]*?setPreparedOffer\(null\)/);
});
test('historic snapshots stay frozen and public copy never uses a locally constructed token',()=>{
  assert.match(builder,/const activeOfferId =\s*preparedOffer\?\.offer\?\.id \|\| selectedSimulation\?\.offer\?\.id \|\| ''/);
  assert.match(builder,/selectedSimulation\?\.results_snapshot \|\| preview/);
  assert.match(builder,/selectedSimulation\?\.modular_input_snapshot \|\| calculationInput/);
  assert.match(builder,/selectedSimulation\?\.offer\s*\? 'Recuperar proposta pública'/);
  assert.match(builder,/preparedOffer\?\.publicUrl/);
  assert.match(builder,/copySalesPublicOfferUrl\(url,/);
  assert.match(builder,/Copiar link da proposta pública/);
  assert.match(builder,/const generateCheckoutLink = async/);
  assert.match(legacy,/const copyPublicUrl = async/);
  assert.doesNotMatch(transport,/getSupabase|\bfetch\s*\(|checkout|Stripe|window\.|localStorage/);
});
test('create/recover uses contract email frozen on server and only updates after successful request',()=>{
  const prepare=builder.split('const prepareOffer = async')[1]?.split('const activeOfferId =')[0]||'';
  assert.match(prepare,/!isValidContractEmail\(frozenContractEmail\)/);
  assert.match(prepare,/contractEmail: frozenContractEmail/);
  assert.match(prepare,/requestKey\('modular-offer'\)/);
  assert.ok(prepare.indexOf('setPreparedOffer(data)')>prepare.indexOf('await prepareSalesPublicOffer('));
  assert.match(prepare,/onOfferPrepared\?\.\(lead\.id, data\.offer\)/);
});
