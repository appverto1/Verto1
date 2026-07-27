import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Copy,
  ExternalLink,
  GitCompareArrows,
  Loader2,
  MessageCircle,
  RotateCcw,
  Save,
  Settings2,
  X,
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import { PUBLIC_ACTIVE_PATIENT_PRICE } from '../constants/salesCommercial';
import {
  calculateSalesProfitability,
  type OfferProfitabilityRating,
  type SalesAssumptionSnapshot,
  type SalesAssumptionValues,
  type SalesProfitabilityResult,
  type SalesSimulationInput,
  type SalesUsageProfile,
} from '../utils/salesProfitability';
import { SalesModularProposalBuilder } from './SalesModularProposalBuilder';

type SalesProfitabilitySimulatorProps = {
  lead: any;
  onClose: () => void;
  onOpenAssumptions: () => void;
  onOfferPrepared?: (leadId: string, offer: any) => void;
};

type SavedSimulation = {
  id: string;
  status: 'saved' | 'selected' | 'offered' | 'archived';
  assumption_set_id: string;
  initial_active_patient_quantity: number;
  base_unit_amount_cents: number;
  discount_percentage: number;
  discount_duration_months: number | null;
  offer_validity_days: number;
  usage_profile: SalesUsageProfile;
  custom_monthly_cost_cents: number;
  onboarding_cost_cents: number;
  results_snapshot: SalesProfitabilityResult;
  profitability_rating: OfferProfitabilityRating;
  internal_justification?: string | null;
  internal_notes?: string | null;
  created_at: string;
  offer?: {
    id: string;
    status: string;
    expires_at: string;
  } | null;
};

const assumptionLabels: Partial<
  Record<keyof SalesAssumptionValues, string>
> = {
  stripeFeeBasisPoints: 'tarifa percentual da Stripe',
  stripeFixedFeeCents: 'tarifa fixa da Stripe',
  revenueTaxBasisPoints: 'impostos sobre faturamento',
  variablePatientCostCents: 'custo variável por paciente',
  variableClinicCostCents: 'custo mensal por clínica',
  storageCostCents: 'armazenamento',
  egressCostCents: 'tráfego / egress',
  processingCostCents: 'processamento',
  notificationCostCents: 'e-mails e notificações',
  otherVariableCostCents: 'outros custos variáveis',
  monthlySupportClinicCostCents: 'suporte mensal por clínica',
  supportPatientCostCents: 'suporte por paciente',
  monthlyOperationalCostCents: 'custo operacional atribuível',
  commercialCommissionBasisPoints: 'comissão comercial',
  fixedMonthlyEligibleCostCents: 'custos fixos elegíveis',
  fixedAllocationPatientCount: 'pacientes na base de rateio',
  fixedAllocationClinicCount: 'clínicas na base de rateio',
  customFixedAllocationCents: 'rateio mensal personalizado',
  depreciationAmortizationCents: 'depreciação e amortização',
  financialExpensesCents: 'despesas financeiras',
  profitTaxBasisPoints: 'impostos sobre lucro',
  otherBelowEbitdaCents: 'outras despesas abaixo do EBITDA',
  minimumMarginBasisPoints: 'margem mínima',
  healthyMarginBasisPoints: 'faixa de oferta saudável',
  attentionMarginBasisPoints: 'faixa de atenção',
};

const sourceLabels = {
  actual: 'Real',
  calculated: 'Calculado',
  estimated: 'Estimado',
  manual: 'Manual',
  unavailable: 'Indisponível',
} as const;

const ratingCopy: Record<
  OfferProfitabilityRating,
  { label: string; className: string }
> = {
  healthy: {
    label: 'Oferta saudável',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  attention: {
    label: 'Oferta exige atenção',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  not_recommended: {
    label: 'Oferta não recomendada',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
  },
  insufficient_data: {
    label: 'Dados insuficientes',
    className: 'border-slate-200 bg-slate-100 text-slate-700',
  },
};

const formatCurrency = (cents: number | null | undefined) =>
  cents == null
    ? 'Dados insuficientes'
    : (cents / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });

const formatPercent = (basisPoints: number | null | undefined) =>
  basisPoints == null
    ? 'Dados insuficientes'
    : `${(basisPoints / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`;

const simulationToInput = (simulation: SavedSimulation): SalesSimulationInput => ({
  initialActivePatientQuantity: Number(
    simulation.initial_active_patient_quantity
  ),
  baseUnitAmountCents: Number(simulation.base_unit_amount_cents),
  discountBasisPoints: Math.round(
    Number(simulation.discount_percentage || 0) * 100
  ),
  discountDurationMonths: Number(
    simulation.discount_duration_months || 0
  ),
  offerValidityDays: Number(simulation.offer_validity_days || 14),
  usageProfile: simulation.usage_profile || 'standard',
  customMonthlyCostCents: Number(
    simulation.custom_monthly_cost_cents || 0
  ),
  onboardingCostCents: Number(simulation.onboarding_cost_cents || 0),
});

const LegacySalesProfitabilitySimulator = ({
  lead,
  onClose,
  onOpenAssumptions,
  onOfferPrepared,
}: SalesProfitabilitySimulatorProps) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const saveIdempotencyKeyRef = useRef('');
  const offerIdempotencyKeysRef = useRef<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assumptionSet, setAssumptionSet] =
    useState<SalesAssumptionSnapshot | null>(null);
  const [assumptionValues, setAssumptionValues] =
    useState<SalesAssumptionValues | null>(null);
  const [simulations, setSimulations] = useState<SavedSimulation[]>([]);
  const [selectedSimulationId, setSelectedSimulationId] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [preparedOffer, setPreparedOffer] = useState<any>(null);
  const [input, setInput] = useState<SalesSimulationInput>({
    initialActivePatientQuantity: Math.max(
      1,
      Number(lead?.estimatedActivePatients || 1)
    ),
    baseUnitAmountCents: PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents,
    discountBasisPoints: 0,
    discountDurationMonths: 0,
    offerValidityDays: 14,
    usageProfile: 'standard',
    customMonthlyCostCents: 0,
    onboardingCostCents: 0,
  });
  const [internalNotes, setInternalNotes] = useState('');
  const [internalJustification, setInternalJustification] = useState('');

  const authenticatedFetch = async (
    url: string,
    init: RequestInit = {}
  ) => {
    const supabase = await getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success === false) {
      const requestError = new Error(
        data?.error || 'Não foi possível concluir esta ação.'
      );
      (requestError as any).code = data?.code;
      throw requestError;
    }
    return data;
  };

  useEffect(() => {
    busyRef.current = Boolean(busy);
  }, [busy]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = (
        Array.from(
          drawerRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ) as HTMLElement[]
      ).filter(
        (element) =>
          !element.hasAttribute('hidden') &&
          element.getAttribute('aria-hidden') !== 'true'
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [assumptionsResponse, simulationsResponse] =
          await Promise.all([
            authenticatedFetch(
              '/api/owner/sales/profitability-assumptions'
            ),
            authenticatedFetch(
              `/api/owner/sales/leads/${encodeURIComponent(
                lead.id
              )}/simulations`
            ),
          ]);
        if (cancelled) return;
        const loadedAssumption =
          assumptionsResponse.assumptionSet || null;
        setAssumptionSet(loadedAssumption);
        setAssumptionValues(
          loadedAssumption?.values ||
            assumptionsResponse.editableTemplate ||
            null
        );
        const loadedValues =
          loadedAssumption?.values ||
          assumptionsResponse.editableTemplate ||
          null;
        setInput((current) => ({
          ...current,
          baseUnitAmountCents:
            Number(
              loadedValues?.officialUnitAmountCents ||
                assumptionsResponse.officialPrice?.unitAmountCents
            ) || PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents,
          onboardingCostCents:
            current.onboardingCostCents ||
            Number(loadedValues?.defaultOnboardingCostCents || 0),
        }));
        const loadedSimulations =
          simulationsResponse.simulations || [];
        setSimulations(loadedSimulations);
        const selected = loadedSimulations.find(
          (item: SavedSimulation) => item.status === 'selected'
        ) || loadedSimulations.find(
          (item: SavedSimulation) => item.status === 'offered'
        );
        if (selected) setSelectedSimulationId(selected.id);
      } catch (loadError: any) {
        if (!cancelled) {
          setError(
            loadError?.message ||
              'Não foi possível carregar o simulador.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  const previewAssumption = useMemo<SalesAssumptionSnapshot | null>(() => {
    if (!assumptionValues) return null;
    return {
      id: assumptionSet?.id || '00000000-0000-0000-0000-000000000000',
      version: assumptionSet?.version || 1,
      name: assumptionSet?.name || 'Premissas ainda não salvas',
      effectiveAt: assumptionSet?.effectiveAt || new Date().toISOString(),
      values: assumptionValues,
      sources: assumptionSet?.sources || {},
      sourceDetails: assumptionSet?.sourceDetails || {},
    };
  }, [assumptionSet, assumptionValues]);

  const preview = useMemo(() => {
    if (!previewAssumption) return null;
    try {
      return calculateSalesProfitability(input, previewAssumption);
    } catch {
      return null;
    }
  }, [input, previewAssumption]);

  const selectedSimulation = simulations.find(
    (simulation) => simulation.id === selectedSimulationId
  );
  const comparedSimulations = comparisonIds
    .map((id) => simulations.find((item) => item.id === id))
    .filter(Boolean) as SavedSimulation[];

  const recalculatePreview = () => {
    setInput((current) => ({ ...current }));
    setNotice(
      `Prévia recalculada com as premissas v${assumptionSet?.version || 1}.`
    );
  };

  const updateInput = <K extends keyof SalesSimulationInput>(
    key: K,
    value: SalesSimulationInput[K]
  ) => {
    saveIdempotencyKeyRef.current = '';
    setPreparedOffer(null);
    setInput((current) => {
      const next = { ...current, [key]: value };
      if (key === 'discountBasisPoints' && Number(value) === 0) {
        next.discountDurationMonths = 0;
      }
      if (
        key === 'discountBasisPoints' &&
        Number(value) > 0 &&
        next.discountDurationMonths === 0
      ) {
        next.discountDurationMonths = 1;
      }
      return next;
    });
  };

  const saveSimulation = async () => {
    setBusy('simulation');
    setError('');
    setNotice('');
    const requestKey =
      saveIdempotencyKeyRef.current || crypto.randomUUID();
    saveIdempotencyKeyRef.current = requestKey;
    try {
      let simulationAssumptionSet = assumptionSet;
      if (!simulationAssumptionSet) {
        if (!assumptionValues) {
          throw new Error(
            'Não foi possível montar o snapshot incompleto da simulação.'
          );
        }
        const sources = Object.fromEntries(
          Object.entries(assumptionValues)
            .filter(([key]) => key !== 'usageProfiles')
            .map(([key, value]) => [
              key,
              key === 'officialUnitAmountCents'
                ? 'actual'
                : value == null
                  ? 'unavailable'
                  : 'manual',
            ])
        );
        const assumptionResponse = await authenticatedFetch(
          '/api/owner/sales/profitability-assumptions',
          {
            method: 'POST',
            body: JSON.stringify({
              name: `Premissas pendentes · ${new Date().toLocaleDateString(
                'pt-BR'
              )}`,
              values: assumptionValues,
              sourceMetadata: {
                basis: 'manual',
                sources,
                sourceDetails: {
                  officialUnitAmountCents:
                    'Preço público canônico por paciente ativo.',
                },
              },
            }),
          }
        );
        simulationAssumptionSet = assumptionResponse.assumptionSet;
        if (!simulationAssumptionSet) {
          throw new Error(
            'A versão incompleta das premissas não foi confirmada pelo servidor.'
          );
        }
        setAssumptionSet(simulationAssumptionSet);
        setAssumptionValues(simulationAssumptionSet.values);
      }
      if (!simulationAssumptionSet) {
        throw new Error(
          'Não foi possível vincular as premissas à simulação.'
        );
      }
      const data = await authenticatedFetch(
        `/api/owner/sales/leads/${encodeURIComponent(
          lead.id
        )}/simulations`,
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': requestKey },
          body: JSON.stringify({
            ...input,
            assumptionSetId: simulationAssumptionSet.id,
            internalNotes,
            internalJustification,
            idempotencyKey: requestKey,
          }),
        }
      );
      const saved = data.simulation as SavedSimulation;
      setSimulations((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setSelectedSimulationId(saved.id);
      setNotice(
        data.idempotent
          ? 'A simulação já estava salva.'
          : simulationAssumptionSet === assumptionSet
            ? 'Simulação salva sem alterar a DRE ou criar objetos Stripe.'
            : 'Simulação incompleta salva. Configure os dados ausentes antes de preparar a oferta.'
      );
    } catch (saveError: any) {
      setError(
        saveError?.message ||
          'Não foi possível salvar a simulação.'
      );
    } finally {
      setBusy('');
    }
  };

  const selectSimulation = async (simulation: SavedSimulation) => {
    setBusy(`select:${simulation.id}`);
    setError('');
    try {
      await authenticatedFetch(
        `/api/owner/sales/leads/${encodeURIComponent(
          lead.id
        )}/simulations/${encodeURIComponent(
          simulation.id
        )}/select`,
        { method: 'POST' }
      );
      setSelectedSimulationId(simulation.id);
      setSimulations((current) =>
        current.map((item) =>
          item.id === simulation.id
            ? { ...item, status: 'selected' }
            : item
        )
      );
      setNotice('Simulação selecionada para a proposta.');
    } catch (selectionError: any) {
      setError(
        selectionError?.message ||
          'Não foi possível selecionar a simulação.'
      );
    } finally {
      setBusy('');
    }
  };

  const duplicateSimulation = (simulation: SavedSimulation) => {
    setInput(simulationToInput(simulation));
    setInternalNotes(simulation.internal_notes || '');
    setInternalJustification(
      simulation.internal_justification || ''
    );
    setSelectedSimulationId('');
    setPreparedOffer(null);
    saveIdempotencyKeyRef.current = '';
    setNotice(
      'Cópia carregada. Ajuste as condições e salve como nova simulação.'
    );
    document
      .querySelector('[data-sales-simulator-form]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const toggleComparison = (simulationId: string) => {
    setComparisonIds((current) => {
      if (current.includes(simulationId)) {
        return current.filter((id) => id !== simulationId);
      }
      return current.length >= 3
        ? [...current.slice(1), simulationId]
        : [...current, simulationId];
    });
  };

  const prepareOffer = async () => {
    if (!selectedSimulation) {
      setError('Selecione uma simulação salva para preparar a oferta.');
      return;
    }
    const requestKey =
      offerIdempotencyKeysRef.current[selectedSimulation.id] ||
      crypto.randomUUID();
    offerIdempotencyKeysRef.current[selectedSimulation.id] = requestKey;
    setBusy('offer');
    setError('');
    setNotice('');
    try {
      const data = await authenticatedFetch(
        '/api/owner/sales/offers',
        {
          method: 'POST',
          headers: { 'X-Idempotency-Key': requestKey },
          body: JSON.stringify({
            leadId: lead.id,
            simulationId: selectedSimulation.id,
            idempotencyKey: requestKey,
          }),
        }
      );
      setPreparedOffer(data);
      setSimulations((current) =>
        current.map((item) =>
          item.id === selectedSimulation.id
            ? {
                ...item,
                status: 'offered',
                offer: data.offer,
              }
            : item
        )
      );
      onOfferPrepared?.(lead.id, data.offer);
      setNotice(
        data.idempotent
          ? 'A mesma proposta e o mesmo link foram recuperados.'
          : 'Proposta criada. O desconto Stripe foi vinculado somente a esta oferta.'
      );
    } catch (offerError: any) {
      setError(
        offerError?.message ||
          'Não foi possível preparar a oferta.'
      );
    } finally {
      setBusy('');
    }
  };

  const copyPublicUrl = async () => {
    if (!preparedOffer?.publicUrl) return;
    await navigator.clipboard.writeText(preparedOffer.publicUrl);
    setNotice('Link da proposta copiado.');
  };

  const whatsappUrl = useMemo(() => {
    if (!preparedOffer?.publicUrl) return '';
    const phone = String(lead?.phone || '').replace(/\D/g, '');
    if (!phone) return '';
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
    const clinic = lead?.clinicName || lead?.name || 'sua clínica';
    const message = `Olá! Preparei uma proposta individual da Verto para ${clinic}: ${preparedOffer.publicUrl}`;
    return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(
      message
    )}`;
  }, [
    lead?.clinicName,
    lead?.name,
    lead?.phone,
    preparedOffer?.publicUrl,
  ]);

  const renderMetric = (
    label: string,
    value: string,
    hint?: string
  ) => (
    <div className="min-w-0 border-l-2 border-violet-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[10px] font-normal leading-4 text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-950/30 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-profitability-title"
        tabIndex={-1}
        className="ml-auto flex h-[100dvh] w-full max-w-[820px] flex-col overflow-hidden bg-slate-50 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-violet-600">
              Comercial · uso interno
            </p>
            <h2
              id="sales-profitability-title"
              className="truncate text-lg font-semibold text-slate-900"
            >
              Simular rentabilidade
            </h2>
            <p className="truncate text-xs font-normal text-slate-500">
              {lead.clinicName || lead.name}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            aria-label="Fechar simulador"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
          >
            <X size={19} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-600">
              <Loader2 className="animate-spin text-violet-600" size={20} />
              Carregando premissas e simulações...
            </div>
          ) : (
            <div className="space-y-5">
              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-3 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
                >
                  <AlertTriangle className="mt-0.5 shrink-0" size={17} />
                  <p className="font-normal">{error}</p>
                </div>
              ) : null}
              {notice ? (
                <div
                  role="status"
                  className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
                >
                  <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
                  <p className="font-normal">{notice}</p>
                </div>
              ) : null}

              {assumptionSet ? (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-violet-700">
                      <Settings2 size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-violet-700">
                        Premissas utilizadas
                      </p>
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {assumptionSet.name} · versão {assumptionSet.version} ativa
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenAssumptions}
                    className="min-h-10 text-xs font-medium text-violet-700 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    Ver ou alterar premissas
                  </button>
                </section>
              ) : (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      className="mt-0.5 shrink-0 text-amber-700"
                      size={18}
                    />
                    <div>
                      <h3 className="text-sm font-semibold text-amber-950">
                        Premissas financeiras ainda não configuradas
                      </h3>
                      <p className="mt-1 text-sm font-normal leading-5 text-amber-900">
                        Configure as premissas financeiras uma única vez para
                        calcular margem, EBITDA e lucro desta proposta.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={onOpenAssumptions}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-amber-900 px-3 text-xs font-medium text-white"
                    >
                      <Settings2 size={15} />
                      Configurar premissas
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveSimulation()}
                      disabled={Boolean(busy) || !preview}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900 disabled:opacity-50"
                    >
                      {busy === 'simulation' ? (
                        <Loader2 className="animate-spin" size={15} />
                      ) : (
                        <Save size={15} />
                      )}
                      Salvar simulação incompleta
                    </button>
                  </div>
                </section>
              )}

              <section
                data-sales-simulator-form
                className="border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Condições da simulação
                    </h3>
                    <p className="mt-1 text-xs font-normal text-slate-500">
                      A prévia é local. Stripe e Checkout não são acessados
                      durante a digitação.
                    </p>
                  </div>
                  <CircleDollarSign
                    size={20}
                    className="shrink-0 text-violet-600"
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-700">
                    Pacientes ativos iniciais
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={input.initialActivePatientQuantity}
                      onChange={(event) =>
                        updateInput(
                          'initialActivePatientQuantity',
                          Number(event.target.value)
                        )
                      }
                      className="mt-1 min-h-11 w-full border border-slate-200 px-3 text-sm font-normal outline-none focus:border-violet-500"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Preço oficial por paciente
                    <input
                      readOnly
                      value={formatCurrency(input.baseUnitAmountCents)}
                      className="mt-1 min-h-11 w-full border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-600"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Desconto personalizado
                    <div className="mt-1 flex min-h-11 border border-slate-200 focus-within:border-violet-500">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={input.discountBasisPoints / 100}
                        onChange={(event) =>
                          updateInput(
                            'discountBasisPoints',
                            Math.round(Number(event.target.value) * 100)
                          )
                        }
                        className="min-w-0 flex-1 px-3 text-sm font-normal outline-none"
                      />
                      <span className="px-3 py-2.5 text-sm text-slate-400">
                        %
                      </span>
                    </div>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Duração do desconto
                    <div className="mt-1 flex min-h-11 border border-slate-200 focus-within:border-violet-500">
                      <input
                        type="number"
                        min={input.discountBasisPoints > 0 ? 1 : 0}
                        max={36}
                        value={input.discountDurationMonths}
                        disabled={input.discountBasisPoints === 0}
                        onChange={(event) =>
                          updateInput(
                            'discountDurationMonths',
                            Number(event.target.value)
                          )
                        }
                        className="min-w-0 flex-1 px-3 text-sm font-normal outline-none disabled:bg-slate-50"
                      />
                      <span className="px-3 py-2.5 text-xs text-slate-400">
                        meses
                      </span>
                    </div>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Validade da proposta
                    <div className="mt-1 flex min-h-11 border border-slate-200 focus-within:border-violet-500">
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={input.offerValidityDays}
                        onChange={(event) =>
                          updateInput(
                            'offerValidityDays',
                            Number(event.target.value)
                          )
                        }
                        className="min-w-0 flex-1 px-3 text-sm font-normal outline-none"
                      />
                      <span className="px-3 py-2.5 text-xs text-slate-400">
                        dias
                      </span>
                    </div>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Perfil de uso
                    <select
                      value={input.usageProfile}
                      onChange={(event) =>
                        updateInput(
                          'usageProfile',
                          event.target.value as SalesUsageProfile
                        )
                      }
                      className="mt-1 min-h-11 w-full border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-violet-500"
                    >
                      <option value="light">Uso leve</option>
                      <option value="standard">Uso padrão</option>
                      <option value="intensive">Uso intensivo</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </label>
                </div>

                <label className="mt-3 block text-xs font-medium text-slate-700">
                  Observação interna
                  <textarea
                    value={internalNotes}
                    onChange={(event) => {
                      saveIdempotencyKeyRef.current = '';
                      setInternalNotes(event.target.value);
                    }}
                    maxLength={2000}
                    rows={2}
                    className="mt-1 w-full resize-y border border-slate-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500"
                  />
                </label>

                <details className="group mt-4 rounded-lg border border-slate-200 bg-slate-50/60">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        Custos adicionais desta proposta
                      </span>
                      <span className="block text-xs font-normal text-slate-500">
                        Use somente quando esta proposta tiver custos fora das
                        premissas globais.
                      </span>
                    </span>
                    <ChevronDown
                      size={17}
                      className="shrink-0 text-slate-500 transition group-open:rotate-180"
                    />
                  </summary>
                  <div className="grid gap-3 border-t border-slate-200 bg-white p-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-700">
                      Custo adicional mensal
                      <div className="mt-1 flex min-h-11 rounded-lg border border-slate-200 focus-within:border-violet-500">
                        <span className="px-3 py-2.5 text-xs text-slate-400">
                          R$
                        </span>
                        <input
                          inputMode="decimal"
                          value={input.customMonthlyCostCents / 100}
                          onChange={(event) =>
                            updateInput(
                              'customMonthlyCostCents',
                              Math.max(
                                0,
                                Math.round(
                                  Number(event.target.value || 0) * 100
                                )
                              )
                            )
                          }
                          className="min-w-0 flex-1 px-1 text-sm font-normal outline-none"
                        />
                      </div>
                    </label>
                    <label className="text-xs font-medium text-slate-700">
                      Custo único de onboarding
                      <div className="mt-1 flex min-h-11 rounded-lg border border-slate-200 focus-within:border-violet-500">
                        <span className="px-3 py-2.5 text-xs text-slate-400">
                          R$
                        </span>
                        <input
                          inputMode="decimal"
                          value={input.onboardingCostCents / 100}
                          onChange={(event) =>
                            updateInput(
                              'onboardingCostCents',
                              Math.max(
                                0,
                                Math.round(
                                  Number(event.target.value || 0) * 100
                                )
                              )
                            )
                          }
                          className="min-w-0 flex-1 px-1 text-sm font-normal outline-none"
                        />
                      </div>
                    </label>
                  </div>
                </details>

                {preview?.requiresJustification ? (
                  <label className="mt-3 block text-xs font-medium text-rose-800">
                    Justificativa administrativa obrigatória
                    <textarea
                      value={internalJustification}
                      onChange={(event) => {
                        saveIdempotencyKeyRef.current = '';
                        setInternalJustification(event.target.value);
                      }}
                      maxLength={1500}
                      rows={3}
                      placeholder="Explique por que esta condição comercial deve prosseguir."
                      className="mt-1 w-full resize-y border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-rose-500"
                    />
                  </label>
                ) : null}
              </section>

              {preview ? (
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Resultado estimado
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={recalculatePreview}
                        className="inline-flex min-h-10 items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        <RotateCcw size={14} />
                        Recalcular
                      </button>
                      <span
                        className={`border px-3 py-1.5 text-xs font-medium ${
                          ratingCopy[preview.rating].className
                        }`}
                      >
                        {ratingCopy[preview.rating].label}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {renderMetric(
                      'Receita promocional',
                      formatCurrency(
                        preview.promotionalMonthlyRevenueCents
                      )
                    )}
                    {renderMetric(
                      'Margem de contribuição',
                      formatCurrency(
                        preview.promotional.contributionMarginCents
                      ),
                      formatPercent(
                        preview.promotional
                          .contributionMarginBasisPoints
                      )
                    )}
                    {renderMetric(
                      'EBITDA incremental',
                      formatCurrency(preview.promotional.ebitdaCents)
                    )}
                    {renderMetric(
                      'Margem EBITDA',
                      formatPercent(
                        preview.promotional.ebitdaMarginBasisPoints
                      )
                    )}
                    {renderMetric(
                      'Lucro líquido estimado',
                      formatCurrency(preview.promotional.netIncomeCents),
                      formatPercent(preview.promotional.netMarginBasisPoints)
                    )}
                    {renderMetric(
                      'Classificação da oferta',
                      ratingCopy[preview.rating].label
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="border border-violet-200 bg-violet-50/50 p-4">
                      <p className="text-xs font-medium text-violet-700">
                        Durante a promoção
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">
                        {formatCurrency(
                          preview.promotionalUnitAmountCents
                        )}
                        <span className="text-xs font-normal text-slate-500">
                          {' '}
                          por paciente
                        </span>
                      </p>
                      <dl className="mt-3 space-y-2 text-xs">
                        <div className="flex justify-between gap-3">
                          <dt className="font-normal text-slate-500">
                            Receita mensal
                          </dt>
                          <dd className="font-medium text-slate-900">
                            {formatCurrency(
                              preview.promotional.revenueCents
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="font-normal text-slate-500">
                            Margem EBITDA
                          </dt>
                          <dd className="font-medium text-slate-900">
                            {formatPercent(
                              preview.promotional
                                .ebitdaMarginBasisPoints
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="font-normal text-slate-500">
                            Total no período
                          </dt>
                          <dd className="font-medium text-slate-900">
                            {formatCurrency(
                              preview.promotional.revenueCents *
                                input.discountDurationMonths
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="border border-slate-200 bg-white p-4">
                      <p className="text-xs font-medium text-slate-600">
                        Após a promoção
                      </p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">
                        {formatCurrency(input.baseUnitAmountCents)}
                        <span className="text-xs font-normal text-slate-500">
                          {' '}
                          por paciente
                        </span>
                      </p>
                      <dl className="mt-3 space-y-2 text-xs">
                        <div className="flex justify-between gap-3">
                          <dt className="font-normal text-slate-500">
                            Receita mensal
                          </dt>
                          <dd className="font-medium text-slate-900">
                            {formatCurrency(
                              preview.postDiscount.revenueCents
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="font-normal text-slate-500">
                            Margem EBITDA
                          </dt>
                          <dd className="font-medium text-slate-900">
                            {formatPercent(
                              preview.postDiscount
                                .ebitdaMarginBasisPoints
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  {preview.missingAssumptions.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-medium text-amber-950">
                        Não foi possível calcular todas as margens porque faltam:
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-normal text-amber-900">
                        {preview.missingAssumptions.map((key) => (
                          <li key={key}>
                            {assumptionLabels[
                              key as keyof SalesAssumptionValues
                            ] || key}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={onOpenAssumptions}
                        className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900"
                      >
                        <Settings2 size={15} />
                        Configurar dados ausentes
                      </button>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <details className="group rounded-lg border border-slate-200 bg-white">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                        <span className="text-sm font-medium text-slate-800">
                          Projeções de 12, 24 e 36 meses
                        </span>
                        <ChevronDown
                          size={17}
                          className="text-slate-500 transition group-open:rotate-180"
                        />
                      </summary>
                      <div className="grid gap-2 border-t border-slate-200 p-4 sm:grid-cols-3">
                        {(['12', '24', '36'] as const).map((horizon) =>
                          renderMetric(
                            `Acumulado em ${horizon} meses`,
                            formatCurrency(
                              preview.horizons[horizon].ebitdaCents
                            ),
                            `EBITDA estimado · receita ${formatCurrency(
                              preview.horizons[horizon].revenueCents
                            )}`
                          )
                        )}
                      </div>
                    </details>

                    <details className="group rounded-lg border border-slate-200 bg-white">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                        <span className="text-sm font-medium text-slate-800">
                          Ponto de equilíbrio
                        </span>
                        <ChevronDown
                          size={17}
                          className="text-slate-500 transition group-open:rotate-180"
                        />
                      </summary>
                      <div className="grid gap-2 border-t border-slate-200 p-4 sm:grid-cols-3">
                        {renderMetric(
                          'Contribuição positiva',
                          preview.breakEven.contributionPositiveQuantity == null
                            ? 'Não alcançável'
                            : `${preview.breakEven.contributionPositiveQuantity} pacientes`
                        )}
                        {renderMetric(
                          'EBITDA não negativo',
                          preview.breakEven.nonNegativeEbitdaQuantity == null
                            ? 'Não alcançável'
                            : `${preview.breakEven.nonNegativeEbitdaQuantity} pacientes`
                        )}
                        {renderMetric(
                          'Margem mínima',
                          preview.breakEven.minimumMarginQuantity == null
                            ? 'Não calculável'
                            : `${preview.breakEven.minimumMarginQuantity} pacientes`
                        )}
                      </div>
                    </details>

                    <details className="group rounded-lg border border-slate-200 bg-white">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                        <span className="text-sm font-medium text-slate-800">
                          Detalhamento dos custos
                        </span>
                        <ChevronDown
                          size={17}
                          className="text-slate-500 transition group-open:rotate-180"
                        />
                      </summary>
                      <dl className="grid gap-2 border-t border-slate-200 p-4 sm:grid-cols-2">
                        {[
                          [
                            'Inadimplência estimada',
                            preview.promotional.estimatedDelinquencyCents,
                          ],
                          ['Stripe', preview.promotional.stripeCostCents],
                          [
                            'Impostos sobre receita',
                            preview.promotional.revenueTaxCents,
                          ],
                          [
                            'Custos variáveis',
                            preview.promotional.variableCostsCents,
                          ],
                          [
                            'Custos operacionais',
                            preview.promotional.operationalCostsCents,
                          ],
                          [
                            'Custos fixos rateados',
                            preview.promotional.fixedCostsAllocatedCents,
                          ],
                          [
                            'Custos comerciais únicos',
                            preview.oneTimeCommercialCostCents,
                          ],
                        ].map(([label, value]) => (
                          <div
                            key={String(label)}
                            className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"
                          >
                            <dt className="text-xs font-normal text-slate-600">
                              {label}
                            </dt>
                            <dd className="text-xs font-medium text-slate-900">
                              {formatCurrency(value as number | null)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>

                    <details className="group rounded-lg border border-slate-200 bg-white">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                        <span className="text-sm font-medium text-slate-800">
                          Origem dos dados
                        </span>
                        <ChevronDown
                          size={17}
                          className="text-slate-500 transition group-open:rotate-180"
                        />
                      </summary>
                      <div className="border-t border-slate-200 p-4">
                        {assumptionSet ? (
                          <dl className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(assumptionSet.sources).map(
                              ([key, source]) => (
                                <div
                                  key={key}
                                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"
                                >
                                  <dt className="text-xs font-normal text-slate-600">
                                    {assumptionLabels[
                                      key as keyof SalesAssumptionValues
                                    ] || key}
                                  </dt>
                                  <dd className="text-xs font-medium text-slate-900">
                                    {
                                      sourceLabels[
                                        source as keyof typeof sourceLabels
                                      ]
                                    }
                                  </dd>
                                </div>
                              )
                            )}
                          </dl>
                        ) : (
                          <p className="text-sm font-normal text-slate-600">
                            Ainda não há uma versão ativa para informar a origem
                            dos custos.
                          </p>
                        )}
                      </div>
                    </details>

                    <details className="group rounded-lg border border-slate-200 bg-white">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                        <span className="text-sm font-medium text-slate-800">
                          Memória de cálculo
                        </span>
                        <ChevronDown
                          size={17}
                          className="text-slate-500 transition group-open:rotate-180"
                        />
                      </summary>
                      <div className="space-y-2 border-t border-slate-200 p-4 text-xs font-normal leading-5 text-slate-600">
                        <p>
                          Modelo: <span className="font-medium text-slate-800">{preview.modelVersion}</span>
                        </p>
                        <p>
                          Receita mensal = pacientes ativos × preço por paciente
                          após o desconto.
                        </p>
                        <p>
                          Margem, EBITDA e lucro usam o snapshot da versão de
                          premissas vinculada à simulação.
                        </p>
                        <p>
                          Economia mensal concedida:{' '}
                          <span className="font-medium text-slate-800">
                            {formatCurrency(preview.monthlySavingsCents)}
                          </span>
                        </p>
                      </div>
                    </details>
                  </div>

                  {preview.warnings.length > 0 ? (
                    <div className="border border-amber-200 bg-amber-50 p-3">
                      {preview.warnings.map((warning) => (
                        <p
                          key={warning}
                          className="text-xs font-normal leading-5 text-amber-900"
                        >
                          {warning}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <p className="text-[11px] font-normal leading-5 text-slate-500">
                    Projeção gerencial interna. Não garante permanência, não
                    considera churn, não representa lançamento contábil e não
                    altera a DRE realizada.
                  </p>
                </section>
              ) : null}

              <details className="group border border-slate-200 bg-white">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 p-4 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-500">
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">
                      Histórico de simulações
                    </span>
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      {simulations.length} registro(s) · snapshots imutáveis
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    className="shrink-0 text-slate-500 transition group-open:rotate-180"
                  />
                </summary>

                <div className="border-t border-slate-200 p-4">
                  <p className="mb-4 text-xs font-normal text-slate-500">
                    Compare até três versões. Snapshots históricos não são
                    recalculados.
                  </p>
                  {simulations.length === 0 ? (
                    <div className="border border-dashed border-slate-300 p-5 text-center text-sm font-normal text-slate-500">
                      Nenhuma simulação salva para este lead.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {simulations.map((simulation) => {
                      const result = simulation.results_snapshot;
                      const selected =
                        selectedSimulationId === simulation.id;
                      return (
                        <article
                          key={simulation.id}
                          className={`border p-3 ${
                            selected
                              ? 'border-violet-400 bg-violet-50/40'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {
                                  simulation.initial_active_patient_quantity
                                }{' '}
                                pacientes ·{' '}
                                {Number(
                                  simulation.discount_percentage || 0
                                ).toLocaleString('pt-BR', {
                                  maximumFractionDigits: 2,
                                })}
                                % por{' '}
                                {simulation.discount_duration_months || 0}{' '}
                                mês(es)
                              </p>
                              <p className="mt-1 text-xs font-normal text-slate-500">
                                {new Date(
                                  simulation.created_at
                                ).toLocaleString('pt-BR')} ·{' '}
                                {
                                  ratingCopy[
                                    simulation.profitability_rating
                                  ].label
                                }
                              </p>
                            </div>
                            {simulation.offer ? (
                              <span className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
                                Proposta criada
                              </span>
                            ) : selected ? (
                              <span className="border border-violet-200 bg-violet-100 px-2 py-1 text-[11px] font-medium text-violet-800">
                                Selecionada
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            {renderMetric(
                              'Receita promocional',
                              formatCurrency(
                                result.promotionalMonthlyRevenueCents
                              )
                            )}
                            {renderMetric(
                              'Margem EBITDA',
                              formatPercent(
                                result.promotional
                                  .ebitdaMarginBasisPoints
                              )
                            )}
                            {renderMetric(
                              'Lucro líquido',
                              formatCurrency(
                                result.promotional.netIncomeCents
                              )
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void selectSimulation(simulation)
                              }
                              disabled={
                                Boolean(simulation.offer) ||
                                busy === `select:${simulation.id}`
                              }
                              className="inline-flex min-h-10 items-center justify-center gap-2 border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 disabled:opacity-50"
                            >
                              {busy === `select:${simulation.id}` ? (
                                <Loader2
                                  className="animate-spin"
                                  size={14}
                                />
                              ) : (
                                <CheckCircle2 size={14} />
                              )}
                              Selecionar
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                duplicateSimulation(simulation)
                              }
                              className="inline-flex min-h-10 items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                            >
                              <RotateCcw size={14} />
                              Duplicar
                            </button>
                            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
                              <input
                                type="checkbox"
                                checked={comparisonIds.includes(
                                  simulation.id
                                )}
                                onChange={() =>
                                  toggleComparison(simulation.id)
                                }
                                className="accent-violet-600"
                              />
                              Comparar
                            </label>
                          </div>
                        </article>
                      );
                      })}
                    </div>
                  )}
                </div>
              </details>

              {comparedSimulations.length > 1 ? (
                <section className="overflow-x-auto border border-slate-200 bg-white p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <GitCompareArrows size={17} className="text-violet-600" />
                    Comparação
                  </h3>
                  <table className="mt-3 w-full min-w-[620px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="px-2 py-2 font-medium">Condição</th>
                        <th className="px-2 py-2 font-medium">Receita</th>
                        <th className="px-2 py-2 font-medium">EBITDA</th>
                        <th className="px-2 py-2 font-medium">Margem</th>
                        <th className="px-2 py-2 font-medium">Classificação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparedSimulations.map((simulation) => (
                        <tr
                          key={simulation.id}
                          className="border-b border-slate-100"
                        >
                          <td className="px-2 py-2.5 text-slate-700">
                            {simulation.initial_active_patient_quantity} ·{' '}
                            {simulation.discount_percentage}% ·{' '}
                            {simulation.discount_duration_months || 0}m
                          </td>
                          <td className="px-2 py-2.5 text-slate-700">
                            {formatCurrency(
                              simulation.results_snapshot
                                .promotionalMonthlyRevenueCents
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-slate-700">
                            {formatCurrency(
                              simulation.results_snapshot.promotional
                                .ebitdaCents
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-slate-700">
                            {formatPercent(
                              simulation.results_snapshot.promotional
                                .ebitdaMarginBasisPoints
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-slate-700">
                            {
                              ratingCopy[
                                simulation.profitability_rating
                              ].label
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}

              {preparedOffer?.publicUrl ? (
                <section className="border border-emerald-200 bg-emerald-50 p-4">
                  <h3 className="text-sm font-semibold text-emerald-900">
                    Proposta pronta para envio
                  </h3>
                  <p className="mt-1 break-all text-xs font-normal text-emerald-800">
                    {preparedOffer.publicUrl}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <a
                      href={preparedOffer.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 bg-slate-900 px-3 text-xs font-medium text-white"
                    >
                      <ExternalLink size={15} />
                      Abrir proposta
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyPublicUrl()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 border border-emerald-300 bg-white px-3 text-xs font-medium text-emerald-800"
                    >
                      <Copy size={15} />
                      Copiar link
                    </button>
                    {whatsappUrl ? (
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center justify-center gap-2 bg-emerald-600 px-3 text-xs font-medium text-white"
                      >
                        <MessageCircle size={15} />
                        Enviar pelo WhatsApp
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="min-h-11 bg-slate-200 px-3 text-xs text-slate-500"
                      >
                        WhatsApp não informado
                      </button>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>

        {!loading ? (
          <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            {selectedSimulation?.profitability_rating === 'insufficient_data' ? (
              <p
                id="sales-profitability-prepare-hint"
                className="mb-2 text-sm font-normal text-amber-700 sm:text-right"
                role="status"
              >
                Complete as premissas financeiras obrigatórias antes de preparar a oferta.
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={Boolean(busy)}
                className="min-h-11 border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => void saveSimulation()}
                disabled={
                  Boolean(busy) ||
                  !preview
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-violet-300 bg-white px-4 text-sm font-medium text-violet-700 disabled:opacity-50"
              >
                {busy === 'simulation' ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Save size={17} />
                )}
                {assumptionSet
                  ? 'Salvar simulação'
                  : 'Salvar simulação incompleta'}
              </button>
              <button
                type="button"
                onClick={() => void prepareOffer()}
                aria-describedby={
                  selectedSimulation?.profitability_rating === 'insufficient_data'
                    ? 'sales-profitability-prepare-hint'
                    : undefined
                }
                disabled={
                  Boolean(busy) ||
                  !selectedSimulation ||
                  selectedSimulation.profitability_rating === 'insufficient_data'
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#7a32fc] px-4 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy === 'offer' ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <CircleDollarSign size={17} />
                )}
                {selectedSimulation?.offer
                  ? 'Recuperar proposta'
                  : 'Preparar oferta'}
              </button>
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  );
};

export const SalesProfitabilitySimulator = (
  props: SalesProfitabilitySimulatorProps
) => (
  <SalesModularProposalBuilder
    {...props}
    legacyFallback={<LegacySalesProfitabilitySimulator {...props} />}
  />
);
