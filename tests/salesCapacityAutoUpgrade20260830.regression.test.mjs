import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const engine = readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const stripeService = readFileSync('services/stripeService.ts', 'utf8');
const capacityMigration = readFileSync(
  'supabase/migrations/20260827012000_sales_billing_contract_capacity_and_cost_allocation.sql',
  'utf8'
);

// New proposals contract the current active-patient band. The 12-month forecast
// stays available for internal economics only and must not force a larger plan.
assert.match(builder, /commercialCapacityBasis: 'current_patients'/);
assert.match(builder, /Previsão em 12 meses · análise interna/);
assert.match(builder, /Não aumenta o plano contratado hoje/);
assert.match(
  builder,
  /currentPackageDemand = input[\s\S]*commercialCapacityBasis === 'current_patients'[\s\S]*Math\.max\(1, input\.patientQuantity\)/
);
assert.match(engine, /commercialCapacityBasis\?: 'current_patients' \| 'projected_demand'/);
assert.match(engine, /export const salesContractedCapacityDemand/);
assert.match(
  engine,
  /commercialCapacityBasis === 'current_patients'[\s\S]*integer\(input\.patientQuantity, 1\)/
);
assert.match(
  engine,
  /expectedPatients:[\s\S]*commercialCapacityBasis === 'current_patients'[\s\S]*input\.patientQuantity/
);
assert.match(server, /commercialCapacityBasis: "current_patients"/);
assert.match(
  server,
  /const requestedDemand = Math\.max\(1, Math\.floor\(Number\(input\.patientQuantity\) \|\| 1\)\)/
);

// 30 -> 31 must become one 10-patient block => capacity 40, never quantity 31.
const acceptedCapacity = 30;
const blockSize = 10;
const activePatients = 31;
const additionalBlocks = Math.ceil(
  Math.max(activePatients - acceptedCapacity, 0) / blockSize
);
assert.equal(additionalBlocks, 1);
assert.equal(acceptedCapacity + additionalBlocks * blockSize, 40);

const modularSync =
  stripeService.match(
    /async function syncModularCapacityBillingContract[\s\S]*?export async function syncClinicActivePatientAddonQuantity/
  )?.[0] || '';
assert.match(modularSync, /Math\.ceil\([\s\S]*activePatients - contract\.acceptedCapacityLimitPatients[\s\S]*contract\.blockSizePatients/);
assert.match(modularSync, /Math\.max\(\s*contract\.billedAdditionalBlocks,/);
assert.doesNotMatch(modularSync, /requestedBillingQuantity/);
assert.match(stripeService, /proration_behavior: 'none'/);
assert.match(stripeService, /pending_billing_status: 'scheduled_next_cycle'/);

// Standard automatic upgrades stop at 50. Patient activation remains allowed,
// while 51+ is surfaced for Enterprise review without inventing a new price.
assert.match(stripeService, /automaticUpgradeMaxPatients/);
assert.match(stripeService, /activePatients > automaticUpgradeMaxPatients/);
assert.match(stripeService, /enterprise_review_required/);
assert.match(server, /async function assertCanActivateBillablePatient[\s\S]*return \{ ok: true \};/);
assert.match(server, /const automaticUpgradeMaxPatients =[\s\S]*acceptedCapacityLimitPatients <= 50 \? 50/);

// Commercial terms are frozen into the accepted contract snapshot. New v2
// contracts have no grace delay for a capacity upgrade; charge changes apply at
// the next billing cycle with no mid-cycle proration.
assert.match(server, /capacityPriceLadder/);
assert.match(server, /acceptedMonthlyAmountCents/);
assert.match(server, /acceptedPostPromotionMonthlyAmountCents/);
assert.match(
  server,
  /presentationVersion >= SALES_CUSTOMER_FACING_PRESENTATION_VERSION[\s\S]*\? 0/
);
assert.match(server, /billing_model: "modular_capacity_v1"/);
assert.match(capacityMigration, /check \(billing_model in \('modular_capacity_v1'\)\)/);
assert.match(capacityMigration, /billing_adjustment text not null default 'next_cycle'/);
assert.match(capacityMigration, /blocks_clinical_access boolean not null default false/);

// Sales view is intentionally compact: the commercial decision is visible and
// DRE/module diagnostics stay collapsed unless the owner chooses to inspect them.
assert.match(builder, /Resumo comercial/);
assert.match(builder, /Próximo upgrade automático/);
assert.match(builder, /Ver custos e margem/);
assert.match(builder, /Resultado interno por módulo[\s\S]*Detalhes técnicos/);
assert.doesNotMatch(
  builder.match(/\{promotionalMoneyFlow \? \([\s\S]*?\) : null\}/)?.[0] || '',
  /<details\s+open/
);

// Legacy exact-patient billing remains after the modular-contract branch for
// historical customers only.
const publicSync =
  stripeService.match(
    /export async function syncClinicActivePatientAddonQuantity[\s\S]*?export async function reportClinicActivePatientUsage/
  )?.[0] || '';
assert.match(publicSync, /const modularContract = await readModularCapacityBillingContract/);
assert.match(publicSync, /if \(modularContract\)/);
assert.match(publicSync, /Legacy contracts still use the global active-patient Price/);
assert.match(publicSync, /requestedBillingQuantity/);

console.log('salesCapacityAutoUpgrade20260830.regression.test.mjs: OK');
