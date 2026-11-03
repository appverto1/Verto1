import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModularOfferDetails } from '../src/components/PublicSalesOffer';
import {
  SALES_MODULAR_CAPACITY_BLOCK_MODEL_VERSION,
  calculateSalesModularProposal,
  deriveSalesCapacityBlockPhases,
  multiplySalesMoneyBasisPoints,
  salesCapacityBlockPhasesMatch,
  type SalesModularProposalInput,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot
} from '../src/utils/salesModularProposal';
import {
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  calculateCustomCapacity,
  type OfferCommercialPhase,
  type OfferItemDiscount
} from '../src/utils/salesCommercialEvolution';
import { formatSalesCommercialDate } from '../src/utils/salesCommercialDate';
import {
  DEFAULT_SALES_PROFITABILITY_POLICY,
  buildSalesCommercialApprovalHashInput,
  classifySalesProposalReview,
  isSalesCommercialReviewCode
} from '../src/utils/salesModularEconomics';
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

const effectiveAt = '2026-07-30T00:00:00.000Z';
const promotionEndsAt = '2027-01-30T00:00:00.000Z';

assert.equal(
  formatSalesCommercialDate(effectiveAt),
  '30/07/2026'
);
assert.equal(
  formatSalesCommercialDate(promotionEndsAt),
  '30/01/2027'
);
assert.equal(
  formatSalesCommercialDate('2026-10-30T00:00:00.000Z'),
  '30/10/2026'
);
assert.equal(
  formatSalesCommercialDate('data-inválida'),
  'Data não informada',
  'data comercial inválida usa fallback controlado'
);

const driver = (value = 1): SalesModularDriverValue => ({
  value,
  source: 'estimated',
  sourceDetail: 'Fixture versionada de precificação modular.',
  effectiveAt,
  version: 1
});

const moduleItem = (
  itemKey:
    | 'appointments_communication'
    | 'financial_management'
    | 'school_management'
    | 'insurance_tiss',
  publicName: string,
  description: string
): SalesPricingCatalogItem => {
  const requiredDrivers = DEFAULT_REQUIRED_DRIVERS_BY_ITEM[itemKey];
  const values = Object.fromEntries(
    requiredDrivers.map((key) => [key, driver()])
  );
  return {
    id: `${itemKey}-item`,
    itemKey,
    publicName,
    internalName: publicName,
    description,
    pricingMode: 'flat_monthly',
    billingInterval: 'monthly',
    unitName: 'módulo',
    includedQuantity: null,
    maximumQuantity: null,
    recurringAmountCents: 0,
    oneTimeAmountCents: 0,
    sortOrder: 10,
    isRequired: false,
    isPublic: true,
    isActive: true,
    compatibleBasePackages: [],
    metadata: {},
    tiers: [],
    costModel: {
      id: `${itemKey}-cost`,
      itemId: `${itemKey}-item`,
      version: 1,
      directFixedMonthlyCostCents: 100,
      directCostPerPatientCents: 10,
      directCostPerClinicCents: 50,
      directCostPerUsageUnitCents: 1,
      storageCostPerGbCents: 1,
      egressCostPerGbCents: 1,
      notificationCostPerUnitCents: 1,
      processingCostPerUnitCents: 1,
      otherVariableCostCents: 10,
      supportFixedMonthlyCostCents: 10,
      supportCostPerPatientCents: 5,
      operationalFixedMonthlyCostCents: 10,
      onboardingCostCents: 0,
      sharedCostAllocationWeight: 1,
      costSource: 'estimated',
      sourceDetail: 'Fixture versionada de custos marginais.',
      effectiveAt,
      driverConfig: {
        schemaVersion: 2,
        requiredDrivers,
        profiles: {
          light: values,
          standard: values,
          intensive: values
        },
        unitCostsCents: Object.fromEntries(
          requiredDrivers.map((key) => [key, 1])
        ) as Partial<Record<SalesModularDriverKey, number>>
      }
    }
  };
};

const pluralCatalog = (): SalesPricingCatalogSnapshot => ({
  ...structuredClone(modularCatalogFixture),
  id: 'catalog-capacity-blocks',
  version: 4,
  status: 'active',
  effectiveAt,
  customCapacityPolicy: structuredClone(DEFAULT_CUSTOM_CAPACITY_POLICY),
  hasVersionedCustomCapacityPolicy: true,
  profitabilityPolicy: structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
  hasVersionedProfitabilityPolicy: true,
  items: [
    ...structuredClone(modularCatalogFixture.items),
    moduleItem(
      'appointments_communication',
      'Agenda e Comunicação',
      'Sessões, lembretes e comunicação.'
    ),
    moduleItem(
      'financial_management',
      'Financeiro e Gestão',
      'Cobranças, DRE, margens, contas a receber e inadimplência.'
    ),
    moduleItem(
      'school_management',
      'Gestão Escolar e Institucional',
      'Atas, reuniões, autorizações, documentos e histórico institucional.'
    ),
    moduleItem(
      'insurance_tiss',
      'Convênios e TISS',
      'Guias, lotes, XML, TUSS, elegibilidade e glosas.'
    )
  ]
});

const freeSchoolDiscount = (
  capacity: number
): OfferItemDiscount => ({
  type: 'free',
  startsAt: effectiveAt,
  endsAt: promotionEndsAt,
  durationCount: 6,
  durationUnit: 'months',
  priceBeforeDiscountCents: capacity * 196,
  discountedPriceCents: 0,
  priceAfterExpirationCents: capacity * 196,
  reason: 'Condição estratégica temporária aprovada para validação.',
  status: 'active'
});

const pluralInput = (
  patients: number,
  includeSchool = true,
  includeTiss = false
): SalesModularProposalInput => {
  const input = proposalInputFixture(
    patients,
    PACKAGE_TIERS.custom.id,
    150,
    null
  );
  input.expectedPatientQuantity12Months = patients;
  input.offerStartsAt = effectiveAt;
  input.lines = [
    {
      itemKey: 'clinical_core',
      tierId: PACKAGE_TIERS.custom.id,
      quantity: patients,
      pricingEditMode: 'per_patient',
      proposedPricePerPatientCents: 1176,
      itemDiscountBasisPoints: 0
    },
    {
      itemKey: 'appointments_communication',
      quantity: 1,
      pricingEditMode: 'per_patient',
      proposedPricePerPatientCents: 295,
      itemDiscountBasisPoints: 0
    },
    {
      itemKey: 'financial_management',
      quantity: 1,
      pricingEditMode: 'per_patient',
      proposedPricePerPatientCents: 63,
      itemDiscountBasisPoints: 0
    }
  ];
  if (includeSchool) {
    input.lines.push({
      itemKey: 'school_management',
      quantity: 1,
      pricingEditMode: 'per_patient',
      proposedPricePerPatientCents: 196,
      itemDiscountBasisPoints: 0,
      offerDiscount: freeSchoolDiscount(
        patients > 150 ? Math.ceil(patients / 10) * 10 : 150
      )
    });
  }
  if (includeTiss) {
    input.lines.push({
      itemKey: 'insurance_tiss',
      quantity: 1,
      pricingEditMode: 'per_patient',
      proposedPricePerPatientCents: 250,
      itemDiscountBasisPoints: 0
    });
  }
  return input;
};

const result150 = calculateSalesModularProposal(
  pluralInput(150),
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.equal(
  result150.modelVersion,
  SALES_MODULAR_CAPACITY_BLOCK_MODEL_VERSION
);
assert.equal(result150.basePackage.capacity?.selectedBlocks, 0);
assert.equal(result150.commercialPricing.capacityBlockPhases.length, 2);
const promotional150 =
  result150.commercialPricing.capacityBlockPhases[0];
const posterior150 =
  result150.commercialPricing.capacityBlockPhases[1];
assert.equal(promotional150.effectivePricePerPatientCents, 1534);
assert.equal(promotional150.contractedMonthlyRevenueCents, 230_100);
assert.equal(promotional150.blockPriceCents, 15_340);
assert.equal(posterior150.effectivePricePerPatientCents, 1730);
assert.equal(posterior150.contractedMonthlyRevenueCents, 259_500);
assert.equal(posterior150.blockPriceCents, 17_300);
assert.deepEqual(
  promotional150.modules.map((module) => [
    module.itemKey,
    module.blockRevenueCents
  ]),
  [
    ['clinical_core', 11_760],
    ['appointments_communication', 2_950],
    ['financial_management', 630],
    ['school_management', 0]
  ]
);
assert.equal(
  posterior150.modules.find(
    (module) => module.itemKey === 'school_management'
  )?.blockRevenueCents,
  1_960
);
assert.equal(
  promotional150.modules.some(
    (module) => module.itemKey === 'insurance_tiss'
  ),
  false,
  'módulo não contratado não pode compor o bloco'
);
assert.ok(
  pluralCatalog()
    .items.find((item) => item.itemKey === 'financial_management')
    ?.description.includes('DRE'),
  'DRE permanece dentro de Financeiro e Gestão'
);

const result151 = calculateSalesModularProposal(
  pluralInput(151),
  pluralCatalog(),
  modularAssumptionsFixture
);
const promotional151 =
  result151.commercialPricing.capacityBlockPhases[0];
const posterior151 =
  result151.commercialPricing.capacityBlockPhases[1];
assert.equal(result151.basePackage.capacity?.selectedBlocks, 1);
assert.equal(result151.basePackage.limitQuantity, 160);
assert.equal(promotional151.blockPriceCents, 15_340);
assert.equal(promotional151.blocksRevenueCents, 15_340);
assert.equal(promotional151.contractedMonthlyRevenueCents, 245_440);
assert.equal(posterior151.blockPriceCents, 17_300);
assert.equal(posterior151.contractedMonthlyRevenueCents, 276_800);
assert.notEqual(
  promotional151.blockPriceCents,
  DEFAULT_CUSTOM_CAPACITY_POLICY.blockPriceCents,
  'nova proposta modular nunca usa o preço fixo legado'
);
assert.ok(promotional151.blockPriceCents > 0);

const schoolPromotional = promotional151.modules.find(
  (module) => module.itemKey === 'school_management'
);
assert.equal(schoolPromotional?.blockRevenueCents, 0);
const schoolResultLine = result151.lines.find(
  (line) => line.itemKey === 'school_management'
);
assert.ok(Number(schoolResultLine?.promotional.directCostCents) > 0);
assert.equal(
  schoolResultLine?.promotional.directCostCents,
  schoolResultLine?.postPromotion.directCostCents,
  'gratuidade zera receita, sem apagar o custo promocional do módulo'
);
assert.equal(
  posterior151.modules.find(
    (module) => module.itemKey === 'school_management'
  )?.blockRevenueCents,
  1_960,
  'fim do benefício restaura a parcela do módulo'
);

const result161 = calculateSalesModularProposal(
  pluralInput(161),
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.equal(result161.basePackage.capacity?.selectedBlocks, 2);
assert.equal(result161.basePackage.limitQuantity, 170);
assert.equal(
  result161.commercialPricing.capacityBlockPhases[0].blocksRevenueCents,
  30_680
);

const intensiveDirectCost = (
  result: ReturnType<typeof calculateSalesModularProposal>
) =>
  result.economics!.items.reduce(
    (sum, item) => sum + Number(item.intensiveDirectCostCents),
    0
  );
const directMarginalCostFromPhase = (
  result: ReturnType<typeof calculateSalesModularProposal>
) => {
  const phase = result.commercialPricing.capacityBlockPhases[0];
  const percentageCost = multiplySalesMoneyBasisPoints(
    phase.blockPriceCents,
    result.economics!.percentageCostBasisPoints!
  );
  return phase.blockMarginalCostCents! - percentageCost;
};
const result160 = calculateSalesModularProposal(
  pluralInput(160),
  pluralCatalog(),
  modularAssumptionsFixture
);
const result170 = calculateSalesModularProposal(
  pluralInput(170),
  pluralCatalog(),
  modularAssumptionsFixture
);
const result180 = calculateSalesModularProposal(
  pluralInput(180),
  pluralCatalog(),
  modularAssumptionsFixture
);
const exactDirect150To160 =
  intensiveDirectCost(result160) - intensiveDirectCost(result150);
const naiveFirstPatientTimesTen = result150.lines.reduce(
  (sum, line) =>
    sum + Number(line.commercialPricing.marginalCostPerPatientCents || 0) * 10,
  0
);
assert.equal(exactDirect150To160, 467);
assert.equal(naiveFirstPatientTimesTen, 460);
assert.equal(
  directMarginalCostFromPhase(result150),
  exactDirect150To160,
  'o próximo bloco usa custo(160) - custo(150)'
);
assert.notEqual(
  exactDirect150To160,
  naiveFirstPatientTimesTen,
  'arredondamentos de armazenamento/egress tornam o driver não linear'
);
assert.equal(
  directMarginalCostFromPhase(result160),
  intensiveDirectCost(result170) - intensiveDirectCost(result160),
  'capacidade 160 compara o próximo bloco em 170'
);
assert.equal(
  directMarginalCostFromPhase(result161),
  intensiveDirectCost(result180) - intensiveDirectCost(result170),
  'com dois blocos selecionados, o próximo bloco compara 180 contra 170'
);

const freeAgendaInput = pluralInput(150);
const agendaLine = freeAgendaInput.lines.find(
  (line) => line.itemKey === 'appointments_communication'
)!;
agendaLine.offerDiscount = {
  ...freeSchoolDiscount(150),
  priceBeforeDiscountCents: 44_250,
  priceAfterExpirationCents: 44_250,
  reason: 'Gratuidade temporária da Agenda com custo marginal preservado.'
};
const freeAgendaResult = calculateSalesModularProposal(
  freeAgendaInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
const freeAgendaBlockModule =
  freeAgendaResult.commercialPricing.capacityBlockPhases[0].modules.find(
    (module) => module.itemKey === 'appointments_communication'
  )!;
assert.equal(freeAgendaBlockModule.blockRevenueCents, 0);
assert.ok(
  Number(freeAgendaBlockModule.blockMarginalCostCents) > 0,
  'módulo gratuito preserva seu custo marginal real'
);

const withTiss = calculateSalesModularProposal(
  pluralInput(151, true, true),
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.equal(
  withTiss.commercialPricing.capacityBlockPhases[0].blockPriceCents,
  17_840
);
assert.equal(
  withTiss.commercialPricing.capacityBlockPhases[0].modules.some(
    (module) => module.itemKey === 'insurance_tiss'
  ),
  true
);

const withoutSchool = calculateSalesModularProposal(
  pluralInput(151, false),
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.equal(
  withoutSchool.commercialPricing.capacityBlockPhases[0].blockPriceCents,
  15_340
);
assert.equal(
  withoutSchool.commercialPricing.capacityBlockPhases[0].modules.some(
    (module) => module.itemKey === 'school_management'
  ),
  false
);

const capacity160 = calculateCustomCapacity(
  {
    currentPatients: 151,
    expectedPatients: 151,
    baseLimitPatients: 150,
    basePriceCents: 230_100,
    blockPriceCentsOverride: 15_340
  },
  DEFAULT_CUSTOM_CAPACITY_POLICY
);
const percentagePhase: OfferCommercialPhase = {
  phaseNumber: 1,
  startsAt: effectiveAt,
  endsAt: null,
  lines: [
    {
      itemKey: 'clinical_core',
      publicName: 'Verto Clínica + ABA',
      billingInterval: 'monthly',
      normalPriceCents: 160_000,
      activePriceCents: 144_000,
      discountCents: 16_000,
      itemDiscountCents: 16_000,
      globalDiscountCents: 0,
      discount: null,
      directCostCents: 1000
    }
  ],
  recurringRevenueCents: 144_000,
  recurringCostCents: 1000,
  contributionCents: 143_000,
  ebitdaCents: 143_000,
  marginBasisPoints: 9931,
  invoiceAmountCents: 144_000
};
const percentagePricing = deriveSalesCapacityBlockPhases({
  phases: [percentagePhase],
  capacity: capacity160,
  recurringLines: [
    {
      itemKey: 'clinical_core',
      publicName: 'Verto Clínica + ABA',
      normalPricePerPatientCents: 1000,
      blockDirectMarginalCostCents: 100
    }
  ],
  percentageCostBasisPoints: 0,
  policy: DEFAULT_SALES_PROFITABILITY_POLICY
})[0];
assert.equal(percentagePricing.effectivePricePerPatientCents, 900);
assert.equal(percentagePricing.blockPriceCents, 9000);

const percentageInput = pluralInput(151, false);
percentageInput.lines.find(
  (line) => line.itemKey === 'appointments_communication'
)!.itemDiscountBasisPoints = 1000;
const percentageResult = calculateSalesModularProposal(
  percentageInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.equal(
  percentageResult.commercialPricing.capacityBlockPhases[0]
    .modules.find(
      (module) => module.itemKey === 'appointments_communication'
    )?.effectivePricePerPatientCents,
  265,
  'desconto percentual é aplicado ao preço unitário da fase em centavos'
);
assert.equal(
  percentageResult.commercialPricing.capacityBlockPhases[0].blockPriceCents,
  15_040
);

assert.equal(
  posterior151.modules.find(
    (module) => module.itemKey === 'school_management'
  )?.effectivePricePerPatientCents! * 160,
  31_360,
  'fim do benefício aplica o preço do módulo sobre toda a capacidade contratada'
);
assert.equal(
  promotional151.modules.find(
    (module) => module.itemKey === 'school_management'
  )?.blockRevenueCents,
  0,
  'fim do benefício não altera a fase promocional anterior'
);

assert.notEqual(
  promotional151.blockMarginalCostCents,
  result151.promotional.directCostCents,
  'custo marginal do bloco permanece separado do custo médio mensal'
);
assert.equal(
  promotional151.blockMarginStatus,
  promotional151.blockIncrementalMarginBasisPoints === null
    ? 'insufficient_data'
    : promotional151.blockIncrementalMarginBasisPoints >=
        DEFAULT_SALES_PROFITABILITY_POLICY
          .moduleTargetIncrementalMarginBasisPoints
      ? 'healthy'
      : promotional151.blockIncrementalMarginBasisPoints >=
          DEFAULT_SALES_PROFITABILITY_POLICY
            .capacityMinimumIncrementalMarginBasisPoints
        ? 'acceptable'
        : promotional151.blockIncrementalMarginBasisPoints >=
            DEFAULT_SALES_PROFITABILITY_POLICY
              .clinicMinimumEbitdaMarginBasisPoints
          ? 'attention'
          : 'blocked'
);

const insufficientPricing = deriveSalesCapacityBlockPhases({
  phases: [percentagePhase],
  capacity: capacity160,
  recurringLines: [
    {
      itemKey: 'clinical_core',
      publicName: 'Verto Clínica + ABA',
      normalPricePerPatientCents: 1000,
      blockDirectMarginalCostCents: null
    }
  ],
  percentageCostBasisPoints: 0,
  policy: DEFAULT_SALES_PROFITABILITY_POLICY
})[0];
assert.equal(insufficientPricing.blockMarginalCostCents, null);
assert.equal(insufficientPricing.blockMarginStatus, 'insufficient_data');

const approvalHashInput = buildSalesCommercialApprovalHashInput(
  result151,
  ['CAPACITY_MARGIN_BELOW_MINIMUM']
);
assert.deepEqual(
  approvalHashInput.approvalResult.capacityBlockPhases.map(
    (phase) => phase.blockPriceCents
  ),
  [15_340, 17_300]
);
const changedPriceInput = pluralInput(151);
changedPriceInput.lines.find(
  (line) => line.itemKey === 'appointments_communication'
)!.proposedPricePerPatientCents = 296;
const changedPrice = calculateSalesModularProposal(
  changedPriceInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.notDeepEqual(
  buildSalesCommercialApprovalHashInput(
    changedPrice,
    ['CAPACITY_MARGIN_BELOW_MINIMUM']
  ),
  approvalHashInput,
  'alterar a composição derivada invalida o hash aprovado'
);

const frozenSnapshot = structuredClone(result151);
const frozenPublicPrices =
  frozenSnapshot.commercialPricing.capacityBlockPhases.map(
    (phase) => phase.blockPriceCents
  );
const changedCatalog = pluralCatalog();
changedCatalog.customCapacityPolicy!.blockPriceCents = 999_999;
changedCatalog.items.find(
  (item) => item.itemKey === 'clinical_core'
)!.recurringAmountCents = 1;
assert.deepEqual(
  frozenSnapshot.commercialPricing.capacityBlockPhases.map(
    (phase) => phase.blockPriceCents
  ),
  frozenPublicPrices,
  'snapshot publicado não é recalculado pelo catálogo atual'
);
assert.ok(
  frozenSnapshot.commercialPricing.capacityBlockPhases.every(
    (phase) =>
      Number.isInteger(phase.blockPriceCents) &&
      Number.isInteger(phase.contractedMonthlyRevenueCents) &&
      phase.modules.every(
        (module) =>
          Number.isInteger(module.effectivePricePerPatientCents) &&
          Number.isInteger(module.blockRevenueCents)
      )
  ),
  'resultado monetário final usa somente centavos inteiros'
);

const totalModeInput = pluralInput(151, false);
totalModeInput.lines[0] = {
  ...totalModeInput.lines[0],
  pricingEditMode: 'monthly_total',
  proposedPricePerPatientCents: null,
  customRecurringAmountCents: 188_160
};
const totalModeResult = calculateSalesModularProposal(
  totalModeInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
const totalModeCore = totalModeResult.lines.find(
  (line) => line.itemKey === 'clinical_core'
)!;
assert.equal(
  totalModeCore.commercialPricing.derivedMonthlyRevenueCents,
  totalModeCore.commercialPricing.proposedPricePerPatientCents! * 160
);
assert.equal(
  totalModeResult.commercialPricing.capacityBlockPhases[0]
    .contractedMonthlyRevenueCents,
  totalModeResult.promotionalRecurringRevenueCents
);
assert.deepEqual(
  totalModeResult.commercialPricing.monthlyTotalMismatches,
  [],
  'total divisível fecha exatamente sem ajuste'
);

const incompatibleTotalInput = pluralInput(150, false);
incompatibleTotalInput.lines = [
  {
    itemKey: 'clinical_core',
    tierId: PACKAGE_TIERS.custom.id,
    quantity: 150,
    pricingEditMode: 'monthly_total',
    proposedPricePerPatientCents: null,
    customRecurringAmountCents: 230_105,
    itemDiscountBasisPoints: 0
  }
];
const incompatibleTotalResult = calculateSalesModularProposal(
  incompatibleTotalInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
const incompatibleCore = incompatibleTotalResult.lines[0];
assert.equal(
  incompatibleCore.commercialPricing.requestedMonthlyRevenueCents,
  230_105
);
assert.equal(
  incompatibleCore.commercialPricing.derivedMonthlyRevenueCents,
  230_100
);
assert.equal(
  incompatibleTotalResult.input.lines[0].customRecurringAmountCents,
  230_105,
  'o total digitado não é alterado silenciosamente'
);
assert.deepEqual(
  incompatibleTotalResult.commercialPricing.monthlyTotalMismatches[0],
  {
    itemKey: 'clinical_core',
    publicName: 'Verto Clínica',
    requestedMonthlyRevenueCents: 230_105,
    proposedPricePerPatientCents: 1534,
    nearestRepresentableMonthlyRevenueCents: 230_100,
    adjustmentCents: -5
  }
);
assert.ok(
  classifySalesProposalReview(
    incompatibleTotalResult
  ).technicalBlockingCodes.includes(
    'PRICING_MONTHLY_TOTAL_NOT_REPRESENTABLE:clinical_core'
  )
);
const acceptedTotalInput = structuredClone(incompatibleTotalInput);
acceptedTotalInput.lines[0].customRecurringAmountCents = 230_100;
const acceptedTotalResult = calculateSalesModularProposal(
  acceptedTotalInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.deepEqual(
  acceptedTotalResult.commercialPricing.monthlyTotalMismatches,
  []
);
assert.equal(
  acceptedTotalResult.input.lines[0].customRecurringAmountCents,
  230_100,
  'após confirmação, input e snapshot permanecem canônicos'
);
assert.equal(
  result150.commercialPricing.capacityBlockPhases[0]
    .contractedMonthlyRevenueCents,
  230_100,
  'a fixture Plural de R$ 2.301,00 permanece válida'
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
assert.deepEqual(
  legacyResult.commercialPricing.capacityBlockPhases,
  [],
  'snapshot histórico sem novos campos continua legível pelo contrato legado'
);
assert.equal(
  isSalesCommercialReviewCode('CLINIC_MARGIN_BELOW_60'),
  true,
  'código percentual legado permanece reconhecido para snapshots históricos'
);
assert.equal(
  (result150.economics?.blockingCodes || []).includes(
    'CLINIC_MARGIN_BELOW_60'
  ),
  false,
  'nova simulação nunca emite o código percentual legado'
);

const threePhaseInput = pluralInput(150);
threePhaseInput.lines.find(
  (line) => line.itemKey === 'appointments_communication'
)!.offerDiscount = {
  type: 'percentage',
  percentageBasisPoints: 5000,
  startsAt: effectiveAt,
  endsAt: '2026-10-30T00:00:00.000Z',
  durationCount: 3,
  durationUnit: 'months',
  priceBeforeDiscountCents: 44_250,
  discountedPriceCents: 22_050,
  priceAfterExpirationCents: 44_250,
  reason: 'Benefício temporário independente para testar três fases.',
  status: 'active'
};
const threePhaseResult = calculateSalesModularProposal(
  threePhaseInput,
  pluralCatalog(),
  modularAssumptionsFixture
);
assert.equal(
  threePhaseResult.commercialPricing.capacityBlockPhases.length,
  3
);
assert.deepEqual(
  threePhaseResult.commercialPricing.capacityBlockPhases.map(
    (phase) => phase.phaseNumber
  ),
  [1, 2, 3]
);

const toPublicOffer = (
  result: ReturnType<typeof calculateSalesModularProposal>,
  capacityBlockPhases: any[] | undefined =
    result.commercialPricing.capacityBlockPhases
) =>
  ({
    offerType: 'modular',
    proposalName: 'Proposta de validação',
    currency: 'BRL',
    initialActivePatientQuantity: result.input.patientQuantity,
    basePackage: {
      name: result.basePackage.name,
      limitQuantity: result.basePackage.limitQuantity,
      includedStorageMb: result.basePackage.includedStorageMb,
      capacity: result.basePackage.capacity
        ? {
            ...result.basePackage.capacity,
            blockSizePatients:
              result.basePackage.capacity.policy.blockSizePatients,
            gracePeriodDays:
              result.basePackage.capacity.policy.gracePeriodDays,
            billingAdjustment: 'next_cycle'
          }
        : null
    },
    items: result.lines.map((line) => ({
      itemKey: line.itemKey,
      publicName: line.publicName,
      description: line.description,
      pricingMode: line.pricingMode,
      quantity: line.quantity,
      limitQuantity: line.limitQuantity,
      includedQuantity: line.includedQuantity,
      grossRecurringAmountCents: line.grossRecurringRevenueCents,
      promotionalRecurringAmountCents:
        line.promotionalRecurringRevenueCents,
      postPromotionRecurringAmountCents:
        line.postPromotionRecurringRevenueCents,
      oneTimeAmountCents: line.oneTimeRevenueCents,
      itemDiscountBasisPoints: line.itemDiscountBasisPoints,
      offerDiscount: line.offerDiscount,
      publicMetadata: line.publicMetadata
    })),
    promotionalMonthlyAmountCents:
      result.promotionalRecurringRevenueCents,
    postDiscountMonthlyAmountCents:
      result.postPromotionRecurringRevenueCents,
    oneTimeAmountCents: result.oneTimeRevenueCents,
    globalDiscountCents: result.globalDiscountCents,
    globalDiscountPercentage: 0,
    discountDurationMonths: 0,
    onboardingInstallments: 1,
    expiresAt: '2026-08-30T00:00:00.000Z',
    status: 'sent',
    modularCheckoutEnabled: false,
    stripeReady: false,
    commercialPhases: result.commercialPhases,
    capacityBlockPhases
  }) as any;

const threePhaseMarkup = renderToStaticMarkup(
  React.createElement(ModularOfferDetails, {
    offer: toPublicOffer(threePhaseResult)
  })
);
assert.match(threePhaseMarkup, /Fase 1/);
assert.match(threePhaseMarkup, /Fase 2/);
assert.match(threePhaseMarkup, /Fase 3/);
assert.match(threePhaseMarkup, /30\/07\/2026/);
assert.match(threePhaseMarkup, /30\/10\/2026/);
assert.match(threePhaseMarkup, /30\/01\/2027/);
assert.match(threePhaseMarkup, /30\/08\/2026/);
assert.match(threePhaseMarkup, /condição permanente/);
const invalidDateOffer = structuredClone(toPublicOffer(threePhaseResult));
invalidDateOffer.capacityBlockPhases[0].startsAt = 'data-inválida';
let invalidDateMarkup = '';
assert.doesNotThrow(() => {
  invalidDateMarkup = renderToStaticMarkup(
    React.createElement(ModularOfferDetails, {
      offer: invalidDateOffer
    })
  );
});
assert.match(invalidDateMarkup, /Data não informada/);
assert.deepEqual(
  threePhaseResult.commercialPricing.capacityBlockPhases.map((phase) => ({
    startsAt: phase.startsAt,
    endsAt: phase.endsAt
  })),
  [
    {
      startsAt: '2026-07-30T00:00:00.000Z',
      endsAt: '2026-10-30T00:00:00.000Z'
    },
    {
      startsAt: '2026-10-30T00:00:00.000Z',
      endsAt: '2027-01-30T00:00:00.000Z'
    },
    {
      startsAt: '2027-01-30T00:00:00.000Z',
      endsAt: null
    }
  ],
  'a formatação não altera os timestamps congelados'
);

const historicalOffer = toPublicOffer(legacyResult, undefined);
historicalOffer.basePackage = {
  ...historicalOffer.basePackage,
  capacity: {
    schemaVersion: 1,
    demandPatients: 151,
    baseLimitPatients: 150,
    basePriceCents: 159_900,
    minimumBlocks: 1,
    selectedBlocks: 1,
    selectionMode: 'automatic',
    addedCapacityPatients: 10,
    totalContractedLimitPatients: 160,
    includedStorageMb: 16_000,
    blocksMonthlyRevenueCents: 7_990,
    effectiveBlockPriceCents: 7_990,
    blockPricingBasis: 'catalog_fixed',
    blockSizePatients: 10,
    gracePeriodDays: 7,
    billingAdjustment: 'next_cycle'
  }
};
delete historicalOffer.capacityBlockPhases;
const historicalMarkup = renderToStaticMarkup(
  React.createElement(ModularOfferDetails, {
    offer: historicalOffer
  })
);
assert.match(historicalMarkup, /R\$\s*79,90/);
assert.doesNotMatch(
  historicalMarkup,
  /definido na condição comercial/,
  'snapshot histórico exibe seu preço congelado'
);

assert.equal(
  salesCapacityBlockPhasesMatch(
    result151.commercialPricing.capacityBlockPhases,
    [...result151.commercialPricing.capacityBlockPhases]
      .reverse()
      .map((phase) => ({
        ...phase,
        modules: [...phase.modules].reverse()
      }))
  ),
  true,
  'ordem do payload não interfere na reconciliação'
);
for (const mutate of [
  (snapshot: any) => {
    snapshot[0].modules[0].effectivePricePerPatientCents += 1;
  },
  (snapshot: any) => {
    snapshot[0].blockMarginalCostCents += 1;
  },
  (snapshot: any) => {
    snapshot[0].blockIncrementalMarginBasisPoints += 1;
  },
  (snapshot: any) => {
    snapshot[0].startsAt = '2026-08-01T00:00:00.000Z';
  },
  (snapshot: any) => {
    snapshot[0].blockSizePatients += 1;
  }
]) {
  const tampered = structuredClone(
    result151.commercialPricing.capacityBlockPhases
  );
  mutate(tampered);
  assert.equal(
    salesCapacityBlockPhasesMatch(
      tampered,
      result151.commercialPricing.capacityBlockPhases
    ),
    false,
    'adulteração isolada da fase deve ser rejeitada'
  );
}

const serverSource = readFileSync('server.ts', 'utf8');
const publicCapacitySanitizer = serverSource.slice(
  serverSource.indexOf('const sanitizePublicCapacityBlockPhases'),
  serverSource.indexOf('const sanitizePublicBasePackage')
);
assert.match(publicCapacitySanitizer, /blockPriceCents/);
assert.match(publicCapacitySanitizer, /effectivePricePerPatientCents/);
assert.doesNotMatch(
  publicCapacitySanitizer,
  /MarginalCost|Contribution|Margin|minimumPrice|policy|approval|hash/i
);
assert.match(
  serverSource,
  /capacityBlockPhases:\s*sanitizePublicCapacityBlockPhases/
);
const publicBaseSanitizer = serverSource.slice(
  serverSource.indexOf('const sanitizePublicBasePackage'),
  serverSource.indexOf('const loadPublicSalesOffer')
);
assert.doesNotMatch(publicBaseSanitizer, /\bpolicy\s*:/);
assert.match(
  publicBaseSanitizer,
  /capacity\.policy\?\.blockPriceCents/
);
assert.match(serverSource, /salesCapacityBlockPhasesMatch/);

const publicSource = readFileSync(
  'src/components/PublicSalesOffer.tsx',
  'utf8'
);
const modularDetailsSource = readFileSync(
  'src/components/ModularPublicOfferDetails.tsx',
  'utf8'
);
assert.match(
  modularDetailsSource,
  /mantendo os mesmos módulos contratados e os preços por paciente/
);
assert.doesNotMatch(
  publicSource.slice(
    publicSource.indexOf('type PublicCapacityBlockPhase'),
    publicSource.indexOf('export type ModularPublicOffer')
  ),
  /MarginalCost|Contribution|Margin|minimumPrice|policyHash|resultHash/
);

const builderSource = readFileSync(
  'src/components/SalesModularProposalBuilder.tsx',
  'utf8'
);
assert.match(builderSource, /Composição do bloco de/);
assert.match(builderSource, /Parcela no bloco de/);
assert.doesNotMatch(
  builderSource.slice(
    builderSource.indexOf('Blocos adicionais de capacidade'),
    builderSource.indexOf('Usar quantidade recomendada')
  ),
  /value=\{[^}]*blockPriceCents/
);
assert.doesNotMatch(
  builderSource,
  /fetch\([^)]*module|forEach\([^]*fetch\(/,
  'recálculo usa catálogo e estado já carregados, sem requisição por módulo'
);

console.log('sales modular capacity block pricing tests passed');
