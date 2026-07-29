import type {
  SalesUsageProfile,
  SimulationValueSource
} from './salesProfitability';
import { validateCustomCapacityPolicy } from './salesCommercialEvolution';
import { validateSalesProfitabilityPolicy } from './salesModularEconomics';

export type ModularCostOwnershipValue =
  | 'shared'
  | 'item_direct'
  | 'excluded';

export type ModularCostOwnership = {
  variablePatientCost: ModularCostOwnershipValue;
  variableClinicCost: ModularCostOwnershipValue;
  storageCost: ModularCostOwnershipValue;
  egressCost: ModularCostOwnershipValue;
  processingCost: ModularCostOwnershipValue;
  notificationCost: ModularCostOwnershipValue;
  otherVariableCost: ModularCostOwnershipValue;
  supportClinicCost: ModularCostOwnershipValue;
  supportPatientCost: ModularCostOwnershipValue;
  operationalCost: ModularCostOwnershipValue;
  fixedMonthlyEligibleCost: ModularCostOwnershipValue;
};

export type ModularCostOwnershipKey = keyof ModularCostOwnership;

export const MODULAR_COST_OWNERSHIP_KEYS = [
  'variablePatientCost',
  'variableClinicCost',
  'storageCost',
  'egressCost',
  'processingCost',
  'notificationCost',
  'otherVariableCost',
  'supportClinicCost',
  'supportPatientCost',
  'operationalCost',
  'fixedMonthlyEligibleCost'
] as const satisfies readonly ModularCostOwnershipKey[];

export const MODULAR_COST_APPLICABILITY_BY_ITEM: Record<
  string,
  readonly ModularCostOwnershipKey[]
> = {
  clinical_core: [
    'variablePatientCost',
    'variableClinicCost',
    'storageCost',
    'egressCost',
    'otherVariableCost',
    'supportClinicCost',
    'supportPatientCost',
    'operationalCost',
    'fixedMonthlyEligibleCost'
  ],
  appointments_communication: [
    'variablePatientCost',
    'variableClinicCost',
    'notificationCost',
    'otherVariableCost',
    'supportClinicCost',
    'supportPatientCost',
    'operationalCost',
    'fixedMonthlyEligibleCost'
  ],
  financial_management: [
    'variableClinicCost',
    'processingCost',
    'otherVariableCost',
    'supportClinicCost',
    'operationalCost',
    'fixedMonthlyEligibleCost'
  ],
  insurance_tiss: [
    'variableClinicCost',
    'storageCost',
    'egressCost',
    'processingCost',
    'otherVariableCost',
    'supportClinicCost',
    'operationalCost',
    'fixedMonthlyEligibleCost'
  ],
  school_management: [
    'variablePatientCost',
    'variableClinicCost',
    'storageCost',
    'egressCost',
    'processingCost',
    'notificationCost',
    'otherVariableCost',
    'supportClinicCost',
    'supportPatientCost',
    'operationalCost',
    'fixedMonthlyEligibleCost'
  ],
  additional_storage: [
    'storageCost',
    'egressCost',
    'otherVariableCost'
  ],
  onboarding: []
};

export const modularCostCategoryApplies = (
  itemKey: string,
  category: ModularCostOwnershipKey
) => Boolean(MODULAR_COST_APPLICABILITY_BY_ITEM[itemKey]?.includes(category));

export type SalesModularProfile = Exclude<SalesUsageProfile, 'custom'>;

export type SalesModularUsageProfileSettings = {
  storageUtilizationBasisPoints: number | null;
  expectedEgressMultiplier: number | null;
};

export type SalesModularCostSettings = {
  schemaVersion: 2;
  ownership: ModularCostOwnership;
  ownershipJustifications: Partial<Record<ModularCostOwnershipKey, string>>;
  includedStorageMbPerPatient: number | null;
  usageProfiles: Record<SalesModularProfile, SalesModularUsageProfileSettings>;
};

export type SalesModularDriverKey =
  | 'monthlyClinicalSessions'
  | 'monthlyAbaSessions'
  | 'monthlyAbaRecords'
  | 'generatedDocuments'
  | 'monthlyAppointments'
  | 'remindersPerAppointment'
  | 'internalNotifications'
  | 'emails'
  | 'webPushNotifications'
  | 'futurePaidMessages'
  | 'financialEntries'
  | 'financialReports'
  | 'recurringProcesses'
  | 'tissGuides'
  | 'tissBatches'
  | 'tissXmlDocuments'
  | 'tissDocuments'
  | 'schoolPatients'
  | 'schoolMeetings'
  | 'schoolParticipants'
  | 'schoolDocuments'
  | 'schoolNotifications'
  | 'expectedStorageGb'
  | 'storageUtilizationBasisPoints'
  | 'expectedEgressMultiplier'
  | 'onboardingConfigurationHours'
  | 'onboardingTrainingHours'
  | 'onboardingImportHours'
  | 'extraordinaryOnboardingCostCents';

export type SalesModularDriverValue = {
  value: number | null;
  source: SimulationValueSource;
  sourceDetail: string;
  effectiveAt: string;
  version: number;
};

export type SalesModularDriverConfig = {
  schemaVersion: 2;
  requiredDrivers: SalesModularDriverKey[];
  profiles: Record<
    SalesModularProfile,
    Partial<Record<SalesModularDriverKey, SalesModularDriverValue>>
  >;
  unitCostsCents: Partial<Record<SalesModularDriverKey | 'onboardingHours', number | null>>;
  usageProfileOverrides?: Partial<
    Record<SalesModularProfile, Partial<SalesModularUsageProfileSettings>>
  >;
  onboardingCalculationMode?: 'hours' | 'manual';
};

export type SalesModularDriverOverrides = Partial<
  Record<string, Partial<Record<SalesModularDriverKey, SalesModularDriverValue>>>
>;

export type SalesModularDriverDefinition = {
  key: SalesModularDriverKey;
  label: string;
  unit: string;
  group:
    | 'usage'
    | 'storage'
    | 'notifications'
    | 'onboarding';
  itemKeys: string[];
  valueStep?: number;
  monetaryValue?: boolean;
};

export const SALES_MODULAR_DRIVER_DEFINITIONS: SalesModularDriverDefinition[] = [
  { key: 'monthlyClinicalSessions', label: 'Sessões clínicas mensais', unit: 'sessões/mês', group: 'usage', itemKeys: ['clinical_core'] },
  { key: 'monthlyAbaSessions', label: 'Sessões ABA mensais', unit: 'sessões ABA/mês', group: 'usage', itemKeys: ['clinical_core'] },
  { key: 'monthlyAbaRecords', label: 'Registros ou tentativas ABA', unit: 'registros/mês', group: 'usage', itemKeys: ['clinical_core'] },
  { key: 'generatedDocuments', label: 'Relatórios ou documentos gerados', unit: 'documentos/mês', group: 'usage', itemKeys: ['clinical_core'] },
  { key: 'monthlyAppointments', label: 'Sessões mensais', unit: 'sessões/mês', group: 'usage', itemKeys: ['appointments_communication'] },
  { key: 'remindersPerAppointment', label: 'Lembretes por sessão', unit: 'lembretes/sessão', group: 'notifications', itemKeys: ['appointments_communication'], valueStep: 0.1 },
  { key: 'internalNotifications', label: 'Notificações internas', unit: 'notificações/mês', group: 'notifications', itemKeys: ['appointments_communication'] },
  { key: 'emails', label: 'E-mails', unit: 'e-mails/mês', group: 'notifications', itemKeys: ['appointments_communication'] },
  { key: 'webPushNotifications', label: 'Web push', unit: 'notificações/mês', group: 'notifications', itemKeys: ['appointments_communication'] },
  { key: 'futurePaidMessages', label: 'Mensagens pagas futuras', unit: 'mensagens/mês', group: 'notifications', itemKeys: ['appointments_communication'] },
  { key: 'financialEntries', label: 'Lançamentos financeiros', unit: 'lançamentos/mês', group: 'usage', itemKeys: ['financial_management'] },
  { key: 'financialReports', label: 'Relatórios financeiros', unit: 'relatórios/mês', group: 'usage', itemKeys: ['financial_management'] },
  { key: 'recurringProcesses', label: 'Processamentos recorrentes', unit: 'processamentos/mês', group: 'usage', itemKeys: ['financial_management'] },
  { key: 'tissGuides', label: 'Guias mensais', unit: 'guias/mês', group: 'usage', itemKeys: ['insurance_tiss'] },
  { key: 'tissBatches', label: 'Lotes TISS', unit: 'lotes/mês', group: 'usage', itemKeys: ['insurance_tiss'] },
  { key: 'tissXmlDocuments', label: 'XML gerados', unit: 'XML/mês', group: 'usage', itemKeys: ['insurance_tiss'] },
  { key: 'tissDocuments', label: 'Documentos de convênio', unit: 'documentos/mês', group: 'usage', itemKeys: ['insurance_tiss'] },
  { key: 'schoolPatients', label: 'Pacientes com vínculo escolar', unit: 'pacientes/mês', group: 'usage', itemKeys: ['school_management'] },
  { key: 'schoolMeetings', label: 'Reuniões escolares', unit: 'reuniões/mês', group: 'usage', itemKeys: ['school_management'] },
  { key: 'schoolParticipants', label: 'Participantes em reuniões', unit: 'participantes/mês', group: 'usage', itemKeys: ['school_management'] },
  { key: 'schoolDocuments', label: 'Documentos escolares', unit: 'documentos/mês', group: 'usage', itemKeys: ['school_management'] },
  { key: 'schoolNotifications', label: 'Notificações escolares', unit: 'notificações/mês', group: 'notifications', itemKeys: ['school_management'] },
  { key: 'expectedStorageGb', label: 'Armazenamento esperado', unit: 'GB/mês', group: 'storage', itemKeys: ['insurance_tiss', 'school_management'], valueStep: 0.01 },
  { key: 'storageUtilizationBasisPoints', label: 'Utilização esperada', unit: '% da capacidade', group: 'storage', itemKeys: ['clinical_core', 'additional_storage'], valueStep: 0.01 },
  { key: 'expectedEgressMultiplier', label: 'Multiplicador de egress', unit: 'GB transferido/GB usado', group: 'storage', itemKeys: ['clinical_core', 'insurance_tiss', 'school_management', 'additional_storage'], valueStep: 0.01 },
  { key: 'onboardingConfigurationHours', label: 'Horas de configuração', unit: 'horas', group: 'onboarding', itemKeys: ['onboarding'], valueStep: 0.25 },
  { key: 'onboardingTrainingHours', label: 'Horas de treinamento', unit: 'horas', group: 'onboarding', itemKeys: ['onboarding'], valueStep: 0.25 },
  { key: 'onboardingImportHours', label: 'Horas de importação', unit: 'horas', group: 'onboarding', itemKeys: ['onboarding'], valueStep: 0.25 },
  { key: 'extraordinaryOnboardingCostCents', label: 'Custos extraordinários', unit: 'R$/implantação', group: 'onboarding', itemKeys: ['onboarding'], valueStep: 0.01, monetaryValue: true }
];

export const DEFAULT_REQUIRED_DRIVERS_BY_ITEM: Record<string, SalesModularDriverKey[]> = {
  clinical_core: [
    'monthlyClinicalSessions',
    'monthlyAbaSessions',
    'monthlyAbaRecords',
    'generatedDocuments'
  ],
  appointments_communication: [
    'monthlyAppointments',
    'remindersPerAppointment',
    'internalNotifications',
    'emails',
    'webPushNotifications'
  ],
  financial_management: [
    'financialEntries',
    'financialReports',
    'recurringProcesses'
  ],
  insurance_tiss: [
    'tissGuides',
    'tissBatches',
    'tissXmlDocuments',
    'tissDocuments',
    'expectedStorageGb'
  ],
  school_management: [
    'schoolPatients',
    'schoolMeetings',
    'schoolParticipants',
    'schoolDocuments',
    'schoolNotifications',
    'expectedStorageGb'
  ],
  additional_storage: [],
  onboarding: [
    'onboardingConfigurationHours',
    'onboardingTrainingHours',
    'onboardingImportHours'
  ]
};

export const DEFAULT_MODULAR_COST_SETTINGS: SalesModularCostSettings = {
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
      expectedEgressMultiplier: null
    },
    standard: {
      storageUtilizationBasisPoints: 6000,
      expectedEgressMultiplier: null
    },
    intensive: {
      storageUtilizationBasisPoints: 10000,
      expectedEgressMultiplier: null
    }
  }
};

export const MODULAR_COST_OWNERSHIP_LABELS: Record<
  ModularCostOwnershipKey,
  string
> = {
  variablePatientCost: 'Custo variável por paciente',
  variableClinicCost: 'Custo variável por clínica',
  storageCost: 'Armazenamento',
  egressCost: 'Egress',
  processingCost: 'Processamento',
  notificationCost: 'Notificações',
  otherVariableCost: 'Outros custos variáveis',
  supportClinicCost: 'Suporte por clínica',
  supportPatientCost: 'Suporte por paciente',
  operationalCost: 'Operação mensal',
  fixedMonthlyEligibleCost: 'Custo fixo mensal elegível'
};

export const OWNERSHIP_ASSUMPTION_KEYS: Record<
  ModularCostOwnershipKey,
  string
> = {
  variablePatientCost: 'variablePatientCostCents',
  variableClinicCost: 'variableClinicCostCents',
  storageCost: 'storageCostCents',
  egressCost: 'egressCostCents',
  processingCost: 'processingCostCents',
  notificationCost: 'notificationCostCents',
  otherVariableCost: 'otherVariableCostCents',
  supportClinicCost: 'monthlySupportClinicCostCents',
  supportPatientCost: 'supportPatientCostCents',
  operationalCost: 'monthlyOperationalCostCents',
  fixedMonthlyEligibleCost: 'fixedMonthlyEligibleCostCents'
};

export const DIRECT_COST_MODEL_KEYS: Record<
  ModularCostOwnershipKey,
  readonly string[]
> = {
  variablePatientCost: ['directCostPerPatientCents'],
  variableClinicCost: ['directCostPerClinicCents'],
  storageCost: ['storageCostPerGbCents'],
  egressCost: ['egressCostPerGbCents'],
  processingCost: ['processingCostPerUnitCents'],
  notificationCost: ['notificationCostPerUnitCents'],
  otherVariableCost: ['otherVariableCostCents'],
  supportClinicCost: ['supportFixedMonthlyCostCents'],
  supportPatientCost: ['supportCostPerPatientCents'],
  operationalCost: ['operationalFixedMonthlyCostCents'],
  fixedMonthlyEligibleCost: ['directFixedMonthlyCostCents']
};

const DIRECT_COST_FIELD_LABELS: Record<string, string> = {
  directCostPerPatientCents: 'custo por paciente (R$/paciente/mês)',
  directCostPerClinicCents: 'custo por clínica (R$/clínica/mês)',
  storageCostPerGbCents: 'armazenamento (R$/GB/mês)',
  egressCostPerGbCents: 'egress (R$/GB transferido)',
  processingCostPerUnitCents: 'processamento por unidade',
  notificationCostPerUnitCents: 'notificação (R$/notificação)',
  otherVariableCostCents:
    'outros custos variáveis diretos (R$/funcionalidade/mês)',
  supportFixedMonthlyCostCents: 'suporte por clínica (R$/clínica/mês)',
  supportCostPerPatientCents: 'suporte por paciente (R$/paciente/mês)',
  operationalFixedMonthlyCostCents: 'operação (R$/clínica/mês)',
  directFixedMonthlyCostCents: 'custo fixo direto (R$/funcionalidade/mês)',
  directCostPerUsageUnitCents: 'custo da unidade principal de uso',
  onboardingCostCents: 'custo manual de implantação'
};

export const requiredDirectCostFieldsForItem = (
  itemKey: string,
  settings: SalesModularCostSettings
) =>
  MODULAR_COST_OWNERSHIP_KEYS.flatMap((category) =>
    settings.ownership[category] === 'item_direct' &&
    modularCostCategoryApplies(itemKey, category)
      ? DIRECT_COST_MODEL_KEYS[category]
      : []
  );

export const directCostCategoryForField = (
  field: string
): ModularCostOwnershipKey | undefined =>
  MODULAR_COST_OWNERSHIP_KEYS.find((category) =>
    DIRECT_COST_MODEL_KEYS[category].includes(field)
  );

export type SalesCatalogPublicationBlock = {
  code:
    | 'COST_UNAVAILABLE'
    | 'REQUIRED_DRIVER_MISSING'
    | 'POSSIBLE_DUPLICATE_COST'
    | 'INCLUDED_STORAGE_MODEL_MISSING'
    | 'EGRESS_CRITERION_MISSING'
    | 'CUSTOM_CAPACITY_POLICY_INVALID'
    | 'PROFITABILITY_POLICY_INVALID'
    | 'COST_SETTINGS_INVALID'
    | 'DRIVER_CONFIG_INVALID'
    | 'NEGATIVE_COST'
    | 'TOTAL_MISMATCH';
  itemKey?: string;
  field?: string;
  message: string;
};

const isFiniteNonNegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const isValidModularCostSettings = (
  value: unknown
): value is SalesModularCostSettings => {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  if (!isRecord(value.ownership)) return false;
  const ownershipKeys = Object.keys(value.ownership).sort();
  const expectedKeys = [...MODULAR_COST_OWNERSHIP_KEYS].sort();
  if (
    ownershipKeys.length !== expectedKeys.length ||
    ownershipKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  if (
    MODULAR_COST_OWNERSHIP_KEYS.some(
      (key) => !['shared', 'item_direct', 'excluded'].includes(value.ownership[key])
    )
  ) {
    return false;
  }
  if (!isRecord(value.ownershipJustifications)) return false;
  if (
    !isFiniteNonNegative(value.includedStorageMbPerPatient) ||
    value.includedStorageMbPerPatient <= 0
  ) {
    return false;
  }
  if (!isRecord(value.usageProfiles)) return false;
  const profileKeys = Object.keys(value.usageProfiles).sort();
  const expectedProfiles = ['intensive', 'light', 'standard'];
  if (
    profileKeys.length !== expectedProfiles.length ||
    profileKeys.some((key, index) => key !== expectedProfiles[index])
  ) {
    return false;
  }
  return (['light', 'standard', 'intensive'] as const).every((profile) => {
    const settings = value.usageProfiles[profile];
    return (
      isRecord(settings) &&
      isFiniteNonNegative(settings.storageUtilizationBasisPoints) &&
      settings.storageUtilizationBasisPoints <= 10_000 &&
      (settings.expectedEgressMultiplier === null ||
        isFiniteNonNegative(settings.expectedEgressMultiplier))
    );
  });
};

export const hasExactRequiredDrivers = (
  itemKey: string,
  config: Pick<SalesModularDriverConfig, 'requiredDrivers' | 'onboardingCalculationMode'>
) => {
  const expected =
    itemKey === 'onboarding' && config.onboardingCalculationMode === 'manual'
      ? []
      : DEFAULT_REQUIRED_DRIVERS_BY_ITEM[itemKey] || [];
  const received = Array.isArray(config.requiredDrivers)
    ? config.requiredDrivers
    : [];
  const unique = new Set(received);
  return (
    unique.size === received.length &&
    unique.size === expected.length &&
    expected.every((driver) => unique.has(driver))
  );
};

export const isValidModularDriverConfig = (
  itemKey: string,
  value: unknown
): value is SalesModularDriverConfig => {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  if (
    !Array.isArray(value.requiredDrivers) ||
    value.requiredDrivers.some((driver) => typeof driver !== 'string') ||
    !hasExactRequiredDrivers(itemKey, value as SalesModularDriverConfig) ||
    !isRecord(value.profiles) ||
    !isRecord(value.unitCostsCents)
  ) {
    return false;
  }
  if (
    itemKey === 'onboarding' &&
    !['hours', 'manual'].includes(value.onboardingCalculationMode)
  ) {
    return false;
  }
  for (const unitCost of Object.values(value.unitCostsCents)) {
    if (unitCost !== null && !isFiniteNonNegative(unitCost)) return false;
  }
  return (['light', 'standard', 'intensive'] as const).every((profile) => {
    const profileValues = value.profiles[profile];
    if (!isRecord(profileValues)) return false;
    return value.requiredDrivers.every((driver: SalesModularDriverKey) => {
      const datum = profileValues[driver];
      return (
        isRecord(datum) &&
        isFiniteNonNegative(datum.value) &&
        ['actual', 'calculated', 'estimated', 'manual'].includes(datum.source) &&
        typeof datum.sourceDetail === 'string' &&
        datum.sourceDetail.trim().length >= 2 &&
        typeof datum.effectiveAt === 'string' &&
        Number.isFinite(Date.parse(datum.effectiveAt)) &&
        Number.isInteger(datum.version) &&
        datum.version >= 1
      );
    });
  });
};

export const normalizeModularCostSettings = (
  raw: Partial<SalesModularCostSettings> | null | undefined
): SalesModularCostSettings => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawProfiles = source.usageProfiles || DEFAULT_MODULAR_COST_SETTINGS.usageProfiles;
  return {
    schemaVersion: 2,
    ownership: {
      ...DEFAULT_MODULAR_COST_SETTINGS.ownership,
      ...(source.ownership || {})
    },
    ownershipJustifications:
      source.ownershipJustifications && typeof source.ownershipJustifications === 'object'
        ? source.ownershipJustifications
        : {},
    includedStorageMbPerPatient:
      source.includedStorageMbPerPatient === null
        ? null
        : Number.isFinite(Number(source.includedStorageMbPerPatient))
          ? Number(source.includedStorageMbPerPatient)
          : DEFAULT_MODULAR_COST_SETTINGS.includedStorageMbPerPatient,
    usageProfiles: {
      light: {
        ...DEFAULT_MODULAR_COST_SETTINGS.usageProfiles.light,
        ...(rawProfiles.light || {})
      },
      standard: {
        ...DEFAULT_MODULAR_COST_SETTINGS.usageProfiles.standard,
        ...(rawProfiles.standard || {})
      },
      intensive: {
        ...DEFAULT_MODULAR_COST_SETTINGS.usageProfiles.intensive,
        ...(rawProfiles.intensive || {})
      }
    }
  };
};

export const emptySalesModularDriverConfig = (
  itemKey: string
): SalesModularDriverConfig => ({
  schemaVersion: 2,
  requiredDrivers: [...(DEFAULT_REQUIRED_DRIVERS_BY_ITEM[itemKey] || [])],
  profiles: { light: {}, standard: {}, intensive: {} },
  unitCostsCents: {},
  onboardingCalculationMode: itemKey === 'onboarding' ? 'hours' : undefined
});

export const hasDirectEquivalentCost = (
  ownershipKey: ModularCostOwnershipKey,
  items: Array<{
    itemKey?: string;
    costModel?: Record<string, any> | null;
  }>
) => {
  const keys = DIRECT_COST_MODEL_KEYS[ownershipKey] || [];
  return items.some((item) =>
    (!item.itemKey || modularCostCategoryApplies(item.itemKey, ownershipKey)) &&
    keys.some((key) => Number(item.costModel?.[key] || 0) > 0)
  );
};

export const findModularCostDuplicates = (
  settings: SalesModularCostSettings,
  items: Array<{
    itemKey?: string;
    costModel?: Record<string, any> | null;
  }>,
  _assumptionValues?: Record<string, any> | null
): ModularCostOwnershipKey[] =>
  (Object.keys(settings.ownership) as ModularCostOwnershipKey[]).filter((key) => {
    if (settings.ownership[key] !== 'shared') return false;
    return hasDirectEquivalentCost(key, items);
  });

export const validateModularCatalogForPublication = (
  catalog: {
    modularCostSettings?: Partial<SalesModularCostSettings> | null;
    customCapacityPolicy?: unknown;
    profitabilityPolicy?: unknown;
    items: Array<{
      itemKey: string;
      publicName: string;
      isActive: boolean;
      tiers?: Array<{ maximumQuantity: number | null }>;
      costModel?: Record<string, any> | null;
    }>;
  },
  assumptionValues?: Record<string, any> | null,
  storedTotalsReconciled = true
): SalesCatalogPublicationBlock[] => {
  const rawSettings = catalog.modularCostSettings;
  const settings = normalizeModularCostSettings(catalog.modularCostSettings);
  const blocks: SalesCatalogPublicationBlock[] = [];
  const activeItems = catalog.items.filter((item) => item.isActive);

  if (!validateCustomCapacityPolicy(catalog.customCapacityPolicy)) {
    blocks.push({
      code: 'CUSTOM_CAPACITY_POLICY_INVALID',
      field: 'customCapacityPolicy',
      message:
        'Defina e salve uma política versionada válida para os blocos de capacidade antes de publicar.'
    });
  }

  if (!validateSalesProfitabilityPolicy(catalog.profitabilityPolicy)) {
    blocks.push({
      code: 'PROFITABILITY_POLICY_INVALID',
      field: 'profitabilityPolicy',
      message:
        'Defina e salve a política de margem versionada, a alocação no Verto Clínica e a expansão antes de publicar.'
    });
  }

  if (!isValidModularCostSettings(rawSettings)) {
    blocks.push({
      code: 'COST_SETTINGS_INVALID',
      message:
        'A matriz de propriedade deve conter exatamente as 11 categorias conhecidas e perfis numéricos válidos.'
    });
  }

  const requiredUnitCostsByItem: Record<string, Array<SalesModularDriverKey | 'onboardingHours'>> = {
    clinical_core: ['monthlyAbaSessions', 'monthlyAbaRecords', 'generatedDocuments'],
    financial_management: ['financialReports', 'recurringProcesses'],
    insurance_tiss: ['tissBatches', 'tissXmlDocuments', 'tissDocuments'],
    school_management: ['schoolParticipants']
  };

  for (const item of activeItems) {
    const model = item.costModel;
    if (!model || model.costSource === 'unavailable') {
      blocks.push({
        code: 'COST_UNAVAILABLE',
        itemKey: item.itemKey,
        message: `${item.publicName}: modelo de custo indisponível.`
      });
      continue;
    }
    for (const [field, value] of Object.entries(model)) {
      if ((field.endsWith('Cents') || field === 'sharedCostAllocationWeight') && value !== null && value !== undefined && Number(value) < 0) {
        blocks.push({
          code: 'NEGATIVE_COST',
          itemKey: item.itemKey,
          field,
          message: `${item.publicName}: existe custo negativo em ${field}.`
        });
      }
    }
    const rawConfig = model.driverConfig;
    const config = (
      isRecord(rawConfig)
        ? rawConfig
        : emptySalesModularDriverConfig(item.itemKey)
    ) as SalesModularDriverConfig;
    if (!isValidModularDriverConfig(item.itemKey, rawConfig)) {
      blocks.push({
        code: 'DRIVER_CONFIG_INVALID',
        itemKey: item.itemKey,
        field: 'driverConfig',
        message: `${item.publicName}: drivers, fontes, critérios, vigência ou versão estão incompletos.`
      });
    }
    const requiredCostFields: string[] = item.itemKey === 'onboarding'
      ? config.onboardingCalculationMode === 'manual'
        ? ['onboardingCostCents']
        : []
      : [
          ...requiredDirectCostFieldsForItem(item.itemKey, settings),
          ...(['clinical_core', 'appointments_communication', 'financial_management', 'insurance_tiss', 'school_management'].includes(item.itemKey)
            ? ['directCostPerUsageUnitCents']
            : [])
        ];
    for (const field of requiredCostFields) {
      if (model[field] === null || model[field] === undefined) {
        blocks.push({
          code: 'COST_UNAVAILABLE',
          itemKey: item.itemKey,
          field,
          message: `${item.publicName}: informe ${DIRECT_COST_FIELD_LABELS[field] || field}; zero explícito é aceito.`
        });
      }
    }
    const requiredUnitCosts = [
      ...(requiredUnitCostsByItem[item.itemKey] || []),
      ...(item.itemKey === 'onboarding' &&
      config.onboardingCalculationMode !== 'manual'
        ? (['onboardingHours'] as const)
        : [])
    ];
    for (const driver of requiredUnitCosts) {
      const value = config.unitCostsCents?.[driver];
      if (!isFiniteNonNegative(value)) {
        blocks.push({
          code: 'COST_UNAVAILABLE',
          itemKey: item.itemKey,
          field: `unitCostsCents.${driver}`,
          message: `${item.publicName}: custo unitário de ${driver} indisponível.`
        });
      }
    }
    const requiredDrivers = config.requiredDrivers || DEFAULT_REQUIRED_DRIVERS_BY_ITEM[item.itemKey] || [];
    for (const profile of ['light', 'standard', 'intensive'] as const) {
      for (const driver of requiredDrivers) {
        const datum = config.profiles?.[profile]?.[driver];
        if (!datum || datum.value === null || datum.source === 'unavailable') {
          blocks.push({
            code: 'REQUIRED_DRIVER_MISSING',
            itemKey: item.itemKey,
            field: `${profile}.${driver}`,
            message: `${item.publicName}: driver ${driver} indisponível no perfil ${profile}.`
          });
        }
      }
    }
  }

  const core = activeItems.find((item) => item.itemKey === 'clinical_core');
  if (
    core &&
    (!isFiniteNonNegative(settings.includedStorageMbPerPatient) ||
      settings.includedStorageMbPerPatient === 0 ||
      core.costModel?.storageCostPerGbCents == null)
  ) {
    blocks.push({
      code: 'INCLUDED_STORAGE_MODEL_MISSING',
      itemKey: 'clinical_core',
      message: 'Verto Clínica: informe o modelo do armazenamento incluído.'
    });
  }

  const storageItems = activeItems.filter((item) =>
    ['clinical_core', 'additional_storage', 'insurance_tiss', 'school_management'].includes(item.itemKey)
  );
  for (const item of storageItems) {
    const config = (item.costModel?.driverConfig || {}) as SalesModularDriverConfig;
    for (const profile of ['light', 'standard', 'intensive'] as const) {
      const multiplier =
        config.usageProfileOverrides?.[profile]?.expectedEgressMultiplier ??
        settings.usageProfiles[profile].expectedEgressMultiplier;
      if (!isFiniteNonNegative(multiplier)) {
        blocks.push({
          code: 'EGRESS_CRITERION_MISSING',
          itemKey: item.itemKey,
          field: `${profile}.expectedEgressMultiplier`,
          message: `${item.publicName}: defina o critério de egress do perfil ${profile}.`
        });
      }
    }
  }

  for (const key of findModularCostDuplicates(settings, activeItems, assumptionValues)) {
    const justification = String(settings.ownershipJustifications[key] || '').trim();
    if (justification.length < 12) {
      blocks.push({
        code: 'POSSIBLE_DUPLICATE_COST',
        field: key,
        message: `Possível custo duplicado: ${MODULAR_COST_OWNERSHIP_LABELS[key]}. Justifique ou altere a propriedade.`
      });
    }
  }

  if (!storedTotalsReconciled) {
    blocks.push({
      code: 'TOTAL_MISMATCH',
      message: 'A soma das linhas diverge do consolidado.'
    });
  }
  return blocks;
};
