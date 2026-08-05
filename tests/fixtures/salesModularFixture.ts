import type {
  SalesModularProposalInput,
  SalesPricingCatalogSnapshot,
  SalesPricingCatalogTier
} from '../../src/utils/salesModularProposal';
import type {
  SalesAssumptionSnapshot,
  SalesAssumptionValues
} from '../../src/utils/salesProfitability';
import type {
  SalesModularDriverConfig,
  SalesModularDriverKey,
  SalesModularDriverValue
} from '../../src/utils/salesModularCostDrivers';

const effectiveAt = '2026-07-27T00:00:00.000Z';

const driver = (value: number): SalesModularDriverValue => ({
  value,
  source: 'estimated',
  sourceDetail: 'Fixture versionada do teste.',
  effectiveAt,
  version: 1
});

const profileDrivers = (factor: number) => ({
  monthlyClinicalSessions: driver(100 * factor),
  monthlyAbaSessions: driver(50 * factor),
  monthlyAbaRecords: driver(1000 * factor),
  generatedDocuments: driver(20 * factor)
});

const driverConfig: SalesModularDriverConfig = {
  schemaVersion: 2,
  requiredDrivers: [
    'monthlyClinicalSessions',
    'monthlyAbaSessions',
    'monthlyAbaRecords',
    'generatedDocuments'
  ],
  profiles: {
    light: profileDrivers(0.5),
    standard: profileDrivers(1),
    intensive: profileDrivers(2)
  },
  unitCostsCents: {
    monthlyAbaSessions: 3,
    monthlyAbaRecords: 4,
    generatedDocuments: 5
  }
};

const tier = (
  id: string,
  maximumQuantity: number | null,
  recurringAmountCents: number | null,
  sortOrder: number,
  isCustom = false
): SalesPricingCatalogTier => ({
  id,
  itemId: 'clinical-core',
  tierKey: isCustom ? 'custom' : `up_to_${maximumQuantity}`,
  publicName: isCustom
    ? 'Verto Clínica personalizada'
    : `Verto Clínica até ${maximumQuantity}`,
  minimumQuantity: 1,
  maximumQuantity,
  includedQuantity: maximumQuantity,
  recurringAmountCents,
  oneTimeAmountCents: 0,
  sortOrder,
  isCustom,
  metadata: maximumQuantity === null
    ? {}
    : { includedStorageMb: maximumQuantity * 100 }
});

export const PACKAGE_TIERS = {
  upTo10: tier('tier-10', 10, 19900, 10),
  upTo25: tier('tier-25', 25, 29900, 20),
  upTo50: tier('tier-50', 50, 49900, 30),
  upTo100: tier('tier-100', 100, 79900, 40),
  custom: tier('tier-custom', null, null, 50, true)
};

export const modularCatalogFixture: SalesPricingCatalogSnapshot = {
  id: 'catalog-v2',
  version: 2,
  name: 'Catálogo comercial v2',
  status: 'active',
  effectiveAt,
  allocationSettings: {
    stripePercentage: 'net_revenue',
    stripeFixed: 'base_package',
    revenueTax: 'net_revenue',
    delinquency: 'net_revenue',
    sharedPlatformCosts: 'configured_weight',
    belowEbitda: 'configured_weight'
  },
  modularCostSettings: {
    schemaVersion: 2,
    ownership: {
      variablePatientCost: 'item_direct',
      variableClinicCost: 'item_direct',
      storageCost: 'item_direct',
      egressCost: 'item_direct',
      processingCost: 'excluded',
      notificationCost: 'excluded',
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
  },
  customCapacityPolicy: null,
  hasVersionedCustomCapacityPolicy: false,
  profitabilityPolicy: null,
  hasVersionedProfitabilityPolicy: false,
  items: [
    {
      id: 'clinical-core',
      itemKey: 'clinical_core',
      publicName: 'Verto Clínica',
      internalName: 'Verto Clínica',
      description: 'Pacote-base clínico.',
      pricingMode: 'package_limit',
      billingInterval: 'monthly',
      unitName: 'pacientes',
      includedQuantity: null,
      maximumQuantity: null,
      recurringAmountCents: null,
      oneTimeAmountCents: 0,
      sortOrder: 1,
      isRequired: true,
      isPublic: true,
      isActive: true,
      compatibleBasePackages: [],
      metadata: {},
      tiers: Object.values(PACKAGE_TIERS),
      costModel: {
        id: 'clinical-cost-v1',
        itemId: 'clinical-core',
        version: 1,
        directFixedMonthlyCostCents: 1000,
        directCostPerPatientCents: 10,
        directCostPerClinicCents: 200,
        directCostPerUsageUnitCents: 2,
        storageCostPerGbCents: 20,
        egressCostPerGbCents: 30,
        notificationCostPerUnitCents: 0,
        processingCostPerUnitCents: 0,
        otherVariableCostCents: 100,
        supportFixedMonthlyCostCents: 300,
        supportCostPerPatientCents: 5,
        operationalFixedMonthlyCostCents: 400,
        onboardingCostCents: 0,
        sharedCostAllocationWeight: 1,
        costSource: 'manual',
        sourceDetail: 'Custos publicados para o teste.',
        effectiveAt,
        driverConfig
      }
    }
  ]
};

const assumptions: SalesAssumptionValues = {
  officialUnitAmountCents: 100,
  stripeFeeBasisPoints: 300,
  stripeFixedFeeCents: 50,
  revenueTaxBasisPoints: 500,
  estimatedDelinquencyBasisPoints: 100,
  refundChargebackBasisPoints: 0,
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
  defaultOnboardingCostCents: 0,
  commercialCommissionBasisPoints: 0,
  fixedMonthlyEligibleCostCents: 1000,
  fixedAllocationMethod: 'per_clinic',
  fixedAllocationPatientCount: 100,
  fixedAllocationClinicCount: 1,
  customFixedAllocationCents: 0,
  depreciationAmortizationCents: 0,
  financialExpensesCents: 0,
  profitTaxBasisPoints: 0,
  otherBelowEbitdaCents: 0,
  minimumMarginBasisPoints: 1000,
  healthyMarginBasisPoints: 2500,
  attentionMarginBasisPoints: 1500
};

export const modularAssumptionsFixture: SalesAssumptionSnapshot = {
  id: 'assumptions-v2',
  version: 2,
  name: 'Premissas pré-lançamento',
  effectiveAt,
  values: assumptions,
  sources: Object.fromEntries(
    Object.keys(assumptions).map((key) => [key, 'manual'])
  ) as SalesAssumptionSnapshot['sources']
};

export const proposalInputFixture = (
  patients: number,
  tierId: string,
  customLimit: number | null = null,
  customPriceCents: number | null = null
): SalesModularProposalInput => ({
  platformFoundationPricingMode: 'manual',
  platformFoundationMonthlyAmountCents: 0,
  patientQuantity: patients,
  expectedPatientQuantity12Months: patients,
  basePackageTierId: tierId,
  basePackageSelectionMode: 'automatic',
  customBasePackageLimit: customLimit,
  lines: [
    {
      itemKey: 'clinical_core',
      tierId,
      quantity: patients,
      itemDiscountBasisPoints: 0,
      customRecurringAmountCents: customPriceCents,
      customOneTimeAmountCents: null
    }
  ],
  globalDiscountBasisPoints: 0,
  discountDurationMonths: 0,
  offerValidityDays: 14,
  onboardingInstallments: 1,
  usageProfile: 'standard',
  driverOverrides: {}
});

export const allClinicalDriverKeys: SalesModularDriverKey[] = [
  'monthlyClinicalSessions',
  'monthlyAbaSessions',
  'monthlyAbaRecords',
  'generatedDocuments'
];
