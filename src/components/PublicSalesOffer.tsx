import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Layers3,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import { LogoVerto } from './Common';
import {
  PUBLIC_ACTIVE_PATIENT_PRICE_LABEL,
  formatSalesCurrency
} from '../constants/salesCommercial';
import type {
  CustomCapacityPolicy,
  OfferItemDiscount
} from '../utils/salesCommercialEvolution';
import { formatSalesCommercialDate } from '../utils/salesCommercialDate';

type LegacyPublicOffer = {
  offerType: 'legacy';
  clinicName?: string | null;
  leadName?: string | null;
  baseUnitAmountCents: number;
  currency: string;
  initialActivePatientQuantity: number;
  discountType: 'none' | 'coupon';
  discountDurationMonths?: number | null;
  discountPercentage?: number | null;
  promotionalUnitAmountCents: number;
  promotionalMonthlyAmountCents: number;
  postDiscountMonthlyAmountCents: number;
  expiresAt: string;
  status: string;
  stripeReady: boolean;
};

type ModularOfferItem = {
  itemKey: string;
  publicName: string;
  description: string;
  pricingMode: string;
  quantity: number;
  limitQuantity: number | null;
  includedQuantity: number | null;
  grossRecurringAmountCents: number;
  promotionalRecurringAmountCents: number;
  postPromotionRecurringAmountCents: number;
  oneTimeAmountCents: number;
  itemDiscountBasisPoints: number;
  offerDiscount?: OfferItemDiscount | null;
  publicMetadata: Record<string, any>;
};

type PublicOfferCommercialPhase = {
  phaseNumber: number;
  startsAt: string;
  endsAt: string | null;
  recurringRevenueCents: number;
  invoiceAmountCents: number;
  lines: Array<{
    itemKey: string;
    publicName: string;
    billingInterval: 'monthly' | 'one_time';
    normalPriceCents: number;
    activePriceCents: number;
    discountCents: number;
    itemDiscountCents: number;
    globalDiscountCents: number;
    discount: Omit<OfferItemDiscount, 'internalNotes'> | null;
  }>;
};

type PublicCapacitySnapshot = {
  schemaVersion: number;
  demandPatients: number;
  baseLimitPatients: number;
  basePriceCents: number;
  minimumBlocks: number;
  selectedBlocks: number;
  selectionMode: 'automatic' | 'manual';
  addedCapacityPatients: number;
  totalContractedLimitPatients: number;
  includedStorageMb: number;
  blocksMonthlyRevenueCents: number;
  effectiveBlockPriceCents: number | null;
  blockPricingBasis:
    | 'catalog_fixed'
    | 'selected_module_per_patient_prices';
  blockSizePatients?: number;
  gracePeriodDays?: number;
  billingAdjustment?: 'next_cycle';
  policy?: CustomCapacityPolicy | null;
};

type PublicCapacityBlockPhase = {
  schemaVersion: 1;
  phaseNumber: number;
  startsAt: string;
  endsAt: string | null;
  baseCapacityPatients: number;
  contractedCapacityPatients: number;
  blockSizePatients: number;
  selectedBlocks: number;
  effectivePricePerPatientCents: number;
  contractedMonthlyRevenueCents: number;
  blockPriceCents: number;
  blocksRevenueCents: number;
  modules: Array<{
    itemKey: string;
    publicName: string;
    normalPricePerPatientCents: number;
    effectivePricePerPatientCents: number;
    normalBlockRevenueCents: number;
    blockRevenueCents: number;
    subsidizedBlockRevenueCents: number;
  }>;
};

export type ModularPublicOffer = {
  offerType: 'modular';
  proposalName: string;
  clinicName?: string | null;
  leadName?: string | null;
  currency: string;
  initialActivePatientQuantity: number;
  basePackage?: {
    name?: string;
    limitQuantity?: number | null;
    includedStorageMb?: number | null;
    capacity?: PublicCapacitySnapshot | null;
  } | null;
  items: ModularOfferItem[];
  promotionalMonthlyAmountCents: number;
  postDiscountMonthlyAmountCents: number;
  oneTimeAmountCents: number;
  globalDiscountCents: number;
  globalDiscountPercentage: number;
  discountDurationMonths: number;
  onboardingInstallments: number;
  publicNotes?: string | null;
  expiresAt: string;
  status: string;
  modularCheckoutEnabled: false;
  stripeReady: false;
  acceptedAt?: string | null;
  commercialPhases?: PublicOfferCommercialPhase[];
  capacityBlockPhases?: PublicCapacityBlockPhase[];
};

type PublicOffer = LegacyPublicOffer | ModularPublicOffer;

type PaymentReturnState =
  | 'idle'
  | 'confirming'
  | 'payment_confirmed'
  | 'activation_email_sent'
  | 'review_required'
  | 'unavailable';

export const ModularOfferDetails = ({
  offer
}: {
  offer: ModularPublicOffer;
}) => {
  const recurringItems = offer.items.filter(
    (item) => item.pricingMode !== 'one_time'
  );
  const oneTimeItems = offer.items.filter(
    (item) => item.oneTimeAmountCents > 0
  );
  const hasPromotion =
    offer.promotionalMonthlyAmountCents !==
    offer.postDiscountMonthlyAmountCents;
  const capacityBlockPhases = offer.capacityBlockPhases || [];
  const currentBlockPhase = capacityBlockPhases[0] || null;
  const postBenefitBlockPhase =
    capacityBlockPhases[capacityBlockPhases.length - 1] || null;
  const publicBlockSizePatients =
    currentBlockPhase?.blockSizePatients ??
    offer.basePackage?.capacity?.blockSizePatients ??
    offer.basePackage?.capacity?.policy?.blockSizePatients ??
    0;
  const publicGracePeriodDays =
    offer.basePackage?.capacity?.gracePeriodDays ??
    offer.basePackage?.capacity?.policy?.gracePeriodDays ??
    0;
  const historicalBlockPriceCents =
    offer.basePackage?.capacity?.effectiveBlockPriceCents ??
    offer.basePackage?.capacity?.policy?.blockPriceCents ??
    null;

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Estrutura escolhida</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {offer.basePackage?.name || 'Verto Clínica'}
          </p>
          <p className="mt-1 text-xs font-normal text-slate-500">
            {offer.initialActivePatientQuantity} pacientes estimados
            {offer.basePackage?.limitQuantity
              ? ` · limite de ${offer.basePackage.limitQuantity}`
              : ''}
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {recurringItems.map((item) => (
            <div
              key={`${item.itemKey}:${item.publicMetadata?.tierName || 'item'}`}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Check size={15} className="shrink-0 text-emerald-600" />
                  <p className="text-sm font-medium text-slate-900">{item.publicName}</p>
                </div>
                <p className="mt-1 pl-[23px] text-xs font-normal leading-5 text-slate-500">
                  {item.description}
                </p>
                {Array.isArray(item.publicMetadata?.features) &&
                item.publicMetadata.features.length > 0 ? (
                  <ul className="mt-2 space-y-1 pl-[23px] text-xs font-normal leading-5 text-slate-600">
                    {item.publicMetadata.features.map(
                      (feature: string, featureIndex: number) => (
                        <li
                          key={`${item.itemKey}:feature:${featureIndex}`}
                          className="flex items-start gap-2"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-violet-400"
                          />
                          <span>{feature}</span>
                        </li>
                      )
                    )}
                  </ul>
                ) : null}
                {item.limitQuantity || item.includedQuantity ? (
                  <p className="mt-1 pl-[23px] text-xs font-medium text-violet-700">
                    {item.limitQuantity
                      ? `Limite: ${item.limitQuantity.toLocaleString('pt-BR')} ${item.publicMetadata?.unitName || ''}`
                      : `${item.includedQuantity?.toLocaleString('pt-BR')} ${item.publicMetadata?.unitName || ''} incluídos`}
                  </p>
                ) : null}
                {item.publicMetadata?.pricePerPatientCents != null ? (
                  <p className="mt-1 pl-[23px] text-xs font-medium text-slate-700">
                    {formatSalesCurrency(
                      Number(item.publicMetadata.pricePerPatientCents),
                      offer.currency
                    )}{' '}
                    por paciente/mês · capacidade faturada{' '}
                    {Number(
                      item.publicMetadata.billedCapacityPatients || 0
                    ).toLocaleString('pt-BR')}
                  </p>
                ) : null}
                {item.itemDiscountBasisPoints > 0 ? (
                  <p className="mt-1 pl-[23px] text-xs font-medium text-emerald-700">
                    Desconto do módulo:{' '}
                    {(item.itemDiscountBasisPoints / 100).toLocaleString(
                      'pt-BR',
                      { maximumFractionDigits: 2 }
                    )}
                    %
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 pl-[23px] text-left sm:min-w-44 sm:pl-0 sm:text-right">
                {item.offerDiscount ? (
                  <>
                    <p className="text-xs text-slate-500">
                      Preço de tabela: {formatSalesCurrency(item.offerDiscount.priceBeforeDiscountCents, offer.currency)}/mês
                    </p>
                    <p className="mt-1 text-sm font-semibold text-violet-800">
                      {formatSalesCurrency(item.offerDiscount.discountedPriceCents, offer.currency)}/mês
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-700">
                      {item.offerDiscount.durationCount
                        ? `durante ${item.offerDiscount.durationCount} ${item.offerDiscount.durationUnit === 'days' ? 'dias' : 'meses'}`
                        : item.offerDiscount.endsAt
                          ? `até ${formatSalesCommercialDate(item.offerDiscount.endsAt)}`
                          : 'condição vigente'}
                    </p>
                    <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-900">
                      Depois: {formatSalesCurrency(item.offerDiscount.priceAfterExpirationCents, offer.currency)}/mês
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-900">
                    {formatSalesCurrency(
                      hasPromotion
                        ? item.promotionalRecurringAmountCents
                        : item.postPromotionRecurringAmountCents,
                      offer.currency
                    )}
                    <span className="font-normal text-slate-500">/mês</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {offer.basePackage?.capacity ? (
        <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
          <p className="text-sm font-medium text-violet-950">Capacidade contratada do Verto Clínica</p>
          <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
            <span>Limite-base: {offer.basePackage.capacity.baseLimitPatients} pacientes</span>
            <span>Quantidade reservada: {offer.basePackage.capacity.selectedBlocks} bloco(s)</span>
            <span>Limite total: {offer.basePackage.capacity.totalContractedLimitPatients} pacientes</span>
            <span>Armazenamento: {offer.basePackage.capacity.includedStorageMb.toLocaleString('pt-BR')} MB</span>
            <span>
              Valor do bloco nesta fase:{' '}
              {currentBlockPhase == null
                ? historicalBlockPriceCents == null
                  ? 'definido na condição comercial'
                  : `${formatSalesCurrency(
                      historicalBlockPriceCents,
                      offer.currency
                    )}/mês`
                : `${formatSalesCurrency(
                    currentBlockPhase.blockPriceCents,
                    offer.currency
                  )}/mês`}
            </span>
            {postBenefitBlockPhase &&
            postBenefitBlockPhase.phaseNumber !==
              currentBlockPhase?.phaseNumber ? (
              <span>
                Valor do bloco após os benefícios:{' '}
                {formatSalesCurrency(
                  postBenefitBlockPhase.blockPriceCents,
                  offer.currency
                )}/mês
              </span>
            ) : null}
            <span>
              Valor dos blocos reservados nesta fase:{' '}
              {formatSalesCurrency(
                currentBlockPhase?.blocksRevenueCents ??
                  offer.basePackage.capacity.blocksMonthlyRevenueCents,
                offer.currency
              )}/mês
            </span>
          </div>
          {currentBlockPhase ? (
            <details className="mt-3 rounded-xl border border-violet-100 bg-white/80">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-violet-900">
                Módulos que compõem o bloco de{' '}
                {currentBlockPhase.blockSizePatients}
              </summary>
              <div className="divide-y divide-violet-50 border-t border-violet-100 px-3">
                {currentBlockPhase.modules.map((module) => {
                  const postModule = postBenefitBlockPhase?.modules.find(
                    (candidate) => candidate.itemKey === module.itemKey
                  );
                  return (
                    <div
                      key={module.itemKey}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <span className="text-slate-600">{module.publicName}</span>
                      <span className="text-right font-medium text-slate-800">
                        {formatSalesCurrency(
                          module.blockRevenueCents,
                          offer.currency
                        )}
                        {postModule &&
                        postModule.blockRevenueCents !==
                          module.blockRevenueCents
                          ? ` · depois ${formatSalesCurrency(
                              postModule.blockRevenueCents,
                              offer.currency
                            )}`
                          : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}
          {capacityBlockPhases.length > 0 ? (
            <div className="mt-3 space-y-2" aria-label="Fases comerciais da capacidade">
              {capacityBlockPhases.map((phase, phaseIndex) => {
                const previousPhase =
                  phaseIndex > 0 ? capacityBlockPhases[phaseIndex - 1] : null;
                const changedModules = phase.modules.filter((module) => {
                  if (!previousPhase) return true;
                  const previousModule = previousPhase.modules.find(
                    (candidate) => candidate.itemKey === module.itemKey
                  );
                  return (
                    !previousModule ||
                    previousModule.effectivePricePerPatientCents !==
                      module.effectivePricePerPatientCents
                  );
                });
                return (
                  <div
                    key={phase.phaseNumber}
                    className="rounded-xl border border-violet-100 bg-white/80 p-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-medium text-violet-900">
                          Fase {phase.phaseNumber}
                        </p>
                        <p className="mt-0.5 text-[11px] font-normal text-slate-500">
                          {formatSalesCommercialDate(phase.startsAt)} —{' '}
                          {phase.endsAt
                            ? formatSalesCommercialDate(phase.endsAt)
                            : 'condição permanente'}
                        </p>
                      </div>
                      <div className="text-left text-xs text-slate-700 sm:text-right">
                        <p>
                          {formatSalesCurrency(
                            phase.effectivePricePerPatientCents,
                            offer.currency
                          )}
                          /paciente
                        </p>
                        <p className="mt-0.5 font-medium text-slate-900">
                          {formatSalesCurrency(
                            phase.contractedMonthlyRevenueCents,
                            offer.currency
                          )}
                          /mês · bloco{' '}
                          {formatSalesCurrency(
                            phase.blockPriceCents,
                            offer.currency
                          )}
                        </p>
                      </div>
                    </div>
                    {changedModules.length > 0 ? (
                      <p className="mt-2 text-[11px] font-normal leading-5 text-slate-600">
                        {phaseIndex === 0
                          ? 'Módulos desta fase: '
                          : 'Valores alterados nesta fase: '}
                        {changedModules
                          .map(
                            (module) =>
                              `${module.publicName} ${formatSalesCurrency(
                                module.effectivePricePerPatientCents,
                                offer.currency
                              )}/paciente`
                          )
                          .join(' · ')}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          <p className="mt-3 text-xs leading-5 text-slate-600">
            A capacidade contratada contempla até{' '}
            {offer.basePackage.capacity.baseLimitPatients} pacientes ativos. Ao
            ultrapassar esse limite, a capacidade será ampliada em blocos de{' '}
            {publicBlockSizePatients} pacientes,
            mantendo os mesmos módulos contratados e os preços por paciente
            vigentes em cada fase. Há{' '}
            {publicGracePeriodDays} dias de
            tolerância para ajuste no próximo ciclo. O atendimento clínico
            nunca é bloqueado.
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {hasPromotion ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-xs font-medium text-violet-700">
              Durante a promoção
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatSalesCurrency(
                offer.promotionalMonthlyAmountCents,
                offer.currency
              )}
              <span className="text-sm font-normal text-slate-500">/mês</span>
            </p>
            <p className="mt-1 text-xs font-normal text-slate-600">
              {offer.globalDiscountPercentage.toLocaleString('pt-BR', {
                maximumFractionDigits: 2
              })}
              % de desconto por {offer.discountDurationMonths} meses
            </p>
          </div>
        ) : null}
        <div
          className={`rounded-2xl border border-emerald-200 bg-emerald-50 p-4 ${
            hasPromotion ? '' : 'sm:col-span-2'
          }`}
        >
          <p className="text-xs font-medium text-emerald-700">
            {hasPromotion ? 'Após a promoção' : 'Total mensal'}
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {formatSalesCurrency(
              offer.postDiscountMonthlyAmountCents,
              offer.currency
            )}
            <span className="text-sm font-normal text-slate-500">/mês</span>
          </p>
        </div>
      </div>

      {oneTimeItems.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Implantação</p>
          {oneTimeItems.map((item) => (
            <div
              key={item.itemKey}
              className="mt-2 flex items-center justify-between gap-4 text-sm"
            >
              <span className="font-normal text-slate-700">{item.publicName}</span>
              <span className="font-semibold text-slate-900">
                {formatSalesCurrency(item.oneTimeAmountCents, offer.currency)}
              </span>
            </div>
          ))}
          {offer.onboardingInstallments > 1 ? (
            <p className="mt-2 text-xs font-normal text-slate-500">
              Condição comercial: {offer.onboardingInstallments} parcelas,
              sem criar cobrança na Stripe nesta etapa.
            </p>
          ) : null}
        </div>
      ) : null}

      {offer.publicNotes ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-normal leading-6 text-slate-700">
          {offer.publicNotes}
        </div>
      ) : null}

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-4">
        <Layers3 size={18} className="mt-0.5 shrink-0 text-violet-700" />
        <p className="text-sm font-normal leading-6 text-violet-950">
          Comece com a estrutura que sua clínica precisa hoje e adicione novos
          módulos conforme sua operação crescer. Toda a estrutura clínica e ABA
          está incluída no Verto Clínica.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-normal text-amber-900">
        Proposta válida até{' '}
        {formatSalesCommercialDate(offer.expiresAt)}.
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
        <p className="text-sm font-medium text-slate-800">
          Venda assistida pela equipe Verto
        </p>
        <p className="mt-1 text-xs font-normal leading-5 text-slate-500">
          Após seu aceite, um owner com MFA gera o link de pagamento individual; o checkout modular será habilitado somente por esse fluxo assistido.
          Esta página não cria cadastro público nem ativa a clínica.
        </p>
      </div>
    </>
  );
};

export const PublicSalesOffer = ({ token }: { token: string }) => {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [commercialConsent, setCommercialConsent] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [paymentReturnState, setPaymentReturnState] = useState<PaymentReturnState>('idle');

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const query = new URLSearchParams(window.location.search);
    const checkoutSessionId = query.get('session_id') || '';
    const returnedFromPayment = query.get('payment') === 'success' && Boolean(checkoutSessionId);

    const loadPaymentStatus = async () => {
      setPaymentReturnState('confirming');
      setLoading(false);
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts && !cancelled; attempt += 1) {
        try {
          const response = await fetch(
            `/api/public/sales-offers/${encodeURIComponent(token)}/payment-status?session_id=${encodeURIComponent(checkoutSessionId)}`,
            { credentials: 'omit', cache: 'no-store' }
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok && response.status !== 202) {
            throw new Error(data?.error || 'PAYMENT_STATUS_UNAVAILABLE');
          }
          if (cancelled) return;
          if (data?.state === 'activation_email_sent') {
            setPaymentReturnState('activation_email_sent');
            return;
          }
          if (data?.state === 'review_required') {
            setPaymentReturnState('review_required');
            return;
          }
          if (data?.state === 'payment_confirmed') {
            setPaymentReturnState('payment_confirmed');
          }
        } catch {
          if (attempt === maxAttempts - 1 && !cancelled) {
            setPaymentReturnState('unavailable');
            return;
          }
        }
        await new Promise<void>((resolve) => {
          retryTimer = window.setTimeout(resolve, 2000);
        });
      }
      if (!cancelled) setPaymentReturnState('payment_confirmed');
    };

    const loadOffer = async () => {
      try {
        const response = await fetch(`/api/public/sales-offers/${encodeURIComponent(token)}`, {
          credentials: 'omit'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.success === false) {
          throw new Error(data?.message || data?.error || 'Oferta indisponível.');
        }
        if (!cancelled) {
          setOffer(data.offer);
          setAcceptedAt(data.offer?.acceptedAt || null);
        }
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || 'Não foi possível carregar esta oferta.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (returnedFromPayment) void loadPaymentStatus();
    else void loadOffer();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [token]);

  const continueToCheckout = async () => {
    setContinuing(true);
    setError('');
    try {
      const response = await fetch(`/api/public/sales-offers/${encodeURIComponent(token)}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ acceptTerms: true })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || data?.error || 'Não foi possível continuar.');
      }
      if (!data?.url) throw new Error('Checkout indisponível.');
      window.location.assign(data.url);
    } catch (checkoutError: any) {
      setError(checkoutError?.message || 'Não foi possível continuar.');
    } finally {
      setContinuing(false);
    }
  };

  const acceptModularOffer = async () => {
    if (!commercialConsent) return;
    setAccepting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/public/sales-offers/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({
            commercialValuesConsent: true
          })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Não foi possível registrar o aceite.');
      }
      setAcceptedAt(data.acceptedAt || new Date().toISOString());
    } catch (acceptError: any) {
      setError(acceptError?.message || 'Não foi possível registrar o aceite.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 md:py-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex justify-center"><LogoVerto /></div>
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm md:p-8">
          {paymentReturnState !== 'idle' ? (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              {paymentReturnState === 'confirming' ? (
                <Loader2 className="mb-4 animate-spin text-violet-600" size={30} />
              ) : paymentReturnState === 'unavailable' || paymentReturnState === 'review_required' ? (
                <AlertCircle className="mb-4 text-amber-600" size={32} />
              ) : (
                <CheckCircle2 className="mb-4 text-emerald-600" size={32} />
              )}
              <h1 className="text-xl font-semibold text-slate-900">
                {paymentReturnState === 'confirming'
                  ? 'Confirmando seu pagamento'
                  : paymentReturnState === 'activation_email_sent'
                    ? 'Pagamento confirmado'
                    : paymentReturnState === 'review_required'
                      ? 'Pagamento recebido'
                      : paymentReturnState === 'unavailable'
                        ? 'Confirmação em andamento'
                        : 'Pagamento confirmado'}
              </h1>
              <p className="mt-3 max-w-md text-sm font-normal leading-6 text-slate-600">
                {paymentReturnState === 'activation_email_sent'
                  ? 'Enviamos o link de ativação para o e-mail informado no Checkout. Abra a mensagem para criar seu acesso à Verto.'
                  : paymentReturnState === 'review_required'
                    ? 'Seu pagamento foi preservado. A equipe da Verto revisará os dados de ativação antes de liberar o acesso.'
                    : paymentReturnState === 'unavailable'
                      ? 'Ainda não recebemos a confirmação final. Aguarde alguns minutos e verifique seu e-mail; se necessário, fale com o suporte.'
                      : 'A Stripe confirmou o retorno e estamos preparando seu e-mail de ativação. Esta página não cria a conta automaticamente.'}
              </p>
            </div>
          ) : loading ? (
            <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-600">
              <Loader2 className="animate-spin" size={20} /> Carregando proposta...
            </div>
          ) : error && !offer ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-center">
              <AlertCircle className="mx-auto mb-3 text-rose-600" />
              <h1 className="text-lg font-semibold text-slate-900">Oferta indisponível</h1>
              <p className="mt-2 text-sm font-normal text-slate-600">{error}</p>
            </div>
          ) : offer ? (
            <div>
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-violet-50 p-3 text-violet-700"><ShieldCheck size={22} /></div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-violet-600">
                    {offer.offerType === 'modular'
                      ? offer.proposalName
                      : 'Proposta individual Verto'}
                  </p>
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">
                    {offer.clinicName || offer.leadName || 'Sua operação clínica'}
                  </h1>
                  <p className="mt-2 text-sm font-normal leading-6 text-slate-600">
                    Esta proposta é vinculada exclusivamente aos dados apresentados à equipe comercial da Verto.
                  </p>
                </div>
              </div>

              {offer.offerType === 'modular' ? (
                <>
                  <ModularOfferDetails offer={offer} />
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                    {acceptedAt ? (
                      <div className="flex items-start gap-3 text-sm text-emerald-800">
                        <CheckCircle2 size={19} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">Proposta aceita</p>
                          <p className="mt-1 font-normal leading-5 text-slate-600">
                            Aceite registrado em {new Date(acceptedAt).toLocaleString('pt-BR')}. A equipe comercial poderá gerar o link de pagamento assistido.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-700">
                          <input
                            type="checkbox"
                            checked={commercialConsent}
                            onChange={(event) => setCommercialConsent(event.target.checked)}
                            className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                          />
                          <span>
                            Declaro estar ciente dos valores promocionais e dos valores aplicáveis após o término de cada benefício.
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void acceptModularOffer()}
                          disabled={!commercialConsent || accepting}
                          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {accepting ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
                          {accepting ? 'Registrando aceite...' : 'Aceitar proposta'}
                        </button>
                      </>
                    )}
                  </div>
                  {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
                </>
              ) : (
                <>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">Preço oficial</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {offer.baseUnitAmountCents
                      ? `${formatSalesCurrency(offer.baseUnitAmountCents, offer.currency)} por paciente ativo/mês`
                      : PUBLIC_ACTIVE_PATIENT_PRICE_LABEL}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">Quantidade inicial</p>
                  <p className="mt-1 text-base font-semibold text-slate-900">{offer.initialActivePatientQuantity} pacientes ativos</p>
                </div>
                {offer.discountType === 'coupon' ? (
                  <>
                    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                      <p className="text-xs font-medium text-violet-700">Condição promocional</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {Number(offer.discountPercentage || 0).toLocaleString('pt-BR', {
                          maximumFractionDigits: 2
                        })}% de desconto por {offer.discountDurationMonths} meses
                      </p>
                    </div>
                    <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                      <p className="text-xs font-medium text-violet-700">Preço promocional</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {formatSalesCurrency(offer.promotionalUnitAmountCents, offer.currency)} por paciente
                      </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:col-span-2">
                      <p className="text-xs font-medium text-emerald-700">Total mensal durante a promoção</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">
                        {formatSalesCurrency(offer.promotionalMonthlyAmountCents, offer.currency)}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                    <p className="text-xs font-medium text-slate-500">Condição comercial</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      Preço oficial, sem desconto temporário
                    </p>
                  </div>
                )}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
                  <p className="text-xs font-medium text-slate-500">
                    {offer.discountType === 'coupon'
                      ? 'Após o encerramento do desconto'
                      : 'Total mensal'}
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {formatSalesCurrency(offer.postDiscountMonthlyAmountCents, offer.currency)} por mês
                  </p>
                  {offer.discountType === 'coupon' ? (
                    <p className="mt-2 text-xs font-normal leading-5 text-slate-500">
                      O preço retorna automaticamente a {formatSalesCurrency(offer.baseUnitAmountCents, offer.currency)} por paciente, sem recriar a assinatura ou reiniciar o ciclo.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-normal text-amber-900">
                Proposta válida até {new Date(offer.expiresAt).toLocaleString('pt-BR')}.
              </div>

              {error ? <p className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}

              <button
                type="button"
                onClick={() => void continueToCheckout()}
                disabled={continuing || !offer.stripeReady}
                className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#7a32fc] px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {continuing ? <Loader2 className="animate-spin" size={17} /> : <CheckCircle2 size={17} />}
                {continuing ? 'Preparando Checkout...' : offer.stripeReady ? 'Continuar para cadastro e pagamento' : 'Configuração Stripe pendente'}
              </button>
              <p className="mt-3 text-center text-[11px] font-normal leading-5 text-slate-500">
                Ao continuar, você confirma que revisou a proposta e seguirá para os termos e a política de privacidade aplicáveis.
              </p>
                </>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
};
