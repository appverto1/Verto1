import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileClock,
  Loader2,
  PackageCheck
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import type {
  SalesPricingCatalogItem,
  SalesPricingCatalogSnapshot,
  SalesPricingCostModel,
  SalesSharedAllocationMethod
} from '../utils/salesModularProposal';
import {
  MODULAR_COST_OWNERSHIP_LABELS,
  SALES_MODULAR_DRIVER_DEFINITIONS,
  directCostCategoryForField,
  emptySalesModularDriverConfig,
  findModularCostDuplicates,
  modularCostCategoryApplies,
  normalizeModularCostSettings,
  type ModularCostOwnershipKey,
  type ModularCostOwnershipValue,
  type SalesCatalogPublicationBlock,
  type SalesModularCostSettings,
  type SalesModularDriverKey,
  type SalesModularDriverValue,
  type SalesModularProfile
} from '../utils/salesModularCostDrivers';
import {
  DEFAULT_CUSTOM_CAPACITY_POLICY,
  validateCustomCapacityPolicy,
  type CustomCapacityPolicy
} from '../utils/salesCommercialEvolution';
import {
  DEFAULT_SALES_PROFITABILITY_POLICY,
  validateSalesProfitabilityPolicy,
  type SalesProfitabilityPolicy
} from '../utils/salesModularEconomics';

type CatalogVersion = {
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  effective_at: string;
  published_at?: string | null;
};

type ProfitabilityRow = {
  item_key: string;
  public_name: string;
  simulated_count: number;
  proposed_count: number;
  average_proposed_revenue_cents: number | null;
  average_direct_cost_cents: number | null;
  average_ebitda_cents: number | null;
  average_ebitda_margin_basis_points: number | null;
  minimum_ebitda_margin_basis_points: number | null;
  maximum_ebitda_margin_basis_points: number | null;
  selected_basis_points: number | null;
  proposed_basis_points: number | null;
  has_insufficient_data: boolean;
};

const money = (value: number | null | undefined) =>
  value == null
    ? 'Dados insuficientes'
    : (value / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });

const percent = (value: number | null | undefined) =>
  value == null
    ? 'Dados insuficientes'
    : `${(value / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}%`;

const key = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

const nullableCurrencyInput = (value: unknown) =>
  value === '' || value === null || value === undefined
    ? null
    : Math.round(Number(value) * 100);

const costFields: Array<{
  key: keyof SalesPricingCostModel;
  label: string;
  group: string;
  unit: string;
}> = [
  ['directFixedMonthlyCostCents', 'Fixo mensal direto', 'Custos fixos da funcionalidade', 'R$/funcionalidade/mês'],
  ['directCostPerClinicCents', 'Custo direto da clínica', 'Custos fixos da funcionalidade', 'R$/clínica/mês'],
  ['directCostPerPatientCents', 'Custo direto por paciente', 'Custos por paciente', 'R$/paciente/mês'],
  ['directCostPerUsageUnitCents', 'Custo da unidade principal', 'Custos por unidade de uso', 'unidade definida abaixo'],
  ['processingCostPerUnitCents', 'Processamento por unidade', 'Custos por unidade de uso', 'R$/unidade processada'],
  ['storageCostPerGbCents', 'Armazenamento', 'Armazenamento e egress', 'R$/GB/mês'],
  ['egressCostPerGbCents', 'Egress', 'Armazenamento e egress', 'R$/GB transferido'],
  ['notificationCostPerUnitCents', 'Notificação enviada', 'Notificações', 'R$/notificação'],
  ['otherVariableCostCents', 'Outros custos variáveis diretos', 'Operação', 'R$/funcionalidade/mês'],
  ['supportFixedMonthlyCostCents', 'Suporte fixo', 'Suporte', 'R$/clínica/mês'],
  ['supportCostPerPatientCents', 'Suporte por paciente', 'Suporte', 'R$/paciente/mês'],
  ['operationalFixedMonthlyCostCents', 'Operação mensal', 'Operação', 'R$/clínica/mês'],
  ['onboardingCostCents', 'Implantação manual direta', 'Implantação', 'R$/implantação']
].map(([fieldKey, label, group, unit]) => ({
  key: fieldKey as keyof SalesPricingCostModel,
  label: String(label),
  group: String(group),
  unit: String(unit)
}));

const costGroups = [
  'Custos fixos da funcionalidade',
  'Custos por paciente',
  'Custos por unidade de uso',
  'Armazenamento e egress',
  'Notificações',
  'Suporte',
  'Operação',
  'Implantação'
];

const driverCostKeys: Array<SalesModularDriverKey | 'onboardingHours'> = [
  'monthlyAbaSessions',
  'monthlyAbaRecords',
  'generatedDocuments',
  'financialReports',
  'recurringProcesses',
  'tissBatches',
  'tissXmlDocuments',
  'tissDocuments',
  'schoolParticipants',
  'onboardingHours'
];

const profileLabels: Record<SalesModularProfile, string> = {
  light: 'Leve',
  standard: 'Padrão',
  intensive: 'Intensivo'
};

const profitabilityMarginFields: Array<{
  key:
    | 'clinicMinimumEbitdaMarginBasisPoints'
    | 'recurringTargetEbitdaMarginBasisPoints'
    | 'moduleTargetIncrementalMarginBasisPoints'
    | 'moduleMinimumIncrementalMarginBasisPoints'
    | 'capacityMinimumIncrementalMarginBasisPoints'
    | 'postPromotionMinimumEbitdaMarginBasisPoints';
  label: string;
  hint: string;
}> = [
  {
    key: 'clinicMinimumEbitdaMarginBasisPoints',
    label: 'Piso absoluto da clínica',
    hint: 'Nenhuma fase pode ficar abaixo.'
  },
  {
    key: 'recurringTargetEbitdaMarginBasisPoints',
    label: 'Meta recorrente',
    hint: 'Obrigatória após promoções.'
  },
  {
    key: 'moduleMinimumIncrementalMarginBasisPoints',
    label: 'Piso dos módulos',
    hint: 'Custo incremental, sem rateio duplicado.'
  },
  {
    key: 'moduleTargetIncrementalMarginBasisPoints',
    label: 'Meta dos módulos',
    hint: 'Classificação saudável.'
  },
  {
    key: 'capacityMinimumIncrementalMarginBasisPoints',
    label: 'Piso da capacidade',
    hint: 'Blocos e excedentes.'
  },
  {
    key: 'postPromotionMinimumEbitdaMarginBasisPoints',
    label: 'Piso posterior',
    hint: 'Condição normal congelada.'
  }
];

const expansionPolicyItems = [
  {
    itemKey: 'appointments_communication',
    label: 'Agenda e Comunicação',
    driverKey: 'monthlyAppointments',
    unit: 'sessões'
  },
  {
    itemKey: 'financial_management',
    label: 'Financeiro e Gestão',
    driverKey: 'financialEntries',
    unit: 'lançamentos'
  },
  {
    itemKey: 'insurance_tiss',
    label: 'Convênios e TISS',
    driverKey: 'tissGuides',
    unit: 'guias'
  },
  {
    itemKey: 'school_management',
    label: 'Gestão Escolar',
    driverKey: 'schoolPatients',
    unit: 'vínculos escolares'
  },
  {
    itemKey: 'additional_storage',
    label: 'Armazenamento adicional',
    driverKey: 'expectedStorageGb',
    unit: 'GB'
  }
] as const;

const primaryUsageUnitByItem: Record<string, string> = {
  clinical_core: 'R$/sessão clínica',
  appointments_communication: 'R$/sessão',
  financial_management: 'R$/lançamento',
  insurance_tiss: 'R$/guia',
  school_management: 'R$/reunião escolar',
  additional_storage: 'R$/bloco',
  onboarding: 'R$/hora de implantação'
};

const driverCostLabel = (
  driverKey: SalesModularDriverKey | 'onboardingHours'
) => {
  if (driverKey === 'onboardingHours') {
    return { label: 'Custo por hora de implantação', unit: 'R$/hora de implantação' };
  }
  const definition = SALES_MODULAR_DRIVER_DEFINITIONS.find(
    (candidate) => candidate.key === driverKey
  );
  return {
    label: definition?.label || driverKey,
    unit:
      driverKey === 'monthlyAbaRecords'
        ? 'R$/1.000 registros ABA'
        : `R$/${String(definition?.unit || 'unidade').replace('/mês', '')}`
  };
};

const costFieldAppliesToItem = (
  field: keyof SalesPricingCostModel,
  itemKey: string
) => {
  if (itemKey === 'onboarding') return field === 'onboardingCostCents';
  if (field === 'onboardingCostCents') return false;
  const ownershipCategory = directCostCategoryForField(String(field));
  if (ownershipCategory) {
    return modularCostCategoryApplies(itemKey, ownershipCategory);
  }
  if (field === 'directCostPerUsageUnitCents') {
    return ['clinical_core', 'appointments_communication', 'financial_management', 'insurance_tiss', 'school_management'].includes(itemKey);
  }
  return false;
};

export const SalesPricingCatalogPanel = () => {
  const [catalog, setCatalog] =
    useState<(SalesPricingCatalogSnapshot & { metadata?: any }) | null>(null);
  const [versions, setVersions] = useState<CatalogVersion[]>([]);
  const [report, setReport] = useState<ProfitabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [migrationPending, setMigrationPending] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [allocationDraft, setAllocationDraft] = useState<
    SalesPricingCatalogSnapshot['allocationSettings'] | null
  >(null);
  const [modularCostDraft, setModularCostDraft] =
    useState<SalesModularCostSettings | null>(null);
  const [customCapacityPolicyDraft, setCustomCapacityPolicyDraft] =
    useState<CustomCapacityPolicy | null>(null);
  const [profitabilityPolicyDraft, setProfitabilityPolicyDraft] =
    useState<SalesProfitabilityPolicy | null>(null);
  const [publicationBlocks, setPublicationBlocks] = useState<
    SalesCatalogPublicationBlock[]
  >([]);
  const [costDrafts, setCostDrafts] = useState<
    Record<string, Record<string, any>>
  >({});
  const possibleDuplicateCosts = useMemo(() => {
    if (!catalog || !modularCostDraft) return [];
    return findModularCostDuplicates(
      modularCostDraft,
      catalog.items.map((item) => ({
        ...item,
        costModel: {
          ...(item.costModel || {}),
          ...(costDrafts[item.id] || {})
        }
      }))
    );
  }, [catalog, costDrafts, modularCostDraft]);

  const authenticatedFetch = async (
    url: string,
    init: RequestInit = {}
  ) => {
    const supabase = await getSupabase();
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
        ...(init.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      const requestError = new Error(
        data?.error || 'Não foi possível concluir esta ação.'
      );
      (requestError as any).code = data?.code;
      (requestError as any).blocks = data?.blocks;
      throw requestError;
    }
    return data;
  };

  const setCatalogData = (data: any) => {
    const loadedCatalog = data.catalog || null;
    setCatalog(loadedCatalog);
    setVersions(data.versions || []);
    setReport(data.profitabilityByFeature || []);
    setPublicationBlocks(data.publicationBlocks || []);
    setDraftName(
      loadedCatalog?.status === 'draft' ? loadedCatalog.name || '' : ''
    );
    setAllocationDraft(loadedCatalog?.allocationSettings || null);
    setModularCostDraft(
      loadedCatalog
        ? normalizeModularCostSettings(loadedCatalog.modularCostSettings)
        : null
    );
    setCustomCapacityPolicyDraft(
      loadedCatalog?.status === 'draft'
        ? validateCustomCapacityPolicy(loadedCatalog.customCapacityPolicy)
          ? { ...loadedCatalog.customCapacityPolicy }
          : { ...DEFAULT_CUSTOM_CAPACITY_POLICY }
        : validateCustomCapacityPolicy(loadedCatalog?.customCapacityPolicy)
          ? { ...loadedCatalog.customCapacityPolicy }
          : null
    );
    setProfitabilityPolicyDraft(
      loadedCatalog?.status === 'draft'
        ? validateSalesProfitabilityPolicy(loadedCatalog.profitabilityPolicy)
          ? {
              ...loadedCatalog.profitabilityPolicy,
              driverExpansionPolicies: {
                ...loadedCatalog.profitabilityPolicy.driverExpansionPolicies
              }
            }
          : {
              ...DEFAULT_SALES_PROFITABILITY_POLICY,
              driverExpansionPolicies: {}
            }
        : validateSalesProfitabilityPolicy(loadedCatalog?.profitabilityPolicy)
          ? {
              ...loadedCatalog.profitabilityPolicy,
              driverExpansionPolicies: {
                ...loadedCatalog.profitabilityPolicy.driverExpansionPolicies
              }
            }
          : null
    );
    const nextCosts: Record<string, Record<string, any>> = {};
    for (const item of loadedCatalog?.items || []) {
      const model = item.costModel || {};
      nextCosts[item.id] = {
        ...model,
        costSource: model.costSource || 'unavailable',
        sourceDetail:
          model.sourceDetail || 'Custo por funcionalidade ainda não informado.',
        sharedCostAllocationWeight:
          model.sharedCostAllocationWeight == null
            ? 1
            : Number(model.sharedCostAllocationWeight)
      };
      const baseDriverConfig = emptySalesModularDriverConfig(item.itemKey);
      const driverConfig = {
        ...baseDriverConfig,
        ...(model.driverConfig || {}),
        profiles: {
          light: {
            ...baseDriverConfig.profiles.light,
            ...(model.driverConfig?.profiles?.light || {})
          },
          standard: {
            ...baseDriverConfig.profiles.standard,
            ...(model.driverConfig?.profiles?.standard || {})
          },
          intensive: {
            ...baseDriverConfig.profiles.intensive,
            ...(model.driverConfig?.profiles?.intensive || {})
          }
        }
      };
      nextCosts[item.id].driverConfig = driverConfig;
      nextCosts[item.id].driverUnitCosts = {};
      for (const driverKey of driverCostKeys) {
        const value = driverConfig.unitCostsCents?.[driverKey];
        nextCosts[item.id].driverUnitCosts[driverKey] =
          value == null ? '' : Number(value) / 100;
      }
      for (const field of costFields) {
        nextCosts[item.id][field.key] =
          model[field.key] == null ? '' : Number(model[field.key]) / 100;
      }
    }
    setCostDrafts(nextCosts);
  };

  const load = async (versionId?: string) => {
    setLoading(true);
    setError('');
    try {
      const query = versionId
        ? `?versionId=${encodeURIComponent(versionId)}`
        : '';
      const data = await authenticatedFetch(
        `/api/owner/sales/pricing-catalogs${query}`
      );
      setCatalogData(data);
      setMigrationPending(false);
    } catch (loadError: any) {
      if (loadError?.code === 'PRICING_CATALOG_NOT_FOUND') {
        setMigrationPending(true);
      } else {
        setError(loadError?.message || 'Não foi possível carregar o catálogo.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const activeVersion = useMemo(
    () => versions.find((version) => version.status === 'active') || null,
    [versions]
  );

  const cloneCatalog = async () => {
    if (!activeVersion) return;
    setBusy('clone');
    setError('');
    try {
      const data = await authenticatedFetch(
        '/api/owner/sales/pricing-catalogs/clone',
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': key('catalog-clone') },
          body: JSON.stringify({
            sourceVersionId: activeVersion.id,
            name: `Catálogo comercial v${Math.max(
              1,
              ...versions.map((version) => version.version + 1)
            )} — margem operacional modular`
          })
        }
      );
      await load(data.catalogVersion.id);
      setNotice('Rascunho criado. A versão ativa continua inalterada.');
    } catch (cloneError: any) {
      setError(cloneError?.message || 'Não foi possível criar o rascunho.');
    } finally {
      setBusy('');
    }
  };

  const saveDraftAction = async (
    action: 'version' | 'item' | 'tier' | 'cost_model',
    payload: Record<string, any>,
    actionKey: string
  ) => {
    if (!catalog || catalog.status !== 'draft') return;
    setBusy(actionKey);
    setError('');
    setNotice('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/pricing-catalogs/${encodeURIComponent(catalog.id)}`,
        {
          method: 'PATCH',
          headers: { 'X-Idempotency-Key': key(`catalog-${action}`) },
          body: JSON.stringify({ action, payload })
        }
      );
      await load(catalog.id);
      setNotice('Rascunho salvo com histórico de auditoria.');
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o rascunho.');
    } finally {
      setBusy('');
    }
  };

  const publishCatalog = async () => {
    if (!catalog || catalog.status !== 'draft') return;
    setBusy('publish');
    setError('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/pricing-catalogs/${encodeURIComponent(catalog.id)}/publish`,
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': key('catalog-publish') },
          body: JSON.stringify({})
        }
      );
      await load(catalog.id);
      setNotice(
        'Catálogo publicado. Propostas históricas continuam no snapshot anterior.'
      );
    } catch (publishError: any) {
      if (Array.isArray(publishError?.blocks)) {
        setPublicationBlocks(publishError.blocks);
      }
      setError(publishError?.message || 'Não foi possível publicar.');
    } finally {
      setBusy('');
    }
  };

  const saveCost = async (item: SalesPricingCatalogItem) => {
    const draft = costDrafts[item.id] || {};
    const invalidCost = costFields.find((field) => {
      if (!costFieldAppliesToItem(field.key, item.itemKey)) return false;
      const value = draft[field.key];
      return (
        value !== '' &&
        value !== null &&
        value !== undefined &&
        (!Number.isFinite(Number(value)) || Number(value) < 0)
      );
    });
    if (invalidCost) {
      setError(`${invalidCost.label}: informe um valor maior ou igual a zero.`);
      return;
    }
    const rawDriverConfig = {
      ...emptySalesModularDriverConfig(item.itemKey),
      ...(draft.driverConfig || {})
    };
    const driverConfig = {
      ...rawDriverConfig,
      schemaVersion: 2 as const,
      unitCostsCents: Object.fromEntries(
        driverCostKeys.map((driverKey) => [
          driverKey,
          nullableCurrencyInput(draft.driverUnitCosts?.[driverKey])
        ])
      ),
      profiles: Object.fromEntries(
        (['light', 'standard', 'intensive'] as SalesModularProfile[]).map(
          (profile) => [
            profile,
            Object.fromEntries(
              (rawDriverConfig.requiredDrivers || []).map(
                (driverKey: SalesModularDriverKey) => {
                  const current = rawDriverConfig.profiles?.[profile]?.[
                    driverKey
                  ] as SalesModularDriverValue | undefined;
                  const rawValue = (current as any)?.value;
                  const numericValue =
                    rawValue === '' || rawValue == null
                      ? null
                      : Number(rawValue);
                  return [
                    driverKey,
                    {
                      value:
                        driverKey === 'extraordinaryOnboardingCostCents' &&
                        numericValue !== null
                          ? Math.round(numericValue * 100)
                          : numericValue,
                      source:
                        numericValue === null
                          ? 'unavailable'
                          : current?.source && current.source !== 'unavailable'
                            ? current.source
                            : draft.costSource === 'unavailable'
                              ? 'manual'
                              : draft.costSource,
                      sourceDetail:
                        String(current?.sourceDetail || '').trim() ||
                        String(draft.sourceDetail || '').trim() ||
                        'Premissa de uso cadastrada no catálogo.',
                      effectiveAt:
                        current?.effectiveAt || new Date().toISOString(),
                      version:
                        Number(current?.version || 0) ||
                        Number(item.costModel?.version || 0) + 1
                    }
                  ];
                }
              )
            )
          ]
        )
      )
    };
    const payload: Record<string, any> = {
      itemId: item.id,
      costSource: draft.costSource || 'unavailable',
      sourceDetail:
        String(draft.sourceDetail || '').trim() ||
        'Custo por funcionalidade ainda não informado.',
      sharedCostAllocationWeight: Number(
        draft.sharedCostAllocationWeight || 0
      ),
      driverConfig
    };
    for (const field of costFields) {
      payload[field.key] = nullableCurrencyInput(draft[field.key]);
    }
    await saveDraftAction(
      'cost_model',
      payload,
      `cost:${item.id}`
    );
  };

  const updateDriverDraft = (
    itemId: string,
    profile: SalesModularProfile,
    driverKey: SalesModularDriverKey,
    patch: Partial<SalesModularDriverValue> & { value?: number | string | null }
  ) => {
    setCostDrafts((current) => {
      const itemDraft = current[itemId] || {};
      const config = itemDraft.driverConfig || {};
      const profileDrivers = config.profiles?.[profile] || {};
      const existing = profileDrivers[driverKey] || {
        value: null,
        source: 'unavailable',
        sourceDetail: '',
        effectiveAt: new Date().toISOString(),
        version: 1
      };
      return {
        ...current,
        [itemId]: {
          ...itemDraft,
          driverConfig: {
            ...config,
            profiles: {
              ...(config.profiles || {}),
              [profile]: {
                ...profileDrivers,
                [driverKey]: { ...existing, ...patch }
              }
            }
          }
        }
      };
    });
  };

  const updateDriverUnitCost = (
    itemId: string,
    driverKey: SalesModularDriverKey | 'onboardingHours',
    value: string
  ) => {
    setCostDrafts((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        driverUnitCosts: {
          ...(current[itemId]?.driverUnitCosts || {}),
          [driverKey]: value
        }
      }
    }));
  };

  const allocationFields: Array<{
    key: keyof SalesPricingCatalogSnapshot['allocationSettings'];
    label: string;
  }> = [
    { key: 'stripePercentage', label: 'Tarifa percentual Stripe' },
    { key: 'stripeFixed', label: 'Tarifa fixa Stripe' },
    { key: 'revenueTax', label: 'Imposto sobre faturamento' },
    { key: 'delinquency', label: 'Inadimplência' },
    { key: 'sharedPlatformCosts', label: 'Custos compartilhados' },
    { key: 'belowEbitda', label: 'Despesas abaixo do EBITDA atribuído' }
  ];
  const allocationOptions: Array<{
    value: SalesSharedAllocationMethod;
    label: string;
  }> = [
    { value: 'net_revenue', label: 'Receita líquida' },
    { value: 'gross_revenue', label: 'Receita bruta' },
    { value: 'configured_weight', label: 'Peso por funcionalidade' },
    { value: 'base_package', label: 'Somente pacote-base' },
    { value: 'none', label: 'Sem alocação' },
    { value: 'custom', label: 'Personalizado por peso' }
  ];

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex min-h-32 items-center justify-center gap-3 text-sm text-slate-600">
          <Loader2 className="animate-spin text-violet-600" size={19} />
          Carregando catálogo modular...
        </div>
      </section>
    );
  }

  if (migrationPending) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <FileClock className="mt-0.5 shrink-0 text-amber-700" size={19} />
          <div>
            <h2 className="text-base font-semibold text-amber-950">
              Catálogo modular aguardando migration
            </h2>
            <p className="mt-1 text-sm font-normal leading-6 text-amber-900">
              As premissas legadas continuam disponíveis. Aplique manualmente a
              as migrations 20260727030000 e 20260727040000, nesta ordem,
              para liberar catálogo, propriedade de custos e drivers modulares.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!catalog) return null;

  return (
    <>
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium text-violet-700">
              Catálogo comercial versionado
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">
              Pacotes, módulos e custos por funcionalidade
            </h2>
            <p className="mt-2 max-w-3xl text-sm font-normal leading-6 text-slate-600">
              Edite somente em rascunhos. Publicações ficam imutáveis e cada
              proposta preserva preços, limites, custos e resultados.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={catalog.id}
              onChange={(event) => void load(event.target.value)}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700"
              aria-label="Versão do catálogo"
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version} · {version.name} · {version.status}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void cloneCatalog()}
              disabled={Boolean(busy) || !activeVersion}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-4 text-sm font-medium text-violet-700 disabled:opacity-50"
            >
              {busy === 'clone' ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Copy size={16} />
              )}
              Nova versão
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              catalog.status === 'active'
                ? 'bg-emerald-100 text-emerald-800'
                : catalog.status === 'draft'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-200 text-slate-700'
            }`}
          >
            v{catalog.version} ·{' '}
            {catalog.status === 'active'
              ? 'Ativa'
              : catalog.status === 'draft'
                ? 'Rascunho'
                : 'Histórica'}
          </span>
          <span className="text-xs font-normal text-slate-500">
            Vigência:{' '}
            {new Date(catalog.effectiveAt).toLocaleString('pt-BR')}
          </span>
          <span className="text-xs font-normal text-slate-500">
            {catalog.items.length} itens carregados em lote
          </span>
          <span className="text-xs font-normal text-slate-500">
            {catalog.hasVersionedCustomCapacityPolicy
              ? 'Política de blocos versionada'
              : 'Sem política de blocos nesta versão'}
          </span>
          <span className="text-xs font-normal text-slate-500">
            {catalog.hasVersionedProfitabilityPolicy
              ? 'Política de margem versionada'
              : 'Sem política de margem nesta versão'}
          </span>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}
        {notice ? (
          <div
            role="status"
            className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
            {notice}
          </div>
        ) : null}
      </section>

      {catalog.status === 'draft' ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <label className="w-full max-w-lg text-sm font-medium text-slate-700">
              Nome da versão
              <input
                value={draftName}
                maxLength={120}
                onChange={(event) => setDraftName(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void saveDraftAction(
                    'version',
                    {
                      name: draftName,
                      allocationSettings: allocationDraft,
                      modularCostSettings: modularCostDraft,
                      customCapacityPolicy: customCapacityPolicyDraft,
                      profitabilityPolicy: profitabilityPolicyDraft
                    },
                    'version'
                  )
                }
                disabled={
                  Boolean(busy) ||
                  draftName.trim().length < 2 ||
                  !validateCustomCapacityPolicy(customCapacityPolicyDraft) ||
                  !validateSalesProfitabilityPolicy(profitabilityPolicyDraft)
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                <Database size={16} /> Salvar versão
              </button>
              <button
                type="button"
                onClick={() => void publishCatalog()}
                disabled={Boolean(busy) || publicationBlocks.length > 0}
                title={
                  publicationBlocks.length > 0
                    ? 'Resolva os bloqueios listados antes de publicar.'
                    : undefined
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === 'publish' ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <PackageCheck size={16} />
                )}
                Publicar versão
              </button>
            </div>
          </div>
          {publicationBlocks.length > 0 ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">
                    Publicação bloqueada ({publicationBlocks.length})
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 font-normal leading-5">
                    {publicationBlocks.slice(0, 30).map((block, index) => (
                      <li key={`${block.code}:${block.itemKey || block.field || index}`}>
                        {block.message}
                      </li>
                    ))}
                  </ul>
                  {publicationBlocks.length > 30 ? (
                    <p className="mt-2 text-xs">
                      Mais {publicationBlocks.length - 30} bloqueios. Salve os
                      modelos por funcionalidade para atualizar a lista.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {profitabilityPolicyDraft ? (
            <fieldset className="mt-4 border-t border-amber-200 pt-4">
              <legend className="text-sm font-medium text-slate-800">
                Política de margem operacional atribuída
              </legend>
              <p className="mt-1 max-w-3xl text-xs font-normal leading-5 text-slate-600">
                O perfil intensivo define os preços mínimos. Infraestrutura,
                operação-base, suporte-base e taxa fixa são absorvidos uma única
                vez pelo Verto Clínica.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {profitabilityMarginFields.map((field) => (
                  <label
                    key={field.key}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-700"
                  >
                    <span className="flex items-center justify-between gap-3">
                      {field.label}
                      <span className="flex min-h-9 items-center rounded-lg border border-slate-200 px-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
                        <input
                          type="number"
                          min={0}
                          max={99.99}
                          step={0.01}
                          value={
                            profitabilityPolicyDraft[field.key] / 100
                          }
                          onChange={(event) =>
                            setProfitabilityPolicyDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    [field.key]: Math.round(
                                      Number(event.target.value) * 100
                                    )
                                  }
                                : current
                            )
                          }
                          className="w-16 bg-transparent text-right font-normal outline-none"
                        />
                        <span className="ml-1 text-slate-400">%</span>
                      </span>
                    </span>
                    <span className="mt-2 block font-normal leading-5 text-slate-500">
                      {field.hint}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
                  <p className="font-medium text-emerald-900">
                    Custos compartilhados
                  </p>
                  <p className="mt-1 font-normal leading-5 text-emerald-800">
                    Alocação fixa em Verto Clínica. Módulos recebem apenas seus
                    custos incrementais e taxas percentuais.
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                  <p className="font-medium text-slate-700">
                    Fórmula auditável
                  </p>
                  <p className="mt-1 font-normal leading-5 text-slate-500">
                    Custo fixo + direto + taxa fixa, dividido pelo saldo após
                    margem alvo, Stripe, inadimplência e imposto.
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3 text-xs text-slate-600">
                <p className="font-medium text-slate-800">
                  Referências para 150 pacientes
                </p>
                <p className="mt-1 font-normal leading-5">
                  Promocional atual: {money(159900)} · intermediário:{' '}
                  {money(199900)} · referência de tabela: {money(219900)}.
                  São referências comerciais; o preço-alvo exibido na proposta
                  é sempre recalculado com custos e premissas publicados.
                </p>
              </div>
              <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-700">
                  Franquias e excedentes por driver
                </summary>
                <p className="mt-2 text-xs font-normal leading-5 text-slate-500">
                  Ative somente com valores comerciais aprovados. Campos
                  indisponíveis não são convertidos silenciosamente em zero.
                </p>
                <div className="mt-3 space-y-3">
                  {expansionPolicyItems.map((definition) => {
                    const configured =
                      profitabilityPolicyDraft.driverExpansionPolicies[
                        definition.itemKey
                      ];
                    const updateExpansion = (
                      patch: Record<string, unknown>
                    ) =>
                      setProfitabilityPolicyDraft((current) => {
                        if (!current) return current;
                        const previous =
                          current.driverExpansionPolicies[
                            definition.itemKey
                          ];
                        const next = {
                          enabled: false,
                          driverKey: definition.driverKey,
                          includedUnits: null,
                          blockSizeUnits: null,
                          blockPriceCents: null,
                          source: 'unavailable' as const,
                          sourceDetail:
                            'Franquia ainda não aprovada comercialmente.',
                          effectiveAt: new Date().toISOString(),
                          version: 1,
                          ...(previous || {}),
                          ...patch
                        };
                        return {
                          ...current,
                          driverExpansionPolicies: {
                            ...current.driverExpansionPolicies,
                            [definition.itemKey]: next
                          }
                        };
                      });
                    return (
                      <div
                        key={definition.itemKey}
                        className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 lg:grid-cols-[1.4fr_repeat(3,1fr)]"
                      >
                        <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-medium text-slate-700">
                          <span>
                            {definition.label}
                            <span className="mt-1 block font-normal text-slate-500">
                              Driver: {definition.unit}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={configured?.enabled === true}
                            onChange={(event) =>
                              updateExpansion({
                                enabled: event.target.checked,
                                source: event.target.checked
                                  ? 'manual'
                                  : 'unavailable',
                                sourceDetail: event.target.checked
                                  ? 'Política aprovada e informada manualmente no catálogo.'
                                  : 'Franquia desabilitada nesta versão.'
                              })
                            }
                            className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          />
                        </label>
                        {[
                          ['includedUnits', 'Franquia incluída'],
                          ['blockSizeUnits', 'Unidades por bloco'],
                          ['blockPriceCents', 'Preço do bloco (R$)']
                        ].map(([fieldKey, label]) => (
                          <label
                            key={fieldKey}
                            className="text-xs font-medium text-slate-600"
                          >
                            {label}
                            <input
                              type="number"
                              min={0}
                              step={
                                fieldKey === 'blockPriceCents' ? 0.01 : 1
                              }
                              value={
                                configured?.[
                                  fieldKey as
                                    | 'includedUnits'
                                    | 'blockSizeUnits'
                                    | 'blockPriceCents'
                                ] == null
                                  ? ''
                                  : fieldKey === 'blockPriceCents'
                                    ? Number(configured.blockPriceCents) / 100
                                    : Number(
                                        configured[
                                          fieldKey as
                                            | 'includedUnits'
                                            | 'blockSizeUnits'
                                        ]
                                      )
                              }
                              disabled={!configured?.enabled}
                              onChange={(event) =>
                                updateExpansion({
                                  [fieldKey]:
                                    event.target.value === ''
                                      ? null
                                      : fieldKey === 'blockPriceCents'
                                        ? Math.round(
                                            Number(event.target.value) * 100
                                          )
                                        : Number(event.target.value)
                                })
                              }
                              className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                            />
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </details>
              {!validateSalesProfitabilityPolicy(
                profitabilityPolicyDraft
              ) ? (
                <p role="alert" className="mt-3 text-xs text-rose-700">
                  Revise os pisos de margem e complete cada franquia habilitada.
                </p>
              ) : null}
            </fieldset>
          ) : null}
          {customCapacityPolicyDraft ? (
            <fieldset className="mt-4 border-t border-amber-200 pt-4">
              <legend className="text-sm font-medium text-slate-800">
                Blocos adicionais de capacidade
              </legend>
              <p className="mt-1 max-w-3xl text-xs font-normal leading-5 text-slate-600">
                Esta política pertence somente ao novo rascunho. A versão ativa
                permanece sem alterações até a publicação.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-700">
                  <span className="flex items-center justify-between gap-3">
                    Habilitar blocos
                    <input
                      type="checkbox"
                      checked={customCapacityPolicyDraft.enabled}
                      onChange={(event) =>
                        setCustomCapacityPolicyDraft((current) =>
                          current
                            ? { ...current, enabled: event.target.checked }
                            : current
                        )
                      }
                      className="h-5 w-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                    />
                  </span>
                  <span className="mt-2 block font-normal leading-5 text-slate-500">
                    Controla a oferta comercial de capacidade adicional.
                  </span>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Pacientes por bloco
                  <span className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={customCapacityPolicyDraft.blockSizePatients}
                      onChange={(event) =>
                        setCustomCapacityPolicyDraft((current) =>
                          current
                            ? {
                                ...current,
                                blockSizePatients: Math.trunc(
                                  Number(event.target.value)
                                )
                              }
                            : current
                        )
                      }
                      className="min-w-0 flex-1 bg-transparent font-normal outline-none"
                    />
                    <span className="text-slate-400">pacientes</span>
                  </span>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Fallback legado do bloco
                  <span className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
                    <span className="mr-2 text-slate-400">R$</span>
                    <input
                      type="number"
                      min={0}
                      max={10000000}
                      step="0.01"
                      value={customCapacityPolicyDraft.blockPriceCents / 100}
                      readOnly
                      aria-describedby="legacy-capacity-block-price-help"
                      className="min-w-0 flex-1 bg-transparent font-normal text-slate-500 outline-none"
                    />
                    <span className="text-slate-400">/mês</span>
                  </span>
                  <span
                    id="legacy-capacity-block-price-help"
                    className="mt-1 block font-normal leading-5 text-slate-500"
                  >
                    Somente leitura histórica. Novas propostas modulares derivam
                    o bloco dos módulos e da fase comercial.
                  </span>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Armazenamento por paciente
                  <span className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
                    <input
                      type="number"
                      min={1}
                      max={1000000}
                      step={1}
                      value={
                        customCapacityPolicyDraft.includedStorageMbPerPatient
                      }
                      onChange={(event) =>
                        setCustomCapacityPolicyDraft((current) =>
                          current
                            ? {
                                ...current,
                                includedStorageMbPerPatient: Math.trunc(
                                  Number(event.target.value)
                                )
                              }
                            : current
                        )
                      }
                      className="min-w-0 flex-1 bg-transparent font-normal outline-none"
                    />
                    <span className="text-slate-400">MB</span>
                  </span>
                </label>
                <label className="text-xs font-medium text-slate-700">
                  Tolerância após exceder
                  <span className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
                    <input
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      value={customCapacityPolicyDraft.gracePeriodDays}
                      onChange={(event) =>
                        setCustomCapacityPolicyDraft((current) =>
                          current
                            ? {
                                ...current,
                                gracePeriodDays: Math.trunc(
                                  Number(event.target.value)
                                )
                              }
                            : current
                        )
                      }
                      className="min-w-0 flex-1 bg-transparent font-normal outline-none"
                    />
                    <span className="text-slate-400">dias</span>
                  </span>
                </label>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
                  <p className="font-medium text-slate-700">Ajuste comercial</p>
                  <p className="mt-2 font-normal leading-5 text-slate-500">
                    Aplicado no próximo ciclo de cobrança.
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs sm:col-span-2">
                  <p className="font-medium text-emerald-900">
                    Acesso clínico preservado
                  </p>
                  <p className="mt-2 font-normal leading-5 text-emerald-800">
                    A política é fixa em não bloquear cadastro, prontuário,
                    agenda, Sessão ou atendimento.
                  </p>
                </div>
              </div>
              {!validateCustomCapacityPolicy(customCapacityPolicyDraft) ? (
                <p role="alert" className="mt-3 text-xs text-rose-700">
                  Revise os valores da política. O tamanho do bloco e o
                  armazenamento devem ser maiores que zero.
                </p>
              ) : null}
            </fieldset>
          ) : null}
          {allocationDraft ? (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-slate-800">
                Critérios de alocação
              </legend>
              <p className="mt-1 text-xs font-normal text-slate-600">
                O resíduo de centavos continua sempre no pacote-base.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {allocationFields.map((field) => (
                  <label
                    key={field.key}
                    className="text-xs font-medium text-slate-600"
                  >
                    {field.label}
                    <select
                      value={allocationDraft[field.key]}
                      onChange={(event) =>
                        setAllocationDraft((current) =>
                          current
                            ? {
                                ...current,
                                [field.key]: event.target
                                  .value as SalesSharedAllocationMethod
                              }
                            : current
                        )
                      }
                      className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                    >
                      {allocationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {modularCostDraft ? (
            <>
              <fieldset className="mt-5 border-t border-amber-200 pt-4">
                <legend className="text-sm font-medium text-slate-800">
                  Propriedade dos custos
                </legend>
                <p className="mt-1 text-xs font-normal leading-5 text-slate-600">
                  Define se cada categoria vem das premissas compartilhadas,
                  dos itens ou fica fora do cálculo modular. O simulador legado
                  não usa esta matriz.
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {(Object.keys(
                    modularCostDraft.ownership
                  ) as ModularCostOwnershipKey[]).map((ownershipKey) => {
                    const duplicate = possibleDuplicateCosts.includes(
                      ownershipKey
                    );
                    return (
                      <div
                        key={ownershipKey}
                        className={`rounded-xl border p-3 ${
                          duplicate
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <label className="text-xs font-medium text-slate-700">
                          {MODULAR_COST_OWNERSHIP_LABELS[ownershipKey]}
                          <select
                            value={modularCostDraft.ownership[ownershipKey]}
                            onChange={(event) =>
                              setModularCostDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      ownership: {
                                        ...current.ownership,
                                        [ownershipKey]: event.target
                                          .value as ModularCostOwnershipValue
                                      }
                                    }
                                  : current
                              )
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                          >
                            <option value="shared">Compartilhado pela proposta</option>
                            <option value="item_direct">Direto nas funcionalidades</option>
                            <option value="excluded">Excluído do cálculo</option>
                          </select>
                        </label>
                        {duplicate ? (
                          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-900">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            Possível custo duplicado
                          </p>
                        ) : null}
                        {modularCostDraft.ownership[ownershipKey] ===
                        'shared' ? (
                          <label className="mt-2 block text-xs font-medium text-slate-600">
                            Justificativa, se também houver custo direto
                            <input
                              maxLength={500}
                              value={
                                modularCostDraft.ownershipJustifications[
                                  ownershipKey
                                ] || ''
                              }
                              onChange={(event) =>
                                setModularCostDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        ownershipJustifications: {
                                          ...current.ownershipJustifications,
                                          [ownershipKey]: event.target.value
                                        }
                                      }
                                    : current
                                )
                              }
                              className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
                            />
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset className="mt-5 border-t border-amber-200 pt-4">
                <legend className="text-sm font-medium text-slate-800">
                  Perfis de armazenamento e egress
                </legend>
                <p className="mt-1 text-xs font-normal leading-5 text-slate-600">
                  Os percentuais são visíveis, configuráveis e versionados. O
                  egress não é igualado ao armazenamento automaticamente.
                </p>
                <label className="mt-3 block max-w-sm text-xs font-medium text-slate-600">
                  Armazenamento incluído no Verto Clínica
                  <span className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={
                        modularCostDraft.includedStorageMbPerPatient ?? ''
                      }
                      onChange={(event) =>
                        setModularCostDraft((current) =>
                          current
                            ? {
                                ...current,
                                includedStorageMbPerPatient:
                                  event.target.value === ''
                                    ? null
                                    : Number(event.target.value)
                              }
                            : current
                        )
                      }
                      className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
                    />
                    <span className="whitespace-nowrap font-normal text-slate-500">
                      MB/paciente permitido
                    </span>
                  </span>
                </label>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(Object.keys(profileLabels) as SalesModularProfile[]).map(
                    (profile) => (
                      <div
                        key={profile}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <p className="text-xs font-medium text-slate-800">
                          {profileLabels[profile]}
                        </p>
                        <label className="mt-2 block text-xs text-slate-600">
                          Utilização esperada (% da capacidade)
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            value={
                              modularCostDraft.usageProfiles[profile]
                                .storageUtilizationBasisPoints == null
                                ? ''
                                : Number(
                                    modularCostDraft.usageProfiles[profile]
                                      .storageUtilizationBasisPoints
                                  ) / 100
                            }
                            onChange={(event) =>
                              setModularCostDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      usageProfiles: {
                                        ...current.usageProfiles,
                                        [profile]: {
                                          ...current.usageProfiles[profile],
                                          storageUtilizationBasisPoints:
                                            event.target.value === ''
                                              ? null
                                              : Math.round(
                                                  Number(event.target.value) *
                                                    100
                                                )
                                        }
                                      }
                                    }
                                  : current
                              )
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 px-3 font-normal"
                          />
                        </label>
                        <label className="mt-2 block text-xs text-slate-600">
                          Multiplicador esperado de egress
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            placeholder="Dados insuficientes"
                            value={
                              modularCostDraft.usageProfiles[profile]
                                .expectedEgressMultiplier ?? ''
                            }
                            onChange={(event) =>
                              setModularCostDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      usageProfiles: {
                                        ...current.usageProfiles,
                                        [profile]: {
                                          ...current.usageProfiles[profile],
                                          expectedEgressMultiplier:
                                            event.target.value === ''
                                              ? null
                                              : Number(event.target.value)
                                        }
                                      }
                                    }
                                  : current
                              )
                            }
                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 px-3 font-normal"
                          />
                          <span className="mt-1 block font-normal text-slate-500">
                            GB transferido / GB usado
                          </span>
                        </label>
                      </div>
                    )
                  )}
                </div>
              </fieldset>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">
          Itens do catálogo
        </h3>
        <p className="mt-1 text-sm font-normal text-slate-500">
          Valores comerciais em reais; custos ausentes permanecem indisponíveis.
        </p>
        <div className="mt-4 space-y-4">
          {catalog.items.map((item) => {
            const costDraft = costDrafts[item.id] || {};
            return (
              <details
                key={item.id}
                className="group rounded-2xl border border-slate-200 bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {item.publicName}
                    </p>
                    <p className="mt-1 text-xs font-normal text-slate-500">
                      {item.pricingMode} ·{' '}
                      {item.costModel?.costSource === 'unavailable'
                        ? 'custo indisponível'
                        : `custo ${item.costModel?.costSource || 'não informado'}`}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-violet-700">
                    Ver preços e custos
                  </span>
                </summary>
                <div className="border-t border-slate-100 p-4">
                  {item.tiers.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-[620px] w-full text-left text-xs">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="pb-2 font-medium">Faixa</th>
                            <th className="pb-2 font-medium">Mínimo</th>
                            <th className="pb-2 font-medium">Máximo</th>
                            <th className="pb-2 font-medium">Preço mensal</th>
                            <th className="pb-2 font-medium" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {item.tiers.map((tier) => (
                            <tr key={tier.id}>
                              <td className="py-2 pr-2 font-medium text-slate-800">
                                {tier.publicName}
                              </td>
                              <td className="py-2 pr-2">{tier.minimumQuantity}</td>
                              <td className="py-2 pr-2">
                                {tier.maximumQuantity ?? 'Personalizado'}
                              </td>
                              <td className="py-2 pr-2">
                                {tier.recurringAmountCents == null
                                  ? 'Personalizado'
                                  : money(tier.recurringAmountCents)}
                              </td>
                              <td className="py-2 text-right">
                                {catalog.status === 'draft' &&
                                !tier.isCustom ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const raw = window.prompt(
                                        `Novo preço mensal de ${tier.publicName} (R$)`,
                                        String(
                                          Number(
                                            tier.recurringAmountCents || 0
                                          ) / 100
                                        )
                                      );
                                      if (raw === null) return;
                                      void saveDraftAction(
                                        'tier',
                                        {
                                          tierId: tier.id,
                                          recurringAmountCents:
                                            nullableCurrencyInput(raw)
                                        },
                                        `tier:${tier.id}`
                                      );
                                    }}
                                    disabled={Boolean(busy)}
                                    className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 font-medium text-violet-700"
                                  >
                                    Editar preço
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                      <span className="text-slate-600">
                        Valor configurado:{' '}
                        {item.billingInterval === 'one_time'
                          ? money(item.oneTimeAmountCents)
                          : money(item.recurringAmountCents)}
                      </span>
                      {catalog.status === 'draft' &&
                      item.itemKey !== 'onboarding' ? (
                        <button
                          type="button"
                          onClick={() => {
                            const raw = window.prompt(
                              `Novo valor de ${item.publicName} (R$)`,
                              String(
                                Number(
                                  item.billingInterval === 'one_time'
                                    ? item.oneTimeAmountCents || 0
                                    : item.recurringAmountCents || 0
                                ) / 100
                              )
                            );
                            if (raw === null) return;
                            void saveDraftAction(
                              'item',
                              {
                                itemId: item.id,
                                [item.billingInterval === 'one_time'
                                  ? 'oneTimeAmountCents'
                                  : 'recurringAmountCents']:
                                  nullableCurrencyInput(raw)
                              },
                              `item:${item.id}`
                            );
                          }}
                          className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-violet-700"
                        >
                          Editar preço
                        </button>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-4">
                      {costGroups.filter((group) =>
                        costFields.some(
                          (field) =>
                            field.group === group &&
                            costFieldAppliesToItem(field.key, item.itemKey)
                        ) ||
                        ((group === 'Custos por unidade de uso' ||
                          group === 'Implantação') &&
                          driverCostKeys.some((driverKey) =>
                            driverKey === 'onboardingHours'
                              ? group === 'Implantação' && item.itemKey === 'onboarding'
                              : Boolean(
                                  group === 'Custos por unidade de uso' &&
                                  SALES_MODULAR_DRIVER_DEFINITIONS.find(
                                    (definition) =>
                                      definition.key === driverKey
                                  )?.itemKeys.includes(item.itemKey)
                                )
                          ))
                      ).map((group) => {
                        const fields = costFields.filter(
                          (field) =>
                            field.group === group &&
                            costFieldAppliesToItem(field.key, item.itemKey)
                        );
                        return (
                          <fieldset
                            key={group}
                            className="rounded-xl border border-slate-200 bg-white p-3"
                          >
                            <legend className="px-1 text-xs font-medium text-slate-800">
                              {group}
                            </legend>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {fields.map((field) => {
                                const ownershipCategory =
                                  directCostCategoryForField(
                                    String(field.key)
                                  );
                                const requiredForPublication =
                                  field.key === 'directCostPerUsageUnitCents' ||
                                  (field.key === 'onboardingCostCents' &&
                                    costDraft.driverConfig
                                      ?.onboardingCalculationMode === 'manual') ||
                                  Boolean(
                                    ownershipCategory &&
                                      modularCostDraft?.ownership[
                                        ownershipCategory
                                      ] === 'item_direct'
                                  );
                                const isMissingRequired =
                                  requiredForPublication &&
                                  (costDraft[field.key] === '' ||
                                    costDraft[field.key] === null ||
                                    costDraft[field.key] === undefined);
                                const unit =
                                  field.key ===
                                  'directCostPerUsageUnitCents'
                                    ? primaryUsageUnitByItem[item.itemKey] ||
                                      field.unit
                                    : field.unit;
                                return (
                                  <label
                                    key={String(field.key)}
                                    className="text-xs font-medium text-slate-600"
                                  >
                                    {field.label}
                                    {requiredForPublication ? (
                                      <span className="ml-1 font-normal text-amber-700">
                                        · obrigatório para publicar
                                      </span>
                                    ) : null}
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      disabled={catalog.status !== 'draft'}
                                      value={
                                        costDraft[field.key] == null
                                          ? ''
                                          : costDraft[field.key]
                                      }
                                      aria-invalid={isMissingRequired}
                                      onChange={(event) =>
                                        setCostDrafts((current) => ({
                                          ...current,
                                          [item.id]: {
                                            ...current[item.id],
                                            [field.key]: event.target.value
                                          }
                                        }))
                                      }
                                      className={`mt-1 min-h-10 w-full rounded-xl border bg-white px-3 font-normal disabled:bg-slate-100 ${
                                        isMissingRequired
                                          ? 'border-amber-300'
                                          : 'border-slate-200'
                                      }`}
                                    />
                                    <span className="mt-1 block font-normal text-slate-500">
                                      {unit}
                                    </span>
                                  </label>
                                );
                              })}
                              {group === 'Custos por unidade de uso' ||
                              group === 'Implantação'
                                ? driverCostKeys
                                    .filter((driverKey) => {
                                      if (driverKey === 'onboardingHours') {
                                        return group === 'Implantação' && item.itemKey === 'onboarding';
                                      }
                                      return group === 'Custos por unidade de uso' && SALES_MODULAR_DRIVER_DEFINITIONS.find(
                                        (definition) =>
                                          definition.key === driverKey
                                      )?.itemKeys.includes(item.itemKey);
                                    })
                                    .map((driverKey) => {
                                      const descriptor =
                                        driverCostLabel(driverKey);
                                      return (
                                        <label
                                          key={driverKey}
                                          className="text-xs font-medium text-slate-600"
                                        >
                                          {descriptor.label}
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            disabled={
                                              catalog.status !== 'draft'
                                            }
                                            value={
                                              costDraft.driverUnitCosts?.[
                                                driverKey
                                              ] ?? ''
                                            }
                                            onChange={(event) =>
                                              updateDriverUnitCost(
                                                item.id,
                                                driverKey,
                                                event.target.value
                                              )
                                            }
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                                          />
                                          <span className="mt-1 block font-normal text-slate-500">
                                            {descriptor.unit}
                                          </span>
                                        </label>
                                      );
                                    })
                                : null}
                              {group === 'Implantação' &&
                              item.itemKey === 'onboarding' ? (
                                <label className="text-xs font-medium text-slate-600">
                                  Forma de cálculo do custo
                                  <select
                                    disabled={catalog.status !== 'draft'}
                                    value={
                                      costDraft.driverConfig
                                        ?.onboardingCalculationMode || 'hours'
                                    }
                                    onChange={(event) =>
                                      setCostDrafts((current) => ({
                                        ...current,
                                        [item.id]: {
                                          ...current[item.id],
                                          driverConfig: {
                                            ...current[item.id]?.driverConfig,
                                            onboardingCalculationMode: event
                                              .target.value,
                                            requiredDrivers:
                                              event.target.value === 'manual'
                                                ? []
                                                : emptySalesModularDriverConfig(
                                                    'onboarding'
                                                  ).requiredDrivers
                                          }
                                        }
                                      }))
                                    }
                                    className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                                  >
                                    <option value="hours">Horas × custo por hora</option>
                                    <option value="manual">Custo manual direto</option>
                                  </select>
                                </label>
                              ) : null}
                            </div>
                          </fieldset>
                        );
                      })}

                      <fieldset className="rounded-xl border border-slate-200 bg-white p-3">
                        <legend className="px-1 text-xs font-medium text-slate-800">
                          Premissas de uso por funcionalidade
                        </legend>
                        <p className="mb-3 text-xs font-normal leading-5 text-slate-500">
                          Valores ausentes permanecem como Dados insuficientes;
                          nunca são convertidos silenciosamente em zero.
                        </p>
                        <div className="space-y-3">
                          {SALES_MODULAR_DRIVER_DEFINITIONS.filter(
                            (definition) =>
                              definition.itemKeys.includes(item.itemKey) &&
                              costDraft.driverConfig?.requiredDrivers?.includes(
                                definition.key
                              )
                          ).map((definition) => (
                            <div
                              key={definition.key}
                              className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="text-xs font-medium text-slate-800">
                                  {definition.label}
                                </p>
                                <span className="text-[11px] font-normal text-slate-500">
                                  {definition.unit}
                                </span>
                              </div>
                              <div className="mt-2 grid gap-3 lg:grid-cols-3">
                                {(
                                  Object.keys(
                                    profileLabels
                                  ) as SalesModularProfile[]
                                ).map((profile) => {
                                  const datum = costDraft.driverConfig
                                    ?.profiles?.[profile]?.[
                                    definition.key
                                  ] as SalesModularDriverValue | undefined;
                                  const displayedValue =
                                    definition.monetaryValue &&
                                    typeof datum?.value === 'number'
                                      ? datum.value / 100
                                      : ((datum as any)?.value ?? '');
                                  return (
                                    <div
                                      key={profile}
                                      className="rounded-lg border border-slate-200 bg-white p-2"
                                    >
                                      <p className="text-[11px] font-medium text-slate-700">
                                        {profileLabels[profile]}
                                      </p>
                                      <label className="mt-1 block text-[11px] text-slate-500">
                                        Valor
                                        <input
                                          type="number"
                                          min={0}
                                          step={definition.valueStep || 1}
                                          disabled={
                                            catalog.status !== 'draft'
                                          }
                                          placeholder="Dados insuficientes"
                                          value={displayedValue}
                                          onChange={(event) =>
                                            updateDriverDraft(
                                              item.id,
                                              profile,
                                              definition.key,
                                              {
                                                value: event.target.value
                                              }
                                            )
                                          }
                                          className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 font-normal"
                                        />
                                      </label>
                                      <label className="mt-2 block text-[11px] text-slate-500">
                                        Origem
                                        <select
                                          disabled={
                                            catalog.status !== 'draft'
                                          }
                                          value={datum?.source || 'unavailable'}
                                          onChange={(event) =>
                                            updateDriverDraft(
                                              item.id,
                                              profile,
                                              definition.key,
                                              {
                                                source: event.target
                                                  .value as SalesModularDriverValue['source']
                                              }
                                            )
                                          }
                                          className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 font-normal"
                                        >
                                          <option value="unavailable">Indisponível</option>
                                          <option value="actual">Real</option>
                                          <option value="calculated">Calculado</option>
                                          <option value="estimated">Estimado</option>
                                          <option value="manual">Manual</option>
                                        </select>
                                      </label>
                                      <label className="mt-2 block text-[11px] text-slate-500">
                                        Fonte e critério
                                        <input
                                          maxLength={500}
                                          disabled={
                                            catalog.status !== 'draft'
                                          }
                                          value={datum?.sourceDetail || ''}
                                          onChange={(event) =>
                                            updateDriverDraft(
                                              item.id,
                                              profile,
                                              definition.key,
                                              {
                                                sourceDetail:
                                                  event.target.value
                                              }
                                            )
                                          }
                                          className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 font-normal"
                                        />
                                      </label>
                                      <p className="mt-2 text-[10px] font-normal text-slate-400">
                                        Versão {datum?.version || 'nova'} ·
                                        vigência{' '}
                                        {datum?.effectiveAt
                                          ? new Date(
                                              datum.effectiveAt
                                            ).toLocaleDateString('pt-BR')
                                          : 'ao salvar'}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </fieldset>

                      <fieldset className="rounded-xl border border-slate-200 bg-white p-3">
                        <legend className="px-1 text-xs font-medium text-slate-800">
                          Peso de rateio, origem e fonte
                        </legend>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="text-xs font-medium text-slate-600">
                        Origem
                        <select
                          disabled={catalog.status !== 'draft'}
                          value={costDraft.costSource || 'unavailable'}
                          onChange={(event) =>
                            setCostDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                costSource: event.target.value
                              }
                            }))
                          }
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                        >
                          <option value="unavailable">Indisponível</option>
                          <option value="actual">Real</option>
                          <option value="calculated">Calculado</option>
                          <option value="estimated">Estimado</option>
                          <option value="manual">Manual</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        Peso de rateio
                        <input
                          type="number"
                          min={0}
                          step="0.1"
                          disabled={catalog.status !== 'draft'}
                          value={costDraft.sharedCostAllocationWeight ?? 1}
                          onChange={(event) =>
                            setCostDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                sharedCostAllocationWeight: event.target.value
                              }
                            }))
                          }
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-600 sm:col-span-2">
                        Fonte e critério
                        <input
                          disabled={catalog.status !== 'draft'}
                          maxLength={500}
                          value={costDraft.sourceDetail || ''}
                          onChange={(event) =>
                            setCostDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                sourceDetail: event.target.value
                              }
                            }))
                          }
                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                        />
                      </label>
                        </div>
                      </fieldset>
                    </div>
                    {catalog.status === 'draft' ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void saveCost(item)}
                          disabled={Boolean(busy)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {busy === `cost:${item.id}` ? (
                            <Loader2 className="animate-spin" size={15} />
                          ) : (
                            <Database size={15} />
                          )}
                          Criar versão do custo
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-violet-700">
              Rentabilidade por funcionalidade
            </p>
            <h3 className="mt-1 text-base font-semibold text-slate-900">
              Simulado e proposto
            </h3>
            <p className="mt-1 text-sm font-normal text-slate-500">
              Não representa contratação nem receita realizada.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            Sem DRE realizada
          </span>
        </div>
        {report.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
            O relatório será preenchido quando existirem cenários salvos.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[980px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Funcionalidade</th>
                  <th className="px-3 py-2 font-medium">Simulados</th>
                  <th className="px-3 py-2 font-medium">Propostos</th>
                  <th className="px-3 py-2 font-medium">Receita média</th>
                  <th className="px-3 py-2 font-medium">Custo direto</th>
                  <th className="px-3 py-2 font-medium">
                    EBITDA atribuído
                  </th>
                  <th className="px-3 py-2 font-medium">Margem média</th>
                  <th className="px-3 py-2 font-medium">Faixa</th>
                  <th className="px-3 py-2 font-medium">Selecionadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.map((row) => (
                  <tr key={row.item_key}>
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {row.public_name}
                    </td>
                    <td className="px-3 py-3">{row.simulated_count}</td>
                    <td className="px-3 py-3">{row.proposed_count}</td>
                    <td className="px-3 py-3">
                      {money(row.average_proposed_revenue_cents)}
                    </td>
                    <td className="px-3 py-3">
                      {money(row.average_direct_cost_cents)}
                    </td>
                    <td className="px-3 py-3">
                      {money(row.average_ebitda_cents)}
                    </td>
                    <td className="px-3 py-3">
                      {percent(row.average_ebitda_margin_basis_points)}
                    </td>
                    <td className="px-3 py-3">
                      {percent(row.minimum_ebitda_margin_basis_points)} –{' '}
                      {percent(row.maximum_ebitda_margin_basis_points)}
                    </td>
                    <td className="px-3 py-3">
                      {percent(row.selected_basis_points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};
