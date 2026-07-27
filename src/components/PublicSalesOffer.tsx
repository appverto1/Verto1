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
  publicMetadata: Record<string, any>;
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
              <p className="shrink-0 pl-[23px] text-sm font-semibold text-slate-900 sm:pl-0">
                {formatSalesCurrency(
                  hasPromotion
                    ? item.promotionalRecurringAmountCents
                    : item.postPromotionRecurringAmountCents,
                  offer.currency
                )}
                <span className="font-normal text-slate-500">/mês</span>
              </p>
            </div>
          ))}
        </div>
      </div>

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
        {new Date(offer.expiresAt).toLocaleString('pt-BR')}.
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
        <p className="text-sm font-medium text-slate-800">
          Proposta comercial para análise
        </p>
        <p className="mt-1 text-xs font-normal leading-5 text-slate-500">
          O checkout modular será habilitado após a validação da nova estrutura
          de pacotes. Fale com a equipe comercial para continuar.
        </p>
      </div>
    </>
  );
};

export const PublicSalesOffer = ({ token }: { token: string }) => {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
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
        if (!cancelled) setOffer(data.offer);
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
                <ModularOfferDetails offer={offer} />
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
