import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  GitCompareArrows,
  Info,
  Layers3,
  Link2,
  Loader2,
  Mail,
  PackageCheck,
  Pencil,
  Save,
  Settings2,
  X
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import {
  applySalesPackageTierSelection,
  calculateSalesModularProposal,
  isSalesPackageTierCompatible,
  recommendSalesPackageTier,
  resolveSalesPackageTierSelection,
  salesModularProposalRequiresVersionedProfitabilityPolicy,
  salesPackageDemand,
  type SalesModularLineSelection,
  type SalesModularProposalInput,
  type SalesModularProposalResult,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot,
  type SalesPricingCatalogTier
} from '../utils/salesModularProposal';
import {
  calculateCustomCapacity,
  validateCustomCapacityPolicy,
  type OfferItemDiscountType
} from '../utils/salesCommercialEvolution';
import { formatSalesCommercialDate } from '../utils/salesCommercialDate';
import {
  SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE,
  classifySalesProposalReview,
  formatSalesBasisPointsPercent,
  formatSalesIncrementalMarginStatusLabel,
  validateSalesProfitabilityPolicy,
  type SalesCommercialExceptionApprovalSnapshot,
  type SalesCommercialExceptionType,
  type SalesProfitabilityPolicy,
  type SalesProposalReviewClassification
} from '../utils/salesModularEconomics';
import type { SalesAssumptionSnapshot } from '../utils/salesProfitability';
import { normalizeSalesTrialDays } from '../utils/salesTrialContract';
import { buildSalesRecurringMoneyFlow } from '../utils/salesFinancialExplanation';
import {
  ModularOfferDetails,
  type ModularPublicOffer
} from './PublicSalesOffer';

type Props = {
  lead: any;
  onClose: () => void;
  onOpenAssumptions: () => void;
  onOfferPrepared?: (leadId: string, offer: any) => void;
  legacyFallback: React.ReactNode;
};

type SavedModularSimulation = {
  id: string;
  status: 'saved' | 'selected' | 'offered' | 'archived';
  scenario_name?: string | null;
  assumption_set_id: string;
  catalog_version_id: string;
  modular_input_snapshot: SalesModularProposalInput;
  results_snapshot: SalesModularProposalResult & {
    commercialReview?: SalesProposalReviewClassification & {
      canGeneratePublicOffer?: boolean;
    };
    commercialExceptionApproval?: SalesCommercialExceptionApprovalSnapshot | null;
  };
  profitability_rating: SalesModularProposalResult['rating'];
  internal_justification?: string | null;
  internal_notes?: string | null;
  public_notes?: string | null;
  created_at: string;
  offer?: {
    id: string;
    status: string;
    expires_at: string;
    contract_email?: string | null;
  } | null;
};

const currency = (value: number | null | undefined) =>
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

const requestKey = (prefix: string) =>
  `${prefix}:${crypto.randomUUID()}`;

const normalizeContractEmail = (value: unknown) =>
  String(value || '').trim().toLowerCase();

const isValidContractEmail = (value: unknown) => {
  const email = normalizeContractEmail(value);
  return (
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
};

const ECONOMY_SIMULATOR_PATIENT_PRESETS = [150, 160, 170, 200] as const;

const itemTierForQuantity = (
  item: SalesPricingCatalogItem,
  quantity: number
) =>
  [...item.tiers]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .find(
      (tier) =>
        !tier.isCustom &&
        tier.minimumQuantity <= quantity &&
        (tier.maximumQuantity === null || quantity <= tier.maximumQuantity)
    ) ||
  item.tiers.find((tier) => tier.isCustom) ||
  null;

const selectionForItem = (
  item: SalesPricingCatalogItem,
  patientQuantity: number,
  baseTier: SalesPricingCatalogTier,
  perPatientPricing = false
): SalesModularLineSelection => {
  const quantity =
    item.itemKey === 'insurance_tiss'
      ? 100
      : item.itemKey === 'additional_storage'
        ? 1
        : patientQuantity;
  const linkedTier =
    item.itemKey === 'clinical_core'
      ? baseTier
      : itemTierForQuantity(item, quantity);
  const catalogMonthlyAmountCents =
    linkedTier?.recurringAmountCents ?? item.recurringAmountCents ?? 0;
  return {
    itemKey: item.itemKey,
    tierId: linkedTier?.id || null,
    quantity,
    itemDiscountBasisPoints: 0,
    customRecurringAmountCents:
      perPatientPricing && item.billingInterval !== 'one_time'
        ? catalogMonthlyAmountCents
        : linkedTier?.isCustom
          ? 0
          : null,
    pricingEditMode:
      perPatientPricing && item.billingInterval !== 'one_time'
        ? 'monthly_total'
        : undefined,
    proposedPricePerPatientCents:
      perPatientPricing && item.billingInterval !== 'one_time'
        ? null
        : undefined,
    customOneTimeAmountCents: item.itemKey === 'onboarding' ? 0 : null
  };
};

const ratingStyle: Record<SalesModularProposalResult['rating'], string> = {
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  attention: 'border-amber-200 bg-amber-50 text-amber-800',
  not_recommended: 'border-rose-200 bg-rose-50 text-rose-800',
  insufficient_data: 'border-slate-200 bg-slate-100 text-slate-700'
};

const ratingLabel: Record<SalesModularProposalResult['rating'], string> = {
  healthy: 'Dentro da margem-alvo',
  attention: 'Abaixo da margem-alvo',
  not_recommended: 'EBITDA atribuído negativo',
  insufficient_data: 'Custos ainda incompletos'
};

const markup = (
  multiplier: number | null | undefined,
  basisPoints: number | null | undefined
) =>
  multiplier == null || basisPoints == null
    ? 'Dados insuficientes'
    : `${multiplier.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}× (${percent(basisPoints)})`;

const costSourceLabel: Record<string, string> = {
  actual: 'Real',
  calculated: 'Calculado',
  estimated: 'Estimado',
  manual: 'Manual',
  unavailable: 'Indisponível'
};

const incrementalMarginLabel = formatSalesIncrementalMarginStatusLabel;

const commercialAlertLabel = (
  code: string,
  policy?: SalesProfitabilityPolicy | null
) => {
  const clinicMinimum = policy
    ? formatSalesBasisPointsPercent(
        policy.clinicMinimumEbitdaMarginBasisPoints
      )
    : null;
  const postPromotionMinimum = policy
    ? formatSalesBasisPointsPercent(
        policy.postPromotionMinimumEbitdaMarginBasisPoints
      )
    : null;
  const moduleMinimum = policy
    ? formatSalesBasisPointsPercent(
        policy.moduleMinimumIncrementalMarginBasisPoints
      )
    : null;
  const capacityMinimum = policy
    ? formatSalesBasisPointsPercent(
        policy.capacityMinimumIncrementalMarginBasisPoints
      )
    : null;
  const recurringTarget = policy
    ? formatSalesBasisPointsPercent(
        policy.recurringTargetEbitdaMarginBasisPoints
      )
    : null;
  if (code === 'CLINIC_MARGIN_BELOW_TARGET') {
    return recurringTarget
      ? `A margem EBITDA atribuída está abaixo da meta de ${recurringTarget}. Este aviso não bloqueia a proposta.`
      : 'A margem EBITDA atribuída está abaixo da meta. Este aviso não bloqueia a proposta.';
  }
  if (code === 'POST_PROMOTION_MARGIN_BELOW_TARGET') {
    return recurringTarget
      ? `A condição posterior está abaixo da meta de ${recurringTarget}. Este aviso não bloqueia a proposta.`
      : 'A condição posterior está abaixo da meta de EBITDA atribuída. Este aviso não bloqueia a proposta.';
  }
  if (code.startsWith('MODULE_MARGIN_BELOW_TARGET:')) {
    return moduleMinimum
      ? `Um módulo está abaixo da referência incremental de ${moduleMinimum}. Este aviso não bloqueia a proposta.`
      : 'Um módulo está abaixo da referência de margem incremental. Este aviso não bloqueia a proposta.';
  }
  if (code === 'CAPACITY_MARGIN_BELOW_TARGET') {
    return capacityMinimum
      ? `Os blocos de capacidade estão abaixo da referência incremental de ${capacityMinimum}. Este aviso não bloqueia a proposta.`
      : 'Os blocos de capacidade estão abaixo da referência incremental. Este aviso não bloqueia a proposta.';
  }
  if (code.startsWith('EXPANSION_MARGIN_BELOW_TARGET:')) {
    return capacityMinimum
      ? `Um excedente por driver está abaixo da referência incremental de ${capacityMinimum}. Este aviso não bloqueia a proposta.`
      : 'Um excedente por driver está abaixo da referência incremental. Este aviso não bloqueia a proposta.';
  }
  if (
    code === 'CLINIC_MARGIN_BELOW_MINIMUM' ||
    code === 'CLINIC_MARGIN_BELOW_60'
  ) {
    return clinicMinimum
      ? `A margem da clínica está abaixo da referência histórica de ${clinicMinimum}. Este aviso não bloqueia a proposta.`
      : 'A margem da clínica está abaixo da referência histórica. Este aviso não bloqueia a proposta.';
  }
  if (
    code === 'POST_PROMOTION_MARGIN_BELOW_MINIMUM' ||
    code === 'POST_PROMOTION_MARGIN_BELOW_70'
  ) {
    return postPromotionMinimum
      ? `A condição posterior está abaixo da referência pós-benefício de ${postPromotionMinimum}. Este aviso não bloqueia a proposta.`
      : 'A condição posterior está abaixo da referência pós-benefício. Este aviso não bloqueia a proposta.';
  }
  if (
    code.startsWith('MODULE_MARGIN_BELOW_MINIMUM:') ||
    code.startsWith('MODULE_MARGIN_BELOW_75:')
  ) {
    return moduleMinimum
      ? `Um módulo está abaixo da referência incremental de ${moduleMinimum}. Este aviso não bloqueia a proposta.`
      : 'Um módulo está abaixo da referência incremental. Este aviso não bloqueia a proposta.';
  }
  if (
    code === 'CAPACITY_MARGIN_BELOW_MINIMUM' ||
    code === 'CAPACITY_MARGIN_BELOW_75'
  ) {
    return capacityMinimum
      ? `Os blocos de capacidade estão abaixo da referência incremental de ${capacityMinimum}. Este aviso não bloqueia a proposta.`
      : 'Os blocos de capacidade estão abaixo da referência incremental. Este aviso não bloqueia a proposta.';
  }
  if (
    code.startsWith('EXPANSION_MARGIN_BELOW_MINIMUM:') ||
    code.startsWith('EXPANSION_MARGIN_BELOW_75:')
  ) {
    return capacityMinimum
      ? `Um excedente por driver está abaixo da referência incremental de ${capacityMinimum}. Este aviso não bloqueia a proposta.`
      : 'Um excedente por driver está abaixo da referência incremental. Este aviso não bloqueia a proposta.';
  }
  if (code === 'PROMOTIONAL_PHASE_DEFICIT') {
    return 'A fase promocional possui EBITDA atribuído negativo.';
  }
  if (code.startsWith('FREE_MODULE_WITH_COST:')) {
    return 'Um módulo gratuito mantém custo operacional durante o benefício.';
  }
  if (code === 'TEMPORARY_DISCOUNT_REQUIRED' || code === 'TEMPORARY_DISCOUNT_RECOMMENDED') {
    return 'A condição recomenda benefício temporário com término definido.';
  }
  if (code === 'MODULE_PROMOTION_TERMS_REQUIRED' || code === 'MODULE_PROMOTION_TERMS_RECOMMENDED') {
    return 'A promoção de um módulo recomenda prazo e condição posterior explícitos.';
  }
  return 'A composição requer revisão da política comercial.';
};

const publicOfferDiscount = (
  discount: SalesModularLineSelection['offerDiscount']
) => {
  if (!discount) return null;
  const { internalNotes: _internalNotes, ...publicDiscount } = discount;
  return publicDiscount;
};

export const SalesModularProposalBuilder = ({
  lead,
  onClose,
  onOpenAssumptions,
  onOfferPrepared,
  legacyFallback
}: Props) => {
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [useLegacyFallback, setUseLegacyFallback] = useState(false);
  const [showEconomySimulator, setShowEconomySimulator] = useState(false);
  const [economySimulatorPatients, setEconomySimulatorPatients] =
    useState(150);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalog, setCatalog] =
    useState<SalesPricingCatalogSnapshot | null>(null);
  const [assumptions, setAssumptions] =
    useState<SalesAssumptionSnapshot | null>(null);
  const [simulations, setSimulations] =
    useState<SavedModularSimulation[]>([]);
  const [input, setInput] = useState<SalesModularProposalInput | null>(null);
  const [scenarioName, setScenarioName] = useState('Cenário principal');
  const [internalJustification, setInternalJustification] = useState('');
  const [approveCommercialException, setApproveCommercialException] =
    useState(false);
  const [commercialExceptionType, setCommercialExceptionType] =
    useState<SalesCommercialExceptionType>('margin_policy_override');
  const [internalNotes, setInternalNotes] = useState('');
  const [publicNotes, setPublicNotes] = useState('');
  const [selectedSimulationId, setSelectedSimulationId] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [editingScenarioId, setEditingScenarioId] = useState('');
  const [editingScenarioName, setEditingScenarioName] = useState('');
  const [preparedOffer, setPreparedOffer] = useState<any>(null);
  const [checkoutLink, setCheckoutLink] = useState<any>(null);
  const [offerAccepted, setOfferAccepted] = useState(false);
  const [contractEmail, setContractEmail] = useState('');

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
      const fetchError = new Error(
        data?.error || 'Não foi possível concluir esta ação.'
      );
      (fetchError as any).code = data?.code;
      throw fetchError;
    }
    return data;
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const controls = Array.from(
        panelRef.current.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'
        )
      ) as HTMLElement[];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [busy, onClose]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [catalogData, assumptionData, simulationData] = await Promise.all([
          authenticatedFetch('/api/owner/sales/pricing-catalogs?compact=1'),
          authenticatedFetch('/api/owner/sales/profitability-assumptions'),
          authenticatedFetch(
            `/api/owner/sales/leads/${encodeURIComponent(lead.id)}/modular-simulations?page=1&pageSize=50`
          )
        ]);
        if (cancelled) return;
        const activeCatalog =
          catalogData.catalog as SalesPricingCatalogSnapshot;
        const patientQuantity = Math.max(
          1,
          Number(lead?.estimatedActivePatients || 1)
        );
        const recommendedTier = recommendSalesPackageTier(
          activeCatalog,
          patientQuantity
        );
        if (!recommendedTier) throw new Error('PRICING_TIER_NOT_FOUND');
        const core = activeCatalog.items.find(
          (item) => item.itemKey === 'clinical_core'
        );
        if (!core) throw new Error('PRICING_ITEM_NOT_FOUND');
        const initialInput: SalesModularProposalInput = {
          commercialPricingMode: 'manual_module_prices',
          platformFoundationPricingMode: 'manual',
          platformFoundationMonthlyAmountCents: 0,
          patientQuantity,
          expectedPatientQuantity12Months: patientQuantity,
          basePackageTierId: recommendedTier.id,
          basePackageSelectionMode: 'automatic',
          customBasePackageLimit:
            recommendedTier.isCustom || recommendedTier.maximumQuantity === null
              ? 150
              : null,
          customCapacityBlocks: null,
          customCapacitySelectionMode: 'automatic',
          lines: [
            selectionForItem(
              core,
              patientQuantity,
              recommendedTier,
              true
            )
          ],
          globalDiscountBasisPoints: 0,
          discountDurationMonths: 0,
          offerValidityDays: 14,
          trialDays: 7,
          onboardingInstallments: 1,
          usageProfile: 'intensive',
          driverOverrides: {},
          internalNotes: '',
          publicNotes: ''
          ,offerStartsAt: new Date().toISOString()
        };
        const frozenSimulation = simulationData.simulations?.find(
          (simulation: SavedModularSimulation) =>
            simulation.status === 'selected' ||
            simulation.status === 'offered'
        ) || null;
        setCatalog(activeCatalog);
        setAssumptions(assumptionData.assumptionSet || null);
        setSimulations(simulationData.simulations || []);
        setSelectedSimulationId(frozenSimulation?.id || '');
        setContractEmail(
          normalizeContractEmail(
            frozenSimulation?.offer?.contract_email || ''
          )
        );
        setInput({
          ...initialInput,
          trialDays: frozenSimulation
            ? normalizeSalesTrialDays(
                frozenSimulation.modular_input_snapshot?.trialDays,
                0
              )
            : initialInput.trialDays
        });
      } catch (loadError: any) {
        if (cancelled) return;
        if (
          loadError?.code === 'PRICING_CATALOG_NOT_FOUND' ||
          loadError?.code === 'PRICING_CATALOG_UNAVAILABLE'
        ) {
          setUseLegacyFallback(true);
          return;
        }
        setError(loadError?.message || 'Não foi possível abrir o construtor.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [lead?.id]);

  useEffect(() => {
    if (!catalog || !input) return;
    const resolution = resolveSalesPackageTierSelection(catalog, input);
    if (!resolution.selectedTier) return;
    const currentMode = input.basePackageSelectionMode === 'manual'
      ? 'manual'
      : 'automatic';
    const customLimitNeedsInitialization =
      (resolution.selectedTier.isCustom ||
        resolution.selectedTier.maximumQuantity === null) &&
      (!Number.isInteger(input.customBasePackageLimit) ||
        Number(input.customBasePackageLimit) < 1);
    if (
      input.basePackageTierId === resolution.selectedTier.id &&
      currentMode === resolution.mode &&
      !customLimitNeedsInitialization
    ) {
      return;
    }
    setInput(
      applySalesPackageTierSelection(
        input,
        resolution.selectedTier,
        resolution.mode
      )
    );
    setPreparedOffer(null);
    if (resolution.manualOverrideRemoved) {
      setNotice(
        `A faixa escolhida manualmente deixou de comportar a demanda de ${resolution.demand} pacientes. Aplicamos ${resolution.selectedTier.publicName}.`
      );
    }
  }, [catalog, input]);

  useEffect(() => {
    if (!catalog || !input) return;
    const selectedTier = catalog.items
      .find((item) => item.itemKey === 'clinical_core')
      ?.tiers.find((tier) => tier.id === input.basePackageTierId);
    if (!selectedTier || (!selectedTier.isCustom && selectedTier.maximumQuantity !== null)) {
      return;
    }
    const recurringLines = input.lines.filter((line) => {
      const item = catalog.items.find(
        (candidate) => candidate.itemKey === line.itemKey
      );
      return item?.billingInterval !== 'one_time';
    });
    const basePriceCents = recurringLines.reduce((sum, line) => {
      if (
        line.pricingEditMode === 'per_patient' &&
        typeof line.proposedPricePerPatientCents === 'number'
      ) {
        return sum + Math.round(
          Number(input.customBasePackageLimit || 0) *
            line.proposedPricePerPatientCents
        );
      }
      return sum + Number(line.customRecurringAmountCents || 0);
    }, 0);
    if (
      !Number.isInteger(input.customBasePackageLimit) ||
      Number(input.customBasePackageLimit) < 1 ||
      catalog.status !== 'active' ||
      !validateCustomCapacityPolicy(catalog.customCapacityPolicy)
    ) {
      return;
    }
    const capacity = calculateCustomCapacity(
      {
        currentPatients: input.patientQuantity,
          expectedPatients: input.expectedPatientQuantity12Months,
          baseLimitPatients: Number(input.customBasePackageLimit),
          basePriceCents,
        selection: {
          mode: input.customCapacitySelectionMode === 'manual' ? 'manual' : 'automatic',
          selectedBlocks: input.customCapacityBlocks
        }
      },
      catalog.customCapacityPolicy
    );
    if (
      input.customCapacityBlocks === capacity.selectedBlocks &&
      input.customCapacitySelectionMode === capacity.selectionMode
    ) {
      return;
    }
    setInput((current) => current
      ? {
          ...current,
          customCapacityBlocks: capacity.selectedBlocks,
          customCapacitySelectionMode: capacity.selectionMode
        }
      : current);
    setPreparedOffer(null);
    if (capacity.manualOverrideRemoved) {
      setNotice(
        `A reserva foi ajustada para ${capacity.selectedBlocks} bloco(s), o mínimo necessário para ${capacity.demandPatients} pacientes.`
      );
    }
  }, [catalog, input]);

  const hasValidVersionedProfitabilityPolicy = Boolean(
    catalog?.hasVersionedProfitabilityPolicy === true &&
      validateSalesProfitabilityPolicy(catalog.profitabilityPolicy)
  );
  const proposalRequiresVersionedProfitabilityPolicy =
    salesModularProposalRequiresVersionedProfitabilityPolicy(input, catalog);
  const profitabilityPolicyRequired = Boolean(
    catalog?.status === 'active' &&
      proposalRequiresVersionedProfitabilityPolicy &&
      !hasValidVersionedProfitabilityPolicy
  );
  const preview = useMemo(() => {
    if (!input || !catalog || !assumptions || profitabilityPolicyRequired) {
      return null;
    }
    try {
      return calculateSalesModularProposal(input, catalog, assumptions);
    } catch {
      return null;
    }
  }, [assumptions, catalog, input, profitabilityPolicyRequired]);
  const promotionalMoneyFlow = useMemo(() => {
    if (!preview || !assumptions || !input) return null;
    return buildSalesRecurringMoneyFlow({
      period: preview.promotional,
      assumptions,
      usageProfile: input.usageProfile,
      lines: preview.lines
    });
  }, [assumptions, input, preview]);
  const proposalReview = useMemo(
    () => preview ? classifySalesProposalReview(preview) : null,
    [preview]
  );
  const profitabilityThresholdColumns = useMemo(() => {
    const policy = preview?.economics?.policy;
    if (!policy) return [];
    const definitions = [
      ['Referência clínica', policy.clinicMinimumEbitdaMarginBasisPoints],
      ['Meta recorrente', policy.recurringTargetEbitdaMarginBasisPoints],
      ['Referência pós-benefício', policy.postPromotionMinimumEbitdaMarginBasisPoints],
      ['Referência módulo', policy.moduleMinimumIncrementalMarginBasisPoints],
      ['Referência capacidade', policy.capacityMinimumIncrementalMarginBasisPoints],
      ['Meta módulo', policy.moduleTargetIncrementalMarginBasisPoints]
    ] as const;
    const grouped = new Map<number, string[]>();
    definitions.forEach(([label, basisPoints]) => {
      grouped.set(basisPoints, [
        ...(grouped.get(basisPoints) || []),
        label
      ]);
    });
    return Array.from(grouped.entries())
      .sort(([left], [right]) => left - right)
      .map(([basisPoints, labels]) => ({
        basisPoints,
        label: `${labels.join(' / ')} · ${formatSalesBasisPointsPercent(
          basisPoints
        )}`
      }));
  }, [preview?.economics?.policy]);
  const approvalResetKey = useMemo(
    () => JSON.stringify(preview?.input || null),
    [preview]
  );

  useEffect(() => {
    setApproveCommercialException(false);
  }, [approvalResetKey]);

  const aggressivePreview = useMemo(() => {
    if (!input || !catalog || !assumptions || profitabilityPolicyRequired) {
      return null;
    }
    const aggressivePatients =
      preview?.basePackage.limitQuantity ??
      catalog.items
        .find((item) => item.itemKey === 'clinical_core')
        ?.tiers.find((candidate) => candidate.id === input.basePackageTierId)
        ?.maximumQuantity ??
      input.expectedPatientQuantity12Months;
    try {
      return calculateSalesModularProposal(
        {
          ...input,
          patientQuantity: aggressivePatients,
          expectedPatientQuantity12Months: aggressivePatients,
          usageProfile: 'intensive',
          driverOverrides: {},
          lines: input.lines.map((line) =>
            line.itemKey === 'clinical_core'
              ? { ...line, quantity: aggressivePatients }
              : line
          )
        },
        catalog,
        assumptions
      );
    } catch {
      return null;
    }
  }, [
    assumptions,
    catalog,
    input,
    preview?.basePackage.limitQuantity,
    profitabilityPolicyRequired
  ]);

  const economySimulatorRows = useMemo(() => {
    if (
      !showEconomySimulator ||
      !input ||
      !catalog ||
      !assumptions ||
      !hasValidVersionedProfitabilityPolicy
    ) {
      return [];
    }
    const coreItem = catalog.items.find(
      (item) => item.itemKey === 'clinical_core'
    );
    const customTier = coreItem?.tiers.find(
      (tier) => tier.isCustom || tier.maximumQuantity === null
    );
    const baseLimit = Number(input.customBasePackageLimit);
    if (
      !coreItem ||
      !customTier ||
      !Number.isInteger(baseLimit) ||
      baseLimit < 1
    ) {
      return [];
    }
    const recurringModuleItems = catalog.items
      .filter(
        (item) =>
          item.isActive &&
          item.billingInterval !== 'one_time' &&
          item.pricingMode !== 'storage_block'
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
    if (recurringModuleItems.length < 1) return [];

    const selectionForSimulator = (
      item: SalesPricingCatalogItem
    ): SalesModularLineSelection => {
      const current = input.lines.find(
        (line) => line.itemKey === item.itemKey
      );
      if (current) {
        return {
          ...current,
          tierId:
            item.itemKey === 'clinical_core'
              ? customTier.id
              : current.tierId,
          quantity:
            item.itemKey === 'insurance_tiss'
              ? current.quantity
              : economySimulatorPatients
        };
      }
      return selectionForItem(
        item,
        economySimulatorPatients,
        customTier,
        true
      );
    };

    const rows: Array<{
      key: string;
      label: string;
      revenueCents: number;
      costCents: number | null;
      marginBasisPoints: number | null;
      canSend: boolean;
    }> = [];
    for (
      let mask = 1;
      mask < 2 ** recurringModuleItems.length;
      mask += 1
    ) {
      const selectedModules = recurringModuleItems.filter(
        (_item, index) => (mask & (1 << index)) !== 0
      );
      try {
        const result = calculateSalesModularProposal(
          {
            ...input,
            platformFoundationPricingMode: 'manual',
            platformFoundationMonthlyAmountCents: 0,
            patientQuantity: economySimulatorPatients,
            expectedPatientQuantity12Months: economySimulatorPatients,
            basePackageTierId: customTier.id,
            basePackageSelectionMode: 'automatic',
            customBasePackageLimit: baseLimit,
            customCapacityBlocks: null,
            customCapacitySelectionMode: 'automatic',
            lines: selectedModules.map(selectionForSimulator),
            globalDiscountBasisPoints: 0,
            discountDurationMonths: 0,
            usageProfile: 'intensive',
            driverOverrides: {}
          },
          catalog,
          assumptions
        );
        rows.push({
          key: String(mask),
          label: selectedModules.map((item) => item.publicName).join(' + '),
          revenueCents: result.postPromotion.recurringRevenueCents,
          costCents: result.postPromotion.totalEstimatedCostCents,
          marginBasisPoints: result.postPromotion.ebitdaMarginBasisPoints,
          canSend: result.economics?.canSend === true
        });
      } catch {
        // Cenários incompletos permanecem ausentes em vez de assumir custo zero.
      }
    }
    return rows;
  }, [
    assumptions,
    catalog,
    economySimulatorPatients,
    input,
    hasValidVersionedProfitabilityPolicy,
    showEconomySimulator
  ]);

  const selectedSimulation = useMemo(
    () =>
      simulations.find(
        (simulation) => simulation.id === selectedSimulationId
      ) || null,
    [selectedSimulationId, simulations]
  );
  const selectedSimulationTrialDays = selectedSimulation
    ? normalizeSalesTrialDays(
        selectedSimulation.modular_input_snapshot?.trialDays,
        0
      )
    : null;
  const draftTrialDays = normalizeSalesTrialDays(input?.trialDays, 0);
  const selectedSimulationTrialMismatch =
    selectedSimulationTrialDays !== null &&
    selectedSimulationTrialDays !== draftTrialDays;
  const selectedSimulationHasVersionedEconomics =
    validateSalesProfitabilityPolicy(
      selectedSimulation?.results_snapshot?.economics?.policy
    );
  const selectedSimulationRequiresVersionedProfitabilityPolicy = Boolean(
    selectedSimulation &&
      (
        selectedSimulation.results_snapshot?.commercialPricing?.enabled === true ||
        selectedSimulation.modular_input_snapshot?.customBasePackageLimit != null ||
        (
          selectedSimulation.catalog_version_id === catalog?.id &&
          salesModularProposalRequiresVersionedProfitabilityPolicy(
            selectedSimulation.modular_input_snapshot,
            catalog
          )
        )
      )
  );
  const selectedSimulationReview = useMemo(
    () =>
      selectedSimulation
        ? classifySalesProposalReview(selectedSimulation.results_snapshot)
        : null,
    [selectedSimulation]
  );
  const selectedSimulationHasApproval =
    selectedSimulation?.results_snapshot?.commercialExceptionApproval
      ?.status === 'approved';
  const comparedSimulations = useMemo(
    () =>
      comparisonIds
        .map((id) => simulations.find((simulation) => simulation.id === id))
        .filter(Boolean) as SavedModularSimulation[],
    [comparisonIds, simulations]
  );
  const publicPreviewOffer = useMemo<ModularPublicOffer | null>(() => {
    if (!preview || !input) return null;
    return {
      offerType: 'modular',
      proposalName: scenarioName || 'Proposta Verto',
      leadName: lead?.name || null,
      clinicName: lead?.clinicName || null,
      currency: 'BRL',
      initialActivePatientQuantity: input.patientQuantity,
      basePackage: {
        name: preview.basePackage.name,
        limitQuantity: preview.basePackage.limitQuantity,
        includedStorageMb: preview.basePackage.includedStorageMb,
        capacity: preview.basePackage.capacity
          ? {
              schemaVersion: preview.basePackage.capacity.schemaVersion,
              demandPatients: preview.basePackage.capacity.demandPatients,
              baseLimitPatients:
                preview.basePackage.capacity.baseLimitPatients,
              basePriceCents: preview.basePackage.capacity.basePriceCents,
              minimumBlocks: preview.basePackage.capacity.minimumBlocks,
              selectedBlocks: preview.basePackage.capacity.selectedBlocks,
              selectionMode: preview.basePackage.capacity.selectionMode,
              addedCapacityPatients:
                preview.basePackage.capacity.addedCapacityPatients,
              totalContractedLimitPatients:
                preview.basePackage.capacity.totalContractedLimitPatients,
              includedStorageMb:
                preview.basePackage.capacity.includedStorageMb,
              blocksMonthlyRevenueCents:
                preview.basePackage.capacity.blocksMonthlyRevenueCents,
              effectiveBlockPriceCents:
                preview.basePackage.capacity.effectiveBlockPriceCents ?? null,
              blockPricingBasis:
                preview.basePackage.capacity.blockPricingBasis ||
                'selected_module_per_patient_prices',
              blockSizePatients:
                preview.basePackage.capacity.policy.blockSizePatients,
              gracePeriodDays:
                preview.basePackage.capacity.policy.gracePeriodDays,
              billingAdjustment: 'next_cycle'
            }
          : null
      },
      items: preview.lines
        .filter(
          (line) =>
            line.itemKey !== 'platform_foundation' &&
            line.itemKey !== 'onboarding'
        )
        .map((line) => ({
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
        offerDiscount: publicOfferDiscount(line.offerDiscount),
        publicMetadata: {
          tierName: line.publicMetadata.tierName || null,
          unitName: line.publicMetadata.unitName || null,
          includedQuantity: line.publicMetadata.includedQuantity ?? null,
          maximumQuantity: line.publicMetadata.maximumQuantity ?? null,
          pricePerPatientCents:
            line.publicMetadata.pricePerPatientCents ?? null,
          billedCapacityPatients:
            line.publicMetadata.billedCapacityPatients ?? null,
          pricingBasis:
            line.publicMetadata.pricingBasis || 'catalog_snapshot',
          features: Array.isArray(line.publicMetadata.features)
            ? line.publicMetadata.features
            : []
        }
      })),
      promotionalMonthlyAmountCents:
        preview.promotionalRecurringRevenueCents,
      postDiscountMonthlyAmountCents:
        preview.postPromotionRecurringRevenueCents,
      oneTimeAmountCents: preview.oneTimeRevenueCents,
      globalDiscountCents: preview.globalDiscountCents,
      globalDiscountPercentage: input.globalDiscountBasisPoints / 100,
      discountDurationMonths: input.discountDurationMonths,
      onboardingInstallments: input.onboardingInstallments ?? 1,
      publicNotes: publicNotes || null,
      expiresAt: new Date(
        Date.now() + input.offerValidityDays * 24 * 60 * 60 * 1000
      ).toISOString(),
      status: 'preview',
      modularCheckoutEnabled: true,
      stripeReady: true,
      trialDays: input.trialDays ?? 0,
      commercialPhases: preview.commercialPhases.map((phase) => ({
        phaseNumber: phase.phaseNumber,
        startsAt: phase.startsAt,
        endsAt: phase.endsAt,
        recurringRevenueCents: phase.recurringRevenueCents,
        invoiceAmountCents: phase.invoiceAmountCents,
        lines: phase.lines.map((line) => ({
          itemKey: line.itemKey,
          publicName: line.publicName,
          billingInterval: line.billingInterval,
          normalPriceCents: line.normalPriceCents,
          activePriceCents: line.activePriceCents,
          discountCents: line.discountCents,
          itemDiscountCents: line.itemDiscountCents,
          globalDiscountCents: line.globalDiscountCents,
          discount: publicOfferDiscount(line.discount)
        }))
      })),
      capacityBlockPhases:
        preview.commercialPricing.capacityBlockPhases.map((phase) => ({
          schemaVersion: 1,
          phaseNumber: phase.phaseNumber,
          startsAt: phase.startsAt,
          endsAt: phase.endsAt,
          baseCapacityPatients: phase.baseCapacityPatients,
          contractedCapacityPatients: phase.contractedCapacityPatients,
          blockSizePatients: phase.blockSizePatients,
          selectedBlocks: phase.selectedBlocks,
          effectivePricePerPatientCents:
            phase.effectivePricePerPatientCents,
          contractedMonthlyRevenueCents:
            phase.contractedMonthlyRevenueCents,
          blockPriceCents: phase.blockPriceCents,
          blocksRevenueCents: phase.blocksRevenueCents,
          modules: phase.modules.map((module) => ({
            itemKey: module.itemKey,
            publicName: module.publicName,
            normalPricePerPatientCents:
              module.normalPricePerPatientCents,
            effectivePricePerPatientCents:
              module.effectivePricePerPatientCents,
            normalBlockRevenueCents: module.normalBlockRevenueCents,
            blockRevenueCents: module.blockRevenueCents,
            subsidizedBlockRevenueCents:
              module.subsidizedBlockRevenueCents
          }))
        }))
    };
  }, [input, lead?.clinicName, lead?.name, preview, publicNotes, scenarioName]);

  if (useLegacyFallback) return <>{legacyFallback}</>;

  const updateInput = (patch: Partial<SalesModularProposalInput>) => {
    const changesFrozenTrial =
      Object.prototype.hasOwnProperty.call(patch, 'trialDays') &&
      selectedSimulationId.length > 0;
    setInput((current) => (current ? { ...current, ...patch } : current));
    if (changesFrozenTrial) {
      setSelectedSimulationId('');
    }
    setPreparedOffer(null);
    setNotice(
      changesFrozenTrial
        ? 'Período de teste alterado. Salve e selecione um novo cenário para congelar essa condição antes de gerar a proposta.'
        : ''
    );
  };

  const changePatientQuantity = (patientQuantity: number) => {
    if (!catalog || !input) return;
    const safeQuantity = Math.max(1, Math.min(100000, patientQuantity || 1));
    const lines = input.lines.map((line) => {
      const item = catalog.items.find(
        (catalogItem) => catalogItem.itemKey === line.itemKey
      );
      if (!item) return line;
      if (item.itemKey === 'clinical_core') {
        return {
          ...line,
          quantity: safeQuantity
        };
      }
      if (
        item.pricingMode === 'package_limit' &&
        line.itemKey !== 'insurance_tiss'
      ) {
        const tier = itemTierForQuantity(item, safeQuantity);
        return {
          ...line,
          tierId: tier?.id || line.tierId,
          quantity: safeQuantity
        };
      }
      return line;
    });
    updateInput({
      patientQuantity: safeQuantity,
      lines
    });
  };

  const selectBaseTier = (tierId: string) => {
    if (!catalog || !input) return;
    const core = catalog.items.find(
      (item) => item.itemKey === 'clinical_core'
    );
    const tier = core?.tiers.find((candidate) => candidate.id === tierId);
    if (!core || !tier) return;
    const demand = salesPackageDemand(
      input.patientQuantity,
      input.expectedPatientQuantity12Months
    );
    if (!isSalesPackageTierCompatible(catalog, tier.id, demand)) {
      setError(
        `Esta faixa não é compatível com a demanda de ${demand} pacientes. Use uma faixa convencional maior ou a recomendação automática.`
      );
      return;
    }
    setError('');
    setInput(applySalesPackageTierSelection(input, tier, 'manual'));
    setPreparedOffer(null);
    setNotice('Faixa escolhida manualmente. Ela será mantida enquanto comportar a demanda.');
  };

  const useRecommendedBaseTier = () => {
    if (!catalog || !input) return;
    const recommended = recommendSalesPackageTier(
      catalog,
      salesPackageDemand(
        input.patientQuantity,
        input.expectedPatientQuantity12Months
      )
    );
    if (!recommended) return;
    setInput(applySalesPackageTierSelection(input, recommended, 'automatic'));
    setPreparedOffer(null);
    setError('');
    setNotice(`Faixa recomendada aplicada: ${recommended.publicName}.`);
  };

  const toggleItem = (item: SalesPricingCatalogItem) => {
    if (!input || !catalog) return;
    const exists = input.lines.some((line) => line.itemKey === item.itemKey);
    if (exists) {
      if (item.isRequired && item.itemKey !== 'clinical_core') return;
      const remainingRecurringItems = input.lines.filter((line) => {
        if (line.itemKey === item.itemKey) return false;
        const catalogItem = catalog.items.find(
          (candidate) => candidate.itemKey === line.itemKey
        );
        return catalogItem?.billingInterval !== 'one_time';
      });
      if (remainingRecurringItems.length < 1) {
        setError('Selecione pelo menos um módulo recorrente.');
        return;
      }
      updateInput({
        lines: input.lines.filter((line) => line.itemKey !== item.itemKey)
      });
      return;
    }
    const core = catalog.items.find(
      (candidate) => candidate.itemKey === 'clinical_core'
    );
    const baseTier = core?.tiers.find(
      (tier) => tier.id === input.basePackageTierId
    );
    if (!baseTier) return;
    const newSelection = selectionForItem(
      item,
      input.patientQuantity,
      baseTier,
      true
    );
    if (
      item.itemKey === 'onboarding' &&
      assumptions?.values.defaultOnboardingCostCents != null
    ) {
      newSelection.customOneTimeAmountCents =
        assumptions.values.defaultOnboardingCostCents;
    }
    updateInput({ lines: [...input.lines, newSelection] });
  };

  const updateLine = (
    itemKey: string,
    patch: Partial<SalesModularLineSelection>
  ) => {
    if (!input) return;
    updateInput({
      lines: input.lines.map((line) =>
        line.itemKey === itemKey ? { ...line, ...patch } : line
      )
    });
  };

  const saveSimulation = async () => {
    if (!input || !catalog || !assumptions || !preview) return;
    if (!hasValidVersionedProfitabilityPolicy) {
      setError(SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE);
      return;
    }
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const data = await authenticatedFetch(
        `/api/owner/sales/leads/${encodeURIComponent(lead.id)}/modular-simulations`,
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': requestKey('modular-simulation') },
          body: JSON.stringify({
            proposalMode: 'modular',
            catalogVersionId: catalog.id,
            assumptionSetId: assumptions.id,
            scenarioName,
            input,
            internalJustification,
            approveCommercialException,
            commercialExceptionConfirmed: approveCommercialException,
            commercialExceptionType,
            internalNotes,
            publicNotes
          })
        }
      );
      const stored = {
        ...data.simulation,
        items: data.items || [],
        offer: null
      } as SavedModularSimulation;
      setSimulations((current) => [
        stored,
        ...current.filter((simulation) => simulation.id !== stored.id)
      ]);
      setNotice(
        data.idempotent
          ? 'Cenário já salvo; o mesmo snapshot foi recuperado.'
          : stored.results_snapshot?.commercialExceptionApproval
            ? 'Exceção aprovada e congelada em uma nova versão do cenário. Selecione-a para gerar a proposta.'
            : 'Cenário salvo no banco. Selecione-o quando estiver pronto para gerar a proposta.'
      );
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o cenário.');
    } finally {
      setBusy('');
    }
  };

  const selectSimulation = async (simulation: SavedModularSimulation) => {
    setBusy(`select:${simulation.id}`);
    setError('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/leads/${encodeURIComponent(lead.id)}/simulations/${encodeURIComponent(simulation.id)}/select`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setSelectedSimulationId(simulation.id);
      setInput((current) =>
        current
          ? {
              ...current,
              trialDays: normalizeSalesTrialDays(
                simulation.modular_input_snapshot?.trialDays,
                0
              )
            }
          : current
      );
      setSimulations((current) =>
        current.map((candidate) =>
          candidate.id === simulation.id
            ? { ...candidate, status: 'selected' }
            : candidate
        )
      );
      setNotice('Cenário selecionado para a proposta.');
    } catch (selectError: any) {
      setError(selectError?.message || 'Não foi possível selecionar.');
    } finally {
      setBusy('');
    }
  };

  const renameSimulation = async (simulationId: string) => {
    if (editingScenarioName.trim().length < 2) return;
    setBusy(`rename:${simulationId}`);
    try {
      const data = await authenticatedFetch(
        `/api/owner/sales/leads/${encodeURIComponent(lead.id)}/modular-simulations/${encodeURIComponent(simulationId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'rename',
            scenarioName: editingScenarioName
          })
        }
      );
      setSimulations((current) =>
        current.map((simulation) =>
          simulation.id === simulationId ? data.simulation : simulation
        )
      );
      setEditingScenarioId('');
      setEditingScenarioName('');
    } catch (renameError: any) {
      setError(renameError?.message || 'Não foi possível renomear.');
    } finally {
      setBusy('');
    }
  };

  const archiveSimulation = async (simulationId: string) => {
    setBusy(`archive:${simulationId}`);
    try {
      await authenticatedFetch(
        `/api/owner/sales/leads/${encodeURIComponent(lead.id)}/modular-simulations/${encodeURIComponent(simulationId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ action: 'archive' })
        }
      );
      setSimulations((current) =>
        current.map((simulation) =>
          simulation.id === simulationId
            ? { ...simulation, status: 'archived' }
            : simulation
        )
      );
      setComparisonIds((current) =>
        current.filter((id) => id !== simulationId)
      );
      if (selectedSimulationId === simulationId) {
        setSelectedSimulationId('');
      }
    } catch (archiveError: any) {
      setError(archiveError?.message || 'Não foi possível arquivar.');
    } finally {
      setBusy('');
    }
  };

  const duplicateSimulation = (simulation: SavedModularSimulation) => {
    const snapshotInput = simulation.modular_input_snapshot;
    const snapshotDemand = salesPackageDemand(
      snapshotInput.patientQuantity,
      snapshotInput.expectedPatientQuantity12Months
    );
    const snapshotRecommended = catalog
      ? recommendSalesPackageTier(catalog, snapshotDemand)
      : null;
    const snapshotTier = catalog?.items
      .find((item) => item.itemKey === 'clinical_core')
      ?.tiers.find((tier) => tier.id === snapshotInput.basePackageTierId);
    const inferredMode = snapshotInput.basePackageSelectionMode ||
      (snapshotRecommended?.id === snapshotInput.basePackageTierId
        ? 'automatic'
        : 'manual');
    setInput({
      ...snapshotInput,
      trialDays: normalizeSalesTrialDays(snapshotInput.trialDays, 0),
      commercialPricingMode: 'manual_module_prices',
      // Duplicar um cenário histórico cria uma nova composição comercial sem
      // expor a infraestrutura como módulo; o snapshot original permanece intacto.
      platformFoundationPricingMode: 'manual',
      platformFoundationMonthlyAmountCents: 0,
      usageProfile: 'intensive',
      driverOverrides: {},
      basePackageSelectionMode: inferredMode,
      customBasePackageLimit:
        snapshotTier?.isCustom || snapshotTier?.maximumQuantity === null
          ? snapshotInput.customBasePackageLimit ??
            simulation.results_snapshot?.basePackage?.limitQuantity ??
            snapshotDemand
          : null,
      lines: snapshotInput.lines
        .filter(
          (line) =>
            line.itemKey !== 'onboarding' &&
            line.itemKey !== 'platform_foundation'
        )
        .map((line) => {
        const item = catalog?.items.find(
          (candidate) => candidate.itemKey === line.itemKey
        );
        if (!item || item.billingInterval === 'one_time') return line;
        const tier = item.tiers.find(
          (candidate) => candidate.id === line.tierId
        );
        return {
          ...line,
          pricingEditMode: line.pricingEditMode || 'monthly_total',
          customRecurringAmountCents:
            line.pricingEditMode === 'per_patient'
              ? line.customRecurringAmountCents ?? null
              : line.customRecurringAmountCents ??
                tier?.recurringAmountCents ??
                item.recurringAmountCents ??
                0
        };
      })
    });
    setScenarioName(
      `Cópia de ${simulation.scenario_name || 'cenário modular'}`
    );
    setInternalJustification(simulation.internal_justification || '');
    setApproveCommercialException(false);
    setInternalNotes(simulation.internal_notes || '');
    setPublicNotes(simulation.public_notes || '');
    setSelectedSimulationId('');
    setPreparedOffer(null);
    setNotice('Cópia carregada. Revise e salve como um novo cenário.');
    panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleComparison = (simulationId: string) => {
    setComparisonIds((current) => {
      if (current.includes(simulationId)) {
        return current.filter((id) => id !== simulationId);
      }
      if (current.length >= 3) {
        setError('Compare no máximo três cenários por vez.');
        return current;
      }
      setError('');
      return [...current, simulationId];
    });
  };

  const prepareOffer = async () => {
    if (!selectedSimulation) return;
    const frozenContractEmail = normalizeContractEmail(contractEmail);
    if (!isValidContractEmail(frozenContractEmail)) {
      setError('Informe um e-mail válido do responsável pela contratação antes de gerar a proposta pública.');
      return;
    }
    if (
      !selectedSimulation.offer &&
      selectedSimulationRequiresVersionedProfitabilityPolicy &&
      !selectedSimulationHasVersionedEconomics
    ) {
      setError(SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE);
      return;
    }
    setBusy('offer');
    setError('');
    try {
      const data = await authenticatedFetch('/api/owner/sales/offers', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': requestKey('modular-offer') },
        body: JSON.stringify({
          leadId: lead.id,
          simulationId: selectedSimulation.id,
          contractEmail: frozenContractEmail
        })
      });
      setPreparedOffer(data);
      if (data?.offer?.contract_email) {
        setContractEmail(normalizeContractEmail(data.offer.contract_email));
      }
      setSimulations((current) =>
        current.map((simulation) =>
          simulation.id === selectedSimulation.id
            ? {
                ...simulation,
                status: 'offered',
                offer: data.offer || simulation.offer
              }
            : simulation
        )
      );
      onOfferPrepared?.(lead.id, data.offer);
      setNotice(data.message || 'Proposta modular criada.');
    } catch (offerError: any) {
      setError(offerError?.message || 'Não foi possível gerar a proposta.');
    } finally {
      setBusy('');
    }
  };

  const activeOfferId =
    preparedOffer?.offer?.id || selectedSimulation?.offer?.id || '';
  const frozenOfferContractEmail = normalizeContractEmail(
    preparedOffer?.offer?.contract_email ||
      selectedSimulation?.offer?.contract_email ||
      ''
  );
  const contractEmailLocked = isValidContractEmail(frozenOfferContractEmail);
  const historicalOfferMissingContractIdentity = Boolean(
    activeOfferId && !contractEmailLocked
  );

  useEffect(() => {
    if (!activeOfferId) {
      setCheckoutLink(null);
      setOfferAccepted(false);
      return;
    }
    let cancelled = false;
    void authenticatedFetch(
      `/api/owner/sales/offers/${encodeURIComponent(activeOfferId)}/modular-checkout`
    ).then((data) => {
      if (!cancelled) {
        setCheckoutLink(data.links?.[0] || null);
        setOfferAccepted(Boolean(data.acceptedAt));
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeOfferId]);

  const registerOfferAcceptance = async () => {
    if (!activeOfferId) return;
    const confirmed = window.confirm(
      'Confirma que o cliente aceitou a proposta e declarou ciência dos valores promocionais e posteriores?'
    );
    if (!confirmed) return;
    setBusy('offer-accept');
    setError('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/offers/${encodeURIComponent(activeOfferId)}/accept`,
        {
          method: 'POST',
          body: JSON.stringify({ commercialValuesConsent: true })
        }
      );
      setOfferAccepted(true);
      setNotice('Aceite comercial registrado com ciência dos valores futuros.');
    } catch (acceptError: any) {
      setError(acceptError?.message || 'Não foi possível registrar o aceite.');
    } finally {
      setBusy('');
    }
  };

  const generateCheckoutLink = async (regenerate = false) => {
    if (!activeOfferId) return;
    setBusy(regenerate ? 'checkout-regenerate' : 'checkout-create');
    setError('');
    try {
      const data = await authenticatedFetch(
        `/api/owner/sales/offers/${encodeURIComponent(activeOfferId)}/modular-checkout`,
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': requestKey('modular-checkout') },
          body: JSON.stringify({ regenerate })
        }
      );
      setCheckoutLink(data.link);
      setNotice(
        data.idempotent
          ? 'Link ativo recuperado sem nova chamada à Stripe.'
          : 'Link de pagamento de teste criado com os valores congelados.'
      );
    } catch (checkoutError: any) {
      setError(checkoutError?.message || 'Não foi possível gerar o link de pagamento.');
    } finally {
      setBusy('');
    }
  };

  const expireCheckoutLink = async () => {
    if (!activeOfferId || !checkoutLink?.id) return;
    setBusy('checkout-expire');
    try {
      await authenticatedFetch(
        `/api/owner/sales/offers/${encodeURIComponent(activeOfferId)}/modular-checkout/expire`,
        {
          method: 'POST',
          body: JSON.stringify({ linkId: checkoutLink.id })
        }
      );
      setCheckoutLink((current: any) => current ? { ...current, status: 'expired' } : current);
      setNotice('Link expirado. O histórico foi preservado.');
    } catch (expireError: any) {
      setError(expireError?.message || 'Não foi possível expirar o link.');
    } finally {
      setBusy('');
    }
  };

  const emailCheckoutLink = async () => {
    if (!activeOfferId || !checkoutLink?.id) return;
    setBusy('checkout-email');
    try {
      await authenticatedFetch(
        `/api/owner/sales/offers/${encodeURIComponent(activeOfferId)}/modular-checkout/email`,
        {
          method: 'POST',
          body: JSON.stringify({ linkId: checkoutLink.id })
        }
      );
      setCheckoutLink((current: any) => current ? { ...current, status: 'sent' } : current);
      setNotice('Link enviado ao contato comercial, sem conteúdo clínico.');
    } catch (emailError: any) {
      setError(emailError?.message || 'Não foi possível enviar o link.');
    } finally {
      setBusy('');
    }
  };

  const copyCheckoutLink = async () => {
    const url = checkoutLink?.publicCheckoutUrl || checkoutLink?.checkout_url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copiado para a área de transferência.');
    } catch {
      setError('Não foi possível copiar automaticamente. Abra o Checkout e copie o endereço do navegador.');
    }
  };

  const coreItem = catalog?.items.find(
    (item) => item.itemKey === 'clinical_core'
  );
  const selectedBaseTier = coreItem?.tiers.find(
    (tier) => tier.id === input?.basePackageTierId
  );
  const currentPackageDemand = input
    ? salesPackageDemand(
        input.patientQuantity,
        input.expectedPatientQuantity12Months
      )
    : 1;
  const recommendedBaseTier = catalog && input
    ? recommendSalesPackageTier(catalog, currentPackageDemand)
    : null;
  const hasVersionedCustomCapacityPolicy =
    catalog?.status === 'active' &&
    validateCustomCapacityPolicy(catalog.customCapacityPolicy);
  const coreSelection = input?.lines.find(
    (line) => line.itemKey === 'clinical_core'
  );
  const coreResult = preview?.lines.find(
    (line) => line.itemKey === 'clinical_core'
  );
  const customPerPatientPricing =
    input?.commercialPricingMode === 'manual_module_prices' &&
    input.lines.some((line) =>
      ['per_patient', 'monthly_total'].includes(
        String(line.pricingEditMode || '')
      )
    );
  const commercialPricingMissing =
    preview?.commercialPricing.enabled === true &&
    preview.commercialPricing.missingPriceItemKeys.length > 0;
  const normalizedContractEmail = normalizeContractEmail(contractEmail);
  const contractEmailValid = isValidContractEmail(normalizedContractEmail);
  const currentCapacityBlockPhase =
    preview?.commercialPricing.capacityBlockPhases[0] || null;
  const postBenefitCapacityBlockPhase =
    preview?.commercialPricing.capacityBlockPhases[
      Math.max(
        0,
        (preview?.commercialPricing.capacityBlockPhases.length || 1) - 1
      )
    ] || null;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/45 backdrop-blur-[2px]">
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-modular-title"
        className="flex h-full w-full max-w-[1180px] flex-col overflow-y-auto bg-slate-50 shadow-2xl"
      >
        <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="text-xs font-medium text-violet-700">Comercial · proposta modular</p>
            <h1
              id="sales-modular-title"
              className="mt-1 text-xl font-semibold text-slate-950"
            >
              {lead?.clinicName || lead?.name || 'Novo cenário'}
            </h1>
            <p className="mt-1 text-sm font-normal text-slate-500">
              Monte a estrutura, compare cenários e congele a proposta.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            aria-label="Fechar construtor de proposta"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <X size={19} />
          </button>
        </header>

        {loading ? (
          <div className="flex min-h-[420px] flex-1 items-center justify-center gap-3 text-sm text-slate-600">
            <Loader2 className="animate-spin text-violet-600" size={20} />
            Carregando catálogo, custos e cenários...
          </div>
        ) : !catalog || !input ? (
          <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
            {error || 'O catálogo modular não está disponível.'}
          </div>
        ) : (
          <div className="grid flex-1 gap-5 p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)] lg:p-6">
            <div className="min-w-0 space-y-5">
              {profitabilityPolicyRequired ? (
                <section
                  role="alert"
                  className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm sm:p-5"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                    <div>
                      <h2 className="font-semibold">
                        Política de margem versionada obrigatória
                      </h2>
                      <p className="mt-1 font-normal leading-6">
                        {SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE}
                      </p>
                      <p className="mt-2 font-normal leading-6">
                        Clone o catálogo ativo, revise a política de margem e
                        publique a nova versão. A consulta dos cenários
                        históricos permanece disponível e nenhuma versão será
                        clonada ou publicada automaticamente.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div>
                  <p className="text-xs font-medium text-violet-700">Identidade contratual</p>
                  <h2 className="mt-1 text-base font-semibold text-slate-900">
                    Responsável pela contratação
                  </h2>
                  <p className="mt-1 text-sm font-normal leading-6 text-slate-500">
                    Confirme o e-mail que receberá o Checkout e a ativação. Ele ficará congelado nesta proposta e não altera o histórico do lead.
                  </p>
                </div>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  E-mail do responsável
                  <input
                    type="email"
                    value={contractEmail}
                    maxLength={254}
                    autoComplete="email"
                    disabled={contractEmailLocked}
                    onChange={(event) => {
                      setContractEmail(event.target.value);
                      setPreparedOffer(null);
                      setError('');
                    }}
                    className={`mt-1.5 w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-normal outline-none transition disabled:bg-slate-50 disabled:text-slate-500 ${
                      contractEmail.length > 0 && !contractEmailValid
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                        : 'border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100'
                    }`}
                    placeholder="responsavel@clinica.com.br"
                  />
                </label>
                {lead?.email && !contractEmailLocked ? (
                  <p className="mt-2 text-xs font-normal text-amber-700">
                    O lead possui {normalizeContractEmail(lead.email)} no histórico. Por segurança, ele não é usado automaticamente: confirme o e-mail da contratação acima.
                  </p>
                ) : null}
                {!contractEmailValid ? (
                  <p className="mt-2 text-xs font-normal text-rose-600">
                    Informe um e-mail válido antes de gerar a proposta pública.
                  </p>
                ) : contractEmailLocked ? (
                  <p className="mt-2 text-xs font-normal text-emerald-700">
                    E-mail congelado nesta proposta: {frozenOfferContractEmail}
                  </p>
                ) : historicalOfferMissingContractIdentity ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-normal leading-5 text-amber-800">
                      Esta proposta foi criada antes da identidade contratual e não pode ser alterada retroativamente. O e-mail acima será usado somente em uma nova versão do cenário.
                    </p>
                    {selectedSimulation ? (
                      <button
                        type="button"
                        onClick={() => duplicateSimulation(selectedSimulation)}
                        className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800 hover:bg-amber-100"
                      >
                        <Copy size={14} /> Duplicar cenário para nova proposta
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-xs font-normal text-slate-500">
                    Este e-mail será congelado quando a proposta pública for gerada.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Capacidade e módulo clínico
                    </h2>
                    <p className="mt-1 text-sm font-normal text-slate-500">
                      Dimensione pacientes, armazenamento e capacidade. Custos
                      compartilhados da plataforma permanecem apenas no cálculo
                      interno de rentabilidade e não são vendidos como módulo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenAssumptions}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Settings2 size={16} /> Premissas financeiras
                  </button>
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Custos compartilhados da plataforma
                  </p>
                  <p className="mt-1 text-xs font-normal leading-5 text-slate-600">
                    Estes valores continuam compondo o EBITDA e o preço-alvo, mas
                    não aparecem na proposta pública nem no Checkout. Se houver
                    gap para a meta, ajuste os preços dos módulos contratados.
                  </p>
                  <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-4">
                    <span>
                      Custo compartilhado:{' '}
                      <strong>{currency(preview?.platformFoundation.sharedCostCents)}</strong>
                    </span>
                    <span>
                      Tarifa fixa Stripe:{' '}
                      <strong>{currency(preview?.platformFoundation.fixedPaymentFeeCents)}</strong>
                    </span>
                    <span>
                      Receita dos módulos:{' '}
                      <strong>{currency(preview?.platformFoundation.moduleRecurringRevenueCents)}</strong>
                    </span>
                    <span>
                      Gap para a meta EBITDA:{' '}
                      <strong>{currency(preview?.platformFoundation.recommendedRecurringAmountCents)}</strong>
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <label className="text-sm font-medium text-slate-700">
                    Pacientes atuais
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={input.patientQuantity}
                      onChange={(event) =>
                        changePatientQuantity(Number(event.target.value))
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Previsão em 12 meses
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={input.expectedPatientQuantity12Months}
                      onChange={(event) =>
                        updateInput({
                          expectedPatientQuantity12Months: Math.max(
                            1,
                            Math.min(100000, Number(event.target.value) || 1)
                          )
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Faixa técnica de capacidade
                    <span className="relative mt-1 block">
                      <select
                        value={input.basePackageTierId}
                        onChange={(event) => selectBaseTier(event.target.value)}
                        className="min-h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 pr-9 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      >
                        {coreItem?.tiers.map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {tier.publicName} ·{' '}
                            {tier.recurringAmountCents == null
                              ? 'personalizado'
                              : currency(tier.recurringAmountCents)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={16}
                        className="pointer-events-none absolute right-3 top-3.5 text-slate-400"
                      />
                    </span>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
                    {input.basePackageSelectionMode === 'manual'
                      ? 'Seleção manual'
                      : 'Seleção automática'}
                  </span>
                  <span className="text-slate-500">
                    Demanda considerada: {currentPackageDemand} pacientes
                  </span>
                  {input.basePackageSelectionMode === 'manual' ? (
                    <button
                      type="button"
                      onClick={useRecommendedBaseTier}
                      className="min-h-9 rounded-lg border border-violet-200 bg-violet-50 px-3 font-medium text-violet-700 hover:bg-violet-100"
                    >
                      Usar faixa recomendada
                    </button>
                  ) : recommendedBaseTier ? (
                    <span className="text-violet-700">
                      Recomendada: {recommendedBaseTier.publicName}
                    </span>
                  ) : null}
                </div>
                {coreItem ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Verto Clínica + ABA
                      </p>
                      <p className="mt-1 text-xs font-normal text-slate-500">
                        Módulo clínico opcional. A capacidade técnica e os custos
                        compartilhados continuam considerados internamente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleItem(coreItem)}
                      className={`min-h-10 rounded-xl border px-4 text-sm font-semibold transition ${
                        coreSelection
                          ? 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
                          : 'border-violet-200 bg-violet-600 text-white hover:bg-violet-700'
                      }`}
                    >
                      {coreSelection ? 'Remover módulo clínico' : 'Incluir módulo clínico'}
                    </button>
                  </div>
                ) : null}
                {coreSelection && selectedBaseTier &&
                !selectedBaseTier.isCustom &&
                selectedBaseTier.maximumQuantity !== null ? (
                  <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(320px,1.2fr)] sm:items-end">
                      <label className="text-sm font-medium text-slate-700">
                        Valor mensal do Verto Clínica
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Informe o valor"
                          value={
                            coreSelection?.customRecurringAmountCents == null
                              ? ''
                              : coreSelection.customRecurringAmountCents / 100
                          }
                          onChange={(event) =>
                            updateLine('clinical_core', {
                              pricingEditMode: 'monthly_total',
                              proposedPricePerPatientCents: null,
                              customRecurringAmountCents:
                                event.target.value === ''
                                  ? null
                                  : Math.round(Number(event.target.value) * 100)
                            })
                          }
                          className="mt-1 min-h-11 w-full rounded-xl border border-violet-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        />
                        <span className="mt-1 block text-xs font-normal text-slate-500">
                          Valor comercial definido para esta clínica. Os custos usam o perfil intensivo.
                        </span>
                      </label>
                      <dl className="grid gap-2 text-xs sm:grid-cols-3">
                        {[
                          [
                            'Custo total estimado',
                            currency(
                              coreResult &&
                              [
                                coreResult.promotional.directCostCents,
                                coreResult.promotional.transactionAndTaxCostAllocatedCents,
                                coreResult.promotional.sharedPlatformCostAllocatedCents
                              ].every((value) => value !== null)
                                ? Number(coreResult.promotional.directCostCents) +
                                  Number(coreResult.promotional.transactionAndTaxCostAllocatedCents) +
                                  Number(coreResult.promotional.sharedPlatformCostAllocatedCents)
                                : null
                            )
                          ],
                          ['Lucro líquido', currency(coreResult?.promotional.netIncomeCents)],
                          ['Margem líquida', percent(coreResult?.promotional.netMarginBasisPoints)]
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg bg-white p-3">
                            <dt className="font-normal text-slate-500">{label}</dt>
                            <dd className="mt-1 font-semibold text-slate-900">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                ) : null}
                {selectedBaseTier &&
                (selectedBaseTier.isCustom ||
                  selectedBaseTier.maximumQuantity === null) ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className={`text-sm font-medium text-slate-700 ${
                      coreSelection ? '' : 'sm:col-span-2'
                    }`}>
                      Limite técnico de capacidade
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        step={1}
                        required
                        value={input.customBasePackageLimit ?? ''}
                        onChange={(event) =>
                          updateInput({
                            customBasePackageLimit:
                              event.target.value === ''
                                ? null
                                : Math.max(
                                    1,
                                    Math.min(
                                      100000,
                                      Math.trunc(Number(event.target.value) || 0)
                                    )
                                  )
                          })
                        }
                        aria-describedby="custom-base-limit-help"
                        className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      />
                      <span
                        id="custom-base-limit-help"
                        className="mt-1 block font-normal leading-5 text-slate-500"
                      >
                        {hasVersionedCustomCapacityPolicy
                          ? 'Capacidade incluída na composição. Blocos cobrem a demanda acima deste limite.'
                          : 'Capacidade técnica congelada nesta proposta. Este catálogo não possui blocos versionados.'}
                      </span>
                    </label>
                    {coreSelection ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-800">
                          Preço comercial do Verto Clínica + ABA
                        </p>
                        <select
                          aria-label="Modo de edição do preço do módulo clínico"
                          value={coreSelection?.pricingEditMode || 'per_patient'}
                          onChange={(event) => {
                            const pricingEditMode = event.target.value as
                              | 'per_patient'
                              | 'monthly_total';
                            updateLine('clinical_core', {
                              pricingEditMode,
                              ...(pricingEditMode === 'monthly_total'
                                ? {
                                    customRecurringAmountCents:
                                      coreResult?.commercialPricing
                                        .derivedMonthlyRevenueCents ?? null
                                  }
                                : {
                                    proposedPricePerPatientCents:
                                      coreResult?.commercialPricing
                                        .proposedPricePerPatientCents ?? null
                                  })
                            });
                          }}
                          className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-normal text-slate-700"
                        >
                          <option value="per_patient">Por paciente</option>
                          <option value="monthly_total">Faturamento mensal</option>
                        </select>
                      </div>
                      {coreSelection?.pricingEditMode === 'monthly_total' ? (
                        <label className="mt-3 block text-xs font-medium text-slate-600">
                          Mensalidade recorrente proposta
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Dados insuficientes"
                            value={
                              coreSelection.customRecurringAmountCents == null
                                ? ''
                                : coreSelection.customRecurringAmountCents / 100
                            }
                            onChange={(event) =>
                              updateLine('clinical_core', {
                                customRecurringAmountCents:
                                  event.target.value === ''
                                    ? null
                                    : Math.round(
                                        Number(event.target.value) * 100
                                      )
                              })
                            }
                            className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          />
                        </label>
                      ) : (
                        <label className="mt-3 block text-xs font-medium text-slate-600">
                          Preço proposto por paciente
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="Dados insuficientes"
                            value={
                              coreSelection?.proposedPricePerPatientCents == null
                                ? ''
                                : coreSelection.proposedPricePerPatientCents /
                                  100
                            }
                            onChange={(event) =>
                              updateLine('clinical_core', {
                                proposedPricePerPatientCents:
                                  event.target.value === ''
                                    ? null
                                    : Math.round(
                                        Number(event.target.value) * 100
                                      )
                              })
                            }
                            className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          />
                        </label>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          {coreSelection?.pricingEditMode === 'monthly_total'
                            ? `Derivado por paciente: ${currency(
                                coreResult?.commercialPricing
                                  .proposedPricePerPatientCents
                              )}`
                            : `Total derivado: ${currency(
                                coreResult?.commercialPricing
                                  .derivedMonthlyRevenueCents
                              )}`}
                        </span>
                        {coreResult?.commercialPricing
                          .recommendedPricePerPatientCents != null ? (
                          <button
                            type="button"
                            onClick={() =>
                              updateLine('clinical_core', {
                                pricingEditMode: 'per_patient',
                                proposedPricePerPatientCents:
                                  coreResult.commercialPricing
                                    .recommendedPricePerPatientCents
                              })
                            }
                            className="min-h-8 rounded-lg border border-violet-200 bg-white px-2 font-medium text-violet-700 hover:bg-violet-50"
                          >
                            Usar preço sugerido
                          </button>
                        ) : null}
                      </div>
                    </div>
                    ) : null}
                    {coreSelection && coreResult ? (
                      <dl className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs sm:col-span-2 sm:grid-cols-3">
                        {[
                          [
                            'Custo mensal estimado',
                            currency(
                              coreResult.commercialPricing
                                .estimatedMonthlyCostCents
                            )
                          ],
                          [
                            'Custo efetivo por paciente',
                            currency(
                              coreResult.commercialPricing
                                .effectiveCostPerPatientCents
                            )
                          ],
                          [
                            'Custo marginal por paciente',
                            currency(
                              coreResult.commercialPricing
                                .marginalCostPerPatientCents
                            )
                          ],
                          [
                            'Referência por paciente',
                            currency(
                              coreResult.commercialPricing
                                .minimumPricePerPatientCents
                            )
                          ],
                          [
                            'Sugerido por paciente',
                            currency(
                              coreResult.commercialPricing
                                .recommendedPricePerPatientCents
                            )
                          ],
                          [
                            'Confiança da estimativa',
                            coreResult.commercialPricing.confidenceLevel ===
                            'unavailable'
                              ? 'Dados insuficientes'
                              : coreResult.commercialPricing.confidenceLevel ===
                                  'high'
                                ? 'Alta'
                                : coreResult.commercialPricing
                                      .confidenceLevel === 'medium'
                                  ? 'Média'
                                  : 'Baixa'
                          ]
                        ].map(([label, value]) => (
                          <div key={label} className="bg-white px-3 py-2.5">
                            <dt className="font-normal text-slate-500">
                              {label}
                            </dt>
                            <dd className="mt-0.5 font-medium text-slate-800">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {hasVersionedCustomCapacityPolicy ? (
                    <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 sm:col-span-2">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)] sm:items-end">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            Blocos adicionais de capacidade
                          </p>
                          <p className="mt-1 text-xs font-normal leading-5 text-slate-600">
                            Cada bloco reserva {catalog.customCapacityPolicy.blockSizePatients} pacientes.{' '}
                            {customPerPatientPricing
                              ? 'O preço é derivado da soma dos preços por paciente dos módulos contratados.'
                              : `Preço versionado: ${currency(catalog.customCapacityPolicy.blockPriceCents)}/mês.`}{' '}
                            A capacidade adicional não bloqueia o acesso aos módulos contratados.
                          </p>
                        </div>
                        <label className="text-xs font-medium text-slate-700">
                          Quantidade selecionada
                          <input
                            type="number"
                            min={preview?.basePackage.capacity?.minimumBlocks ?? 0}
                            max={10000}
                            step={1}
                            value={input.customCapacityBlocks ?? 0}
                            onChange={(event) => updateInput({
                              customCapacityBlocks: Math.max(
                                preview?.basePackage.capacity?.minimumBlocks ?? 0,
                                Math.trunc(Number(event.target.value) || 0)
                              ),
                              customCapacitySelectionMode: 'manual'
                            })}
                            className="mt-1 min-h-11 w-full rounded-xl border border-violet-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                          />
                        </label>
                      </div>
                      {preview?.basePackage.capacity ? (
                        <dl className="mt-4 grid gap-px overflow-hidden rounded-xl border border-violet-100 bg-violet-100 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          {[
                            ['Limite-base', `${preview.basePackage.capacity.baseLimitPatients} pacientes`],
                            [
                              'Receita-base dos módulos',
                              `${currency(
                                commercialPricingMissing
                                  ? null
                                  : preview.basePackage.capacity.basePriceCents
                              )}/mês`
                            ],
                            ['Tamanho do bloco', `${preview.basePackage.capacity.policy.blockSizePatients} pacientes`],
                            [
                              'Preço do bloco nesta fase',
                              `${currency(
                                currentCapacityBlockPhase?.blockPriceCents ??
                                  preview.basePackage.capacity
                                    .effectiveBlockPriceCents
                              )}/mês`
                            ],
                            [
                              'Preço após benefícios',
                              `${currency(
                                postBenefitCapacityBlockPhase
                                  ?.blockPriceCents ??
                                  currentCapacityBlockPhase?.blockPriceCents ??
                                  null
                              )}/mês`
                            ],
                            ['Quantidade mínima', `${preview.basePackage.capacity.minimumBlocks}`],
                            ['Quantidade selecionada', `${preview.basePackage.capacity.selectedBlocks}`],
                            ['Capacidade adicionada', `${preview.basePackage.capacity.addedCapacityPatients} pacientes`],
                            ['Limite total', `${preview.basePackage.capacity.totalContractedLimitPatients} pacientes`],
                            ['Armazenamento incluído', `${preview.basePackage.capacity.includedStorageMb.toLocaleString('pt-BR')} MB`],
                            [
                              'Receita adicional nesta fase',
                              `${currency(
                                commercialPricingMissing
                                  ? null
                                  : currentCapacityBlockPhase
                                      ?.blocksRevenueCents ??
                                    preview.basePackage.capacity
                                      .blocksMonthlyRevenueCents
                              )}/mês`
                            ],
                            [
                              'Receita dos módulos nesta fase',
                              `${currency(
                                customPerPatientPricing
                                  ? currentCapacityBlockPhase
                                      ?.contractedMonthlyRevenueCents
                                  : preview.basePackage.capacity
                                      .clinicalCoreMonthlyRevenueCents
                              )}/mês`
                            ],
                            [
                              'Margem incremental do bloco',
                              percent(
                                currentCapacityBlockPhase
                                  ?.blockIncrementalMarginBasisPoints
                              )
                            ],
                            [
                              'Preço-alvo de margem',
                              currency(
                                currentCapacityBlockPhase
                                  ?.blockMinimumPriceCents
                              )
                            ],
                            [
                              'Classificação',
                              currentCapacityBlockPhase &&
                              catalog.profitabilityPolicy
                                ? formatSalesIncrementalMarginStatusLabel(
                                    currentCapacityBlockPhase.blockMarginStatus,
                                    catalog.profitabilityPolicy,
                                    'capacity'
                                  )
                                : 'Dados insuficientes'
                            ],
                            ['Ajuste de capacidade', `${preview.basePackage.capacity.policy.gracePeriodDays} dias · próximo ciclo`]
                          ].map(([label, value]) => (
                            <div key={label} className="bg-white/90 px-3 py-2.5">
                              <dt className="font-normal text-slate-500">{label}</dt>
                              <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {currentCapacityBlockPhase ? (
                        <details className="mt-3 rounded-xl border border-violet-100 bg-white/90">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet-900">
                            Composição do bloco de{' '}
                            {currentCapacityBlockPhase.blockSizePatients}{' '}
                            pacientes
                          </summary>
                          <div className="divide-y divide-violet-50 border-t border-violet-100 px-3">
                            {currentCapacityBlockPhase.modules.map((module) => {
                              const postModule =
                                postBenefitCapacityBlockPhase?.modules.find(
                                  (candidate) =>
                                    candidate.itemKey === module.itemKey
                                );
                              return (
                                <div
                                  key={module.itemKey}
                                  className="flex items-center justify-between gap-3 py-2 text-xs"
                                >
                                  <span className="text-slate-600">
                                    {module.publicName}
                                  </span>
                                  <span className="text-right font-medium text-slate-800">
                                    {currency(module.blockRevenueCents)}
                                    {postModule &&
                                    postModule.blockRevenueCents !==
                                      module.blockRevenueCents
                                      ? ` · depois ${currency(
                                          postModule.blockRevenueCents
                                        )}`
                                      : ''}
                                  </span>
                                </div>
                              );
                            })}
                            <div className="flex items-center justify-between gap-3 py-2 text-xs font-medium text-violet-950">
                              <span>Total do bloco</span>
                              <span>
                                {currency(
                                  currentCapacityBlockPhase.blockPriceCents
                                )}
                              </span>
                            </div>
                          </div>
                        </details>
                      ) : null}
                      {preview &&
                      preview.commercialPricing.capacityBlockPhases.length >
                        1 ? (
                        <details className="mt-3 rounded-xl border border-violet-100 bg-white/90">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet-900">
                            Ver todas as fases do bloco
                          </summary>
                          <div className="space-y-2 border-t border-violet-100 p-3">
                            {preview.commercialPricing.capacityBlockPhases.map(
                              (phase) => (
                                <div
                                  key={phase.phaseNumber}
                                  className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-medium text-slate-800">
                                        Fase {phase.phaseNumber}
                                      </p>
                                      <p className="mt-0.5 text-[11px] font-normal text-slate-500">
                                        {formatSalesCommercialDate(
                                          phase.startsAt
                                        )}{' '}
                                        —{' '}
                                        {phase.endsAt
                                          ? formatSalesCommercialDate(
                                              phase.endsAt
                                            )
                                          : 'condição permanente'}
                                      </p>
                                    </div>
                                    <p className="text-right text-xs font-medium text-slate-800">
                                      {currency(
                                        phase.effectivePricePerPatientCents
                                      )}
                                      /paciente ·{' '}
                                      {currency(phase.blockPriceCents)}/bloco
                                    </p>
                                  </div>
                                  <p className="mt-2 text-[11px] font-normal text-slate-600">
                                    Mensalidade:{' '}
                                    {currency(
                                      phase.contractedMonthlyRevenueCents
                                    )}
                                  </p>
                                </div>
                              )
                            )}
                          </div>
                        </details>
                      ) : null}
                      {input.customCapacitySelectionMode === 'manual' ? (
                        <button
                          type="button"
                          onClick={() => updateInput({
                            customCapacityBlocks: preview?.basePackage.capacity?.minimumBlocks ?? 0,
                            customCapacitySelectionMode: 'automatic'
                          })}
                          className="mt-3 min-h-9 rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 hover:bg-violet-100"
                        >
                          Usar quantidade recomendada
                        </button>
                      ) : null}
                    </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-normal leading-5 text-slate-600 sm:col-span-2">
                        O catálogo selecionado não possui política versionada de
                        blocos. O limite técnico e os valores dos módulos continuam
                        válidos, sem acréscimo automático de capacidade.
                      </div>
                    )}
                  </div>
                ) : null}
                {selectedBaseTier?.maximumQuantity != null &&
                currentPackageDemand > selectedBaseTier.maximumQuantity ? (
                  <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                    A faixa técnica escolhida comporta até{' '}
                    {selectedBaseTier.maximumQuantity} pacientes e não atende a
                    demanda informada.
                  </p>
                ) : preview ? (
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <span>
                      Ocupação: {preview.basePackage.occupiedQuantity}
                      {preview.basePackage.limitQuantity
                        ? ` de ${preview.basePackage.limitQuantity}`
                        : ''}
                    </span>
                    <span>
                      Vagas disponíveis:{' '}
                      {preview.basePackage.availableQuantity == null
                        ? 'personalizado'
                        : preview.basePackage.availableQuantity}
                    </span>
                    <span>
                      Módulos após benefícios:{' '}
                      {currency(
                        preview.platformFoundation.moduleRecurringRevenueCents
                      )}
                    </span>
                    <span>
                      Mensalidade inicial:{' '}
                      {currency(preview.promotionalRecurringRevenueCents)}
                    </span>
                    <span>
                      Mensalidade após benefícios:{' '}
                      {currency(preview.postPromotionRecurringRevenueCents)}
                    </span>
                    {preview.basePackage.limitQuantity ? (
                      <span>
                        Valor consolidado por paciente no limite:{' '}
                        {currency(
                          Math.round(
                            preview.postPromotionRecurringRevenueCents /
                              preview.basePackage.limitQuantity
                          )
                        )}
                      </span>
                    ) : null}
                    <span>
                      Valor consolidado por paciente atual:{' '}
                      {currency(
                        Math.round(
                          preview.postPromotionRecurringRevenueCents /
                            input.patientQuantity
                        )
                      )}
                    </span>
                    <span>
                      Espaço incluído:{' '}
                      {preview.basePackage.includedStorageMb?.toLocaleString(
                        'pt-BR'
                      ) || 'personalizado'}{' '}
                      MB
                    </span>
                    {coreResult ? (
                      <>
                        <span>
                          GB estimados em uso clínico:{' '}
                          {coreResult.directCostBreakdown.estimatedUsedStorageGb?.toLocaleString(
                            'pt-BR',
                            { maximumFractionDigits: 3 }
                          ) || 'Dados insuficientes'}
                        </span>
                        <span>
                          GB estimados de egress clínico:{' '}
                          {coreResult.directCostBreakdown.estimatedEgressGb?.toLocaleString(
                            'pt-BR',
                            { maximumFractionDigits: 3 }
                          ) || 'Dados insuficientes'}
                        </span>
                      </>
                    ) : null}
                    <span>
                      Crescimento previsto:{' '}
                      {input.expectedPatientQuantity12Months.toLocaleString(
                        'pt-BR'
                      )}{' '}
                      pacientes
                    </span>
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-base font-semibold text-slate-900">
                  Módulos e adicionais
                </h2>
                <p className="mt-1 text-sm font-normal text-slate-500">
                  Escolha apenas os módulos que serão efetivamente contratados.
                  Custos de plataforma permanecem internos e a implantação não é
                  ofertada nesta fase comercial.
                </p>
                <div className="mt-4 space-y-3">
                  {catalog.items
                    .filter(
                      (item) =>
                        item.itemKey !== 'clinical_core' &&
                        item.itemKey !== 'onboarding'
                    )
                    .map((item) => {
                    const line = input.lines.find(
                      (selection) => selection.itemKey === item.itemKey
                    );
                    const enabled = Boolean(line);
                    const selectedTier = item.tiers.find(
                      (tier) => tier.id === line?.tierId
                    );
                    const resultLine = preview?.lines.find(
                      (result) =>
                        result.itemKey === item.itemKey &&
                        (result.tierId || null) === (line?.tierId || null)
                    );
                    const capacityBlockModule =
                      currentCapacityBlockPhase?.modules.find(
                        (module) => module.itemKey === item.itemKey
                      );
                    const postBenefitCapacityBlockModule =
                      postBenefitCapacityBlockPhase?.modules.find(
                        (module) => module.itemKey === item.itemKey
                      );
                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 transition ${
                          enabled
                            ? 'border-violet-200 bg-violet-50/40'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={enabled}
                            aria-label={`${enabled ? 'Remover' : 'Adicionar'} ${item.publicName}`}
                            disabled={item.isRequired && item.itemKey !== 'clinical_core'}
                            onClick={() => toggleItem(item)}
                            className={`mt-0.5 flex min-h-10 min-w-10 items-center justify-center rounded-xl border ${
                              enabled
                                ? 'border-violet-300 bg-violet-600 text-white'
                                : 'border-slate-200 bg-white text-slate-400'
                            } disabled:cursor-default`}
                          >
                            {enabled ? <Check size={17} /> : <Layers3 size={17} />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-sm font-medium text-slate-900">
                                {item.publicName}
                                {item.isRequired && item.itemKey !== 'clinical_core' ? (
                                  <span className="ml-2 text-xs font-normal text-violet-700">
                                    incluído obrigatoriamente
                                  </span>
                                ) : item.itemKey === 'clinical_core' ? (
                                  <span className="ml-2 text-xs font-normal text-slate-500">
                                    opcional
                                  </span>
                                ) : null}
                              </p>
                              {enabled && preview ? (
                                <p className="text-sm font-semibold text-slate-900">
                                  {currency(
                                    item.billingInterval === 'one_time'
                                      ? resultLine?.oneTimeRevenueCents
                                      : resultLine?.commercialPricing
                                          .derivedMonthlyRevenueCents ??
                                          resultLine
                                            ?.postPromotionRecurringRevenueCents
                                  )}
                                  <span className="font-normal text-slate-500">
                                    {item.billingInterval === 'one_time'
                                      ? ' único'
                                      : '/mês'}
                                  </span>
                                </p>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs font-normal leading-5 text-slate-500">
                              {item.description}
                            </p>
                            {enabled && capacityBlockModule ? (
                              <p className="mt-1.5 text-xs font-medium text-violet-700">
                                Parcela no bloco de{' '}
                                {currentCapacityBlockPhase?.blockSizePatients}:{' '}
                                {currency(
                                  capacityBlockModule.blockRevenueCents
                                )}
                                {postBenefitCapacityBlockModule &&
                                postBenefitCapacityBlockModule
                                  .blockRevenueCents !==
                                  capacityBlockModule.blockRevenueCents
                                  ? ` durante o benefício · ${currency(
                                      postBenefitCapacityBlockModule
                                        .blockRevenueCents
                                    )} depois`
                                  : ''}
                              </p>
                            ) : null}
                            {enabled && line ? (
                              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                {item.tiers.length > 0 ? (
                                  <label className="text-xs font-medium text-slate-600">
                                    Faixa
                                    <select
                                      value={line.tierId || ''}
                                      onChange={(event) => {
                                        const tier = item.tiers.find(
                                          (candidate) =>
                                            candidate.id === event.target.value
                                        );
                                        updateLine(item.itemKey, {
                                          tierId: event.target.value,
                                          customRecurringAmountCents:
                                            customPerPatientPricing
                                              ? line
                                                  .customRecurringAmountCents ??
                                                null
                                              : tier?.isCustom
                                                ? 0
                                                : null
                                        });
                                      }}
                                      className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                    >
                                      {item.tiers.map((tier) => (
                                        <option key={tier.id} value={tier.id}>
                                          {tier.publicName}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ) : null}
                                {item.itemKey === 'insurance_tiss' ||
                                item.itemKey === 'additional_storage' ? (
                                  <label className="text-xs font-medium text-slate-600">
                                    {item.itemKey === 'insurance_tiss'
                                      ? 'Guias por mês'
                                      : 'Quantidade de blocos'}
                                    <input
                                      type="number"
                                      min={1}
                                      value={line.quantity}
                                      onChange={(event) =>
                                        updateLine(item.itemKey, {
                                          quantity: Math.max(
                                            1,
                                            Number(event.target.value)
                                          )
                                        })
                                      }
                                      className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                    />
                                  </label>
                                ) : null}
                                {customPerPatientPricing &&
                                item.billingInterval !== 'one_time' ? (
                                  <div className="rounded-xl border border-slate-200 bg-white p-3 sm:col-span-3">
                                    <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end">
                                      <label className="text-xs font-medium text-slate-600">
                                        Editar por
                                        <select
                                          value={
                                            line.pricingEditMode ||
                                            'per_patient'
                                          }
                                          onChange={(event) => {
                                            const pricingEditMode = event.target
                                              .value as
                                              | 'per_patient'
                                              | 'monthly_total';
                                            updateLine(item.itemKey, {
                                              pricingEditMode,
                                              ...(pricingEditMode ===
                                              'monthly_total'
                                                ? {
                                                    customRecurringAmountCents:
                                                      resultLine
                                                        ?.commercialPricing
                                                        .derivedMonthlyRevenueCents ??
                                                      null
                                                  }
                                                : {
                                                    proposedPricePerPatientCents:
                                                      resultLine
                                                        ?.commercialPricing
                                                        .proposedPricePerPatientCents ??
                                                      null
                                                  })
                                            });
                                          }}
                                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                        >
                                          <option value="per_patient">
                                            Preço por paciente
                                          </option>
                                          <option value="monthly_total">
                                            Mensalidade total
                                          </option>
                                        </select>
                                      </label>
                                      {line.pricingEditMode ===
                                      'monthly_total' ? (
                                        <label className="text-xs font-medium text-slate-600">
                                          Mensalidade recorrente proposta
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            placeholder="Dados insuficientes"
                                            value={
                                              line.customRecurringAmountCents ==
                                              null
                                                ? ''
                                                : line.customRecurringAmountCents /
                                                  100
                                            }
                                            onChange={(event) =>
                                              updateLine(item.itemKey, {
                                                customRecurringAmountCents:
                                                  event.target.value === ''
                                                    ? null
                                                    : Math.round(
                                                        Number(
                                                          event.target.value
                                                        ) * 100
                                                      )
                                              })
                                            }
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                          />
                                        </label>
                                      ) : (
                                        <label className="text-xs font-medium text-slate-600">
                                          Preço proposto por paciente
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            placeholder="Dados insuficientes"
                                            value={
                                              line
                                                .proposedPricePerPatientCents ==
                                              null
                                                ? ''
                                                : line
                                                    .proposedPricePerPatientCents /
                                                  100
                                            }
                                            onChange={(event) =>
                                              updateLine(item.itemKey, {
                                                proposedPricePerPatientCents:
                                                  event.target.value === ''
                                                    ? null
                                                    : Math.round(
                                                        Number(
                                                          event.target.value
                                                        ) * 100
                                                      )
                                              })
                                            }
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                          />
                                        </label>
                                      )}
                                      <button
                                        type="button"
                                        disabled={
                                          resultLine?.commercialPricing
                                            .recommendedPricePerPatientCents ==
                                          null
                                        }
                                        onClick={() =>
                                          updateLine(item.itemKey, {
                                            pricingEditMode: 'per_patient',
                                            proposedPricePerPatientCents:
                                              resultLine!.commercialPricing
                                                .recommendedPricePerPatientCents
                                          })
                                        }
                                        className="min-h-10 rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Usar sugerido
                                      </button>
                                    </div>
                                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                                      {[
                                        [
                                          'Total derivado',
                                          currency(
                                            resultLine?.commercialPricing
                                              .derivedMonthlyRevenueCents
                                          )
                                        ],
                                        [
                                          'Custo mensal estimado',
                                          currency(
                                            resultLine?.commercialPricing
                                              .estimatedMonthlyCostCents
                                          )
                                        ],
                                        [
                                          'Custo por paciente',
                                          currency(
                                            resultLine?.commercialPricing
                                              .effectiveCostPerPatientCents
                                          )
                                        ],
                                        [
                                          'Custo marginal',
                                          currency(
                                            resultLine?.commercialPricing
                                              .marginalCostPerPatientCents
                                          )
                                        ],
                                        [
                                          'Referência por paciente',
                                          currency(
                                            resultLine?.commercialPricing
                                              .minimumPricePerPatientCents
                                          )
                                        ],
                                        [
                                          'Margem de contribuição',
                                          percent(
                                            resultLine?.commercialPricing
                                              .contributionMarginBasisPoints
                                          )
                                        ]
                                      ].map(([label, value]) => (
                                        <div
                                          key={label}
                                          className="rounded-lg bg-slate-50 px-2.5 py-2"
                                        >
                                          <dt className="font-normal text-slate-500">
                                            {label}
                                          </dt>
                                          <dd className="mt-0.5 font-medium text-slate-800">
                                            {value}
                                          </dd>
                                        </div>
                                      ))}
                                    </dl>
                                    <p className="mt-2 text-[11px] font-normal text-slate-500">
                                      {resultLine?.commercialPricing
                                        .estimateStatus ===
                                      'insufficient_data'
                                        ? 'Dados insuficientes: complete custo, driver ou preço.'
                                        : `Estimativa ${resultLine?.commercialPricing.estimateStatus === 'calibrated' ? 'calibrada' : resultLine?.commercialPricing.estimateStatus === 'pre_launch' ? 'pré-lançamento' : 'estimada'} · modelo v${resultLine?.commercialPricing.costModelVersion ?? '—'} · premissas v${resultLine?.commercialPricing.assumptionsVersion ?? catalog.version}`}
                                    </p>
                                  </div>
                                ) : selectedTier?.isCustom ? (
                                  <label className="text-xs font-medium text-slate-600">
                                    Valor mensal autorizado
                                    <input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={
                                        (line.customRecurringAmountCents || 0) /
                                        100
                                      }
                                      onChange={(event) =>
                                        updateLine(item.itemKey, {
                                          customRecurringAmountCents: Math.round(
                                            Number(event.target.value) * 100
                                          )
                                        })
                                      }
                                      className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                    />
                                  </label>
                                ) : null}
                                {item.itemKey === 'onboarding' ? (
                                  <>
                                    <label className="text-xs font-medium text-slate-600">
                                      Valor de implantação
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={
                                          (line.customOneTimeAmountCents || 0) /
                                          100
                                        }
                                        onChange={(event) =>
                                          updateLine(item.itemKey, {
                                            customOneTimeAmountCents: Math.round(
                                              Number(event.target.value) * 100
                                            )
                                          })
                                        }
                                        className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                      />
                                    </label>
                                    <label className="text-xs font-medium text-slate-600">
                                      Parcelamento comercial
                                      <select
                                        value={input.onboardingInstallments ?? 1}
                                        onChange={(event) =>
                                          updateInput({
                                            onboardingInstallments: Number(
                                              event.target.value
                                            )
                                          })
                                        }
                                        className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                      >
                                        {[1, 2, 3, 6, 12, 18, 24, 36].map(
                                          (installments) => (
                                            <option
                                              key={installments}
                                              value={installments}
                                            >
                                              {installments === 1
                                                ? 'À vista'
                                                : `${installments} parcelas`}
                                            </option>
                                          )
                                        )}
                                      </select>
                                    </label>
                                  </>
                                ) : null}
                                {enabled ? (
                                  <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-3 sm:grid-cols-4">
                                    <label className="text-xs font-medium text-slate-600">
                                      Tipo de benefício
                                      <select
                                        value={line.offerDiscount?.type || 'none'}
                                        onChange={(event) => {
                                          const type = event.target.value as OfferItemDiscountType | 'none';
                                          if (type === 'none') {
                                            updateLine(item.itemKey, {
                                              offerDiscount: null,
                                              itemDiscountBasisPoints: 0
                                            });
                                            return;
                                          }
                                          const normalPrice = item.billingInterval === 'one_time'
                                            ? resultLine?.grossOneTimeRevenueCents || 0
                                            : resultLine?.grossRecurringRevenueCents || 0;
                                          updateLine(item.itemKey, {
                                            itemDiscountBasisPoints: 0,
                                            offerDiscount: {
                                              type,
                                              percentageBasisPoints: type === 'percentage' ? 1000 : undefined,
                                              amountOffCents: type === 'fixed_amount' ? 0 : undefined,
                                              startsAt: input.offerStartsAt || new Date().toISOString(),
                                              endsAt: null,
                                              durationCount: 6,
                                              durationUnit: 'months',
                                              priceBeforeDiscountCents: normalPrice,
                                              discountedPriceCents: type === 'free' ? 0 : normalPrice,
                                              priceAfterExpirationCents: normalPrice,
                                              reason: 'Condição comercial temporária',
                                              status: 'active'
                                            }
                                          });
                                        }}
                                        className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                      >
                                        <option value="none">Sem desconto</option>
                                        <option value="percentage">Percentual</option>
                                        <option value="fixed_amount">Valor fixo</option>
                                        <option value="free">Gratuito temporariamente</option>
                                      </select>
                                    </label>
                                    {line.offerDiscount?.type === 'percentage' ? (
                                      <label className="text-xs font-medium text-slate-600">
                                        Desconto (%)
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          step="0.01"
                                          value={Number(line.offerDiscount.percentageBasisPoints || 0) / 100}
                                          onChange={(event) => updateLine(item.itemKey, {
                                            offerDiscount: {
                                              ...line.offerDiscount!,
                                              percentageBasisPoints: Math.round(Number(event.target.value) * 100)
                                            }
                                          })}
                                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                        />
                                      </label>
                                    ) : line.offerDiscount?.type === 'fixed_amount' ? (
                                      <label className="text-xs font-medium text-slate-600">
                                        Valor do desconto
                                        <input
                                          type="number"
                                          min={0}
                                          step="0.01"
                                          value={Number(line.offerDiscount.amountOffCents || 0) / 100}
                                          onChange={(event) => updateLine(item.itemKey, {
                                            offerDiscount: {
                                              ...line.offerDiscount!,
                                              amountOffCents: Math.round(Number(event.target.value) * 100)
                                            }
                                          })}
                                          className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                        />
                                      </label>
                                    ) : null}
                                    {line.offerDiscount ? (
                                      <>
                                        <label className="text-xs font-medium text-slate-600">
                                          Início
                                          <input
                                            type="date"
                                            value={line.offerDiscount.startsAt.slice(0, 10)}
                                            onChange={(event) => updateLine(item.itemKey, {
                                              offerDiscount: {
                                                ...line.offerDiscount!,
                                                startsAt: `${event.target.value}T00:00:00.000Z`
                                              }
                                            })}
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                          />
                                        </label>
                                        <label className="text-xs font-medium text-slate-600">
                                          Duração (meses)
                                          <input
                                            type="number"
                                            min={1}
                                            max={36}
                                            value={line.offerDiscount.durationCount || 1}
                                            onChange={(event) => updateLine(item.itemKey, {
                                              offerDiscount: {
                                                ...line.offerDiscount!,
                                                endsAt: null,
                                                durationCount: Math.max(1, Math.min(36, Math.trunc(Number(event.target.value) || 1))),
                                                durationUnit: 'months'
                                              }
                                            })}
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                          />
                                        </label>
                                        <label className="text-xs font-medium text-slate-600 sm:col-span-4">
                                          Motivo
                                          <input
                                            value={line.offerDiscount.reason}
                                            maxLength={300}
                                            onChange={(event) => updateLine(item.itemKey, {
                                              offerDiscount: {
                                                ...line.offerDiscount!,
                                                reason: event.target.value
                                              }
                                            })}
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                          />
                                        </label>
                                        <label className="text-xs font-medium text-slate-600 sm:col-span-4">
                                          Nota interna do benefício <span className="font-normal text-slate-400">(opcional)</span>
                                          <input
                                            value={line.offerDiscount.internalNotes || ''}
                                            maxLength={500}
                                            onChange={(event) => updateLine(item.itemKey, {
                                              offerDiscount: {
                                                ...line.offerDiscount!,
                                                internalNotes: event.target.value
                                              }
                                            })}
                                            className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-800"
                                          />
                                        </label>
                                        {resultLine?.offerDiscount ? (
                                          <dl className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs sm:col-span-4 sm:grid-cols-3 lg:grid-cols-4">
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Preço de tabela</dt><dd className="mt-0.5 font-medium text-slate-800">{currency(resultLine.offerDiscount.priceBeforeDiscountCents)}</dd></div>
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Durante o benefício</dt><dd className="mt-0.5 font-medium text-emerald-700">{currency(resultLine.offerDiscount.discountedPriceCents)}</dd></div>
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Depois</dt><dd className="mt-0.5 font-medium text-slate-800">{currency(resultLine.offerDiscount.priceAfterExpirationCents)}</dd></div>
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Encerramento</dt><dd className="mt-0.5 font-medium text-slate-800">{resultLine.offerDiscount.endsAt ? formatSalesCommercialDate(resultLine.offerDiscount.endsAt) : 'Sem término'}</dd></div>
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Impacto mensal</dt><dd className="mt-0.5 font-medium text-amber-700">− {currency(resultLine.offerDiscount.priceBeforeDiscountCents - resultLine.offerDiscount.discountedPriceCents)}</dd></div>
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Impacto no primeiro ano</dt><dd className="mt-0.5 font-medium text-amber-700">− {currency((resultLine.offerDiscount.priceBeforeDiscountCents - resultLine.offerDiscount.discountedPriceCents) * Math.min(12, resultLine.offerDiscount.durationUnit === 'days' ? Math.ceil(Number(resultLine.offerDiscount.durationCount || 0) / 30) : Number(resultLine.offerDiscount.durationCount || 12)))}</dd></div>
                                            <div className="bg-white p-2.5"><dt className="text-slate-500">Margem promoção / depois</dt><dd className="mt-0.5 font-medium text-slate-800">{percent(resultLine.promotional.ebitdaMarginBasisPoints)} / {percent(resultLine.postPromotion.ebitdaMarginBasisPoints)}</dd></div>
                                          </dl>
                                        ) : null}
                                      </>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {enabled && resultLine ? (
                              <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
                                <div>
                                  <p className="text-[11px] font-normal text-slate-500">
                                    Custo direto
                                  </p>
                                  <p className="mt-0.5 text-xs font-medium text-slate-800">
                                    {currency(
                                      resultLine.promotional.directCostCents
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-normal text-slate-500">
                                    EBITDA atribuído
                                  </p>
                                  <p className="mt-0.5 text-xs font-medium text-slate-800">
                                    {currency(
                                      resultLine.promotional.ebitdaCents
                                    )}{' '}
                                    ·{' '}
                                    {percent(
                                      resultLine.promotional
                                        .ebitdaMarginBasisPoints
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-normal text-slate-500">
                                    Origem do custo
                                  </p>
                                  <p className="mt-0.5 text-xs font-medium text-slate-800">
                                    {costSourceLabel[resultLine.costSource] ||
                                      resultLine.costSource}
                                  </p>
                                </div>
                                {resultLine.warnings.length > 0 ? (
                                  <p className="text-xs font-normal leading-5 text-amber-800 sm:col-span-3">
                                    {resultLine.warnings.join(' ')}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {preview ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Resultado por módulo</h2>
                      <p className="mt-1 text-sm font-normal text-slate-500">
                        Faturamento, custo total, resultado operacional e lucro líquido de cada funcionalidade.
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800">Uso intensivo</span>
                  </div>
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[980px] text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Módulo</th>
                          <th className="px-3 py-2 font-medium">Valor definido</th>
                          <th className="px-3 py-2 font-medium">Faturamento após descontos</th>
                          <th className="px-3 py-2 font-medium">Custo total</th>
                          <th className="px-3 py-2 font-medium">Resultado operacional</th>
                          <th className="px-3 py-2 font-medium">Margem operacional</th>
                          <th className="px-3 py-2 font-medium">Lucro líquido</th>
                          <th className="px-3 py-2 font-medium">Margem líquida</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.lines
                          .filter(
                            (line) =>
                              line.itemKey !== 'platform_foundation' &&
                              line.itemKey !== 'onboarding'
                          )
                          .map((line) => {
                          const totalCostCents = [
                            line.promotional.directCostCents,
                            line.promotional.transactionAndTaxCostAllocatedCents,
                            line.promotional.sharedPlatformCostAllocatedCents
                          ].every((value) => value !== null)
                            ? Number(line.promotional.directCostCents) +
                              Number(line.promotional.transactionAndTaxCostAllocatedCents) +
                              Number(line.promotional.sharedPlatformCostAllocatedCents)
                            : null;
                          return (
                            <tr key={line.lineKey}>
                              <td className="px-3 py-3 font-medium text-slate-800">{line.publicName}</td>
                              <td className="px-3 py-3">{line.grossRecurringRevenueCents > 0 ? `${currency(line.grossRecurringRevenueCents)}/mês` : currency(line.grossOneTimeRevenueCents)}</td>
                              <td className="px-3 py-3">{line.grossRecurringRevenueCents > 0 ? `${currency(line.promotional.netRevenueCents)}/mês` : currency(line.oneTimeRevenueCents)}</td>
                              <td className="px-3 py-3">{currency(line.grossRecurringRevenueCents > 0 ? totalCostCents : line.oneTimeDirectCostCents)}</td>
                              <td className="px-3 py-3">{currency(line.promotional.ebitdaCents)}</td>
                              <td className="px-3 py-3">{percent(line.promotional.ebitdaMarginBasisPoints)}</td>
                              <td className="px-3 py-3 font-medium text-slate-900">{currency(line.grossRecurringRevenueCents > 0 ? line.promotional.netIncomeCents : line.oneTimeContributionMarginCents)}</td>
                              <td className="px-3 py-3">{line.grossRecurringRevenueCents > 0 ? percent(line.promotional.netMarginBasisPoints) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-base font-semibold text-slate-900">
                  Condição comercial
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <label className="text-sm font-medium text-slate-700">
                    Desconto global
                    <div className="relative mt-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={input.globalDiscountBasisPoints / 100}
                        onChange={(event) => {
                          const basisPoints = Math.round(
                            Number(event.target.value) * 100
                          );
                          updateInput({
                            globalDiscountBasisPoints: basisPoints,
                            discountDurationMonths:
                              basisPoints > 0
                                ? Math.max(1, input.discountDurationMonths || 6)
                                : 0
                          });
                        }}
                        className="min-h-11 w-full rounded-xl border border-slate-200 px-3 pr-8 font-normal"
                      />
                      <span className="absolute right-3 top-3 text-slate-400">%</span>
                    </div>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Duração
                    <select
                      value={input.discountDurationMonths}
                      disabled={input.globalDiscountBasisPoints === 0}
                      onChange={(event) =>
                        updateInput({
                          discountDurationMonths: Number(event.target.value)
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal disabled:bg-slate-100"
                    >
                      {[1, 3, 6, 12, 18, 24, 36].map((months) => (
                        <option key={months} value={months}>
                          {months} meses
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Período de teste
                    <select
                      value={input.trialDays ?? 0}
                      onChange={(event) =>
                        updateInput({
                          trialDays: Number(event.target.value) as 0 | 7 | 14 | 30
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
                    >
                      <option value={0}>Sem teste</option>
                      <option value={7}>7 dias</option>
                      <option value={14}>14 dias</option>
                      <option value={30}>30 dias</option>
                    </select>
                    {selectedSimulationTrialDays !== null ? (
                      <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                        Cenário selecionado: {selectedSimulationTrialDays > 0
                          ? `${selectedSimulationTrialDays} dias de teste`
                          : 'sem período de teste'}.
                      </span>
                    ) : null}
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Validade
                    <select
                      value={input.offerValidityDays}
                      onChange={(event) =>
                        updateInput({
                          offerValidityDays: Number(event.target.value)
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
                    >
                      {[7, 14, 21, 30, 60, 90].map((days) => (
                        <option key={days} value={days}>
                          {days} dias
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                    <p className="text-sm font-medium text-slate-700">Base de custo</p>
                    <p className="mt-1 text-sm font-semibold text-violet-800">Uso intensivo</p>
                    <p className="mt-1 text-xs font-normal leading-5 text-slate-500">
                      Todas as simulações usam as premissas intensivas versionadas.
                    </p>
                  </div>
                  <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                    Nome do cenário
                    <input
                      value={scenarioName}
                      maxLength={120}
                      onChange={(event) => setScenarioName(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
                    />
                  </label>
                </div>
                {input.globalDiscountBasisPoints > 0 && input.lines.some((line) => Boolean(line.offerDiscount)) ? (
                  <label className="mt-4 block rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
                    Empilhamento de descontos
                    <span className="mt-1 block text-xs font-normal leading-5 text-amber-800">
                      O desconto do módulo é aplicado primeiro; o desconto global incide depois sobre o saldo. Registre a autorização para continuar.
                    </span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={input.discountStackingJustification || ''}
                      onChange={(event) => updateInput({ discountStackingJustification: event.target.value })}
                      className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 font-normal text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      placeholder="Justificativa e responsável pela autorização"
                    />
                  </label>
                ) : null}
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Observação pública
                  <textarea
                    rows={2}
                    maxLength={1500}
                    value={publicNotes}
                    onChange={(event) => setPublicNotes(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal"
                    placeholder="Contexto comercial visível ao lead."
                  />
                </label>
                <label className="mt-3 block text-sm font-medium text-slate-700">
                  Nota interna
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={internalNotes}
                    onChange={(event) => setInternalNotes(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal"
                    placeholder="Nunca será exibida na proposta pública."
                  />
                </label>
                {proposalReview?.requiresCommercialApproval ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-amber-700"
                        size={18}
                      />
                      <div>
                        <p className="text-sm font-medium text-amber-950">
                          Aprovação comercial excepcional
                        </p>
                        <p className="mt-1 text-xs font-normal leading-5 text-amber-900">
                          O cenário pode ser salvo como rascunho. Para gerar a
                          proposta pública, um owner com MFA deve aprovar estes
                          alertas sem alterar os cálculos.
                        </p>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs font-normal leading-5 text-amber-950">
                      {proposalReview.commercialAlertCodes.map((code) => (
                        <li key={code} className="flex gap-2">
                          <span aria-hidden="true">•</span>
                          <span>{commercialAlertLabel(code, preview.economics.policy)}</span>
                        </li>
                      ))}
                    </ul>
                    <label className="mt-4 block text-sm font-medium text-slate-700">
                      Tipo da exceção
                      <select
                        value={commercialExceptionType}
                        onChange={(event) =>
                          setCommercialExceptionType(
                            event.target.value as SalesCommercialExceptionType
                          )
                        }
                        className="mt-1 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      >
                        <option value="margin_policy_override">
                          Revisão individual de margem
                        </option>
                        <option value="temporary_promotion">
                          Condição promocional temporária
                        </option>
                        <option value="strategic_showcase">
                          Condição estratégica de cliente-vitrine
                        </option>
                      </select>
                    </label>
                    <label className="mt-3 block text-sm font-medium text-slate-700">
                      Justificativa interna
                      <textarea
                        rows={3}
                        maxLength={1500}
                        value={internalJustification}
                        onChange={(event) =>
                          setInternalJustification(event.target.value)
                        }
                        className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 font-normal text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                        placeholder="Descreva o motivo, a condição posterior e o responsável pela decisão."
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        Mínimo de 20 caracteres quando a aprovação for marcada.
                      </span>
                    </label>
                    <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={approveCommercialException}
                        onChange={(event) =>
                          setApproveCommercialException(event.target.checked)
                        }
                        className="mt-0.5 h-5 w-5 rounded border-amber-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="font-normal leading-5">
                        Aprovo explicitamente esta exceção individual com os
                        valores e margens exibidos. A política global permanece
                        inalterada.
                      </span>
                    </label>
                  </div>
                ) : null}
              </section>

              {preview && !profitabilityPolicyRequired ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Projeções da proposta
                    </h2>
                    {preview.oneTimeRevenueCents > 0 ? (
                      <p className="mt-1 text-sm font-normal text-slate-500">
                        Valor pontual reconhecido conforme a condição comercial.
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
                      <p className="text-xs font-medium text-violet-700">
                        Durante a promoção
                      </p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {currency(preview.promotionalRecurringRevenueCents)}
                        <span className="text-xs font-normal text-slate-500">
                          /mês
                        </span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                      <p className="text-xs font-medium text-emerald-700">
                        Após a promoção
                      </p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {currency(preview.postPromotionRecurringRevenueCents)}
                        <span className="text-xs font-normal text-slate-500">
                          /mês
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-[1760px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Horizonte</th>
                          <th className="px-3 py-2 font-medium">Receita recorrente</th>
                          {preview.oneTimeRevenueCents > 0 ? (
                            <th className="px-3 py-2 font-medium">Valor pontual</th>
                          ) : null}
                          <th className="px-3 py-2 font-medium">Desconto acumulado</th>
                          <th className="px-3 py-2 font-medium">
                            EBITDA atribuído
                          </th>
                          <th className="px-3 py-2 font-medium">Lucro</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(['12', '24', '36'] as const).map((horizon) => {
                          const projection = preview.horizons[horizon];
                          return (
                            <tr key={horizon}>
                              <td className="px-3 py-3 font-medium text-slate-800">
                                {projection.months} meses
                              </td>
                              <td className="px-3 py-3">
                                {currency(projection.recurringRevenueCents)}
                              </td>
                              {preview.oneTimeRevenueCents > 0 ? (
                                <td className="px-3 py-3">
                                  {currency(projection.oneTimeRevenueCents)}
                                </td>
                              ) : null}
                              <td className="px-3 py-3">
                                {currency(projection.discountImpactCents)}
                              </td>
                              <td className="px-3 py-3">
                                {currency(projection.ebitdaCents)}
                              </td>
                              <td className="px-3 py-3">
                                {currency(projection.netIncomeCents)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <dl
                    className={`mt-4 grid gap-3 ${
                      preview.oneTimeRevenueCents > 0
                        ? 'sm:grid-cols-3'
                        : 'sm:grid-cols-2'
                    }`}
                  >
                    {preview.oneTimeRevenueCents > 0 ? (
                      <div className="rounded-xl bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">Valor pontual total</dt>
                        <dd className="mt-1 text-sm font-semibold text-slate-900">
                          {currency(preview.oneTimeRevenueCents)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">
                        Preço-alvo de margem
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {currency(
                          preview.minimumRecommendedRecurringRevenueCents
                        )}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">
                        Folga para desconto até a meta
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {percent(
                          preview.maximumRecommendedDiscountBasisPoints
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>
              ) : null}

              {preview?.economics ? (
                <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
                  <div className="border-b border-violet-100 bg-violet-50/50 px-4 py-4 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-medium text-violet-700">
                          Perfil intensivo · política versionada
                        </p>
                        <h2 className="mt-1 text-base font-semibold text-slate-900">
                          Economia da clínica
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm font-normal leading-6 text-slate-600">
                          Custos compartilhados da plataforma e a tarifa fixa são
                          considerados uma única vez no consolidado. Cada módulo mostra
                          apenas seu custo direto e sua margem incremental.
                        </p>
                      </div>
                      <span
                        className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium ${
                          proposalReview?.technicalBlockingCodes.length
                            ? 'bg-rose-100 text-rose-800'
                            : proposalReview?.commercialAlertCodes.length
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {proposalReview?.technicalBlockingCodes.length
                          ? 'Dados obrigatórios pendentes'
                          : proposalReview?.commercialAlertCodes.length
                            ? 'Abaixo da meta · aviso'
                            : 'Dentro da margem-alvo'}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5">
                    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        [
                          'Receita promocional',
                          currency(preview.economics.promotional.revenueCents)
                        ],
                        [
                          'Custo intensivo',
                          currency(preview.economics.promotional.costCents)
                        ],
                        [
                          'Margem promocional',
                          percent(
                            preview.economics.promotional.marginBasisPoints
                          )
                        ],
                        [
                          'Folga para desconto até a meta',
                          currency(
                            preview.economics.promotional
                              .maximumDiscountCents
                          )
                        ],
                        [
                          'Receita posterior',
                          currency(
                            preview.economics.postPromotion.revenueCents
                          )
                        ],
                        [
                          'EBITDA atribuído posterior',
                          currency(
                            preview.economics.postPromotion.ebitdaCents
                          )
                        ],
                        [
                          'Margem posterior',
                          percent(
                            preview.economics.postPromotion.marginBasisPoints
                          )
                        ],
                        [
                          'Folga para desconto até a meta no 1º ano',
                          currency(
                            preview.economics.firstYearMaximumDiscountCents
                          )
                        ]
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                        >
                          <dt className="text-xs font-normal text-slate-500">
                            {label}
                          </dt>
                          <dd className="mt-1 text-sm font-semibold text-slate-900">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {proposalReview?.technicalBlockingCodes.length ||
                    proposalReview?.commercialAlertCodes.length ||
                    preview.economics.warnings.length ? (
                      <div
                        role="alert"
                        className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${
                          proposalReview?.technicalBlockingCodes.length
                            ? 'border-rose-200 bg-rose-50 text-rose-900'
                            : 'border-amber-200 bg-amber-50 text-amber-950'
                        }`}
                      >
                        <p className="font-medium">
                          {proposalReview?.technicalBlockingCodes.length
                            ? 'Dados obrigatórios antes do envio'
                            : 'Avisos econômicos não bloqueantes'}
                        </p>
                        {!proposalReview?.technicalBlockingCodes.length ? (
                          <p className="mt-1 font-normal">
                            Estes avisos registram a distância para a meta, mas
                            não impedem salvar, publicar, aceitar ou cobrar a
                            proposta no Stripe.
                          </p>
                        ) : null}
                        <ul className="mt-1 list-disc space-y-1 pl-5 font-normal">
                          {preview.economics.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                          {proposalReview?.commercialAlertCodes.map((code) => (
                            <li key={code}>
                              {commercialAlertLabel(
                                code,
                                preview.economics.policy
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                      <table className="min-w-[1120px] w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">Item</th>
                            <th className="px-3 py-2 font-medium">Preço atual</th>
                            {profitabilityThresholdColumns.map((threshold) => (
                              <th
                                key={threshold.basisPoints}
                                className="px-3 py-2 font-medium"
                              >
                                {threshold.label}
                              </th>
                            ))}
                            <th className="px-3 py-2 font-medium">Custo suportado</th>
                            <th className="px-3 py-2 font-medium">Margem</th>
                            <th className="px-3 py-2 font-medium">Antes</th>
                            <th className="px-3 py-2 font-medium">Depois</th>
                            <th className="px-3 py-2 font-medium">Variação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {preview.economics.items.map((item) => (
                            <tr key={item.itemKey}>
                              <td className="px-3 py-3 font-medium text-slate-800">
                                {item.publicName}
                                <span className="mt-0.5 block font-normal text-slate-400">
                                  {item.isBasePackage
                                    ? 'margem operacional atribuída'
                                    : incrementalMarginLabel(
                                        item.incrementalStatus,
                                        preview.economics.policy
                                      )}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                {currency(item.currentPriceCents)}
                              </td>
                              {profitabilityThresholdColumns.map(
                                (threshold) => (
                                  <td
                                    key={threshold.basisPoints}
                                    className="px-3 py-3"
                                  >
                                    {currency(
                                      item.priceMinimumCents[
                                        threshold.basisPoints
                                      ]
                                    )}
                                  </td>
                                )
                              )}
                              <td className="px-3 py-3">
                                {currency(
                                  item.maximumSupportedCostAtCurrentPriceCents
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {percent(
                                  item.postPromotionMarginBasisPoints
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {percent(
                                  item.effect?.marginBeforeBasisPoints
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {percent(
                                  item.effect?.marginAfterBasisPoints
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {item.effect?.variationBasisPoints == null
                                  ? '—'
                                  : `${item.effect.variationBasisPoints >= 0 ? '+' : ''}${(
                                      item.effect.variationBasisPoints / 100
                                    ).toLocaleString('pt-BR', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })} p.p.`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {preview.economics.capacity ? (
                      <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs sm:grid-cols-4">
                        <span>
                          Receita dos blocos
                          <strong className="mt-1 block text-slate-900">
                            {currency(preview.economics.capacity.revenueCents)}
                          </strong>
                        </span>
                        <span>
                          Custo incremental
                          <strong className="mt-1 block text-slate-900">
                            {currency(
                              preview.economics.capacity.incrementalCostCents
                            )}
                          </strong>
                        </span>
                        <span>
                          Margem dos blocos
                          <strong className="mt-1 block text-slate-900">
                            {preview.economics.capacity.revenueCents === 0
                              ? 'Sem blocos'
                              : percent(
                                  preview.economics.capacity.marginBasisPoints
                                )}
                          </strong>
                          {preview.economics.capacity.revenueCents > 0 ? (
                            <small className="mt-1 block font-normal text-slate-500">
                              {incrementalMarginLabel(
                                preview.economics.capacity.incrementalStatus,
                                preview.economics.policy,
                                'capacity'
                              )}
                            </small>
                          ) : null}
                        </span>
                        <span>
                          Preço-alvo de margem
                          <strong className="mt-1 block text-slate-900">
                            {currency(
                              preview.economics.capacity.minimumPriceCents
                            )}
                          </strong>
                        </span>
                      </div>
                    ) : null}
                    {preview.economics.expansions.length > 0 ? (
                      <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
                        <table className="w-full min-w-[720px] text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-medium">Excedente</th>
                              <th className="px-3 py-2 font-medium">Driver</th>
                              <th className="px-3 py-2 font-medium">Franquia</th>
                              <th className="px-3 py-2 font-medium">Blocos</th>
                              <th className="px-3 py-2 font-medium">Receita</th>
                              <th className="px-3 py-2 font-medium">
                                Margem · referência{' '}
                                {formatSalesBasisPointsPercent(
                                  preview.economics.policy
                                    .capacityMinimumIncrementalMarginBasisPoints
                                )}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {preview.economics.expansions.map((expansion) => (
                              <tr key={expansion.itemKey}>
                                <td className="px-3 py-2 text-slate-700">
                                  {expansion.publicName}
                                </td>
                                <td className="px-3 py-2">
                                  {expansion.driverValue ?? 'Dados insuficientes'}
                                </td>
                                <td className="px-3 py-2">
                                  {expansion.includedUnits ??
                                    'Dados insuficientes'}
                                </td>
                                <td className="px-3 py-2">
                                  {expansion.blocks ??
                                    'Dados insuficientes'}
                                </td>
                                <td className="px-3 py-2">
                                  {currency(
                                    expansion.additionalRevenueCents
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {percent(
                                    expansion.incrementalMarginBasisPoints
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        onClick={() =>
                          setShowEconomySimulator((current) => !current)
                        }
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700"
                        aria-expanded={showEconomySimulator}
                      >
                        <GitCompareArrows size={15} />
                        {showEconomySimulator
                          ? 'Fechar simulador de escala'
                          : 'Simular escala e módulos'}
                      </button>
                      {showEconomySimulator ? (
                        <div className="mt-3 rounded-xl border border-slate-200 p-3">
                          <div className="flex flex-wrap gap-3">
                            <label className="text-xs font-medium text-slate-600">
                              Pacientes simulados
                              <input
                                type="number"
                                min={1}
                                max={100000}
                                value={economySimulatorPatients}
                                list="economy-simulator-patient-presets"
                                onChange={(event) =>
                                  setEconomySimulatorPatients(
                                    Math.max(1, Math.min(100000, Math.trunc(Number(event.target.value) || 1)))
                                  )
                                }
                                className="ml-2 min-h-9 w-28 rounded-lg border border-slate-200 bg-white px-2 font-normal"
                              />
                              <datalist id="economy-simulator-patient-presets">
                                {ECONOMY_SIMULATOR_PATIENT_PRESETS.map((value) => (
                                  <option key={value} value={value} />
                                ))}
                              </datalist>
                            </label>
                            <span className="inline-flex min-h-9 items-center rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-800">
                              Uso intensivo
                            </span>
                          </div>
                          {economySimulatorRows.length > 0 ? (
                            <div className="mt-3 max-h-72 overflow-auto">
                              <table className="w-full min-w-[640px] text-left text-xs">
                                <thead className="sticky top-0 bg-white text-slate-500">
                                  <tr>
                                    <th className="py-2 font-medium">Composição</th>
                                    <th className="py-2 font-medium">Receita</th>
                                    <th className="py-2 font-medium">Custo</th>
                                    <th className="py-2 font-medium">Margem</th>
                                    <th className="py-2 font-medium">Política</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {economySimulatorRows.map((row) => (
                                    <tr key={row.key}>
                                      <td className="py-2 pr-3 text-slate-700">
                                        {row.label}
                                      </td>
                                      <td className="py-2 pr-3">
                                        {currency(row.revenueCents)}
                                      </td>
                                      <td className="py-2 pr-3">
                                        {currency(row.costCents)}
                                      </td>
                                      <td className="py-2 pr-3">
                                        {percent(row.marginBasisPoints)}
                                      </td>
                                      <td className="py-2">
                                        {row.canSend ? 'Aprovável' : 'Revisar'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="mt-3 text-xs leading-5 text-slate-500">
                              Informe preço e limite personalizados válidos para
                              simular todas as combinações sem inventar valores.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}

              {preview?.commercialPhases?.length ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div>
                    <p className="text-xs font-medium text-violet-700">Evolução da cobrança</p>
                    <h2 className="mt-1 text-base font-semibold text-slate-900">Fases da proposta</h2>
                    <p className="mt-1 text-sm font-normal text-slate-500">
                      Cada mudança de benefício gera uma fase própria. O módulo continua ativo e retorna ao valor congelado ao final do desconto.
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {preview.commercialPhases.map((phase) => (
                      <article key={`${phase.phaseNumber}:${phase.startsAt}`} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">Fase {phase.phaseNumber}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {formatSalesCommercialDate(phase.startsAt)} — {phase.endsAt ? formatSalesCommercialDate(phase.endsAt) : 'condição permanente'}
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-slate-900">{currency(phase.invoiceAmountCents)}</p>
                        </div>
                        <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                          {phase.lines.map((line) => (
                            <div key={line.itemKey} className="flex justify-between gap-3">
                              <span>{line.publicName}</span>
                              <span className="shrink-0">{currency(line.activePriceCents)}{line.discount ? ` · benefício de ${currency(line.discountCents)}` : ''}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-xs">
                          <span>Receita<br /><strong>{currency(phase.recurringRevenueCents)}</strong></span>
                          <span>EBITDA atribuído<br /><strong>{currency(phase.ebitdaCents)}</strong></span>
                          <span>Margem<br /><strong>{percent(phase.marginBasisPoints)}</strong></span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {publicPreviewOffer ? (
                <section
                  aria-label="Prévia da proposta pública"
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                >
                  <div className="border-b border-slate-100 pb-4">
                    <p className="text-xs font-medium text-violet-700">
                      Prévia pública
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-900">
                      O que o lead verá
                    </h2>
                    <p className="mt-1 text-sm font-normal text-slate-500">
                      Esta prévia reutiliza o mesmo componente da página
                      pública e não inclui custos, margens ou justificativas.
                    </p>
                  </div>
                  <ModularOfferDetails offer={publicPreviewOffer} />
                </section>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Cenários salvos
                    </h2>
                    <p className="mt-1 text-sm font-normal text-slate-500">
                      Compare até três snapshots sem recalcular o histórico.
                    </p>
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {simulations.filter((item) => item.status !== 'archived').length}{' '}
                    ativos
                  </span>
                </div>
                {simulations.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                    Salve a primeira composição para iniciar o histórico.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {simulations.map((simulation) => (
                      <article
                        key={simulation.id}
                        className={`rounded-xl border p-3 ${
                          simulation.status === 'archived'
                            ? 'border-slate-200 bg-slate-50 opacity-70'
                            : selectedSimulationId === simulation.id
                              ? 'border-violet-300 bg-violet-50'
                              : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            {editingScenarioId === simulation.id ? (
                              <div className="flex gap-2">
                                <input
                                  autoFocus
                                  value={editingScenarioName}
                                  maxLength={120}
                                  onChange={(event) =>
                                    setEditingScenarioName(event.target.value)
                                  }
                                  className="min-h-10 rounded-xl border border-violet-300 px-3 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    void renameSimulation(simulation.id)
                                  }
                                  className="min-h-10 rounded-xl bg-violet-600 px-3 text-xs font-medium text-white"
                                >
                                  Salvar
                                </button>
                              </div>
                            ) : (
                              <p className="text-sm font-medium text-slate-900">
                                {simulation.scenario_name || 'Cenário modular'}
                              </p>
                            )}
                            <p className="mt-1 text-xs text-slate-500">
                              {currency(
                                simulation.results_snapshot
                                  ?.promotionalRecurringRevenueCents
                              )}
                              /mês ·{' '}
                              {simulation.results_snapshot?.input
                                ?.patientQuantity || 0}{' '}
                              pacientes ·{' '}
                              {new Date(
                                simulation.created_at
                              ).toLocaleString('pt-BR')}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              aria-pressed={comparisonIds.includes(
                                simulation.id
                              )}
                              onClick={() => toggleComparison(simulation.id)}
                              className="flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600"
                            >
                              <GitCompareArrows size={14} /> Comparar
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateSimulation(simulation)}
                              className="flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600"
                            >
                              <Copy size={14} /> Duplicar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingScenarioId(simulation.id);
                                setEditingScenarioName(
                                  simulation.scenario_name || 'Cenário modular'
                                );
                              }}
                              className="flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600"
                            >
                              <Pencil size={14} /> Renomear
                            </button>
                            {simulation.status !== 'archived' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void selectSimulation(simulation)
                                  }
                                  disabled={Boolean(busy)}
                                  className="flex min-h-9 items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 text-xs font-medium text-violet-700 disabled:opacity-50"
                                >
                                  <PackageCheck size={14} /> Selecionar
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void archiveSimulation(simulation.id)
                                  }
                                  disabled={Boolean(busy)}
                                  className="flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 disabled:opacity-50"
                                >
                                  <Archive size={14} /> Arquivar
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {comparedSimulations.length > 0 ? (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-[1080px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Cenário</th>
                          <th className="px-3 py-2 font-medium">Funcionalidades e limites</th>
                          <th className="px-3 py-2 font-medium">Total</th>
                          <th className="px-3 py-2 font-medium">Desconto</th>
                          <th className="px-3 py-2 font-medium">Custos</th>
                          <th className="px-3 py-2 font-medium">
                            EBITDA atribuído
                          </th>
                          <th className="px-3 py-2 font-medium">Margem</th>
                          <th className="px-3 py-2 font-medium">Lucro</th>
                          <th className="px-3 py-2 font-medium">Diferença</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {comparedSimulations.map((simulation, index) => {
                          const result = simulation.results_snapshot;
                          const baseline =
                            comparedSimulations[0]?.results_snapshot
                              ?.promotionalRecurringRevenueCents || 0;
                          const difference =
                            result.promotionalRecurringRevenueCents - baseline;
                          return (
                            <tr key={simulation.id}>
                              <td className="px-3 py-3 font-medium text-slate-800">
                                {simulation.scenario_name}
                              </td>
                              <td className="max-w-[260px] px-3 py-3 text-slate-600">
                                {result.lines
                                  .map(
                                    (line) =>
                                      `${line.publicName}${
                                        line.limitQuantity
                                          ? ` (até ${line.limitQuantity})`
                                          : ''
                                      }`
                                  )
                                  .join(' · ')}
                              </td>
                              <td className="px-3 py-3">
                                {currency(
                                  result.promotionalRecurringRevenueCents
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {currency(
                                  result.itemDiscountCents +
                                    result.globalDiscountCents
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {currency(
                                  result.promotional.totalEstimatedCostCents
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {currency(result.promotional.ebitdaCents)}
                              </td>
                              <td className="px-3 py-3">
                                {percent(
                                  result.promotional.ebitdaMarginBasisPoints
                                )}
                              </td>
                              <td className="px-3 py-3">
                                {currency(result.promotional.netIncomeCents)}
                              </td>
                              <td className="px-3 py-3 font-medium">
                                {index === 0
                                  ? 'Base'
                                  : `${difference >= 0 ? '+' : ''}${currency(
                                      difference
                                    )}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            </div>

            <aside className="min-w-0 space-y-4 lg:sticky lg:top-[104px] lg:self-start">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">
                    Resumo financeiro da proposta
                  </h2>
                  {preview ? (
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${ratingStyle[preview.rating]}`}
                    >
                      {ratingLabel[preview.rating]}
                    </span>
                  ) : null}
                </div>
                {preview ? (
                  <>
                    <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
                      <p className="text-xs font-normal text-slate-300">
                        Valor mensal cobrado do cliente
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {currency(
                          preview.commercialPricing.enabled &&
                            preview.commercialPricing.missingPriceItemKeys
                              .length > 0
                            ? null
                            : preview.promotionalRecurringRevenueCents
                        )}
                      </p>
                      {input.globalDiscountBasisPoints > 0 ? (
                        <p className="mt-1 text-xs font-normal text-slate-300">
                          Depois: {currency(preview.postPromotionRecurringRevenueCents)}
                          /mês
                        </p>
                      ) : null}
                    </div>
                    {promotionalMoneyFlow ? (
                      <>
                        <dl className="mt-4 grid grid-cols-2 gap-3">
                          {[
                            {
                              label: 'Receita bruta mensal',
                              value: currency(promotionalMoneyFlow.revenueCents),
                              help:
                                'Valor mensal cobrado do cliente antes de taxas, impostos, perdas e custos.'
                            },
                            {
                              label: 'Impostos estimados',
                              value: currency(promotionalMoneyFlow.totalTaxCents),
                              help:
                                'Soma dos impostos sobre faturamento e do imposto sobre o lucro estimado.'
                            },
                            {
                              label: 'Stripe e perdas estimadas',
                              value: currency(
                                promotionalMoneyFlow.paymentFeesCents === null ||
                                  promotionalMoneyFlow.lossProvisionCents === null
                                  ? null
                                  : promotionalMoneyFlow.paymentFeesCents +
                                      promotionalMoneyFlow.lossProvisionCents
                              ),
                              help:
                                'Tarifas do meio de pagamento, inadimplência, estornos e chargebacks.'
                            },
                            {
                              label: 'Custos diretos do serviço',
                              value: currency(
                                promotionalMoneyFlow.directCostsTotalCents
                              ),
                              help:
                                'Custos dos módulos, pacientes, uso, armazenamento, tráfego, notificações, suporte e operação direta.'
                            },
                            {
                              label: 'Margem de contribuição',
                              value: `${currency(
                                promotionalMoneyFlow.contributionMarginCents
                              )} · ${percent(
                                preview.promotional.contributionMarginBasisPoints
                              )}`,
                              help:
                                'O que sobra depois das deduções da receita e dos custos diretos. Esse valor ajuda a pagar a estrutura da Verto.'
                            },
                            {
                              label: 'Estrutura operacional atribuída',
                              value: currency(
                                promotionalMoneyFlow.sharedOperatingCostsTotalCents
                              ),
                              help:
                                'Parcela de plataforma, suporte-base, operação e custos compartilhados atribuída a esta proposta. Não é o custo marginal de um paciente.'
                            },
                            {
                              label: 'EBITDA atribuído',
                              value: `${currency(
                                promotionalMoneyFlow.ebitdaCents
                              )} · ${percent(
                                preview.promotional.ebitdaMarginBasisPoints
                              )}`,
                              help:
                                'Resultado operacional estimado depois dos custos diretos e da estrutura atribuída, antes de depreciação, despesas financeiras e imposto sobre o lucro.'
                            },
                            {
                              label: 'Despesas após o EBITDA',
                              value: currency(
                                promotionalMoneyFlow.belowEbitdaExpensesTotalCents ===
                                  null ||
                                  promotionalMoneyFlow.profitTaxCents === null
                                  ? null
                                  : promotionalMoneyFlow.belowEbitdaExpensesTotalCents +
                                      promotionalMoneyFlow.profitTaxCents
                              ),
                              help:
                                'Depreciação e amortização, despesas financeiras, outras despesas abaixo do EBITDA e imposto sobre o lucro.'
                            },
                            {
                              label: 'Lucro líquido estimado',
                              value: `${currency(
                                promotionalMoneyFlow.netIncomeCents
                              )} · ${percent(
                                preview.promotional.netMarginBasisPoints
                              )}`,
                              help:
                                'Resultado estimado depois de todos os custos e impostos modelados. Não equivale automaticamente a dinheiro disponível para retirada.'
                            }
                          ].map(({ label, value, help }) => (
                            <div key={label} className="rounded-xl bg-slate-50 p-3">
                              <dt
                                className="flex items-start gap-1.5 text-xs font-normal text-slate-500"
                                title={help}
                              >
                                <span>{label}</span>
                                <Info
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400"
                                  aria-label={help}
                                />
                              </dt>
                              <dd className="mt-1 text-sm font-semibold text-slate-900">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>

                        <details
                          open
                          className="mt-4 rounded-xl border border-slate-200 bg-white"
                        >
                          <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-slate-900">
                            Para onde vai a mensalidade
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              Acompanhe o dinheiro desde a cobrança até o lucro líquido estimado.
                            </span>
                          </summary>
                          <div className="space-y-4 border-t border-slate-100 p-3 text-xs">
                            <div className="rounded-lg bg-slate-950 px-3 py-3 text-white">
                              <div className="flex items-center justify-between gap-3">
                                <span>Receita bruta mensal</span>
                                <strong>{currency(promotionalMoneyFlow.revenueCents)}</strong>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                                Valor cobrado do cliente antes de qualquer dedução.
                              </p>
                            </div>

                            <section>
                              <p className="font-semibold text-slate-800">
                                1. Taxas, impostos e perdas sobre a receita
                              </p>
                              <div className="mt-2 space-y-1.5">
                                {promotionalMoneyFlow.revenueDeductions.map((item) => (
                                  <div
                                    key={item.key}
                                    className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-2"
                                    title={item.explanation}
                                  >
                                    <span className="font-normal text-slate-600">
                                      {item.label}
                                    </span>
                                    <strong className="shrink-0 text-slate-900">
                                      − {currency(item.amountCents)}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-2 font-medium text-slate-800">
                                <span>Receita após essas deduções</span>
                                <strong>
                                  {currency(
                                    promotionalMoneyFlow.revenueAfterDeductionsCents
                                  )}
                                </strong>
                              </div>
                            </section>

                            <section>
                              <p className="font-semibold text-slate-800">
                                2. Custos diretos para entregar o serviço
                              </p>
                              <div className="mt-2 space-y-1.5">
                                {promotionalMoneyFlow.directCosts.map((item) => (
                                  <div
                                    key={item.key}
                                    className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-2"
                                    title={item.explanation}
                                  >
                                    <span className="font-normal text-slate-600">
                                      {item.label}
                                    </span>
                                    <strong className="shrink-0 text-slate-900">
                                      − {currency(item.amountCents)}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-2.5 py-2 font-medium text-emerald-900">
                                <span>Margem de contribuição</span>
                                <strong>
                                  {currency(promotionalMoneyFlow.contributionMarginCents)} ·{' '}
                                  {percent(
                                    preview.promotional
                                      .contributionMarginBasisPoints
                                  )}
                                </strong>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                É o valor que sobra para pagar a estrutura da Verto e gerar resultado.
                              </p>
                            </section>

                            <section>
                              <p className="font-semibold text-slate-800">
                                3. Estrutura da Verto atribuída à proposta
                              </p>
                              <div className="mt-2 space-y-1.5">
                                {promotionalMoneyFlow.sharedOperatingCosts.map((item) => (
                                  <div
                                    key={item.key}
                                    className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-2"
                                    title={item.explanation}
                                  >
                                    <span className="font-normal text-slate-600">
                                      {item.label}
                                    </span>
                                    <strong className="shrink-0 text-slate-900">
                                      − {currency(item.amountCents)}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-violet-50 px-2.5 py-2 font-medium text-violet-900">
                                <span>EBITDA atribuído</span>
                                <strong>
                                  {currency(promotionalMoneyFlow.ebitdaCents)} ·{' '}
                                  {percent(preview.promotional.ebitdaMarginBasisPoints)}
                                </strong>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                Resultado operacional estimado antes das despesas contábeis e financeiras abaixo.
                              </p>
                            </section>

                            <section>
                              <p className="font-semibold text-slate-800">
                                4. Despesas depois do EBITDA
                              </p>
                              <div className="mt-2 space-y-1.5">
                                {promotionalMoneyFlow.belowEbitdaExpenses.map((item) => (
                                  <div
                                    key={item.key}
                                    className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-2"
                                    title={item.explanation}
                                  >
                                    <span className="font-normal text-slate-600">
                                      {item.label}
                                    </span>
                                    <strong className="shrink-0 text-slate-900">
                                      − {currency(item.amountCents)}
                                    </strong>
                                  </div>
                                ))}
                                <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-2">
                                  <span className="font-normal text-slate-600">
                                    Imposto sobre o lucro estimado
                                  </span>
                                  <strong className="shrink-0 text-slate-900">
                                    − {currency(promotionalMoneyFlow.profitTaxCents)}
                                  </strong>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-slate-900 px-2.5 py-2 font-semibold text-white">
                                <span>Lucro líquido estimado</span>
                                <strong>
                                  {currency(promotionalMoneyFlow.netIncomeCents)} ·{' '}
                                  {percent(preview.promotional.netMarginBasisPoints)}
                                </strong>
                              </div>
                            </section>

                            <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                              <p className="font-semibold">
                                Quanto pode ir para retirada dos sócios?
                              </p>
                              <p className="mt-1 leading-relaxed">
                                <strong>Não calculado.</strong>{' '}
                                {promotionalMoneyFlow.distributableCashReason}
                              </p>
                            </section>

                            {!promotionalMoneyFlow.reconciled ? (
                              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
                                O detalhamento não reconciliou com o snapshot. Não use esta composição para decisão até revisar as premissas.
                              </div>
                            ) : null}
                          </div>
                        </details>

                        <details className="mt-3 rounded-xl border border-slate-200 bg-white">
                          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700">
                            Custos e receitas por componente contratado
                          </summary>
                          <div className="space-y-2 border-t border-slate-100 p-3 text-xs">
                            {promotionalMoneyFlow.moduleCosts.map((item) => (
                              <div
                                key={item.itemKey}
                                className="rounded-lg bg-slate-50 px-3 py-2"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-slate-800">
                                      {item.publicName}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-slate-500">
                                      Fonte do custo: {costSourceLabel[item.costSource] || item.costSource}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-medium text-slate-900">
                                      Receita {currency(item.revenueCents)}
                                    </p>
                                    <p className="mt-0.5 text-slate-600">
                                      Custo direto {currency(item.directCostCents)}
                                    </p>
                                  </div>
                                </div>
                                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                  {item.costSourceDetail}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>

                        <details className="mt-3 rounded-xl border border-slate-200 bg-white">
                          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700">
                            Indicadores técnicos de preço e margem
                          </summary>
                          <dl className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 text-xs">
                            {[
                              [
                                'Preço de equilíbrio EBITDA',
                                currency(preview.breakEvenRecurringRevenueCents)
                              ],
                              [
                                `Preço-alvo para ${percent(
                                  preview.targetEbitdaMarginBasisPoints
                                )}`,
                                currency(preview.targetRecurringRevenueCents)
                              ],
                              [
                                'Diferença mensal para o alvo',
                                currency(preview.targetGapCents)
                              ],
                              [
                                'Diferença anual para o alvo',
                                currency(preview.targetGapAnnualCents)
                              ],
                              [
                                'Markup sobre custos até o EBITDA',
                                markup(
                                  preview.markupMultiplier,
                                  preview.markupOnEbitdaCostBasisPoints
                                )
                              ],
                              [
                                'Folga para desconto até a meta',
                                percent(
                                  preview.maximumRecommendedDiscountBasisPoints
                                )
                              ]
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-lg bg-slate-50 px-2.5 py-2">
                                <dt className="font-normal text-slate-500">
                                  {label}
                                </dt>
                                <dd className="mt-0.5 font-medium text-slate-900">
                                  {value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      </>
                    ) : null}
                    {preview.rating === 'attention' ||
                    preview.rating === 'not_recommended' ? (
                      <div
                        className={`mt-4 rounded-xl border p-3 text-xs ${
                          preview.rating === 'not_recommended'
                            ? 'border-rose-200 bg-rose-50 text-rose-800'
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                        }`}
                      >
                        <p className="font-semibold">
                          {preview.rating === 'not_recommended'
                            ? 'O EBITDA atribuído está negativo.'
                            : 'A proposta está abaixo da margem-alvo.'}
                        </p>
                        <p className="mt-1 leading-relaxed">
                          Margem atual:{' '}
                          {percent(preview.promotional.ebitdaMarginBasisPoints)}.
                          Meta:{' '}
                          {percent(preview.targetEbitdaMarginBasisPoints)}.
                          Diferença: {currency(preview.targetGapCents)} por mês
                          e {currency(preview.targetGapAnnualCents)} por ano. A
                          proposta pode continuar; este aviso não bloqueia o
                          orçamento nem o Stripe.
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-medium text-slate-700">
                        Dados do cenário
                      </p>
                      <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        {[
                          ['Pacientes atuais', input.patientQuantity],
                          [
                            'Previsão em 12 meses',
                            input.expectedPatientQuantity12Months
                          ],
                          [
                            'Capacidade-base',
                            preview.basePackage.capacity
                              ?.baseLimitPatients ??
                              preview.basePackage.limitQuantity
                          ],
                          [
                            'Capacidade faturada',
                            preview.basePackage.limitQuantity
                          ],
                          [
                            'Módulos selecionados',
                            preview.lines.filter(
                              (line) => line.pricingMode !== 'one_time'
                            ).length
                          ],
                          [
                            'Valor por paciente nesta fase',
                            currency(
                              currentCapacityBlockPhase
                                ?.effectivePricePerPatientCents ??
                                preview.commercialPricing
                                  .totalProposedPricePerPatientCents
                            )
                          ],
                          [
                            'Mensalidade nesta fase',
                            currency(
                              currentCapacityBlockPhase
                                ?.contractedMonthlyRevenueCents ??
                                preview.promotionalRecurringRevenueCents
                            )
                          ],
                          [
                            'Preço do bloco nesta fase',
                            currency(
                              currentCapacityBlockPhase?.blockPriceCents
                            )
                          ],
                          [
                            'Valor por paciente posterior',
                            currency(
                              postBenefitCapacityBlockPhase
                                ?.effectivePricePerPatientCents
                            )
                          ],
                          [
                            'Mensalidade posterior',
                            currency(
                              postBenefitCapacityBlockPhase
                                ?.contractedMonthlyRevenueCents ??
                                preview.postPromotionRecurringRevenueCents
                            )
                          ],
                          [
                            'Preço do bloco posterior',
                            currency(
                              postBenefitCapacityBlockPhase?.blockPriceCents
                            )
                          ]
                        ].map(([label, value]) => (
                          <div
                            key={String(label)}
                            className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-2.5 py-2"
                          >
                            <dt className="font-normal text-slate-500">
                              {label}
                            </dt>
                            <dd className="text-right font-medium text-slate-800">
                              {value ?? 'Dados insuficientes'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    <details className="mt-3 rounded-xl border border-slate-200 bg-white">
                      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700">
                        Resultado em 12 meses e próxima expansão
                      </summary>
                      <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 p-3 text-xs">
                        {[
                          [
                            'Receita em 12 meses',
                            currency(
                              preview.horizons['12'].recurringRevenueCents +
                                preview.horizons['12'].oneTimeRevenueCents
                            )
                          ],
                          [
                            'Custo em 12 meses',
                            preview.horizons['12'].ebitdaCents === null
                              ? 'Dados insuficientes'
                              : currency(
                                  preview.horizons['12']
                                    .recurringRevenueCents +
                                    preview.horizons['12']
                                      .oneTimeRevenueCents -
                                    preview.horizons['12'].ebitdaCents
                                )
                          ],
                          [
                            'EBITDA atribuído em 12 meses',
                            currency(preview.horizons['12'].ebitdaCents)
                          ],
                          [
                            'Valor subsidiado',
                            currency(
                              preview.horizons['12'].discountImpactCents
                            )
                          ],
                          [
                            'Preço do próximo bloco',
                            currency(
                              preview.commercialPricing.nextBlockPriceCents
                            )
                          ],
                          [
                            'Custo marginal do próximo bloco',
                            currency(
                              preview.commercialPricing
                                .nextBlockMarginalCostCents
                            )
                          ],
                          [
                            'Contribuição do próximo bloco',
                            currency(
                              preview.commercialPricing
                                .nextBlockContributionCents
                            )
                          ],
                          [
                            'Margem incremental do próximo bloco',
                            percent(
                              preview.commercialPricing
                                .nextBlockMarginBasisPoints
                            )
                          ],
                          [
                            'Preço-alvo do próximo bloco',
                            currency(
                              currentCapacityBlockPhase
                                ?.blockMinimumPriceCents
                            )
                          ]
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <dt className="font-normal text-slate-500">
                              {label}
                            </dt>
                            <dd className="mt-0.5 font-medium text-slate-800">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    {preview.missingCosts.length > 0 ? (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        <p className="font-medium">Custos ainda indisponíveis</p>
                        <p className="mt-1 font-normal">
                          {preview.missingCosts.join(', ')}. Valores ausentes não
                          são tratados como zero.
                        </p>
                      </div>
                    ) : null}
                    {preview.commercialPricing.missingPriceItemKeys.length >
                    0 ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        <p className="font-medium">
                          Preço por paciente pendente
                        </p>
                        <p className="mt-1 font-normal">
                          Informe o preço dos módulos:{' '}
                          {preview.commercialPricing.missingPriceItemKeys
                            .map(
                              (itemKey) =>
                                catalog.items.find(
                                  (item) => item.itemKey === itemKey
                                )?.publicName || itemKey
                            )
                            .join(', ')}
                          . Os custos conhecidos continuam visíveis, mas o
                          cenário não pode ser salvo.
                        </p>
                      </div>
                    ) : null}
                    {preview.commercialPricing.monthlyTotalMismatches.length >
                    0 ? (
                      <div
                        className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"
                        role="alert"
                      >
                        <p className="font-medium">
                          Mensalidade incompatível com o preço por paciente
                        </p>
                        <p className="mt-1 font-normal">
                          O valor informado foi preservado. Aceite o valor
                          representável sugerido ou edite diretamente o preço
                          por paciente antes de salvar.
                        </p>
                        <div className="mt-2 space-y-2">
                          {preview.commercialPricing.monthlyTotalMismatches.map(
                            (mismatch) => (
                              <div
                                key={mismatch.itemKey}
                                className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <span className="font-normal">
                                  {mismatch.publicName}:{' '}
                                  {currency(
                                    mismatch.requestedMonthlyRevenueCents
                                  )}{' '}
                                  não fecha em{' '}
                                  {preview.commercialPricing
                                    .contractedCapacityPatients || 0}{' '}
                                  pacientes. Valor mais próximo:{' '}
                                  <strong className="font-medium">
                                    {currency(
                                      mismatch.nearestRepresentableMonthlyRevenueCents
                                    )}
                                  </strong>{' '}
                                  ({mismatch.adjustmentCents >= 0 ? '+' : ''}
                                  {currency(mismatch.adjustmentCents)}).
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateLine(mismatch.itemKey, {
                                      pricingEditMode: 'monthly_total',
                                      proposedPricePerPatientCents:
                                        mismatch.proposedPricePerPatientCents,
                                      customRecurringAmountCents:
                                        mismatch.nearestRepresentableMonthlyRevenueCents
                                    })
                                  }
                                  className="min-h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 font-medium text-amber-900 hover:bg-amber-100"
                                >
                                  Usar total ajustado
                                </button>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ) : null}
                    {preview.missingDrivers.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        <p className="font-medium">Dados insuficientes</p>
                        <p className="mt-1 font-normal">
                          {preview.missingDrivers
                            .map(
                              (missing) =>
                                `${missing.itemName}: ${missing.driver}`
                            )
                            .join(' · ')}
                        </p>
                      </div>
                    ) : null}
                    {preview.possibleDuplicateCosts.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900">
                        <p className="font-medium">Possível custo duplicado</p>
                        <p className="mt-1 font-normal">
                          {preview.possibleDuplicateCosts
                            .map((duplicate) => duplicate.label)
                            .join(', ')}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Complete faixas e valores personalizados para calcular.
                  </p>
                )}
              </section>

              {preview ? (
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Resultado interno por módulo
                    </h2>
                  </div>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-[1380px] w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Item</th>
                          <th className="px-3 py-2 font-medium">Preço/paciente</th>
                          <th className="px-3 py-2 font-medium">Custo/paciente</th>
                          <th className="px-3 py-2 font-medium">Margem contribuição</th>
                          <th className="px-3 py-2 font-medium">Confiança</th>
                          <th className="px-3 py-2 font-medium">Receita</th>
                          <th className="px-3 py-2 font-medium">Fixo direto</th>
                          <th className="px-3 py-2 font-medium">Por paciente</th>
                          <th className="px-3 py-2 font-medium">Uso</th>
                          <th className="px-3 py-2 font-medium">Armazenamento</th>
                          <th className="px-3 py-2 font-medium">Egress</th>
                          <th className="px-3 py-2 font-medium">Notificações</th>
                          <th className="px-3 py-2 font-medium">Outros variáveis</th>
                          <th className="px-3 py-2 font-medium">Suporte</th>
                          <th className="px-3 py-2 font-medium">Operacional</th>
                          <th className="px-3 py-2 font-medium">Taxas e tributos</th>
                          <th className="px-3 py-2 font-medium">Compartilhado alocado</th>
                          <th className="px-3 py-2 font-medium">Contribuição</th>
                          <th className="px-3 py-2 font-medium">
                            EBITDA atribuído
                          </th>
                          <th className="px-3 py-2 font-medium">Lucro</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.lines
                          .filter(
                            (line) =>
                              line.itemKey !== 'platform_foundation' &&
                              line.itemKey !== 'onboarding'
                          )
                          .map((line) => (
                          <tr key={line.lineKey}>
                            <td className="px-3 py-3 font-medium text-slate-800">
                              {line.publicName}
                            </td>
                            <td className="px-3 py-3">
                              {currency(
                                line.commercialPricing
                                  .proposedPricePerPatientCents
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {currency(
                                line.commercialPricing
                                  .effectiveCostPerPatientCents
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {percent(
                                line.commercialPricing
                                  .contributionMarginBasisPoints
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {line.commercialPricing.confidenceLevel ===
                              'unavailable'
                                ? 'Dados insuficientes'
                                : line.commercialPricing.confidenceLevel ===
                                    'high'
                                  ? 'Alta'
                                  : line.commercialPricing.confidenceLevel ===
                                      'medium'
                                    ? 'Média'
                                    : 'Baixa'}
                            </td>
                            <td className="px-3 py-3">
                              {currency(
                                line.commercialPricing.enabled &&
                                  line.commercialPricing
                                    .derivedMonthlyRevenueCents === null
                                  ? null
                                  : line.promotional.netRevenueCents
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.fixedCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.patientCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.usageCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.storageCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.egressCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.notificationCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.otherVariableCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.supportCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.directCostBreakdown.operationalCostCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(
                                line.promotional
                                  .transactionAndTaxCostAllocatedCents
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {currency(
                                line.promotional.sharedPlatformCostAllocatedCents
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.promotional.contributionMarginCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.promotional.ebitdaCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.promotional.netIncomeCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
                >
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p
                  role="status"
                  className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
                >
                  {notice}
                </p>
              ) : null}
              {preparedOffer?.publicUrl ? (
                <a
                  href={preparedOffer.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-800"
                >
                  <ExternalLink size={16} /> Abrir proposta pública
                </a>
              ) : null}
              {activeOfferId ? (
                <section className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-violet-700">Cobrança assistida</p>
                      <h2 className="mt-1 text-sm font-semibold text-slate-900">Link de pagamento</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Disponível somente após o aceite. Valores são reconstruídos do snapshot pelo backend e a validação começa em ambiente de teste.
                      </p>
                    </div>
                    {checkoutLink ? (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${checkoutLink.environment === 'test' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
                        {checkoutLink.environment === 'test' ? 'Teste' : 'Produção'} · {checkoutLink.status}
                      </span>
                    ) : null}
                  </div>
                  {checkoutLink ? (
                    <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
                      <span>Inicial: {currency(checkoutLink.initial_amount_cents)}</span>
                      <span>Promocional: {currency(checkoutLink.promotional_monthly_cents)}/mês</span>
                      <span>Futura: {currency(checkoutLink.future_monthly_cents)}/mês</span>
                      {checkoutLink.one_time_cents > 0 ? (
                        <span>Implantação: {currency(checkoutLink.one_time_cents)}</span>
                      ) : null}
                      <span>Criado em: {new Date(checkoutLink.created_at).toLocaleString('pt-BR')}</span>
                      <span>Expira em: {checkoutLink.expires_at ? new Date(checkoutLink.expires_at).toLocaleString('pt-BR') : 'sem data'}</span>
                      <span>Cliente: {lead?.clinicName || lead?.name || 'não informado'}</span>
                      <span>Última abertura: {checkoutLink.last_opened_at ? new Date(checkoutLink.last_opened_at).toLocaleString('pt-BR') : 'ainda não aberto'}</span>
                      <span>Pagamento: {checkoutLink.payment_completed_at ? `confirmado em ${new Date(checkoutLink.payment_completed_at).toLocaleString('pt-BR')}` : 'aguardando confirmação'}</span>
                      <span className="sm:col-span-2">Módulos: {(checkoutLink.checkout_plan_snapshot?.initialLineItems || []).map((item: any) => item.description).join(', ') || 'snapshot indisponível'}</span>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!offerAccepted ? (
                      <button type="button" onClick={() => void registerOfferAcceptance()} disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-medium text-violet-800 disabled:opacity-50">
                        <Check size={15} /> Registrar aceite comercial
                      </button>
                    ) : !checkoutLink || checkoutLink.status === 'expired' ? (
                      <button type="button" onClick={() => void generateCheckoutLink(Boolean(checkoutLink))} disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-medium text-white disabled:opacity-50">
                        {busy.startsWith('checkout-') ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                        {checkoutLink ? 'Gerar novo link' : 'Gerar link de pagamento'}
                      </button>
                    ) : checkoutLink.status === 'failed' ? (
                      <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
                        A assinatura já foi criada e a cobrança falhou. Regularize a fatura na Stripe; um novo Checkout não é gerado para evitar assinatura duplicada.
                      </p>
                    ) : (
                      <>
                        <button type="button" onClick={() => void copyCheckoutLink()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
                          <Copy size={15} /> Copiar link
                        </button>
                        <button type="button" onClick={() => void emailCheckoutLink()} disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 disabled:opacity-50">
                          <Mail size={15} /> Enviar por e-mail
                        </button>
                        <a href={checkoutLink.publicCheckoutUrl || checkoutLink.checkout_url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
                          <ExternalLink size={15} /> Abrir Checkout
                        </a>
                        <button type="button" onClick={() => void expireCheckoutLink()} disabled={Boolean(busy)} className="min-h-10 rounded-xl border border-rose-200 bg-white px-3 text-xs font-medium text-rose-700 disabled:opacity-50">
                          Expirar link
                        </button>
                        <button type="button" onClick={() => void generateCheckoutLink(true)} disabled={Boolean(busy)} className="min-h-10 rounded-xl border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 disabled:opacity-50">
                          Gerar novo link
                        </button>
                      </>
                    )}
                  </div>
                </section>
              ) : null}
            </aside>
          </div>
        )}

        {!loading && catalog && input ? (
          <footer className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={Boolean(busy)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => void saveSimulation()}
                disabled={
                  Boolean(busy) ||
                  profitabilityPolicyRequired ||
                  !preview ||
                  preview.commercialPricing.missingPriceItemKeys.length > 0 ||
                  Boolean(proposalReview?.technicalBlockingCodes.length) ||
                  (approveCommercialException &&
                    internalJustification.trim().length < 20)
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-300 bg-white px-4 text-sm font-medium text-violet-700 disabled:opacity-50"
              >
                {busy === 'save' ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                {approveCommercialException
                  ? 'Aprovar e salvar versão'
                  : 'Salvar cenário'}
              </button>
              <button
                type="button"
                onClick={() => void prepareOffer()}
                disabled={
                  Boolean(busy) ||
                  !selectedSimulation ||
                  !contractEmailValid ||
                  historicalOfferMissingContractIdentity ||
                  selectedSimulationTrialMismatch ||
                  (!selectedSimulation.offer &&
                    selectedSimulationRequiresVersionedProfitabilityPolicy &&
                    !selectedSimulationHasVersionedEconomics) ||
                  selectedSimulation.results_snapshot?.missingCosts?.length > 0 ||
                  Boolean(
                    selectedSimulationReview?.technicalBlockingCodes.length
                  ) ||
                  (
                    selectedSimulationReview?.requiresCommercialApproval ===
                      true &&
                    !selectedSimulationHasApproval
                  )
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {busy === 'offer' ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <PackageCheck size={16} />
                )}
                {selectedSimulation?.offer
                  ? 'Recuperar proposta pública'
                  : 'Gerar proposta pública'}
              </button>
            </div>
            <p className="mt-2 text-right text-xs font-normal text-slate-500">
              {!contractEmailValid
                  ? 'Confirme um e-mail válido do responsável pela contratação. Ele será congelado na proposta e usado no Checkout e na ativação.'
                  : historicalOfferMissingContractIdentity
                  ? 'Esta proposta histórica não possui identidade contratual. Duplique o cenário, salve e selecione a nova versão antes de gerar o novo link.'
                  : selectedSimulationTrialMismatch
                  ? 'O período de teste do rascunho difere do cenário congelado. Salve e selecione um novo cenário antes de gerar a proposta.'
                  : selectedSimulation &&
                    !selectedSimulation.offer &&
                    selectedSimulationRequiresVersionedProfitabilityPolicy &&
                    !selectedSimulationHasVersionedEconomics
                  ? SALES_PROFITABILITY_POLICY_REQUIRED_MESSAGE
                  : selectedSimulationReview?.requiresCommercialApproval &&
                      !selectedSimulationHasApproval
                    ? 'Salve uma cópia com aprovação excepcional antes de gerar a proposta pública.'
                    : profitabilityPolicyRequired
                      ? 'A composição personalizada atual exige política versionada; propostas padrão salvas permanecem disponíveis.'
                    : 'Gerar proposta pública não cria Checkout, cupom ou assinatura.'}
            </p>
          </footer>
        ) : null}
      </section>
    </div>
  );
};
