import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  GitCompareArrows,
  Layers3,
  Loader2,
  PackageCheck,
  Pencil,
  Save,
  Settings2,
  X
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import {
  calculateSalesModularProposal,
  recommendSalesPackageTier,
  type SalesModularLineSelection,
  type SalesModularProposalInput,
  type SalesModularProposalResult,
  type SalesPricingCatalogItem,
  type SalesPricingCatalogSnapshot,
  type SalesPricingCatalogTier
} from '../utils/salesModularProposal';
import type {
  SalesAssumptionSnapshot,
  SalesUsageProfile
} from '../utils/salesProfitability';
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
  results_snapshot: SalesModularProposalResult;
  profitability_rating: SalesModularProposalResult['rating'];
  internal_justification?: string | null;
  internal_notes?: string | null;
  public_notes?: string | null;
  created_at: string;
  offer?: {
    id: string;
    status: string;
    expires_at: string;
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
  baseTier: SalesPricingCatalogTier
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
  return {
    itemKey: item.itemKey,
    tierId: linkedTier?.id || null,
    quantity,
    itemDiscountBasisPoints: 0,
    customRecurringAmountCents: linkedTier?.isCustom ? 0 : null,
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
  healthy: 'Proposta saudável',
  attention: 'Proposta exige atenção',
  not_recommended: 'Proposta não recomendada',
  insufficient_data: 'Custos ainda incompletos'
};

const costSourceLabel: Record<string, string> = {
  actual: 'Real',
  calculated: 'Calculado',
  estimated: 'Estimado',
  manual: 'Manual',
  unavailable: 'Indisponível'
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
  const [internalNotes, setInternalNotes] = useState('');
  const [publicNotes, setPublicNotes] = useState('');
  const [selectedSimulationId, setSelectedSimulationId] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [editingScenarioId, setEditingScenarioId] = useState('');
  const [editingScenarioName, setEditingScenarioName] = useState('');
  const [preparedOffer, setPreparedOffer] = useState<any>(null);

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
          patientQuantity,
          expectedPatientQuantity12Months: patientQuantity,
          basePackageTierId: recommendedTier.id,
          lines: [selectionForItem(core, patientQuantity, recommendedTier)],
          globalDiscountBasisPoints: 0,
          discountDurationMonths: 0,
          offerValidityDays: 14,
          onboardingInstallments: 1,
          usageProfile: 'standard',
          internalNotes: '',
          publicNotes: ''
        };
        setCatalog(activeCatalog);
        setAssumptions(assumptionData.assumptionSet || null);
        setSimulations(simulationData.simulations || []);
        setSelectedSimulationId(
          simulationData.simulations?.find(
            (simulation: SavedModularSimulation) =>
              simulation.status === 'selected' ||
              simulation.status === 'offered'
          )?.id || ''
        );
        setInput(initialInput);
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

  const preview = useMemo(() => {
    if (!input || !catalog || !assumptions) return null;
    try {
      return calculateSalesModularProposal(input, catalog, assumptions);
    } catch {
      return null;
    }
  }, [assumptions, catalog, input]);

  const selectedSimulation = useMemo(
    () =>
      simulations.find(
        (simulation) => simulation.id === selectedSimulationId
      ) || null,
    [selectedSimulationId, simulations]
  );
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
        includedStorageMb: preview.basePackage.includedStorageMb
      },
      items: preview.lines.map((line) => ({
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
        publicMetadata: line.publicMetadata
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
      modularCheckoutEnabled: false,
      stripeReady: false
    };
  }, [input, lead?.clinicName, lead?.name, preview, publicNotes, scenarioName]);

  if (useLegacyFallback) return <>{legacyFallback}</>;

  const updateInput = (patch: Partial<SalesModularProposalInput>) => {
    setInput((current) => (current ? { ...current, ...patch } : current));
    setPreparedOffer(null);
    setNotice('');
  };

  const changePatientQuantity = (patientQuantity: number) => {
    if (!catalog || !input) return;
    const safeQuantity = Math.max(1, Math.min(100000, patientQuantity || 1));
    const currentCore = catalog.items.find(
      (item) => item.itemKey === 'clinical_core'
    );
    const currentTier = currentCore?.tiers.find(
      (tier) => tier.id === input.basePackageTierId
    );
    const recommended =
      currentTier?.maximumQuantity != null &&
      safeQuantity > currentTier.maximumQuantity
        ? recommendSalesPackageTier(catalog, safeQuantity)
        : currentTier || recommendSalesPackageTier(catalog, safeQuantity);
    if (!recommended || !currentCore) return;
    const lines = input.lines.map((line) => {
      const item = catalog.items.find(
        (catalogItem) => catalogItem.itemKey === line.itemKey
      );
      if (!item) return line;
      if (item.itemKey === 'clinical_core') {
        return {
          ...line,
          tierId: recommended.id,
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
      expectedPatientQuantity12Months: Math.max(
        safeQuantity,
        input.expectedPatientQuantity12Months
      ),
      basePackageTierId: recommended.id,
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
    if (
      tier.maximumQuantity !== null &&
      input.patientQuantity > tier.maximumQuantity
    ) {
      setError(
        `Este pacote comporta até ${tier.maximumQuantity} pacientes. Selecione uma faixa compatível ou personalizada.`
      );
    } else {
      setError('');
    }
    updateInput({
      basePackageTierId: tier.id,
      lines: input.lines.map((line) =>
        line.itemKey === 'clinical_core'
          ? {
              ...line,
              tierId: tier.id,
              quantity: input.patientQuantity
            }
          : line
      )
    });
  };

  const toggleItem = (item: SalesPricingCatalogItem) => {
    if (!input || !catalog) return;
    const exists = input.lines.some((line) => line.itemKey === item.itemKey);
    if (exists) {
      if (item.isRequired) return;
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
      baseTier
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
    setInput(simulation.modular_input_snapshot);
    setScenarioName(
      `Cópia de ${simulation.scenario_name || 'cenário modular'}`
    );
    setInternalJustification(simulation.internal_justification || '');
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
    setBusy('offer');
    setError('');
    try {
      const data = await authenticatedFetch('/api/owner/sales/offers', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': requestKey('modular-offer') },
        body: JSON.stringify({
          leadId: lead.id,
          simulationId: selectedSimulation.id
        })
      });
      setPreparedOffer(data);
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

  const coreItem = catalog?.items.find(
    (item) => item.itemKey === 'clinical_core'
  );
  const selectedBaseTier = coreItem?.tiers.find(
    (tier) => tier.id === input?.basePackageTierId
  );

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
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Clínica e pacote-base
                    </h2>
                    <p className="mt-1 text-sm font-normal text-slate-500">
                      A menor faixa compatível é recomendada automaticamente.
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
                      min={input.patientQuantity}
                      max={100000}
                      value={input.expectedPatientQuantity12Months}
                      onChange={(event) =>
                        updateInput({
                          expectedPatientQuantity12Months: Math.max(
                            input.patientQuantity,
                            Number(event.target.value)
                          )
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Pacote Verto Clínica
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
                {selectedBaseTier?.isCustom ? (
                  <label className="mt-4 block max-w-sm text-sm font-medium text-slate-700">
                    Valor mensal personalizado do pacote-base
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={
                        Number(
                          input.lines.find(
                            (line) => line.itemKey === 'clinical_core'
                          )?.customRecurringAmountCents || 0
                        ) / 100
                      }
                      onChange={(event) =>
                        updateLine('clinical_core', {
                          customRecurringAmountCents: Math.round(
                            Number(event.target.value) * 100
                          )
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                  </label>
                ) : null}
                {selectedBaseTier?.maximumQuantity != null &&
                input.patientQuantity > selectedBaseTier.maximumQuantity ? (
                  <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                    O pacote escolhido comporta até{' '}
                    {selectedBaseTier.maximumQuantity} pacientes e não atende a
                    quantidade informada.
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
                      Mensalidade do pacote:{' '}
                      {currency(
                        preview.lines.find(
                          (line) => line.itemKey === 'clinical_core'
                        )?.grossRecurringRevenueCents
                      )}
                    </span>
                    {preview.basePackage.limitQuantity ? (
                      <span>
                        Por paciente no limite:{' '}
                        {currency(
                          Math.round(
                            Number(
                              preview.lines.find(
                                (line) => line.itemKey === 'clinical_core'
                              )?.grossRecurringRevenueCents || 0
                            ) / preview.basePackage.limitQuantity
                          )
                        )}
                      </span>
                    ) : null}
                    <span>
                      Por paciente na utilização atual:{' '}
                      {currency(
                        Math.round(
                          Number(
                            preview.lines.find(
                              (line) => line.itemKey === 'clinical_core'
                            )?.grossRecurringRevenueCents || 0
                          ) / input.patientQuantity
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
                  Funcionalidades e adicionais
                </h2>
                <p className="mt-1 text-sm font-normal text-slate-500">
                  A estrutura clínica e ABA completa já faz parte do pacote-base.
                </p>
                <div className="mt-4 space-y-3">
                  {catalog.items.map((item) => {
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
                            disabled={item.isRequired}
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
                                {item.isRequired ? (
                                  <span className="ml-2 text-xs font-normal text-violet-700">
                                    incluído obrigatoriamente
                                  </span>
                                ) : null}
                              </p>
                              {enabled && preview ? (
                                <p className="text-sm font-semibold text-slate-900">
                                  {currency(
                                    resultLine?.postPromotionRecurringRevenueCents ||
                                      resultLine?.oneTimeRevenueCents ||
                                      0
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
                                            tier?.isCustom ? 0 : null
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
                                {selectedTier?.isCustom ? (
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
                                <label className="text-xs font-medium text-slate-600">
                                  Desconto do item
                                  <div className="relative mt-1">
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step="0.01"
                                      value={
                                        Number(
                                          line.itemDiscountBasisPoints || 0
                                        ) / 100
                                      }
                                      onChange={(event) =>
                                        updateLine(item.itemKey, {
                                          itemDiscountBasisPoints: Math.round(
                                            Number(event.target.value) * 100
                                          )
                                        })
                                      }
                                      className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 pr-8 font-normal text-slate-800"
                                    />
                                    <span className="absolute right-3 top-2.5 text-slate-400">
                                      %
                                    </span>
                                  </div>
                                </label>
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
                                    EBITDA estimado
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
                  <label className="text-sm font-medium text-slate-700">
                    Perfil de uso
                    <select
                      value={input.usageProfile}
                      onChange={(event) =>
                        updateInput({
                          usageProfile: event.target.value as SalesUsageProfile
                        })
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
                    >
                      <option value="light">Leve</option>
                      <option value="standard">Padrão</option>
                      <option value="intensive">Intensivo</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </label>
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
                {preview?.requiresJustification ? (
                  <label className="mt-3 block text-sm font-medium text-rose-800">
                    Justificativa administrativa obrigatória
                    <textarea
                      rows={2}
                      maxLength={1500}
                      value={internalJustification}
                      onChange={(event) =>
                        setInternalJustification(event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-normal text-slate-900"
                      placeholder="Explique a exceção de margem."
                    />
                  </label>
                ) : null}
              </section>

              {preview ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Projeções da proposta
                    </h2>
                    <p className="mt-1 text-sm font-normal text-slate-500">
                      Implantação reconhecida conforme o parcelamento comercial,
                      sem criar cobrança na Stripe.
                    </p>
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
                    <table className="min-w-[880px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Horizonte</th>
                          <th className="px-3 py-2 font-medium">Receita recorrente</th>
                          <th className="px-3 py-2 font-medium">Implantação</th>
                          <th className="px-3 py-2 font-medium">Desconto acumulado</th>
                          <th className="px-3 py-2 font-medium">EBITDA</th>
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
                              <td className="px-3 py-3">
                                {currency(projection.oneTimeRevenueCents)}
                              </td>
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
                  <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">
                        Implantação total
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {currency(preview.oneTimeRevenueCents)}
                      </dd>
                      <p className="mt-1 text-xs text-slate-500">
                        {input.onboardingInstallments ?? 1}{' '}
                        {(input.onboardingInstallments ?? 1) === 1
                          ? 'parcela'
                          : 'parcelas'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">
                        Preço mínimo recomendado
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-900">
                        {currency(
                          preview.minimumRecommendedRecurringRevenueCents
                        )}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">
                        Desconto máximo saudável
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
                          <th className="px-3 py-2 font-medium">EBITDA</th>
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
                    Resultado consolidado
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
                        Total mensal
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {currency(preview.promotionalRecurringRevenueCents)}
                      </p>
                      {input.globalDiscountBasisPoints > 0 ? (
                        <p className="mt-1 text-xs font-normal text-slate-300">
                          Depois: {currency(preview.postPromotionRecurringRevenueCents)}
                          /mês
                        </p>
                      ) : null}
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3">
                      {[
                        [
                          'Custos estimados',
                          currency(preview.promotional.totalEstimatedCostCents)
                        ],
                        [
                          'Contribuição',
                          currency(preview.promotional.contributionMarginCents)
                        ],
                        [
                          'Margem de contribuição',
                          percent(
                            preview.promotional
                              .contributionMarginBasisPoints
                          )
                        ],
                        ['EBITDA', currency(preview.promotional.ebitdaCents)],
                        [
                          'Margem EBITDA',
                          percent(preview.promotional.ebitdaMarginBasisPoints)
                        ],
                        [
                          'Lucro gerencial',
                          currency(preview.promotional.netIncomeCents)
                        ],
                        [
                          'Preço mínimo',
                          currency(
                            preview.minimumRecommendedRecurringRevenueCents
                          )
                        ],
                        [
                          'Desconto máximo',
                          percent(
                            preview.maximumRecommendedDiscountBasisPoints
                          )
                        ]
                      ].map(([label, formattedValue]) => (
                        <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                          <dt className="text-xs font-normal text-slate-500">
                            {label}
                          </dt>
                          <dd className="mt-1 text-sm font-semibold text-slate-900">
                            {formattedValue}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {preview.missingCosts.length > 0 ? (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        <p className="font-medium">Custos ainda indisponíveis</p>
                        <p className="mt-1 font-normal">
                          {preview.missingCosts.join(', ')}. Valores ausentes não
                          são tratados como zero.
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
                      Rentabilidade por funcionalidade
                    </h2>
                  </div>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="min-w-[880px] w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Item</th>
                          <th className="px-3 py-2 font-medium">Receita</th>
                          <th className="px-3 py-2 font-medium">Direto</th>
                          <th className="px-3 py-2 font-medium">Taxas e tributos</th>
                          <th className="px-3 py-2 font-medium">Plataforma</th>
                          <th className="px-3 py-2 font-medium">Contribuição</th>
                          <th className="px-3 py-2 font-medium">EBITDA</th>
                          <th className="px-3 py-2 font-medium">Margem</th>
                          <th className="px-3 py-2 font-medium">Lucro</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.lines.map((line) => (
                          <tr key={line.lineKey}>
                            <td className="px-3 py-3 font-medium text-slate-800">
                              {line.publicName}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.promotional.netRevenueCents)}
                            </td>
                            <td className="px-3 py-3">
                              {currency(line.promotional.directCostCents)}
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
                              {percent(line.promotional.ebitdaMarginBasisPoints)}
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
                  !preview ||
                  (preview.requiresJustification &&
                    internalJustification.trim().length < 12)
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-300 bg-white px-4 text-sm font-medium text-violet-700 disabled:opacity-50"
              >
                {busy === 'save' ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Save size={16} />
                )}
                Salvar cenário
              </button>
              <button
                type="button"
                onClick={() => void prepareOffer()}
                disabled={
                  Boolean(busy) ||
                  !selectedSimulation ||
                  selectedSimulation.results_snapshot?.missingCosts?.length > 0
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
              Gerar proposta pública não cria Checkout, cupom ou assinatura.
            </p>
          </footer>
        ) : null}
      </section>
    </div>
  );
};
