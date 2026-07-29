import assert from 'node:assert/strict';
import {
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  buildDiscountNotificationPlan,
  buildFrozenStripeCheckoutPlan,
  buildOfferCommercialPhases,
  calculateCustomCapacity,
  discountAppliesAt,
  normalizeOfferItemDiscount,
  validateCustomCapacityPolicy,
  validateDiscountStacking
} from '../src/utils/salesCommercialEvolution';
import { calculateSalesModularProposal } from '../src/utils/salesModularProposal';
import { PACKAGE_TIERS, modularAssumptionsFixture, modularCatalogFixture, proposalInputFixture } from './fixtures/salesModularFixture';

const capacity = (demand: number, selectedBlocks?: number) => calculateCustomCapacity({
  currentPatients: demand,
  expectedPatients: demand,
  baseLimitPatients: 150,
  basePriceCents: 159_900,
  selection: selectedBlocks === undefined ? { mode: 'automatic' } : { mode: 'manual', selectedBlocks }
}, { ...DEFAULT_CUSTOM_CAPACITY_POLICY });

assert.equal(capacity(150).selectedBlocks, 0);
assert.equal(capacity(151).selectedBlocks, 1);
assert.equal(capacity(160).selectedBlocks, 1);
assert.equal(capacity(161).selectedBlocks, 2);
assert.equal(capacity(200).selectedBlocks, 5);
assert.equal(capacity(200).totalContractedLimitPatients, 200);
assert.equal(capacity(200).blocksMonthlyRevenueCents, 39_950);
assert.equal(capacity(200).clinicalCoreMonthlyRevenueCents, 199_850);
assert.equal(capacity(200).includedStorageMb, 20_000);
assert.equal(capacity(151, 3).selectedBlocks, 3, 'override maior deve ser preservado');
assert.equal(capacity(200, 2).selectedBlocks, 5, 'override abaixo do mínimo deve voltar à recomendação');
assert.equal(capacity(200, 2).manualOverrideRemoved, true);
const frozenCapacity = capacity(200, 5);
const frozenCapacityJson = JSON.stringify(frozenCapacity);
const changedPolicy = { ...DEFAULT_CUSTOM_CAPACITY_POLICY, blockPriceCents: 9_990 };
assert.equal(calculateCustomCapacity({ currentPatients: 200, expectedPatients: 200, baseLimitPatients: 150, basePriceCents: 159_900 }, changedPolicy).blocksMonthlyRevenueCents, 49_950);
assert.equal(JSON.stringify(frozenCapacity), frozenCapacityJson, 'snapshot anterior não pode ser recalculado por política futura');
assert.equal(validateCustomCapacityPolicy(DEFAULT_CUSTOM_CAPACITY_POLICY), true);
assert.equal(validateCustomCapacityPolicy({ ...DEFAULT_CUSTOM_CAPACITY_POLICY, extra: true }), false);

const schoolDiscount = normalizeOfferItemDiscount({
  type: 'free',
  startsAt: '2026-08-01',
  endsAt: null,
  durationCount: 6,
  durationUnit: 'months',
  priceBeforeDiscountCents: 34_900,
  reason: 'Condição de lançamento da Clínica Plural Multi',
  status: 'scheduled'
});
assert.equal(schoolDiscount.discountedPriceCents, 0);
assert.equal(schoolDiscount.priceAfterExpirationCents, 34_900);
assert.equal(schoolDiscount.endsAt, '2027-02-01T00:00:00.000Z');

const percentage = normalizeOfferItemDiscount({
  type: 'percentage', percentageBasisPoints: 1_500, startsAt: '2026-08-01', endsAt: '2026-09-01',
  priceBeforeDiscountCents: 10_000, reason: 'Campanha comercial aprovada', status: 'scheduled'
});
assert.equal(percentage.discountedPriceCents, 8_500);
const fixed = normalizeOfferItemDiscount({
  type: 'fixed_amount', amountOffCents: 2_000, startsAt: '2026-08-01', endsAt: '2026-09-01',
  priceBeforeDiscountCents: 10_000, reason: 'Condição comercial aprovada', status: 'scheduled'
});
assert.equal(fixed.discountedPriceCents, 8_000);
assert.equal(discountAppliesAt({ ...fixed, status: 'expired' }, '2026-08-15'), false);
assert.equal(discountAppliesAt({ ...fixed, status: 'revoked' }, '2026-08-15'), false);
assert.throws(() => normalizeOfferItemDiscount({
  type: 'fixed_amount', amountOffCents: 10_001, startsAt: '2026-08-01', endsAt: '2026-09-01',
  priceBeforeDiscountCents: 10_000, reason: 'Condição inválida', status: 'scheduled'
}), /OFFER_ITEM_DISCOUNT_INVALID/);
assert.throws(() => normalizeOfferItemDiscount({
  type: 'free', startsAt: '2026-08-01', endsAt: null, durationCount: 6,
  priceBeforeDiscountCents: 10_000, reason: 'Duração incompleta', status: 'scheduled'
}), /OFFER_ITEM_DISCOUNT_DURATION_INVALID/);
assert.throws(() => normalizeOfferItemDiscount({
  type: 'free', startsAt: '2026-08-01', endsAt: '2026-12-01',
  durationCount: 6, durationUnit: 'months',
  priceBeforeDiscountCents: 10_000, reason: 'Datas divergentes', status: 'scheduled'
}), /OFFER_ITEM_DISCOUNT_DATES_INVALID/);
assert.throws(() => validateDiscountStacking({ globalDiscountBasisPoints: 500, itemDiscounts: [schoolDiscount] }), /JUSTIFICATION_REQUIRED/);
assert.doesNotThrow(() => validateDiscountStacking({ globalDiscountBasisPoints: 500, itemDiscounts: [schoolDiscount], justification: 'Empilhamento autorizado pelo owner comercial.' }));

const phases = buildOfferCommercialPhases({
  startsAt: '2026-08-01',
  sharedMonthlyCostCents: 5_000,
  lines: [
    { itemKey: 'clinical_core', publicName: 'Verto Clínica', billingInterval: 'monthly', normalPriceCents: 159_900, directCostCents: 20_000 },
    { itemKey: 'school_management', publicName: 'Gestão Escolar e Institucional', billingInterval: 'monthly', normalPriceCents: 34_900, directCostCents: 5_000, discount: schoolDiscount },
    { itemKey: 'onboarding', publicName: 'Implantação', billingInterval: 'one_time', normalPriceCents: 50_000, directCostCents: 30_000 }
  ]
});
assert.equal(phases.length, 2);
assert.equal(phases[0].recurringRevenueCents, 159_900);
assert.equal(phases[0].invoiceAmountCents, 209_900);
assert.equal(phases[1].recurringRevenueCents, 194_800);
assert.equal(phases[1].invoiceAmountCents, 194_800);
assert.ok(Number(phases[0].contributionCents) > 0);
assert.ok(Number(phases[1].contributionCents) > 0);
const staggeredDiscount = normalizeOfferItemDiscount({
  type: 'percentage', percentageBasisPoints: 2_000, startsAt: '2026-09-01', endsAt: null,
  durationCount: 3, durationUnit: 'billing_cycles', priceBeforeDiscountCents: 20_000,
  reason: 'Benefício temporário por módulo', status: 'scheduled'
});
const staggeredPhases = buildOfferCommercialPhases({
  startsAt: '2026-08-01',
  lines: [
    { itemKey: 'clinical_core', publicName: 'Verto Clínica', billingInterval: 'monthly', normalPriceCents: 159_900, directCostCents: 20_000 },
    { itemKey: 'appointments_communication', publicName: 'Agenda e Comunicação', billingInterval: 'monthly', normalPriceCents: 20_000, directCostCents: 2_000, discount: staggeredDiscount }
  ]
});
assert.equal(staggeredPhases.length, 3);
assert.equal(staggeredPhases[0].recurringRevenueCents, 179_900);
assert.equal(staggeredPhases[1].recurringRevenueCents, 175_900);
assert.equal(staggeredPhases[2].recurringRevenueCents, 179_900);

const stackedPhases = buildOfferCommercialPhases({
  startsAt: '2026-08-01',
  globalDiscountBasisPoints: 500,
  globalDiscountBaseItemKey: 'clinical_core',
  globalDiscountStartsAt: '2026-08-01',
  globalDiscountEndsAt: '2027-08-01',
  lines: [
    { itemKey: 'clinical_core', publicName: 'Verto Clínica', billingInterval: 'monthly', normalPriceCents: 159_900, directCostCents: 20_000 },
    { itemKey: 'school_management', publicName: 'Gestão Escolar e Institucional', billingInterval: 'monthly', normalPriceCents: 34_900, directCostCents: 5_000, discount: schoolDiscount }
  ]
});
assert.equal(stackedPhases.length, 3, 'términos distintos devem criar fases ordenadas');
assert.equal(stackedPhases[0].recurringRevenueCents, 151_905, 'desconto global incide depois do desconto do item');
assert.equal(stackedPhases[1].recurringRevenueCents, 185_060, 'preço do módulo volta antes do término global');
assert.equal(stackedPhases[2].recurringRevenueCents, 194_800, 'última fase preserva os preços normais');
assert.equal(
  stackedPhases[0].lines.reduce((sum, line) => sum + line.activePriceCents, 0),
  stackedPhases[0].recurringRevenueCents,
  'soma das linhas deve reconciliar com a fase'
);

const notificationPlan = buildDiscountNotificationPlan('discount-1', schoolDiscount.endsAt!);
assert.deepEqual(notificationPlan.map((item) => item.daysBeforeEnd), [30, 15, 7, 0, -1]);
assert.equal(new Set(notificationPlan.map((item) => item.idempotencySuffix)).size, 5);

const checkout = buildFrozenStripeCheckoutPlan({ phases, capacity: capacity(161) });
assert.ok(checkout.initialLineItems.some((item) => item.itemKey === 'clinical_core_capacity'));
assert.equal(checkout.initialLineItems.find((item) => item.itemKey === 'onboarding')?.recurring, false);
assert.equal(checkout.schedulePhases.length, 2);
assert.equal(checkout.promotionalMonthlyCents, phases[0].recurringRevenueCents);
assert.equal(checkout.futureMonthlyCents, phases[1].recurringRevenueCents);
assert.ok(!checkout.reconciliationHashInput.includes('patient'));
const checkoutAfterPromotion = buildFrozenStripeCheckoutPlan({
  phases,
  capacity: capacity(161),
  effectiveAt: '2027-03-01'
});
assert.equal(checkoutAfterPromotion.schedulePhases.length, 1);
assert.equal(checkoutAfterPromotion.promotionalMonthlyCents, phases[1].recurringRevenueCents);

const modularInput = proposalInputFixture(161, PACKAGE_TIERS.custom.id, 150, 159_900);
modularInput.customCapacityBlocks = 2;
modularInput.customCapacitySelectionMode = 'manual';
const v2InputWithoutCapacityPolicy = proposalInputFixture(
  161,
  PACKAGE_TIERS.custom.id,
  161,
  159_900
);
const v2ResultWithoutCapacityPolicy = calculateSalesModularProposal(
  v2InputWithoutCapacityPolicy,
  modularCatalogFixture,
  modularAssumptionsFixture
);
assert.equal(
  v2ResultWithoutCapacityPolicy.basePackage.capacity,
  null,
  'catálogo histórico sem política versionada não pode inventar blocos'
);
assert.equal(v2ResultWithoutCapacityPolicy.basePackage.limitQuantity, 161);
assert.equal(
  v2ResultWithoutCapacityPolicy.lines.find(
    (line) => line.itemKey === 'clinical_core'
  )?.grossRecurringRevenueCents,
  159_900
);

const catalogWithCapacity = {
  ...modularCatalogFixture,
  customCapacityPolicy: { ...DEFAULT_CUSTOM_CAPACITY_POLICY },
  hasVersionedCustomCapacityPolicy: true,
  profitabilityPolicy: null,
  hasVersionedProfitabilityPolicy: false
};
const draftCatalogWithCapacity = {
  ...catalogWithCapacity,
  status: 'draft' as const
};
const draftResult = calculateSalesModularProposal(
  v2InputWithoutCapacityPolicy,
  draftCatalogWithCapacity,
  modularAssumptionsFixture
);
assert.equal(
  draftResult.basePackage.capacity,
  null,
  'rascunho ainda não publicado não pode ativar blocos em propostas'
);
const modularResult = calculateSalesModularProposal(modularInput, catalogWithCapacity, modularAssumptionsFixture);
assert.equal(modularResult.basePackage.capacity?.selectedBlocks, 2);
assert.deepEqual(
  modularResult.basePackage.capacity?.policy,
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  'snapshot da proposta deve congelar a política publicada'
);
assert.equal(modularResult.basePackage.limitQuantity, 170);
assert.equal(modularResult.basePackage.includedStorageMb, 17_000);
assert.equal(modularResult.lines.find((line) => line.itemKey === 'clinical_core')?.grossRecurringRevenueCents, 175_880);
assert.equal(modularResult.lines.reduce((sum, line) => sum + line.grossRecurringRevenueCents, 0), modularResult.grossRecurringRevenueCents);
assert.equal(
  modularResult.commercialPhases[0].recurringRevenueCents,
  modularResult.commercialPhases[0].lines
    .filter((line) => line.billingInterval === 'monthly')
    .reduce((sum, line) => sum + line.activePriceCents, 0),
  'receita one_time não pode contaminar a fase mensal'
);

console.log('salesCommercialEvolution.test.ts: ok');
