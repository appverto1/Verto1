import assert from 'node:assert/strict';
import {
  calculateSalesModularProposal,
  salesModularProposalRequiresVersionedProfitabilityPolicy,
  type SalesModularProposalInput,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot
} from '../src/utils/salesModularProposal';
import {
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  type OfferItemDiscount
} from '../src/utils/salesCommercialEvolution';
import {
  DEFAULT_SALES_PROFITABILITY_POLICY,
  calculateMaximumSupportedCostCents,
  calculateSalesDriverExpansion,
  calculateSalesMinimumPriceCents,
  calculateSalesModuleEffect,
  classifySalesProposalReview,
  classifyModuleIncrementalMargin,
  formatSalesBasisPointsPercent,
  formatSalesIncrementalMarginStatusLabel,
  isSalesCommercialReviewCode,
  validateSalesProfitabilityPolicy
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

const effectiveAt = '2026-07-28T00:00:00.000Z';
const datum = (value: number): SalesModularDriverValue => ({
  value,
  source: 'estimated',
  sourceDetail: 'Driver intensivo versionado do teste.',
  effectiveAt,
  version: 1
});

const driverValue: Partial<Record<SalesModularDriverKey, number>> = {
  monthlyAppointments: 300,
  remindersPerAppointment: 2,
  internalNotifications: 50,
  emails: 300,
  webPushNotifications: 100,
  financialEntries: 500,
  financialReports: 10,
  recurringProcesses: 20,
  tissGuides: 200,
  tissBatches: 10,
  tissXmlDocuments: 10,
  tissDocuments: 200,
  schoolPatients: 40,
  schoolMeetings: 20,
  schoolParticipants: 60,
  schoolDocuments: 20,
  schoolNotifications: 80,
  expectedStorageGb: 5
};

const moduleItem = (
  itemKey: string,
  publicName: string,
  recurringAmountCents: number,
  usageCostCents: number
): SalesPricingCatalogItem => {
  const required = DEFAULT_REQUIRED_DRIVERS_BY_ITEM[itemKey] || [];
  const profile = Object.fromEntries(
    required.map((key) => [key, datum(driverValue[key] ?? 1)])
  );
  return {
    id: `item-${itemKey}`,
    itemKey,
    publicName,
    internalName: publicName,
    description: `Módulo ${publicName}.`,
    pricingMode: 'flat_monthly',
    billingInterval: 'monthly',
    unitName: 'módulo',
    includedQuantity: null,
    maximumQuantity: null,
    recurringAmountCents,
    oneTimeAmountCents: 0,
    sortOrder: 10,
    isRequired: false,
    isPublic: true,
    isActive: true,
    compatibleBasePackages: [],
    metadata: {},
    tiers: [],
    costModel: {
      id: `cost-${itemKey}`,
      itemId: `item-${itemKey}`,
      version: 1,
      directFixedMonthlyCostCents: 0,
      directCostPerPatientCents: 0,
      directCostPerClinicCents: 0,
      directCostPerUsageUnitCents: usageCostCents,
      storageCostPerGbCents: 2,
      egressCostPerGbCents: 2,
      notificationCostPerUnitCents: 1,
      processingCostPerUnitCents: 1,
      otherVariableCostCents: 0,
      supportFixedMonthlyCostCents: 0,
      supportCostPerPatientCents: 0,
      operationalFixedMonthlyCostCents: 0,
      onboardingCostCents: 0,
      sharedCostAllocationWeight: 99,
      costSource: 'manual',
      sourceDetail: 'Custo incremental versionado do teste.',
      effectiveAt,
      driverConfig: {
        schemaVersion: 2,
        requiredDrivers: required,
        profiles: {
          light: profile,
          standard: profile,
          intensive: profile
        },
        unitCostsCents: Object.fromEntries(
          required.map((key) => [key, 0])
        )
      }
    }
  };
};

const agenda = moduleItem(
  'appointments_communication',
  'Agenda e Comunicação',
  40_000,
  2
);
const finance = moduleItem(
  'financial_management',
  'Financeiro e Gestão',
  45_000,
  1
);
const tiss = moduleItem(
  'insurance_tiss',
  'Convênios e TISS',
  50_000,
  2
);
const school = moduleItem(
  'school_management',
  'Gestão Escolar',
  55_000,
  2
);

const catalogWithEconomics = (
  modules: SalesPricingCatalogItem[] = []
): SalesPricingCatalogSnapshot => ({
  ...structuredClone(modularCatalogFixture),
  id: 'catalog-v4',
  version: 4,
  name: 'Catálogo comercial v4 — margem operacional modular',
  customCapacityPolicy: { ...DEFAULT_CUSTOM_CAPACITY_POLICY },
  hasVersionedCustomCapacityPolicy: true,
  profitabilityPolicy: structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
  hasVersionedProfitabilityPolicy: true,
  modularCostSettings: {
    ...structuredClone(modularCatalogFixture.modularCostSettings),
    ownership: {
      ...structuredClone(modularCatalogFixture.modularCostSettings.ownership),
      processingCost: 'item_direct',
      notificationCost: 'item_direct'
    }
  },
  items: [...structuredClone(modularCatalogFixture.items), ...structuredClone(modules)]
});

const inputWithModules = (
  modules: SalesPricingCatalogItem[],
  corePriceCents = 219_900
): SalesModularProposalInput => {
  const input = proposalInputFixture(
    150,
    PACKAGE_TIERS.custom.id,
    150,
    corePriceCents
  );
  input.usageProfile = 'standard';
  input.offerStartsAt = effectiveAt;
  input.lines.push(
    ...modules.map((item) => ({
      itemKey: item.itemKey,
      tierId: null,
      quantity: item.itemKey === 'insurance_tiss' ? 200 : 1,
      itemDiscountBasisPoints: 0
    }))
  );
  return input;
};

// Fórmula de preço-alvo: custos fixos/diretos/taxa fixa divididos pelo
// saldo após margem, Stripe, inadimplência, estornos e imposto.
assert.equal(
  calculateSalesMinimumPriceCents({
    fixedAllocatedCostCents: 10_000,
    directCostCents: 20_000,
    fixedPaymentFeeCents: 100,
    targetEbitdaMarginBasisPoints: 6000,
    stripePercentageBasisPoints: 300,
    delinquencyPercentageBasisPoints: 100,
    refundChargebackPercentageBasisPoints: 0,
    taxPercentageBasisPoints: 500
  }),
  Math.ceil((30_100 * 10_000) / 3100)
);
assert.equal(
  calculateSalesMinimumPriceCents({
    fixedAllocatedCostCents: 1,
    directCostCents: 1,
    fixedPaymentFeeCents: 1,
    targetEbitdaMarginBasisPoints: 9500,
    stripePercentageBasisPoints: 300,
    delinquencyPercentageBasisPoints: 100,
    refundChargebackPercentageBasisPoints: 0,
    taxPercentageBasisPoints: 500
  }),
  null,
  'denominador não positivo deve impedir o cálculo do preço-alvo'
);
assert.equal(calculateMaximumSupportedCostCents(100_000, 7500, 900), 16_000);

assert.equal(
  validateSalesProfitabilityPolicy(DEFAULT_SALES_PROFITABILITY_POLICY),
  true
);
assert.equal(
  validateSalesProfitabilityPolicy({
    ...DEFAULT_SALES_PROFITABILITY_POLICY,
    unexpected: true
  }),
  false,
  'propriedade extra deve ser rejeitada'
);

const customProfitabilityPolicy = {
  ...structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
  clinicMinimumEbitdaMarginBasisPoints: 5500,
  recurringTargetEbitdaMarginBasisPoints: 6500,
  postPromotionMinimumEbitdaMarginBasisPoints: 6500,
  moduleMinimumIncrementalMarginBasisPoints: 7000,
  capacityMinimumIncrementalMarginBasisPoints: 7000,
  moduleTargetIncrementalMarginBasisPoints: 7500
};
assert.equal(validateSalesProfitabilityPolicy(customProfitabilityPolicy), true);
assert.deepEqual(
  [5500, 6500, 7000, 7500].map(formatSalesBasisPointsPercent),
  ['55%', '65%', '70%', '75%'],
  'basis points devem ser exibidos em percentual pt-BR sem valores fixos'
);
assert.equal(
  classifyModuleIncrementalMargin(7200, customProfitabilityPolicy),
  'acceptable',
  'o piso configurado do módulo deve alterar a classificação visual'
);
assert.equal(
  classifyModuleIncrementalMargin(
    7200,
    DEFAULT_SALES_PROFITABILITY_POLICY
  ),
  'attention'
);
assert.equal(
  classifyModuleIncrementalMargin(7600, customProfitabilityPolicy),
  'healthy',
  'a meta configurada deve alterar o rótulo saudável'
);
assert.equal(
  classifyModuleIncrementalMargin(
    7600,
    DEFAULT_SALES_PROFITABILITY_POLICY
  ),
  'acceptable'
);
assert.match(
  formatSalesIncrementalMarginStatusLabel(
    'healthy',
    customProfitabilityPolicy
  ),
  /75%/
);
assert.match(
  formatSalesIncrementalMarginStatusLabel(
    'acceptable',
    customProfitabilityPolicy,
    'capacity'
  ),
  /70%.*75%/
);
for (const code of [
  'CLINIC_MARGIN_BELOW_MINIMUM',
  'POST_PROMOTION_MARGIN_BELOW_MINIMUM',
  'MODULE_MARGIN_BELOW_MINIMUM:school_management',
  'CAPACITY_MARGIN_BELOW_MINIMUM',
  'EXPANSION_MARGIN_BELOW_MINIMUM:insurance_tiss',
  'CLINIC_MARGIN_BELOW_TARGET',
  'POST_PROMOTION_MARGIN_BELOW_TARGET',
  'MODULE_MARGIN_BELOW_TARGET:school_management',
  'CAPACITY_MARGIN_BELOW_TARGET',
  'EXPANSION_MARGIN_BELOW_TARGET:insurance_tiss',
  'CLINIC_MARGIN_BELOW_60',
  'POST_PROMOTION_MARGIN_BELOW_70',
  'MODULE_MARGIN_BELOW_75:school_management',
  'CAPACITY_MARGIN_BELOW_75',
  'EXPANSION_MARGIN_BELOW_75:insurance_tiss'
]) {
  assert.equal(
    isSalesCommercialReviewCode(code),
    true,
    `alerta comercial deve reconhecer ${code}`
  );
}

const coreResult = calculateSalesModularProposal(
  inputWithModules([]),
  catalogWithEconomics(),
  modularAssumptionsFixture
);
assert.ok(coreResult.economics, 'core isolado deve calcular economia');
assert.equal(coreResult.economics?.pricingProfile, 'intensive');
assert.equal(coreResult.modelVersion, '2026-08-04-v6');
assert.ok(
  coreResult.warnings.some((warning) =>
    warning.includes('custo unitário estimado em zero')
  ),
  'custos unitários estimados em zero com uso previsto devem gerar aviso de qualidade'
);
assert.equal(
  coreResult.economics?.items[0].fixedAllocatedCostCents,
  1000,
  'custo compartilhado deve ser alocado uma única vez no core'
);

const agendaResult = calculateSalesModularProposal(
  inputWithModules([agenda]),
  catalogWithEconomics([agenda]),
  modularAssumptionsFixture
);
const agendaEconomics = agendaResult.economics?.items.find(
  (item) => item.itemKey === 'appointments_communication'
);
assert.ok(agendaEconomics);
assert.equal(
  agendaEconomics?.fixedAllocatedCostCents,
  0,
  'módulo não pode repetir custo compartilhado'
);
assert.equal(agendaEconomics?.fixedPaymentFeeCents, 0);
assert.equal(
  agendaResult.lines.find((line) => line.itemKey === 'clinical_core')
    ?.promotional.sharedPlatformCostAllocatedCents,
  1000
);
assert.equal(
  agendaResult.lines.find(
    (line) => line.itemKey === 'appointments_communication'
  )?.promotional.sharedPlatformCostAllocatedCents,
  0
);
assert.equal(
  agendaResult.lines.find(
    (line) => line.itemKey === 'appointments_communication'
  )?.resolvedDrivers.monthlyAppointments?.value,
  300,
  'Agenda deve escalar por sessões/comunicações, não por pacientes'
);

const highMarginEffect = calculateSalesModuleEffect({
  revenueBeforeCents: 100_000,
  costBeforeCents: 35_000,
  moduleRevenueCents: 50_000,
  moduleCostCents: 5_000
});
assert.equal(highMarginEffect.increasesConsolidatedMargin, true);
assert.ok(
  Number(highMarginEffect.moduleMarginBasisPoints) >
    Number(highMarginEffect.marginBeforeBasisPoints)
);
const lowMarginEffect = calculateSalesModuleEffect({
  revenueBeforeCents: 100_000,
  costBeforeCents: 20_000,
  moduleRevenueCents: 50_000,
  moduleCostCents: 30_000
});
assert.equal(lowMarginEffect.increasesConsolidatedMargin, false);
assert.ok(
  Number(lowMarginEffect.marginAfterBasisPoints) <
    Number(lowMarginEffect.marginBeforeBasisPoints)
);

const coreThreshold60 =
  coreResult.economics?.items[0].priceMinimumCents[6000];
const coreThreshold70 =
  coreResult.economics?.items[0].priceMinimumCents[7000];
assert.ok(coreThreshold60 && coreThreshold70);

const targetFormulaResult = calculateSalesModularProposal(
  inputWithModules([], 49_900),
  catalogWithEconomics(),
  modularAssumptionsFixture
);
assert.equal(
  targetFormulaResult.targetEbitdaMarginBasisPoints,
  DEFAULT_SALES_PROFITABILITY_POLICY.recurringTargetEbitdaMarginBasisPoints
);
const expectedTargetPrice = calculateSalesMinimumPriceCents({
  directCostCents: targetFormulaResult.promotional.directCostCents,
  fixedAllocatedCostCents:
    targetFormulaResult.promotional.sharedPlatformCostAllocatedCents,
  fixedPaymentFeeCents:
    targetFormulaResult.promotional.fixedPaymentFeeAllocatedCents,
  targetEbitdaMarginBasisPoints:
    DEFAULT_SALES_PROFITABILITY_POLICY.recurringTargetEbitdaMarginBasisPoints,
  stripePercentageBasisPoints:
    modularAssumptionsFixture.values.stripeFeeBasisPoints,
  delinquencyPercentageBasisPoints:
    modularAssumptionsFixture.values.estimatedDelinquencyBasisPoints,
  refundChargebackPercentageBasisPoints:
    modularAssumptionsFixture.values.refundChargebackBasisPoints,
  taxPercentageBasisPoints:
    modularAssumptionsFixture.values.revenueTaxBasisPoints
});
assert.equal(
  targetFormulaResult.targetRecurringRevenueCents,
  expectedTargetPrice,
  'preço-alvo deve recalcular custos percentuais sobre a própria receita-alvo'
);
assert.equal(
  targetFormulaResult.minimumRecommendedRecurringRevenueCents,
  targetFormulaResult.targetRecurringRevenueCents,
  'campo histórico deve espelhar o preço-alvo'
);
assert.ok(
  Number(targetFormulaResult.targetRecurringRevenueCents) >
    Number(targetFormulaResult.breakEvenRecurringRevenueCents),
  'preço-alvo deve superar o equilíbrio EBITDA'
);
assert.equal(
  targetFormulaResult.targetGapAnnualCents,
  Number(targetFormulaResult.targetGapCents) * 12
);
assert.notEqual(targetFormulaResult.markupMultiplier, null);
assert.notEqual(targetFormulaResult.markupOnEbitdaCostBasisPoints, null);

const marginOnlyCatalog = catalogWithEconomics();
marginOnlyCatalog.modularCostSettings.ownershipJustifications
  .fixedMonthlyEligibleCost =
    'Rateio compartilhado validado para isolar somente o aviso de margem.';
const belowFloor = calculateSalesModularProposal(
  inputWithModules([], Math.floor(Number(coreThreshold60) * 0.95)),
  marginOnlyCatalog,
  modularAssumptionsFixture
);
assert.equal(belowFloor.economics?.canSend, true);
assert.equal(belowFloor.economics?.requiresJustification, false);
assert.ok(
  belowFloor.economics?.alertCodes.includes('CLINIC_MARGIN_BELOW_TARGET')
);
assert.equal(
  belowFloor.economics?.blockingCodes.some((code) => code.includes('MARGIN_BELOW')),
  false,
  'margem abaixo da meta deve ser aviso, nunca bloqueio técnico'
);
assert.equal(
  classifySalesProposalReview(belowFloor).canGeneratePublicOfferWithoutApproval,
  true
);

const normalPrice = Number(coreThreshold70) + 5000;
const promotionalPrice = Math.floor(
  (Number(coreThreshold60) + Number(coreThreshold70)) / 2
);
const temporaryDiscount: OfferItemDiscount = {
  type: 'fixed_amount',
  amountOffCents: normalPrice - promotionalPrice,
  startsAt: effectiveAt,
  endsAt: null,
  durationCount: 6,
  durationUnit: 'months',
  priceBeforeDiscountCents: normalPrice,
  discountedPriceCents: promotionalPrice,
  priceAfterExpirationCents: normalPrice,
  reason: 'Condição temporária aprovada para o teste.',
  status: 'active'
};
const temporaryInput = inputWithModules([], normalPrice);
temporaryInput.lines[0].offerDiscount = temporaryDiscount;
const temporaryResult = calculateSalesModularProposal(
  temporaryInput,
  catalogWithEconomics(),
  modularAssumptionsFixture
);
assert.equal(temporaryResult.economics?.canSend, true);
assert.equal(temporaryResult.economics?.requiresJustification, false);
assert.ok(
  Number(temporaryResult.economics?.postPromotion.marginBasisPoints) >= 7000
);

const unsustainablePost = calculateSalesModularProposal(
  inputWithModules([], Math.floor(Number(coreThreshold70) * 0.95)),
  catalogWithEconomics(),
  modularAssumptionsFixture
);
assert.ok(
  unsustainablePost.economics?.alertCodes.includes(
    'POST_PROMOTION_MARGIN_BELOW_TARGET'
  )
);
assert.equal(unsustainablePost.economics?.canSend, true);

const cheapAgenda = moduleItem(
  'appointments_communication',
  'Agenda e Comunicação',
  1000,
  2
);
const cheapAgendaResult = calculateSalesModularProposal(
  inputWithModules([cheapAgenda]),
  catalogWithEconomics([cheapAgenda]),
  modularAssumptionsFixture
);
assert.ok(
  cheapAgendaResult.economics?.alertCodes.includes(
    'MODULE_MARGIN_BELOW_TARGET:appointments_communication'
  )
);
assert.equal(cheapAgendaResult.economics?.canSend, true);

const customCatalog = catalogWithEconomics([cheapAgenda]);
customCatalog.profitabilityPolicy = structuredClone(customProfitabilityPolicy);
const customReference = calculateSalesModularProposal(
  inputWithModules([cheapAgenda]),
  customCatalog,
  modularAssumptionsFixture
);
const customCoreThreshold55 = customReference.economics?.items.find(
  (item) => item.itemKey === 'clinical_core'
)?.priceMinimumCents[5500];
assert.ok(customCoreThreshold55, 'a política 55/65/70/75 deve gerar piso 55%');
const customLowResult = calculateSalesModularProposal(
  inputWithModules(
    [cheapAgenda],
    Math.floor(Number(customCoreThreshold55) * 0.95)
  ),
  customCatalog,
  modularAssumptionsFixture
);
const customWarnings = customLowResult.economics?.warnings.join(' ') || '';
assert.match(customWarnings, /65%/);
assert.match(customWarnings, /70%/);
const customGeneratedMarginCodes = (
  customLowResult.economics?.alertCodes || []
).filter((code) => code.includes('MARGIN_BELOW'));
assert.ok(customGeneratedMarginCodes.length > 0);
assert.equal(customLowResult.economics?.blockingCodes.length, 0);
for (const code of customGeneratedMarginCodes) {
  assert.doesNotMatch(
    code,
    /55|60|65|70|75|80/,
    'códigos novos não podem incorporar percentuais configurados'
  );
  assert.equal(
    isSalesCommercialReviewCode(code),
    true,
    'código novo de margem deve ser classificado como alerta comercial'
  );
}

const freeAgendaInput = inputWithModules([agenda]);
freeAgendaInput.lines[1].offerDiscount = {
  type: 'free',
  startsAt: effectiveAt,
  endsAt: null,
  durationCount: 6,
  durationUnit: 'months',
  priceBeforeDiscountCents: agenda.recurringAmountCents || 0,
  discountedPriceCents: 0,
  priceAfterExpirationCents: agenda.recurringAmountCents || 0,
  reason: 'Lançamento temporário com limite de uso aprovado.',
  status: 'active'
};
const freeAgendaResult = calculateSalesModularProposal(
  freeAgendaInput,
  catalogWithEconomics([agenda]),
  modularAssumptionsFixture
);
assert.equal(freeAgendaResult.economics?.requiresJustification, false);
assert.ok(
  Number(freeAgendaResult.economics?.promotional.marginBasisPoints) >= 6000,
  'módulo gratuito só é admissível se o consolidado preservar o piso'
);

const changedCompositionInput = inputWithModules([agenda, finance]);
changedCompositionInput.globalDiscountBasisPoints = 500;
changedCompositionInput.discountDurationMonths = 3;
const withTwoModules = calculateSalesModularProposal(
  changedCompositionInput,
  catalogWithEconomics([agenda, finance]),
  modularAssumptionsFixture
);
const withOneModule = calculateSalesModularProposal(
  {
    ...changedCompositionInput,
    lines: changedCompositionInput.lines.filter(
      (line) => line.itemKey !== 'financial_management'
    )
  },
  catalogWithEconomics([agenda, finance]),
  modularAssumptionsFixture
);
assert.notEqual(
  withTwoModules.economics?.promotional.maximumDiscountCents,
  withOneModule.economics?.promotional.maximumDiscountCents,
  'remoção de módulo deve recalcular o desconto máximo'
);

const capacityInput = inputWithModules([], 219_900);
capacityInput.patientQuantity = 161;
capacityInput.expectedPatientQuantity12Months = 161;
capacityInput.lines[0].quantity = 161;
const capacityResult = calculateSalesModularProposal(
  capacityInput,
  catalogWithEconomics(),
  modularAssumptionsFixture
);
assert.equal(capacityResult.basePackage.capacity?.selectedBlocks, 2);
assert.equal(capacityResult.economics?.capacity?.meetsMinimumMargin, true);
assert.ok(
  Number(capacityResult.economics?.capacity?.marginBasisPoints) >= 7500
);

const expansion = calculateSalesDriverExpansion({
  driverValue: 150,
  incrementalCostPerUnitCents: 10,
  minimumMarginBasisPoints: 7500,
  policy: {
    enabled: true,
    driverKey: 'tissGuides',
    includedUnits: 100,
    blockSizeUnits: 25,
    blockPriceCents: 2000,
    source: 'manual',
    sourceDetail: 'Franquia aprovada no teste.',
    effectiveAt,
    version: 1
  }
});
assert.equal(expansion.blocks, 2);
assert.equal(expansion.status, 'priced');
assert.ok(Number(expansion.incrementalMarginBasisPoints) >= 7500);

const driverCatalog = catalogWithEconomics([finance, tiss, school]);
const driverResult = calculateSalesModularProposal(
  inputWithModules([finance, tiss, school]),
  driverCatalog,
  modularAssumptionsFixture
);
assert.equal(
  driverResult.lines.find((line) => line.itemKey === 'insurance_tiss')
    ?.resolvedDrivers.tissGuides?.value,
  200,
  'TISS deve escalar por guias'
);
assert.equal(
  driverResult.lines.find((line) => line.itemKey === 'school_management')
    ?.resolvedDrivers.schoolPatients?.value,
  40,
  'Escolar deve escalar por vínculo escolar'
);
assert.equal(
  driverResult.lines.find((line) => line.itemKey === 'financial_management')
    ?.resolvedDrivers.financialEntries?.value,
  500,
  'Financeiro deve escalar por transações'
);

assert.equal(
  agendaResult.economics?.percentageCostBasisPoints,
  Number(modularAssumptionsFixture.values.stripeFeeBasisPoints) +
    Number(modularAssumptionsFixture.values.revenueTaxBasisPoints) +
    Number(
      modularAssumptionsFixture.values.estimatedDelinquencyBasisPoints
    ),
  'Stripe, impostos e inadimplência devem compor o preço-alvo'
);
assert.equal(agendaResult.totalsReconciled, true);
assert.equal(
  agendaResult.lines.reduce(
    (sum, line) => sum + Number(line.promotional.ebitdaCents),
    0
  ),
  agendaResult.promotional.ebitdaCents,
  'reconciliação deve fechar em centavos'
);

const frozenPolicy = structuredClone(agendaResult.economics?.policy);
assert.deepEqual(frozenPolicy, DEFAULT_SALES_PROFITABILITY_POLICY);
const mutableCatalog = catalogWithEconomics([agenda]);
const frozenResult = calculateSalesModularProposal(
  inputWithModules([agenda]),
  mutableCatalog,
  modularAssumptionsFixture
);
if (mutableCatalog.profitabilityPolicy) {
  mutableCatalog.profitabilityPolicy.clinicMinimumEbitdaMarginBasisPoints =
    100;
}
assert.equal(
  frozenResult.economics?.policy.clinicMinimumEbitdaMarginBasisPoints,
  6000,
  'snapshot deve congelar política e margens'
);

const archivedVersionedCatalog = catalogWithEconomics([agenda]);
archivedVersionedCatalog.status = 'archived';
archivedVersionedCatalog.profitabilityPolicy = structuredClone(
  customProfitabilityPolicy
);
const archivedVersionedResult = calculateSalesModularProposal(
  inputWithModules([agenda]),
  archivedVersionedCatalog,
  modularAssumptionsFixture
);
assert.equal(
  archivedVersionedResult.economics?.policy
    .clinicMinimumEbitdaMarginBasisPoints,
  5500,
  'catálogo versionado arquivado deve continuar legível sem fallback'
);

const historicalCatalog = structuredClone(modularCatalogFixture);
const historicalCatalogBefore = structuredClone(historicalCatalog);
const standardHistoricalCatalog = structuredClone(historicalCatalog);
standardHistoricalCatalog.modularCostSettings.ownershipJustifications
  .fixedMonthlyEligibleCost =
    'Custo compartilhado validado para o cenário padrão histórico.';
const standardHistoricalInput = proposalInputFixture(
  50,
  PACKAGE_TIERS.upTo50.id
);
const personalizedHistoricalInput = proposalInputFixture(
  150,
  PACKAGE_TIERS.custom.id,
  150,
  159_900
);
assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    standardHistoricalInput,
    standardHistoricalCatalog
  ),
  false,
  'faixa padrão não deve exigir política versionada'
);
assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    {
      ...standardHistoricalInput,
      patientQuantity: 150,
      expectedPatientQuantity12Months: 150
    },
    standardHistoricalCatalog
  ),
  false,
  'quantidade acima de 100 não pode substituir a configuração real da faixa'
);
const customFlagCatalog = structuredClone(historicalCatalog);
const customFlagTier = customFlagCatalog.items[0].tiers.find(
  (tier) => tier.id === PACKAGE_TIERS.custom.id
);
if (!customFlagTier) throw new Error('CUSTOM_TIER_FIXTURE_REQUIRED');
customFlagTier.maximumQuantity = 500;
assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    personalizedHistoricalInput,
    customFlagCatalog
  ),
  true,
  'isCustom true deve exigir política mesmo com máximo definido'
);
const noMaximumCatalog = structuredClone(historicalCatalog);
const noMaximumTier = noMaximumCatalog.items[0].tiers.find(
  (tier) => tier.id === PACKAGE_TIERS.upTo100.id
);
if (!noMaximumTier) throw new Error('STANDARD_TIER_FIXTURE_REQUIRED');
noMaximumTier.maximumQuantity = null;
assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    {
      ...standardHistoricalInput,
      basePackageTierId: noMaximumTier.id
    },
    noMaximumCatalog
  ),
  true,
  'faixa sem máximo deve exigir política mesmo sem sinalizador custom'
);
const standardHistorical = calculateSalesModularProposal(
  standardHistoricalInput,
  standardHistoricalCatalog,
  modularAssumptionsFixture
);
assert.equal(
  standardHistorical.economics,
  null,
  'catálogo padrão histórico sem política não deve inventar economics'
);
assert.notEqual(
  standardHistorical.promotional.totalEstimatedCostCents,
  0,
  'ausência de política não pode converter custo desconhecido ou real em zero artificial'
);
assert.equal(
  standardHistorical.commercialPricing.enabled,
  false,
  'faixa padrão não pode ser convertida em proposta personalizada'
);
assert.equal(
  classifySalesProposalReview(standardHistorical).canSaveDraft,
  true,
  'proposta padrão válida sem política deve continuar salvável'
);
assert.equal(
  classifySalesProposalReview(standardHistorical)
    .canGeneratePublicOfferWithoutApproval,
  true,
  'proposta padrão histórica válida sem política deve continuar publicável'
);

assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    personalizedHistoricalInput,
    historicalCatalog
  ),
  true,
  'faixa custom deve exigir política versionada'
);
const switchedInput = {
  ...personalizedHistoricalInput,
  basePackageTierId: PACKAGE_TIERS.upTo100.id,
  customBasePackageLimit: null
};
assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    switchedInput,
    historicalCatalog
  ),
  false,
  'trocar de personalizado para padrão deve remover o bloqueio'
);
assert.equal(
  salesModularProposalRequiresVersionedProfitabilityPolicy(
    {
      ...switchedInput,
      basePackageTierId: PACKAGE_TIERS.custom.id,
      customBasePackageLimit: 150
    },
    historicalCatalog
  ),
  true,
  'trocar de padrão para personalizado deve restaurar o bloqueio'
);
const historical = calculateSalesModularProposal(
  personalizedHistoricalInput,
  historicalCatalog,
  modularAssumptionsFixture
);
assert.equal(historical.modelVersion, '2026-07-28-v4');
assert.equal(historical.economics, null);
assert.equal(
  historicalCatalog.profitabilityPolicy,
  null,
  'catálogo histórico não deve receber política por fallback'
);
assert.deepEqual(
  historicalCatalog,
  historicalCatalogBefore,
  'proposta histórica não pode ser recalculada nem mutar o catálogo'
);

console.log('salesModularEconomics.test.ts: OK');
