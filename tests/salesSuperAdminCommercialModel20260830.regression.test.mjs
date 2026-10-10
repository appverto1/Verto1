import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const assumptions = readFileSync('src/components/SalesFinancialAssumptionsPanel.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const engine = readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const catalogPanel = readFileSync('src/components/SalesPricingCatalogPanel.tsx', 'utf8');
const stripeService = readFileSync('services/stripeService.ts', 'utf8');

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

assert.match(builder, /SALES_ESSENTIAL_PATIENT_LIMIT = 50/);
assert.match(builder, /SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS = 50/);
assert.match(builder, /Math\.ceil\(demand \/ SALES_ENTERPRISE_BLOCK_SIZE_PATIENTS\)/);
assert.match(builder, /Enterprise/);
assert.match(builder, /Plano Essencial · 1 a 50 pacientes/);
// Historical capacity offers keep their original selector; new exact offers use 50-seat bands.
assert.match(builder, /input\.exactPerPatientBilling === true \? \(/);
assert.match(builder, /SALES_PATIENT_CAPACITY_BLOCKS = \[10, 20, 30, 40, 50\]/);
assert.match(builder, /if \(input\.exactPerPatientBilling !== true\) return input/);
const exactPanelStart = builder.indexOf('                {input.exactPerPatientBilling === true ? (');
const exactCapacityPanel = builder.slice(exactPanelStart, builder.indexOf('                ) : (', exactPanelStart));
assert.doesNotMatch(exactCapacityPanel, /10, 20, 30, 40 ou 50 pacientes/);
assert.match(engine, /blockSizePatients:\s*exactPerPatientBilling\s*\? 50/);
assert.match(engine, /input\.customBasePackageLimit % 50 !== 0/);
assert.match(engine, /contractedCapacityPatients \* proposedPricePerPatientCents/);
assert.match(engine, /contractedCapacityPatients: exactPerPatientBilling \? input\.patientQuantity : basePackageContractedLimit/);
assert.match(server, /PROPOSAL_CAPACITY_BLOCK_INVALID/);
assert.match(server, /contractedCapacity < requestedDemand/);
assert.match(catalogPanel, /Plano Essencial/);
assert.match(catalogPanel, /1 a 50 pacientes/);
assert.match(catalogPanel, /Enterprise 1/);
assert.match(catalogPanel, /51 a 100 pacientes/);
assert.match(catalogPanel, /Enterprise 2\+/);
assert.match(stripeService, /usesFrozenPerPatientCapacityBilling/);
assert.match(stripeService, /targetAdditionalPatients/);
assert.match(stripeService, /enterprise_review_required/);
assert.match(stripeService, /commercialPatientLimit/);

const commercialLimit = (patients) =>
  patients <= 50 ? 50 : Math.ceil(patients / 50) * 50;
assert.equal(commercialLimit(1), 50);
assert.equal(commercialLimit(50), 50);
assert.equal(commercialLimit(51), 100);
assert.equal(commercialLimit(100), 100);
assert.equal(commercialLimit(101), 150);
assert.equal(commercialLimit(150), 150);
assert.equal(commercialLimit(151), 200);

const frozenModulePricePerPatientCents = 3_000;
assert.equal(50 * frozenModulePricePerPatientCents, 150_000);
assert.equal(51 * frozenModulePricePerPatientCents, 153_000);
assert.equal(101 * frozenModulePricePerPatientCents, 303_000);

assert.match(builder, /SALES_HEALTHY_MODULE_MARGIN_BASIS_POINTS = 7000/);
assert.match(builder, /SALES_ATTENTION_MODULE_MARGIN_BASIS_POINTS = 5000/);
assert.match(builder, /normalizeBuilderInputForCalculation/);
assert.match(builder, /previewComputation/);
assert.match(builder, /proposalCalculationErrorMessage/);
assert.match(builder, /input: calculationInput/);
assert.doesNotMatch(
  builder,
  /try \{\s*return calculateSalesModularProposal\(input, catalog, assumptions\);\s*\} catch \{\s*return null;\s*\}/
);
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
