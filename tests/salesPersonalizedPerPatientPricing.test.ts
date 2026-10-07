import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SALES_MODULAR_CAPACITY_BLOCK_MODEL_VERSION,
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

const essencial40Input = proposalInputFixture(
  40,
  PACKAGE_TIERS.upTo50.id,
  null,
  null
);
essencial40Input.commercialPricingMode = 'manual_module_prices';
essencial40Input.commercialCapacityBasis = 'current_patients';
essencial40Input.platformFoundationPricingMode = 'manual';
essencial40Input.platformFoundationMonthlyAmountCents = 0;
essencial40Input.expectedPatientQuantity12Months = 40;
essencial40Input.customCapacityBlocks = null;
essencial40Input.customCapacitySelectionMode = 'automatic';
essencial40Input.offerStartsAt = effectiveAt;
essencial40Input.usageProfile = 'intensive';
essencial40Input.lines[0] = {
  ...essencial40Input.lines[0],
  quantity: 40,
  pricingEditMode: 'per_patient',
  proposedPricePerPatientCents: 1241,
  customRecurringAmountCents: null
};

const recoveredAssumptions40 = structuredClone(modularAssumptionsFixture);
recoveredAssumptions40.version = 1;
recoveredAssumptions40.name = 'Recuperação staging — baseline comercial 2026-10-07';
recoveredAssumptions40.values = {
  ...recoveredAssumptions40.values,
  stripeFeeBasisPoints: 399,
  stripeFixedFeeCents: 39,
  revenueTaxBasisPoints: 0,
  estimatedDelinquencyBasisPoints: 0,
  refundChargebackBasisPoints: 0,
  fixedMonthlyEligibleCostCents: 11092,
  fixedAllocationMethod: 'per_clinic',
  fixedAllocationPatientCount: null,
  fixedAllocationClinicCount: 1,
  depreciationAmortizationCents: 0,
  financialExpensesCents: 0,
  profitTaxBasisPoints: 0,
  otherBelowEbitdaCents: 0,
  minimumMarginBasisPoints: 6000,
  healthyMarginBasisPoints: 7000,
  attentionMarginBasisPoints: 6000
};

const essencial40 = calculateSalesModularProposal(
  essencial40Input,
  catalog(),
  recoveredAssumptions40
);
const essencial40Core = essencial40.lines.find(
  (line) => line.itemKey === 'clinical_core'
);
assert.equal(
  essencial40.basePackage.limitQuantity,
  50,
  '40 pacientes devem permanecer na capacidade Essencial de 50'
);
assert.equal(
  essencial40Core?.commercialPricing.proposedPricePerPatientCents,
  1241
);
assert.equal(
  essencial40Core?.commercialPricing.derivedMonthlyRevenueCents,
  40 * 1241,
  'o faturamento recorrente deve usar pacientes atuais, não a capacidade máxima'
);
assert.notEqual(
  essencial40Core?.postPromotion.ebitdaMarginBasisPoints,
  null,
  'a margem do módulo deve ser calculável com premissas completas'
);
assert.notEqual(
  essencial40.promotional.ebitdaMarginBasisPoints,
  null,
  'a margem consolidada deve ser calculável com premissas completas'
);

const builderState40 = proposalInputFixture(
  40,
  PACKAGE_TIERS.custom.id,
  50,
  null
);
builderState40.commercialPricingMode = 'manual_module_prices';
builderState40.commercialCapacityBasis = 'current_patients';
builderState40.platformFoundationPricingMode = 'manual';
builderState40.platformFoundationMonthlyAmountCents = 0;
builderState40.basePackageSelectionMode = 'manual';
builderState40.expectedPatientQuantity12Months = 40;
builderState40.customCapacityBlocks = null;
builderState40.customCapacitySelectionMode = 'automatic';
builderState40.offerStartsAt = effectiveAt;
builderState40.usageProfile = 'intensive';
builderState40.lines[0] = {
  ...builderState40.lines[0],
  tierId: PACKAGE_TIERS.custom.id,
  quantity: 40,
  pricingEditMode: 'per_patient',
  proposedPricePerPatientCents: 1241,
  customRecurringAmountCents: null
};

const builderState40Result = calculateSalesModularProposal(
  builderState40,
  catalog(),
  recoveredAssumptions40
);
const builderState40Core = builderState40Result.lines.find(
  (line) => line.itemKey === 'clinical_core'
);
assert.equal(
  builderState40Result.basePackage.limitQuantity,
  50,
  'o estado inicial do builder deve representar Essencial 1–50 sem quebrar o cálculo'
);
assert.equal(
  builderState40Core?.commercialPricing.derivedMonthlyRevenueCents,
  40 * 1241,
  'o tier técnico custom não pode converter a capacidade de 50 em 50 pacientes faturados'
);
assert.notEqual(
  builderState40Core?.postPromotion.ebitdaMarginBasisPoints,
  null,
  'o estado real do builder deve manter margem do módulo disponível'
);
assert.notEqual(
  builderState40Result.promotional.ebitdaMarginBasisPoints,
  null,
  'o estado real do builder deve manter margem consolidada disponível'
);

const liveClinicalCatalog40 = catalog();
liveClinicalCatalog.modularCostSettings = {
  schemaVersion: 2,
  ownership: {
    variablePatientCost: 'item_direct',
    variableClinicCost: 'item_direct',
    storageCost: 'item_direct',
    egressCost: 'item_direct',
    processingCost: 'item_direct',
    notificationCost: 'item_direct',
    otherVariableCost: 'item_direct',
    supportClinicCost: 'item_direct',
    supportPatientCost: 'item_direct',
    operationalCost: 'item_direct',
    fixedMonthlyEligibleCost: 'shared'
  },
  ownershipJustifications: {},
  includedStorageMbPerPatient: 100,
  usageProfiles: {
    light: {
      storageUtilizationBasisPoints: 2500,
      expectedEgressMultiplier: 0.5
    },
    standard: {
      storageUtilizationBasisPoints: 6000,
      expectedEgressMultiplier: 2
    },
    intensive: {
      storageUtilizationBasisPoints: 10000,
      expectedEgressMultiplier: 5
    }
  }
};
const liveClinicalCore40 = liveClinicalCatalog40.items.find(
  (item) => item.itemKey === 'clinical_core'
);
assert.ok(liveClinicalCore40);
liveClinicalCore40.costModel = {
  ...liveClinicalCore40.costModel!,
  version: 1,
  directFixedMonthlyCostCents: null,
  directCostPerPatientCents: 0,
  directCostPerClinicCents: 0,
  directCostPerUsageUnitCents: 0,
  storageCostPerGbCents: 11,
  egressCostPerGbCents: 46,
  notificationCostPerUnitCents: null,
  processingCostPerUnitCents: null,
  otherVariableCostCents: 0,
  supportFixedMonthlyCostCents: 1875,
  supportCostPerPatientCents: 125,
  operationalFixedMonthlyCostCents: 1875,
  onboardingCostCents: null,
  sharedCostAllocationWeight: 4,
  costSource: 'estimated',
  sourceDetail: 'Premissa econômica pré-lançamento reproduzida do catálogo ativo.',
  effectiveAt,
  driverConfig: {
    schemaVersion: 2,
    requiredDrivers: [
      'monthlyClinicalSessions',
      'monthlyAbaSessions',
      'monthlyAbaRecords',
      'generatedDocuments'
    ],
    profiles: {
      light: {
        monthlyClinicalSessions: driver(20),
        monthlyAbaSessions: driver(40),
        monthlyAbaRecords: driver(4000),
        generatedDocuments: driver(2)
      },
      standard: {
        monthlyClinicalSessions: driver(40),
        monthlyAbaSessions: driver(120),
        monthlyAbaRecords: driver(12000),
        generatedDocuments: driver(5)
      },
      intensive: {
        monthlyClinicalSessions: driver(80),
        monthlyAbaSessions: driver(300),
        monthlyAbaRecords: driver(30000),
        generatedDocuments: driver(10)
      }
    },
    unitCostsCents: {
      monthlyAbaSessions: 0,
      monthlyAbaRecords: 0,
      generatedDocuments: 0
    }
  }
};

const liveClinicalResult40 = calculateSalesModularProposal(
  builderState40,
  liveClinicalCatalog40,
  recoveredAssumptions40
);
const liveClinicalCoreResult40 = liveClinicalResult40.lines.find(
  (line) => line.itemKey === 'clinical_core'
);
assert.notEqual(
  liveClinicalCoreResult40?.commercialPricing.estimatedMonthlyCostCents,
  null,
  'o modelo de custo real do clinical_core deve produzir custo mensal'
);
assert.notEqual(
  liveClinicalCoreResult40?.postPromotion.ebitdaMarginBasisPoints,
  null,
  'o modelo de custo real do clinical_core deve produzir margem'
);
assert.notEqual(
  liveClinicalResult40.promotional.ebitdaMarginBasisPoints,
  null,
  'o catálogo real do clinical_core deve produzir margem consolidada'
);

const result150 = calculateSalesModularProposal(
  unitInput(150),
  catalog(),
  modularAssumptionsFixture
);
const core150 = result150.lines.find((line) => line.itemKey === 'clinical_core');
assert.equal(
  result150.modelVersion,
  SALES_MODULAR_CAPACITY_BLOCK_MODEL_VERSION
);
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
  totalMode.lines.find((line) => line.itemKey === 'clinical_core')
    ?.commercialPricing.proposedPricePerPatientCents,
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
assert.equal(belowFloor.economics?.canSend, true);
assert.equal(belowFloor.economics?.requiresJustification, false);
assert.ok(
  belowFloor.economics?.alertCodes.includes('CLINIC_MARGIN_BELOW_TARGET')
);
assert.equal(
  belowFloor.economics?.blockingCodes.some((code) => code.includes('MARGIN_BELOW')),
  false
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
assert.equal(legacyResult.modelVersion, '2026-08-04-v5');
assert.equal(legacyResult.commercialPricing.enabled, false);
assert.equal(legacyResult.promotionalRecurringRevenueCents, 159_900);

assert.deepEqual(
  findMissingSalesModuleDependencies(['appointments_communication']),
  []
);
assert.deepEqual(
  findMissingSalesModuleDependencies([
    'clinical_core',
    'appointments_communication'
  ]),
  []
);
const agendaOnly = calculateSalesModularProposal(
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
);
assert.equal(
  agendaOnly.lines.some((line) => line.itemKey === 'clinical_core'),
  false
);
assert.equal(
  agendaOnly.lines.some((line) => line.itemKey === 'platform_foundation'),
  true
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
