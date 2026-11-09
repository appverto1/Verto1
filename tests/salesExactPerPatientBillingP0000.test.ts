import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateSalesModularProposal } from '../src/utils/salesModularProposal';
import { buildFrozenStripeCheckoutPlan, DEFAULT_CUSTOM_CAPACITY_POLICY } from '../src/utils/salesCommercialEvolution';
import { modularAssumptionsFixture, modularCatalogFixture, proposalInputFixture, PACKAGE_TIERS } from './fixtures/salesModularFixture';
import { DEFAULT_SALES_PROFITABILITY_POLICY } from '../src/utils/salesModularEconomics';

const rates = [
  ['clinical_core', 1000],
  ['appointments_communication', 1000],
  ['financial_management', 1000]
] as const;
const core = structuredClone(modularCatalogFixture.items[0]);
const modules = rates.slice(1).map(([itemKey], index) => ({
  ...structuredClone(core),
  id: 'p0000-module-' + index,
  itemKey,
  publicName: itemKey === 'financial_management' ? 'Financeiro' : 'Agenda',
  internalName: itemKey,
  pricingMode: 'flat_monthly' as const,
  isRequired: false,
  tiers: [],
  recurringAmountCents: 1000,
  costModel: null
}));
const catalog = {
  ...structuredClone(modularCatalogFixture),
  customCapacityPolicy: structuredClone(DEFAULT_CUSTOM_CAPACITY_POLICY),
  hasVersionedCustomCapacityPolicy: true,
  profitabilityPolicy: structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
  hasVersionedProfitabilityPolicy: true,
  items: [core, ...modules]
};
for (const patients of [1, 2, 10, 40, 49, 50, 51, 100, 101, 150, 151]) {
  const capacity = Math.ceil(patients / 50) * 50;
  const input = {
    ...proposalInputFixture(patients, PACKAGE_TIERS.custom.id, capacity, null),
    exactPerPatientBilling: true,
    commercialPricingMode: 'manual_module_prices' as const,
    commercialCapacityBasis: 'current_patients' as const,
    customCapacitySelectionMode: 'automatic' as const,
    expectedPatientQuantity12Months: patients,
    offerStartsAt: '2026-07-28T00:00:00.000Z',
    lines: rates.map(([itemKey, unit]) => ({
      itemKey,
      tierId: itemKey === 'clinical_core' ? PACKAGE_TIERS.custom.id : null,
      quantity: patients,
      itemDiscountBasisPoints: 0,
      pricingEditMode: 'per_patient' as const,
      proposedPricePerPatientCents: unit,
      customRecurringAmountCents: null
    }))
  };
  const result = calculateSalesModularProposal(input, catalog, modularAssumptionsFixture);
  assert.equal(result.commercialPricing.totalProposedPricePerPatientCents, 3000);
  assert.equal(result.promotionalRecurringRevenueCents, patients * 3000, 'monthly exact total at ' + patients);
  assert.ok(result.commercialPricing.capacityBlockPhases.length > 0, 'commercial phases must calculate at ' + patients);
  assert.equal(result.commercialPricing.capacityBlockPhases[0].contractedCapacityPatients, capacity, 'technical capacity at ' + patients);
  assert.equal(result.commercialPricing.capacityBlockPhases[0].contractedMonthlyRevenueCents, patients * 3000, 'phase revenue bills active patients, not technical capacity at ' + patients);
  for (const [itemKey, unit] of rates) {
    const line = result.lines.find((line) => line.itemKey === itemKey);
    assert.ok(line, itemKey);
    assert.equal(line?.grossRecurringRevenueCents, patients * unit, itemKey + ' at ' + patients);
  }
  const phases = result.commercialPhases.map((phase) => ({
    ...phase,
    lines: phase.lines.filter((line) => rates.some(([key]) => key === line.itemKey))
  }));
  const checkout = buildFrozenStripeCheckoutPlan({
    phases,
    capacity: result.basePackage.capacity,
    exactPerPatientBilling: true,
    patientQuantity: patients,
    effectiveAt: phases[0].startsAt
  });
  const recurring = checkout.initialLineItems.filter((line) => line.recurring);
  assert.equal(recurring.length, 3);
  assert.ok(recurring.every((line) => line.unitAmountCents === 1000 && line.quantity === patients));
  assert.equal(checkout.promotionalMonthlyCents, patients * 3000);
  assert.equal(checkout.initialAmountCents, patients * 3000);
  assert.ok(checkout.schedulePhases.every((phase) =>
    phase.items.every((line) => line.unitAmountCents === 1000 && line.quantity === patients)
  ));
}
for (const qty of [1, 40, 50, 51, 100, 101]) {
  const monthly = qty * 3000;
  assert.equal((qty + 1) * 3000 - monthly, 3000);
  assert.equal(monthly - (qty - 1) * 3000, 3000);
}
const legacyCheckout = buildFrozenStripeCheckoutPlan({
  phases: [{ phaseNumber: 1, startsAt: '2026-07-28T00:00:00.000Z', endsAt: null,
    lines: [{ itemKey: 'clinical_core', publicName: 'Verto Clínica', billingInterval: 'monthly',
      activePriceCents: 40000 }],
    recurringRevenueCents: 40000, invoiceAmountCents: 40000 }] as any,
  effectiveAt: '2026-07-28T00:00:00.000Z'
});
assert.equal(legacyCheckout.initialLineItems[0].unitAmountCents, 40000);
assert.equal(legacyCheckout.initialLineItems[0].quantity, undefined);
const stripeService = fs.readFileSync('services/stripeService.ts','utf8');
const exact = stripeService.slice(stripeService.indexOf('async function syncExactPerPatientBillingContract'),
  stripeService.indexOf('async function syncModularCapacityBillingContract'));
assert.match(exact, /subscriptionSchedules\.update/);
assert.match(exact, /subscriptions\.update/);
assert.match(exact, /proration_behavior: 'none'/);
assert.match(exact, /quantity: activePatients/);
assert.doesNotMatch(exact, /Math\.max\(contract\.billedAdditionalBlocks/);
assert.match(exact, /EXACT_PER_PATIENT_SUBSCRIPTION_SCOPE_INVALID/);
assert.match(exact, /EXACT_PER_PATIENT_STRIPE_ITEMS_MISMATCH/);
const server = fs.readFileSync('server.ts', 'utf8');
assert.match(server, /exactPerPatientBilling: source\.exactPerPatientBilling === true/);
assert.match(fs.readFileSync('services/salesModularCheckoutCore.ts', 'utf8'), /quantity: Number\(line\.quantity \|\| 1\)/);
assert.match(fs.readFileSync('services/salesModularSubscriptionSchedule.ts', 'utf8'), /quantity: Number\(item\.quantity \|\| 1\)/);
assert.match(server, /billingModelVersion: frozenResults\?\.input\?\.exactPerPatientBilling/);
const builder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx','utf8');
assert.match(builder, /exactPerPatientBilling: true/);
console.log('salesExactPerPatientBillingP0000.test.ts: PASS');
