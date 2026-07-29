import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SALES_MODULAR_PER_PATIENT_MODEL_VERSION,
  calculateSalesModularProposal,
  findMissingSalesModuleDependencies,
  type SalesModularProposalInput,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot
} from '../src/utils/salesModularProposal';
import {
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  type OfferItemDiscount
} from '../src/utils/salesCommercialEvolution';
import { DEFAULT_SALES_PROFITABILITY_POLICY } from '../src/utils/salesModularEconomics';
import {
  DEFAULT_REQUIRED_DRIVERS_BY_ITEM,
  type SalesModularDriverKey,
  type SalesModularDriverValue
} from '../src/utils/salesModularCostDrivers';
import {
  PACKAGE_TIERS,
  modularAssumptionsFixture,
  modularCatalogFixture,
  proposalInputFixture
} from './fixtures/salesModularFixture';

const effectiveAt = '2026-07-28T00:00:00.000Z';

const driverValues: Partial<Record<SalesModularDriverKey, number>> = {
  monthlyAppointments: 320,
  remindersPerAppointment: 2,
  internalNotifications: 80,
  emails: 320,
  webPushNotifications: 160
};

const driver = (value: number): SalesModularDriverValue => ({
  value,
  source: 'estimated',
  sourceDetail: 'Estimativa pré-lançamento versionada do teste.',
  effectiveAt,
  version: 1
});

const recurringModule = (): SalesPricingCatalogItem => {
  const requiredDrivers =
    DEFAULT_REQUIRED_DRIVERS_BY_ITEM.appointments_communication;
  const profile = Object.fromEntries(
    requiredDrivers.map((key) => [key, driver(driverValues[key] ?? 1)])
  );
  return {
    id: 'appointments-item',
    itemKey: 'appointments_communication',
    publicName: 'Agenda e Comunicação',
    internalName: 'Agenda e Comunicação',
    description: 'Agenda, sessões e comunicação.',
    pricingMode: 'flat_monthly',
    billingInterval: 'monthly',
    unitName: 'módulo',
    includedQuantity: null,
    maximumQuantity: null,
    recurringAmountCents: 40_000,
    oneTimeAmountCents: 0,
    sortOrder: 20,
    isRequired: false,
    isPublic: true,
    isActive: true,
    compatibleBasePackages: [],
    metadata: {},
    tiers: [],
    costModel: {
      id: 'appointments-cost',
      itemId: 'appointments-item',
      version: 3,
      directFixedMonthlyCostCents: 900,
      directCostPerPatientCents: 2,
      directCostPerClinicCents: 100,
      directCostPerUsageUnitCents: 1,
      storageCostPerGbCents: 0,
      egressCostPerGbCents: 0,
      notificationCostPerUnitCents: 1,
      processingCostPerUnitCents: 0,
      otherVariableCostCents: 50,
      supportFixedMonthlyCostCents: 100,
      supportCostPerPatientCents: 1,
      operationalFixedMonthlyCostCents: 100,
      onboardingCostCents: 0,
      sharedCostAllocationWeight: 1,
      costSource: 'estimated',
      sourceDetail: 'Estimativa pré-lançamento versionada do teste.',
      effectiveAt,
      driverConfig: {
        schemaVersion: 2,
        requiredDrivers,
        profiles: {
          light: profile,
          standard: profile,
          intensive: profile
        },
        unitCostsCents: Object.fromEntries(
          requiredDrivers.map((key) => [key, 1])
        )
      }
    }
  };
};

const catalog = (): SalesPricingCatalogSnapshot => ({
  ...structuredClone(modularCatalogFixture),
  id: 'catalog-v3-unit-pricing',
  version: 3,
  name: 'Catálogo v3 com preços por paciente',
  status: 'active',
  customCapacityPolicy: structuredClone(DEFAULT_CUSTOM_CAPACITY_POLICY),
  hasVersionedCustomCapacityPolicy: true,
  profitabilityPolicy: structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
  hasVersionedProfitabilityPolicy: true,
  items: [
    ...structuredClone(modularCatalogFixture.items),
    recurringModule()
  ]
});

const unitInput = (
  patients: number,
  corePricePerPatientCents: number | null = 1000,
  modulePricePerPatientCents: number | null = null
): SalesModularProposalInput => {
  const input = proposalInputFixture(
    patients,
    PACKAGE_TIERS.custom.id,
    150,
    null
  );
  input.expectedPatientQuantity12Months = patients;
  input.offerStartsAt = effectiveAt;
  input.lines[0] = {
    ...input.lines[0],
    quantity: patients,
    pricingEditMode: 'per_patient',
    proposedPricePerPatientCents: corePricePerPatientCents,
    customRecurringAmountCents: null
  };
  if (modulePricePerPatientCents !== null) {
    input.lines.push({
      itemKey: 'appointments_communication',
      tierId: null,
      quantity: 1,
      itemDiscountBasisPoints: 0,
      pricingEditMode: 'per_patient',
      proposedPricePerPatientCents: modulePricePerPatientCents,
      customRecurringAmountCents: null
    });
  }
  return input;
};

const result150 = calculateSalesModularProposal(
  unitInput(150),
  catalog(),
  modularAssumptionsFixture
);
const core150 = result150.lines.find((line) => line.itemKey === 'clinical_core');
assert.equal(result150.modelVersion, SALES_MODULAR_PER_PATIENT_MODEL_VERSION);
assert.equal(result150.basePackage.limitQuantity, 150);
assert.equal(result150.basePackage.capacity?.selectedBlocks, 0);
assert.equal(core150?.commercialPricing.proposedPricePerPatientCents, 1000);
assert.equal(core150?.commercialPricing.derivedMonthlyRevenueCents, 150_000);
assert.equal(core150?.grossRecurringRevenueCents, 150_000);
assert.notEqual(
  core150?.commercialPricing.estimatedMonthlyCostCents,
  null,
  'a faixa personalizada deve herdar o modelo de custo do clinical_core'
);
assert.notEqual(core150?.commercialPricing.effectiveCostPerPatientCents, null);
assert.notEqual(core150?.commercialPricing.marginalCostPerPatientCents, null);

const result151 = calculateSalesModularProposal(
  unitInput(151, 1000, 200),
  catalog(),
  modularAssumptionsFixture
);
const core151 = result151.lines.find((line) => line.itemKey === 'clinical_core');
const agenda151 = result151.lines.find(
  (line) => line.itemKey === 'appointments_communication'
);
assert.equal(result151.basePackage.capacity?.selectedBlocks, 1);
assert.equal(result151.basePackage.limitQuantity, 160);
assert.equal(result151.basePackage.includedStorageMb, 16_000);
assert.equal(core151?.commercialPricing.derivedMonthlyRevenueCents, 160_000);
assert.equal(agenda151?.commercialPricing.derivedMonthlyRevenueCents, 32_000);
assert.equal(result151.commercialPricing.totalProposedPricePerPatientCents, 1200);
assert.equal(
  result151.basePackage.capacity?.effectiveBlockPriceCents,
  12_000,
  'o bloco deve refletir dez pacientes vezes a soma dos módulos selecionados'
);
assert.equal(result151.commercialPricing.nextBlockPriceCents, 12_000);
assert.notEqual(result151.commercialPricing.nextBlockMarginalCostCents, null);
assert.notEqual(result151.commercialPricing.nextBlockContributionCents, null);
assert.notEqual(result151.commercialPricing.nextBlockMarginBasisPoints, null);
assert.equal(result151.totalsReconciled, true);
assert.equal(
  result151.lines.reduce(
    (sum, line) => sum + line.promotional.netRevenueCents,
    0
  ),
  result151.promotionalRecurringRevenueCents
);

const canonicalCore = result151.input.lines.find(
  (line) => line.itemKey === 'clinical_core'
);
const canonicalAgenda = result151.input.lines.find(
  (line) => line.itemKey === 'appointments_communication'
);
assert.equal(canonicalCore?.proposedPricePerPatientCents, 1000);
assert.equal(canonicalCore?.customRecurringAmountCents, 160_000);
assert.equal(canonicalAgenda?.proposedPricePerPatientCents, 200);
assert.equal(canonicalAgenda?.customRecurringAmountCents, 32_000);

const result160 = calculateSalesModularProposal(
  unitInput(160, 1000, 200),
  catalog(),
  modularAssumptionsFixture
);
const result161 = calculateSalesModularProposal(
  unitInput(161, 1000, 200),
  catalog(),
  modularAssumptionsFixture
);
const result200 = calculateSalesModularProposal(
  unitInput(200, 1000, 200),
  catalog(),
  modularAssumptionsFixture
);
assert.equal(result160.basePackage.capacity?.selectedBlocks, 1);
assert.equal(result161.basePackage.capacity?.selectedBlocks, 2);
assert.equal(result161.basePackage.limitQuantity, 170);
assert.equal(result200.basePackage.capacity?.selectedBlocks, 5);
assert.equal(result200.basePackage.limitQuantity, 200);

const withoutAgenda = calculateSalesModularProposal(
  unitInput(151),
  catalog(),
  modularAssumptionsFixture
);
assert.equal(
  result151.promotionalRecurringRevenueCents -
    withoutAgenda.promotionalRecurringRevenueCents,
  32_000,
  'adicionar o módulo deve acrescentar sua receita derivada'
);
assert.equal(
  withoutAgenda.lines.some(
    (line) => line.itemKey === 'appointments_communication'
  ),
  false,
  'remover o módulo deve remover sua linha, custo e receita'
);
assert.ok(
  Number(result151.promotional.directCostCents) >
    Number(withoutAgenda.promotional.directCostCents)
);

const totalModeInput = unitInput(151);
totalModeInput.lines[0] = {
  ...totalModeInput.lines[0],
  pricingEditMode: 'monthly_total',
  proposedPricePerPatientCents: null,
  customRecurringAmountCents: 240_000
};
const totalMode = calculateSalesModularProposal(
  totalModeInput,
  catalog(),
  modularAssumptionsFixture
);
assert.equal(
  totalMode.lines[0].commercialPricing.proposedPricePerPatientCents,
  1500
);
assert.equal(
  totalMode.input.lines[0].customRecurringAmountCents,
  240_000
);

const missingModulePriceInput = unitInput(151);
missingModulePriceInput.lines.push({
  itemKey: 'appointments_communication',
  tierId: null,
  quantity: 1,
  itemDiscountBasisPoints: 0,
  pricingEditMode: 'per_patient',
  proposedPricePerPatientCents: null,
  customRecurringAmountCents: null
});
const missingModulePrice = calculateSalesModularProposal(
  missingModulePriceInput,
  catalog(),
  modularAssumptionsFixture
);
const missingLine = missingModulePrice.lines.find(
  (line) => line.itemKey === 'appointments_communication'
);
assert.equal(missingLine?.commercialPricing.derivedMonthlyRevenueCents, null);
assert.equal(missingLine?.commercialPricing.estimateStatus, 'pre_launch');
assert.deepEqual(
  missingModulePrice.commercialPricing.missingPriceItemKeys,
  ['appointments_communication']
);
assert.equal(missingModulePrice.rating, 'insufficient_data');
assert.equal(missingModulePrice.economics?.canSend, false);
assert.ok(
  missingModulePrice.economics?.blockingCodes.includes(
    'COMMERCIAL_PRICE_PER_PATIENT_MISSING:appointments_communication'
  )
);

const freeModuleInput = unitInput(151, 1000, 200);
const normalModuleMonthlyCents = 160 * 200;
const freeDiscount: OfferItemDiscount = {
  type: 'free',
  startsAt: effectiveAt,
  endsAt: null,
  durationCount: 6,
  durationUnit: 'months',
  priceBeforeDiscountCents: normalModuleMonthlyCents,
  discountedPriceCents: 0,
  priceAfterExpirationCents: normalModuleMonthlyCents,
  reason: 'Condição temporária aprovada no teste.',
  status: 'active'
};
freeModuleInput.lines[1].offerDiscount = freeDiscount;
const freeModule = calculateSalesModularProposal(
  freeModuleInput,
  catalog(),
  modularAssumptionsFixture
);
const freeModuleLine = freeModule.lines.find(
  (line) => line.itemKey === 'appointments_communication'
);
assert.equal(freeModuleLine?.promotional.netRevenueCents, 0);
assert.equal(freeModuleLine?.postPromotion.netRevenueCents, 32_000);
assert.equal(
  freeModuleLine?.promotional.directCostCents,
  freeModuleLine?.postPromotion.directCostCents,
  'gratuidade comercial não pode apagar o custo do módulo'
);
assert.ok(Number(freeModuleLine?.promotional.contributionMarginCents) < 0);
assert.equal(
  freeModule.horizons['12'].discountImpactCents,
  normalModuleMonthlyCents * 6
);
assert.equal(
  freeModule.lines.find((line) => line.itemKey === 'clinical_core')
    ?.promotionalRecurringRevenueCents,
  freeModule.lines.find((line) => line.itemKey === 'clinical_core')
    ?.postPromotionRecurringRevenueCents,
  'o desconto do módulo não pode interferir no pacote-base'
);

const changedAssumptions = structuredClone(modularAssumptionsFixture);
changedAssumptions.version = 4;
changedAssumptions.values.fixedMonthlyEligibleCostCents =
  Number(changedAssumptions.values.fixedMonthlyEligibleCostCents) + 5000;
const recalculatedWithNewAssumptions = calculateSalesModularProposal(
  unitInput(150),
  catalog(),
  changedAssumptions
);
assert.notEqual(
  recalculatedWithNewAssumptions.promotional.totalEstimatedCostCents,
  result150.promotional.totalEstimatedCostCents,
  'um cenário novo deve usar a nova premissa'
);
assert.equal(
  result150.commercialPricing.assumptionSetVersion,
  modularAssumptionsFixture.version,
  'o resultado já calculado deve manter a versão congelada'
);

const belowFloor = calculateSalesModularProposal(
  unitInput(150, 1),
  catalog(),
  modularAssumptionsFixture
);
assert.equal(belowFloor.economics?.canSend, false);
assert.ok(
  belowFloor.economics?.blockingCodes.includes('CLINIC_MARGIN_BELOW_60')
);

const legacyResult = calculateSalesModularProposal(
  proposalInputFixture(
    150,
    PACKAGE_TIERS.custom.id,
    150,
    159_900
  ),
  structuredClone(modularCatalogFixture),
  modularAssumptionsFixture
);
assert.equal(legacyResult.modelVersion, '2026-07-28-v4');
assert.equal(legacyResult.commercialPricing.enabled, false);
assert.equal(legacyResult.promotionalRecurringRevenueCents, 159_900);

assert.deepEqual(
  findMissingSalesModuleDependencies(['appointments_communication']),
  [
    {
      itemKey: 'appointments_communication',
      dependency: 'clinical_core'
    }
  ]
);
assert.deepEqual(
  findMissingSalesModuleDependencies([
    'clinical_core',
    'appointments_communication'
  ]),
  []
);
assert.throws(
  () =>
    calculateSalesModularProposal(
      {
        ...unitInput(150),
        lines: [
          {
            itemKey: 'appointments_communication',
            tierId: null,
            quantity: 1,
            itemDiscountBasisPoints: 0,
            pricingEditMode: 'per_patient',
            proposedPricePerPatientCents: 200
          }
        ]
      },
      catalog(),
      modularAssumptionsFixture
    ),
  /PROPOSAL_SIMULATION_INVALID:clinical_core/
);

const serverSource = readFileSync('server.ts', 'utf8');
const publicSanitizer = serverSource.slice(
  serverSource.indexOf('const sanitizePublicCommercialPhases'),
  serverSource.indexOf('const sanitizePublicBasePackage')
);
assert.doesNotMatch(publicSanitizer, /directCostCents|recurringCostCents|ebitdaCents|marginBasisPoints/);
assert.match(
  serverSource,
  /commercialPhases:\s*sanitizePublicCommercialPhases/
);
assert.match(serverSource, /inputSnapshot:\s*resultSnapshot\.input/);
assert.match(serverSource, /PROPOSAL_PRICE_PER_PATIENT_MISSING/);
assert.match(serverSource, /commercialExceptionApproval/);
assert.match(serverSource, /approvedBy:\s*input\.actorUserId/);
assert.match(
  serverSource,
  /app\.post\(\s*"\/api\/owner\/sales\/leads\/:leadId\/modular-simulations"[\s\S]*?checkOwner/
);

const builderSource = readFileSync(
  'src/components/SalesModularProposalBuilder.tsx',
  'utf8'
);
assert.match(builderSource, /Preço por paciente/);
assert.match(builderSource, /Usar preço sugerido/);
assert.match(builderSource, /Custo marginal/);
assert.match(builderSource, /Dados insuficientes/);
assert.match(builderSource, /Módulos e adicionais/);
assert.match(builderSource, /commercialPricingMissing\s*\?\s*null/);

const publicOfferSource = readFileSync(
  'src/components/PublicSalesOffer.tsx',
  'utf8'
);
assert.match(publicOfferSource, /por paciente/);
assert.doesNotMatch(publicOfferSource, /offerDiscount\.internalNotes/);

console.log('salesPersonalizedPerPatientPricing.test.ts: OK');
