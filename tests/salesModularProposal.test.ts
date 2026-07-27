import assert from 'node:assert/strict';
import {
  allocateSalesCents,
  calculateSalesModularProposal,
  recommendSalesPackageTier,
  type SalesModularProposalInput,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot,
  type SalesPricingCatalogTier,
  type SalesPricingCostModel
} from '../src/utils/salesModularProposal';
import type {
  SalesAssumptionSnapshot,
  SalesAssumptionValues
} from '../src/utils/salesProfitability';

const zeroCost = (
  itemId: string,
  overrides: Partial<SalesPricingCostModel> = {}
): SalesPricingCostModel => ({
  id: `cost-${itemId}`,
  itemId,
  version: 1,
  directFixedMonthlyCostCents: 0,
  directCostPerPatientCents: 0,
  directCostPerClinicCents: 0,
  directCostPerUsageUnitCents: 0,
  storageCostPerGbCents: 0,
  egressCostPerGbCents: 0,
  notificationCostPerUnitCents: 0,
  processingCostPerUnitCents: 0,
  supportFixedMonthlyCostCents: 0,
  supportCostPerPatientCents: 0,
  operationalFixedMonthlyCostCents: 0,
  onboardingCostCents: 0,
  sharedCostAllocationWeight: itemId === 'core' ? 4 : 1,
  costSource: 'manual',
  sourceDetail: 'Valores explícitos do teste',
  effectiveAt: '2026-07-27T00:00:00.000Z',
  ...overrides
});

const tier = (
  itemId: string,
  key: string,
  maximum: number | null,
  amount: number | null,
  sortOrder: number,
  metadata: Record<string, any> = {}
): SalesPricingCatalogTier => ({
  id: `${itemId}-${key}`,
  itemId,
  tierKey: key,
  publicName: `${key} ${maximum ?? 'custom'}`,
  minimumQuantity: maximum === null ? 101 : 1,
  maximumQuantity: maximum,
  includedQuantity: maximum,
  recurringAmountCents: amount,
  oneTimeAmountCents: null,
  sortOrder,
  isCustom: maximum === null,
  metadata
});

const item = (
  id: string,
  itemKey: string,
  publicName: string,
  pricingMode: SalesPricingCatalogItem['pricingMode'],
  tiers: SalesPricingCatalogTier[],
  recurringAmountCents: number | null,
  sortOrder: number,
  billingInterval: SalesPricingCatalogItem['billingInterval'] = 'monthly'
): SalesPricingCatalogItem => ({
  id,
  itemKey,
  publicName,
  internalName: publicName,
  description: `${publicName} para teste`,
  pricingMode,
  billingInterval,
  unitName: itemKey === 'insurance_tiss' ? 'guias/mês' : 'pacientes',
  includedQuantity: null,
  maximumQuantity: null,
  recurringAmountCents,
  oneTimeAmountCents: null,
  sortOrder,
  isRequired: itemKey === 'clinical_core',
  isPublic: true,
  isActive: true,
  compatibleBasePackages: [],
  metadata: {},
  tiers,
  costModel: zeroCost(id)
});

const coreTiers = [
  tier('core', 'up_to_10', 10, 19900, 10),
  tier('core', 'up_to_25', 25, 39900, 20),
  tier('core', 'up_to_50', 50, 69900, 30),
  tier('core', 'up_to_100', 100, 119900, 40),
  tier('core', 'custom', null, null, 50)
];
const agendaTiers = [
  tier('agenda', 'up_to_10', 10, 4900, 10),
  tier('agenda', 'up_to_25', 25, 7900, 20),
  tier('agenda', 'up_to_50', 50, 12900, 30),
  tier('agenda', 'up_to_100', 100, 19900, 40),
  tier('agenda', 'custom', null, null, 50)
];
const insuranceTiers = [
  tier('insurance', 'up_to_100', 100, 14900, 10),
  tier('insurance', 'up_to_500', 500, 29900, 20),
  tier('insurance', 'custom', null, null, 30)
];
const schoolTiers = [
  tier('school', 'up_to_10', 10, 5900, 10),
  tier('school', 'up_to_25', 25, 9900, 20),
  tier('school', 'up_to_50', 50, 14900, 30),
  tier('school', 'up_to_100', 100, 24900, 40),
  tier('school', 'custom', null, null, 50)
];
const storageTiers = [
  tier('storage', 'gb_1', null, 299, 10, { gigabytes: 1 }),
  {
    ...tier('storage', 'gb_5', null, 990, 20, { gigabytes: 5 }),
    isCustom: false,
    minimumQuantity: 1,
    includedQuantity: 5120
  },
  {
    ...tier('storage', 'gb_10', null, 1690, 30, { gigabytes: 10 }),
    isCustom: false,
    minimumQuantity: 1,
    includedQuantity: 10240
  }
];
storageTiers[0].isCustom = false;
storageTiers[0].minimumQuantity = 1;
storageTiers[0].includedQuantity = 1024;

const catalog: SalesPricingCatalogSnapshot = {
  id: 'catalog-v1',
  version: 1,
  name: 'Catálogo teste',
  status: 'active',
  effectiveAt: '2026-07-27T00:00:00.000Z',
  allocationSettings: {
    stripePercentage: 'net_revenue',
    stripeFixed: 'base_package',
    revenueTax: 'net_revenue',
    delinquency: 'net_revenue',
    sharedPlatformCosts: 'configured_weight',
    belowEbitda: 'configured_weight'
  },
  items: [
    item('core', 'clinical_core', 'Verto Clínica', 'package_limit', coreTiers, null, 10),
    item('agenda', 'appointments_communication', 'Agenda e Comunicação', 'package_limit', agendaTiers, null, 20),
    item('finance', 'financial_management', 'Financeiro e Gestão', 'flat_monthly', [], 9900, 30),
    item('insurance', 'insurance_tiss', 'Convênios e TISS', 'usage_tier', insuranceTiers, null, 40),
    item('school', 'school_management', 'Gestão Escolar', 'package_limit', schoolTiers, null, 50),
    item('storage', 'additional_storage', 'Armazenamento adicional', 'storage_block', storageTiers, null, 60),
    item('onboarding', 'onboarding', 'Implantação', 'one_time', [], null, 70, 'one_time')
  ]
};

const zeroValues: SalesAssumptionValues = {
  officialUnitAmountCents: 7990,
  stripeFeeBasisPoints: 0,
  stripeFixedFeeCents: 0,
  revenueTaxBasisPoints: 0,
  estimatedDelinquencyBasisPoints: 0,
  variablePatientCostCents: 0,
  variableClinicCostCents: 0,
  storageCostCents: 0,
  egressCostCents: 0,
  processingCostCents: 0,
  notificationCostCents: 0,
  otherVariableCostCents: 0,
  monthlySupportClinicCostCents: 0,
  supportPatientCostCents: 0,
  monthlyOperationalCostCents: 0,
  defaultOnboardingCostCents: 10000,
  commercialCommissionBasisPoints: 0,
  fixedMonthlyEligibleCostCents: 0,
  fixedAllocationMethod: 'none',
  fixedAllocationPatientCount: null,
  fixedAllocationClinicCount: null,
  customFixedAllocationCents: null,
  depreciationAmortizationCents: 0,
  financialExpensesCents: 0,
  profitTaxBasisPoints: 0,
  otherBelowEbitdaCents: 0,
  minimumMarginBasisPoints: 1000,
  healthyMarginBasisPoints: 3000,
  attentionMarginBasisPoints: 1000,
  usageProfiles: {}
};

const assumptions: SalesAssumptionSnapshot = {
  id: 'assumptions-v1',
  version: 1,
  name: 'Premissas teste',
  effectiveAt: '2026-07-27T00:00:00.000Z',
  values: zeroValues,
  sources: {},
  sourceDetails: {}
};

const proposal = (
  overrides: Partial<SalesModularProposalInput> = {}
): SalesModularProposalInput => ({
  patientQuantity: 17,
  expectedPatientQuantity12Months: 25,
  basePackageTierId: 'core-up_to_25',
  lines: [
    {
      itemKey: 'clinical_core',
      tierId: 'core-up_to_25',
      quantity: 17,
      itemDiscountBasisPoints: 0
    },
    {
      itemKey: 'appointments_communication',
      tierId: 'agenda-up_to_25',
      quantity: 17,
      itemDiscountBasisPoints: 0
    },
    {
      itemKey: 'financial_management',
      quantity: 1,
      itemDiscountBasisPoints: 0
    },
    {
      itemKey: 'additional_storage',
      tierId: 'storage-gb_5',
      quantity: 1,
      itemDiscountBasisPoints: 0
    }
  ],
  globalDiscountBasisPoints: 0,
  discountDurationMonths: 0,
  offerValidityDays: 14,
  usageProfile: 'standard',
  ...overrides
});

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('recomenda a menor faixa para 8, 17, 42 e 87 pacientes', () => {
  assert.equal(recommendSalesPackageTier(catalog, 8)?.id, 'core-up_to_10');
  assert.equal(recommendSalesPackageTier(catalog, 17)?.id, 'core-up_to_25');
  assert.equal(recommendSalesPackageTier(catalog, 42)?.id, 'core-up_to_50');
  assert.equal(recommendSalesPackageTier(catalog, 87)?.id, 'core-up_to_100');
});

test('respeita todos os limites do pacote-base, inclusive personalizado', () => {
  for (const [patients, expectedTier] of [
    [1, 'core-up_to_10'],
    [10, 'core-up_to_10'],
    [11, 'core-up_to_25'],
    [25, 'core-up_to_25'],
    [26, 'core-up_to_50'],
    [50, 'core-up_to_50'],
    [51, 'core-up_to_100'],
    [100, 'core-up_to_100'],
    [101, 'core-custom']
  ] as const) {
    assert.equal(
      recommendSalesPackageTier(catalog, patients)?.id,
      expectedTier
    );
  }
});

test('calcula exatamente o exemplo de 17 pacientes em R$ 586,90', () => {
  const result = calculateSalesModularProposal(
    proposal(),
    catalog,
    assumptions
  );
  assert.equal(result.grossRecurringRevenueCents, 58_690);
  assert.equal(result.promotionalRecurringRevenueCents, 58_690);
  assert.equal(result.postPromotionRecurringRevenueCents, 58_690);
  assert.equal(result.lines.length, 4);
  assert.equal(
    result.lines.reduce(
      (sum, line) => sum + line.promotionalRecurringRevenueCents,
      0
    ),
    result.promotional.recurringRevenueCents
  );
});

test('preserva igualdade exata em centavos com descontos por item e global', () => {
  const discounted = proposal({
    globalDiscountBasisPoints: 333,
    discountDurationMonths: 7,
    lines: proposal().lines.map((line, index) => ({
      ...line,
      itemDiscountBasisPoints: index === 1 ? 777 : 0
    }))
  });
  const result = calculateSalesModularProposal(
    discounted,
    catalog,
    assumptions
  );
  assert.equal(
    result.lines.reduce((sum, line) => sum + line.itemDiscountCents, 0),
    result.itemDiscountCents
  );
  assert.equal(
    result.lines.reduce(
      (sum, line) => sum + line.allocatedGlobalDiscountCents,
      0
    ),
    result.globalDiscountCents
  );
  for (const field of [
    'directCostCents',
    'transactionAndTaxCostAllocatedCents',
    'sharedPlatformCostAllocatedCents',
    'contributionMarginCents',
    'ebitdaCents',
    'belowEbitdaCostAllocatedCents',
    'profitTaxAllocatedCents',
    'netIncomeCents'
  ] as const) {
    assert.equal(
      result.lines.reduce(
        (sum, line) => sum + Number(line.promotional[field]),
        0
      ),
      result.promotional[field]
    );
  }
});

test('rateia custos reais e compartilhados sem perder nenhum centavo', () => {
  const values: SalesAssumptionValues = {
    ...zeroValues,
    stripeFeeBasisPoints: 290,
    stripeFixedFeeCents: 39,
    revenueTaxBasisPoints: 600,
    estimatedDelinquencyBasisPoints: 125,
    variablePatientCostCents: 11,
    variableClinicCostCents: 503,
    storageCostCents: 107,
    egressCostCents: 53,
    processingCostCents: 89,
    notificationCostCents: 47,
    otherVariableCostCents: 31,
    monthlySupportClinicCostCents: 397,
    supportPatientCostCents: 13,
    monthlyOperationalCostCents: 701,
    fixedMonthlyEligibleCostCents: 1009,
    fixedAllocationMethod: 'custom',
    customFixedAllocationCents: 1009,
    depreciationAmortizationCents: 307,
    financialExpensesCents: 211,
    profitTaxBasisPoints: 1500,
    otherBelowEbitdaCents: 101
  };
  const costedCatalog: SalesPricingCatalogSnapshot = {
    ...catalog,
    items: catalog.items.map((catalogItem, index) => ({
      ...catalogItem,
      costModel: zeroCost(catalogItem.id, {
        directFixedMonthlyCostCents: 101 + index,
        directCostPerPatientCents: 3,
        directCostPerClinicCents: 17,
        directCostPerUsageUnitCents: 2,
        storageCostPerGbCents: 5,
        egressCostPerGbCents: 7,
        notificationCostPerUnitCents: 1,
        processingCostPerUnitCents: 2,
        supportFixedMonthlyCostCents: 19,
        supportCostPerPatientCents: 2,
        operationalFixedMonthlyCostCents: 23,
        onboardingCostCents: 5000,
        sharedCostAllocationWeight: index + 1
      })
    }))
  };
  const result = calculateSalesModularProposal(
    proposal({
      globalDiscountBasisPoints: 333,
      discountDurationMonths: 9
    }),
    costedCatalog,
    { ...assumptions, values }
  );
  const expectedTransactionAndTax =
    Math.round(
      (result.promotional.recurringRevenueCents *
        Number(values.stripeFeeBasisPoints)) /
        10_000
    ) +
    Math.round(
      (result.promotional.recurringRevenueCents *
        Number(values.revenueTaxBasisPoints)) /
        10_000
    ) +
    Math.round(
      (result.promotional.recurringRevenueCents *
        Number(values.estimatedDelinquencyBasisPoints)) /
        10_000
    ) +
    Number(values.stripeFixedFeeCents);
  assert.equal(
    result.promotional.transactionAndTaxCostAllocatedCents,
    expectedTransactionAndTax
  );
  assert.equal(
    result.lines[0].promotional.transactionAndTaxCostAllocatedCents! >=
      Number(values.stripeFixedFeeCents),
    true
  );
  for (const period of ['promotional', 'postPromotion'] as const) {
    for (const field of [
      'netRevenueCents',
      'directCostCents',
      'transactionAndTaxCostAllocatedCents',
      'sharedPlatformCostAllocatedCents',
      'contributionMarginCents',
      'ebitdaCents',
      'belowEbitdaCostAllocatedCents',
      'profitTaxAllocatedCents',
      'netIncomeCents'
    ] as const) {
      assert.equal(
        result.lines.reduce(
          (sum, line) => sum + Number(line[period][field]),
          0
        ),
        field === 'netRevenueCents'
          ? result[period].recurringRevenueCents
          : result[period][field]
      );
    }
  }
  assert.notEqual(result.minimumRecommendedRecurringRevenueCents, null);
  assert.notEqual(result.maximumRecommendedDiscountBasisPoints, null);
});

test('atribui deterministicamente o residuo ao pacote-base', () => {
  assert.deepEqual(allocateSalesCents(10, [1, 1, 1], 0), [4, 3, 3]);
  assert.deepEqual(allocateSalesCents(5, [0, 0, 0], 1), [0, 5, 0]);
});

test('nao transforma custo indisponivel em zero', () => {
  const unavailableCatalog: SalesPricingCatalogSnapshot = {
    ...catalog,
    items: catalog.items.map((catalogItem) =>
      catalogItem.itemKey === 'financial_management'
        ? {
            ...catalogItem,
            costModel: {
              ...catalogItem.costModel!,
              costSource: 'unavailable',
              directFixedMonthlyCostCents: null
            }
          }
        : catalogItem
    )
  };
  const result = calculateSalesModularProposal(
    proposal(),
    unavailableCatalog,
    assumptions
  );
  assert.ok(result.missingCosts.includes('Financeiro e Gestão'));
  assert.equal(result.promotional.directCostCents, null);
  assert.equal(result.promotional.ebitdaCents, null);
  assert.equal(result.rating, 'insufficient_data');
});

test('aceita todos os modulos, uso por guia e multiplos blocos de armazenamento', () => {
  const result = calculateSalesModularProposal(
    proposal({
      lines: [
        {
          itemKey: 'clinical_core',
          tierId: 'core-up_to_25',
          quantity: 17
        },
        {
          itemKey: 'appointments_communication',
          tierId: 'agenda-up_to_25',
          quantity: 17
        },
        { itemKey: 'financial_management', quantity: 1 },
        {
          itemKey: 'insurance_tiss',
          tierId: 'insurance-up_to_500',
          quantity: 240
        },
        {
          itemKey: 'school_management',
          tierId: 'school-up_to_25',
          quantity: 17
        },
        {
          itemKey: 'additional_storage',
          tierId: 'storage-gb_1',
          quantity: 2
        },
        {
          itemKey: 'additional_storage',
          tierId: 'storage-gb_5',
          quantity: 3
        },
        {
          itemKey: 'onboarding',
          quantity: 1,
          customOneTimeAmountCents: 15000
        }
      ]
    }),
    catalog,
    assumptions
  );
  assert.equal(result.lines.length, 8);
  assert.equal(result.grossRecurringRevenueCents, 101_068);
  assert.equal(result.oneTimeRevenueCents, 15_000);
  assert.equal(
    result.lines.filter((line) => line.itemKey === 'additional_storage').length,
    2
  );
  assert.equal(
    result.lines.find((line) => line.itemKey === 'insurance_tiss')?.quantity,
    240
  );
});

test('permite item gratuito e pacote personalizado autorizado', () => {
  const freeResult = calculateSalesModularProposal(
    proposal({
      lines: proposal().lines.map((line) =>
        line.itemKey === 'financial_management'
          ? { ...line, itemDiscountBasisPoints: 10_000 }
          : line
      )
    }),
    catalog,
    assumptions
  );
  assert.equal(
    freeResult.lines.find(
      (line) => line.itemKey === 'financial_management'
    )?.postPromotionRecurringRevenueCents,
    0
  );

  const customResult = calculateSalesModularProposal(
    proposal({
      patientQuantity: 101,
      expectedPatientQuantity12Months: 130,
      basePackageTierId: 'core-custom',
      lines: [
        {
          itemKey: 'clinical_core',
          tierId: 'core-custom',
          quantity: 101,
          customRecurringAmountCents: 150_000
        }
      ]
    }),
    catalog,
    assumptions
  );
  assert.equal(customResult.basePackage.limitQuantity, null);
  assert.equal(customResult.grossRecurringRevenueCents, 150_000);
});

test('rejeita desconto invalido com codigo comercial especifico', () => {
  assert.throws(
    () =>
      calculateSalesModularProposal(
        proposal({ globalDiscountBasisPoints: 10_001 }),
        catalog,
        assumptions
      ),
    /PRICING_INVALID_DISCOUNT/
  );
  assert.throws(
    () =>
      calculateSalesModularProposal(
        proposal({
          lines: proposal().lines.map((line, index) => ({
            ...line,
            itemDiscountBasisPoints: index === 0 ? 10_001 : 0
          }))
        }),
        catalog,
        assumptions
      ),
    /PRICING_INVALID_DISCOUNT/
  );
});

test('margem negativa exige justificativa e nao e bloqueada pelo motor', () => {
  const expensiveCatalog: SalesPricingCatalogSnapshot = {
    ...catalog,
    items: catalog.items.map((catalogItem) =>
      catalogItem.itemKey === 'clinical_core'
        ? {
            ...catalogItem,
            costModel: zeroCost(catalogItem.id, {
              directFixedMonthlyCostCents: 100_000
            })
          }
        : catalogItem
    )
  };
  const result = calculateSalesModularProposal(
    proposal({ lines: [proposal().lines[0]] }),
    expensiveCatalog,
    assumptions
  );
  assert.equal(result.rating, 'not_recommended');
  assert.equal(result.requiresJustification, true);
  assert.ok(
    result.lines[0].warnings.includes('EBITDA promocional negativo.')
  );
});

test('rejeita pacote-base menor que a quantidade da clinica', () => {
  assert.throws(
    () =>
      calculateSalesModularProposal(
        proposal({ basePackageTierId: 'core-up_to_10' }),
        catalog,
        assumptions
      ),
    /PRICING_PACKAGE_LIMIT_EXCEEDED/
  );
});

test('permite selecionar faixa superior à recomendada', () => {
  const result = calculateSalesModularProposal(
    proposal({
      basePackageTierId: 'core-up_to_50',
      lines: [
        {
          itemKey: 'clinical_core',
          tierId: 'core-up_to_50',
          quantity: 17
        }
      ]
    }),
    catalog,
    assumptions
  );
  assert.equal(result.basePackage.limitQuantity, 50);
  assert.equal(result.basePackage.availableQuantity, 33);
  assert.equal(result.grossRecurringRevenueCents, 69_900);
});

test('contabiliza implantacao uma unica vez nos horizontes', () => {
  const input = proposal({
    lines: [
      ...proposal().lines,
      {
        itemKey: 'onboarding',
        quantity: 1,
        itemDiscountBasisPoints: 0,
        customOneTimeAmountCents: 10000
      }
    ]
  });
  const result = calculateSalesModularProposal(input, catalog, assumptions);
  assert.equal(result.oneTimeRevenueCents, 10000);
  assert.equal(result.oneTimeDirectCostCents, 0);
  assert.equal(result.oneTimeContributionMarginCents, 10000);
  assert.equal(
    result.horizons['12'].ebitdaCents,
    Number(result.promotional.ebitdaCents) * 12 + 10000
  );
  assert.equal(
    result.horizons['24'].ebitdaCents,
    Number(result.promotional.ebitdaCents) * 24 + 10000
  );
});

test('parcela implantacao somente na projecao comercial', () => {
  const input = proposal({
    onboardingInstallments: 24,
    lines: [
      ...proposal().lines,
      {
        itemKey: 'onboarding',
        quantity: 1,
        itemDiscountBasisPoints: 0,
        customOneTimeAmountCents: 12000
      }
    ]
  });
  const result = calculateSalesModularProposal(input, catalog, assumptions);
  assert.equal(result.oneTimeRevenueCents, 12000);
  assert.equal(result.horizons['12'].oneTimeRevenueCents, 6000);
  assert.equal(result.horizons['24'].oneTimeRevenueCents, 12000);
  assert.equal(result.horizons['36'].oneTimeRevenueCents, 12000);
  assert.equal(
    result.horizons['12'].ebitdaCents,
    Number(result.promotional.ebitdaCents) * 12 + 6000
  );
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

console.log(`sales modular proposal tests passed: ${passed}/${tests.length}`);
