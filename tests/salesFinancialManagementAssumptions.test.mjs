import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/SalesFinancialAssumptionsPanel.tsx', 'utf8');
const profitability = readFileSync('src/utils/salesProfitability.ts', 'utf8');
const modular = readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');

for (const label of [
  'Tarifa percentual da Stripe',
  'Tarifa fixa da Stripe por cobrança',
  'Inadimplência estimada',
  'Estornos e chargebacks',
  'Impostos sobre o lucro',
  'Depreciação e amortização',
  'Despesas financeiras',
  'Outras despesas corporativas não atribuídas'
]) {
  assert.match(panel, new RegExp(label), `premissa visível ausente: ${label}`);
}

assert.match(panel, /DRE gerencial, perdas e lucro líquido/);
assert.match(server, /refundChargebackBasisPoints/);
assert.match(profitability, /refundChargebackCents/);
assert.match(profitability, /const preTaxIncomeCents/);
assert.match(profitability, /Math\.max\(0, preTaxIncomeCents\)/);
assert.match(modular, /refundChargebackPercentageBasisPoints/);
assert.match(modular, /const totalPreTaxIncome/);
assert.match(modular, /Math\.max\(0, totalPreTaxIncome\)/);

console.log('salesFinancialManagementAssumptions.test.mjs: ok');
