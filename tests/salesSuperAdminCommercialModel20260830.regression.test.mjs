import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const assumptions = readFileSync('src/components/SalesFinancialAssumptionsPanel.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const engine = readFileSync('src/utils/salesModularProposal.ts', 'utf8');

for (const itemKey of [
  'clinical_core',
  'appointments_communication',
  'financial_management',
  'insurance_tiss',
  'school_management'
]) {
  assert.match(builder, new RegExp(`'${itemKey}'`));
  assert.match(server, new RegExp(`"${itemKey}"`));
}

assert.match(builder, /SALES_PATIENT_CAPACITY_BLOCKS = \[10, 20, 30, 40, 50\]/);
assert.match(server, /SALES_STANDARD_PATIENT_CAPACITY_BLOCKS = new Set\(\[\s*10,\s*20,\s*30,\s*40,\s*50,/);
assert.match(builder, /Enterprise/);
assert.match(server, /PROPOSAL_CAPACITY_BLOCK_INVALID/);
assert.match(server, /contractedCapacity > 50/);
assert.match(server, /contractedCapacity < requestedDemand/);

assert.match(builder, /SALES_HEALTHY_MODULE_MARGIN_BASIS_POINTS = 7000/);
assert.match(builder, /SALES_ATTENTION_MODULE_MARGIN_BASIS_POINTS = 5000/);
assert.match(builder, /border-emerald-200/);
assert.match(builder, /border-amber-200/);
assert.match(builder, /border-rose-200/);
assert.match(builder, /Semáforo de margem por módulo/);

assert.match(builder, /platformFoundationPricingMode: 'manual'/);
assert.match(builder, /platformFoundationMonthlyAmountCents: 0/);
assert.doesNotMatch(builder, /SALES_PLATFORM_FOUNDATION_PUBLIC_NAME/);
assert.doesNotMatch(builder, /Fundação Verto/);
assert.match(builder, /Custos compartilhados da plataforma/);
assert.match(builder, /não são vendidos como módulo/);

assert.match(server, /isSalesCustomerFacingModuleItemKey/);
assert.match(server, /PROPOSAL_ITEM_NOT_CUSTOMER_FACING/);
assert.match(server, /platformFoundationPricingMode: "manual"/);
assert.match(server, /platformFoundationMonthlyAmountCents: 0/);
assert.doesNotMatch(server, /PROPOSAL_CLINICAL_CORE_REQUIRED/);
assert.match(server, /recurringCustomerLines[\s\S]*clinical_core[\s\S]*recurringCustomerLines\[0\]/);

for (const key of [
  'meiDasMonthlyCents',
  'stripeFeeBasisPoints',
  'stripeFixedFeeCents',
  'supabaseMonthlyCostCents',
  'railwayMonthlyCostCents',
  'currentOperatingMarginTargetBasisPoints'
]) {
  assert.match(assumptions, new RegExp(`key: '${key}'`));
}
assert.doesNotMatch(assumptions, /36[,.]05/);
assert.doesNotMatch(assumptions, /\b3605\b/);

// Compatibilidade histórica: o motor continua conhecendo a Fundação para
// reabrir snapshots antigos; apenas novas propostas customer-facing a zeram.
assert.match(engine, /SALES_PLATFORM_FOUNDATION_ITEM_KEY/);
assert.match(engine, /SALES_PLATFORM_FOUNDATION_PUBLIC_NAME/);

console.log('salesSuperAdminCommercialModel20260830.regression.test.mjs: OK');
