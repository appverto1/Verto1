import React, { useEffect, useRef, useState } from 'react';
import { resolveSalesPostPaymentState, resolveSalesPostPaymentRetryDelayMs } from '../utils/salesPostPaymentState.mjs';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import { LogoVerto } from './Common';
import { ModularOfferDetails } from './ModularPublicOfferDetails';
export { ModularOfferDetails } from './ModularPublicOfferDetails';
import { getSupabase } from '../lib/supabase';
import { loadPublicSalesOfferResponse } from '../services/publicSalesOfferTransport';
import { acceptPublicSalesModularOffer, handoffPublicSalesCardCheckout } from '../services/publicSalesCardCheckout';
import { requestPublicSalesPostPaymentReconciliation, loadPublicSalesPaymentStatusResponse } from '../services/publicSalesPostPaymentTransport';
import {
  PUBLIC_ACTIVE_PATIENT_PRICE_LABEL,
  formatSalesCurrency
} from '../constants/salesCommercial';
import type {
  CustomCapacityPolicy,
  OfferItemDiscount
} from '../utils/salesCommercialEvolution';

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
  modularCheckoutEnabled: boolean;
  stripeReady: boolean;
  trialDays: 0 | 7 | 14 | 30;
  acceptedAt?: string | null;
  commercialPhases?: PublicOfferCommercialPhase[];
  capacityBlockPhases?: PublicCapacityBlockPhase[];
};

type PublicOffer = LegacyPublicOffer | ModularPublicOffer;

type PaymentReturnState =
  | 'idle'
  | 'confirming'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'provisioning'
  | 'director_ready'
  | 'account_activated'
  | 'review_required'
  | 'unavailable';

export const PublicSalesOffer = ({ token }: { token: string }) => {
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [continuing, setContinuing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [commercialConsent, setCommercialConsent] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [offerUnavailable, setOfferUnavailable] = useState(false);
  const [paymentReturnState, setPaymentReturnState] = useState<PaymentReturnState>('idle');
  const [paymentStatusRefreshKey, setPaymentStatusRefreshKey] = useState(0);
  const [directorOpening, setDirectorOpening] = useState(false);
  const directorOpeningRef = useRef(false);

  const openDirectorSession = async (checkoutSessionId: string) => {
    if (!checkoutSessionId || directorOpeningRef.current) return false;
    directorOpeningRef.current = true;
    setDirectorOpening(true);
    setError('');
    try {
      const response = await fetch(
        `/api/public/sales-offers/${encodeURIComponent(token)}/director-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          body: JSON.stringify({ sessionId: checkoutSessionId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false || !payload?.tokenHash) {
        if (payload?.error === 'SALES_DIRECTOR_SESSION_ALREADY_CLAIMED') {
          window.location.replace('/');
          return true;
        }
        throw new Error(payload?.message || payload?.error || 'Não foi possível abrir sua conta agora.');
      }

      const supabase = await getSupabase();
      const verified = await supabase.auth.verifyOtp({
        token_hash: String(payload.tokenHash),
        type: (payload.otpType || 'magiclink') as any,
      });
      if (verified?.error || !verified?.data?.session?.access_token) {
        throw verified?.error || new Error('Não foi possível estabelecer a sessão do Diretor.');
      }

      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accessToken: verified.data.session.access_token,
          intendedRole: 'director',
          provider: 'sales_checkout',
          activationFlow: false,
        }),
      });
      const loginPayload = await loginResponse.json().catch(() => ({}));
      if (!loginResponse.ok || loginPayload?.success === false) {
        throw new Error(loginPayload?.message || loginPayload?.error || 'O acesso foi liberado, mas não foi possível abrir a Verto.');
      }

      setPaymentReturnState('account_activated');
      window.history.replaceState({}, document.title, '/');
      window.location.replace('/');
      return true;
    } catch (sessionError: any) {
      setError(sessionError?.message || 'Não foi possível abrir sua conta agora. Tente novamente.');
      return false;
    } finally {
      directorOpeningRef.current = false;
      setDirectorOpening(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const query = new URLSearchParams(window.location.search);
    const checkoutSessionId = query.get('session_id') || '';
    const returnedFromPayment = query.get('payment') === 'success' && Boolean(checkoutSessionId);
    const legacyPaymentReturnWithoutContext = returnedFromPayment && token.toLowerCase() === 'pagamento';

    let lastObservedPaymentState: PaymentReturnState | null = null;
    const applyStatusPayload = (data: any) => {
      const state = resolveSalesPostPaymentState(data);
      lastObservedPaymentState = state;
      setPaymentReturnState(state === 'payment_pending' ? 'confirming' : state);
      return state;
    };

    const paymentRetryDelayMs = (response: Response | null, data: any, fallbackMs: number) =>
      resolveSalesPostPaymentRetryDelayMs(response?.headers?.get('retry-after'), data, fallbackMs);

    const reconcileDirectorProvisioning = async () => {
      const { response, data } = await requestPublicSalesPostPaymentReconciliation(token, checkoutSessionId);
      if (response.status === 429) {
        return {
          ...data,
          rateLimited: true,
          retryAfterMs: paymentRetryDelayMs(response, data, 5000),
        };
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(data?.error || 'SALES_DIRECTOR_PROVISIONING_FAILED');
      }
      if (!cancelled) applyStatusPayload(data);
      return data;
    };

    const finishReturnedPaymentState = async (data: any) => {
      if (cancelled || data?.rateLimited === true) return false;
      const state = applyStatusPayload(data);
      if (state === 'account_activated') {
        window.location.replace('/');
        return true;
      }
      if (state === 'review_required') return true;
      if (state === 'director_ready') {
        await openDirectorSession(checkoutSessionId);
        return true;
      }
      return false;
    };

    const loadPaymentStatus = async () => {
      setPaymentReturnState('confirming');
      setLoading(false);
      const maxAttempts = 10;
      let nextDelayMs = 1800;

      // The success return already carries the Stripe Checkout session id. Reconcile
      // it immediately on the server instead of waiting for the webhook/database
      // status to change first. The operation is idempotent and validates the frozen
      // offer metadata against Stripe before provisioning the Director.
      try {
        const initialReconciliation = await reconcileDirectorProvisioning();
        if (await finishReturnedPaymentState(initialReconciliation)) return;
        if (initialReconciliation?.rateLimited === true) {
          nextDelayMs = Number(initialReconciliation.retryAfterMs || nextDelayMs);
        } else {
          nextDelayMs = paymentRetryDelayMs(null, initialReconciliation, nextDelayMs);
        }
      } catch {
        // Webhook/status polling below remains the recovery path for transient Stripe
        // or network failures. A failed reconciliation never creates another charge.
      }

      for (let attempt = 0; attempt < maxAttempts && !cancelled; attempt += 1) {
        await new Promise<void>((resolve) => {
          retryTimer = window.setTimeout(resolve, nextDelayMs);
        });
        if (cancelled) return;

        try {
          const { response, data } = await loadPublicSalesPaymentStatusResponse(token, checkoutSessionId);
          if (response.status === 429) {
            setPaymentReturnState('confirming');
            nextDelayMs = paymentRetryDelayMs(response, data, 5000);
            continue;
          }
          if (!response.ok && response.status !== 202) {
            throw new Error(data?.error || 'PAYMENT_STATUS_UNAVAILABLE');
          }
          if (cancelled) return;
          if (await finishReturnedPaymentState(data)) return;
          nextDelayMs = paymentRetryDelayMs(
            response,
            data,
            Math.min(5000, 1800 + attempt * 400),
          );

          // Retry authoritative Stripe reconciliation periodically while provisioning
          // remains pending. This handles a delayed/missed webhook without hammering
          // either Stripe or the status endpoint.
          if (attempt === 2 || attempt === 5 || attempt === 8) {
            const reconciled = await reconcileDirectorProvisioning();
            if (await finishReturnedPaymentState(reconciled)) return;
            if (reconciled?.rateLimited === true) {
              nextDelayMs = Math.max(
                nextDelayMs,
                Number(reconciled.retryAfterMs || 5000),
              );
            }
          }
        } catch {
          nextDelayMs = Math.min(8000, Math.max(2500, nextDelayMs + 1000));
          if (attempt === maxAttempts - 1 && !cancelled) {
            setPaymentReturnState('unavailable');
            return;
          }
        }
      }
      // A bounded poll timeout is never evidence of payment or provisioning.
      // Only the authoritative backend can say whether it is still unpaid.
      if (!cancelled && lastObservedPaymentState === 'payment_pending')
        setPaymentReturnState('payment_pending');
      else if (!cancelled && lastObservedPaymentState === null)
        setPaymentReturnState('unavailable');
    };

    const loadOffer = async () => {
      // A token change must not continue displaying a previous clinic's proposal.
      setOffer(null);
      setAcceptedAt(null);
      setCommercialConsent(false);
      setLoading(true);
      setError('');
      setOfferUnavailable(false);
      try {
        const { response, data } = await loadPublicSalesOfferResponse(token);
        if (response.status === 404 && data?.error === 'OFFER_UNAVAILABLE') {
          // An opaque public link may be expired, revoked, or already paid.
          // A 404 cannot prove which. Never retry checkout or claim payment here.
          if (!cancelled) { setOfferUnavailable(true); setError(''); }
          return;
        }
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

    if (legacyPaymentReturnWithoutContext) {
      setPaymentReturnState('unavailable');
      setError('Este Checkout foi criado por uma versão anterior sem o contexto seguro de retorno. Gere um novo Checkout para concluir este teste; nenhuma nova cobrança será criada automaticamente.');
      setLoading(false);
    } else if (returnedFromPayment) void loadPaymentStatus();
    else void loadOffer();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [paymentStatusRefreshKey, token]);

  const continueToCheckout = async () => {
    setContinuing(true);
    setError('');
    try {
      await handoffPublicSalesCardCheckout(token, (url) => window.location.assign(url));
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
      const data = await acceptPublicSalesModularOffer(token);
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
              {paymentReturnState === 'confirming' || paymentReturnState === 'provisioning' || directorOpening ? (
                <Loader2 className="mb-4 animate-spin text-violet-600" size={30} />
              ) : paymentReturnState === 'unavailable' || paymentReturnState === 'review_required' ? (
                <AlertCircle className="mb-4 text-amber-600" size={32} />
              ) : (
                <CheckCircle2 className="mb-4 text-emerald-600" size={32} />
              )}
              <h1 className="text-xl font-semibold text-slate-900">
                {directorOpening
                  ? 'Abrindo sua Verto'
                  : paymentReturnState === 'confirming'
                    ? 'Verificando o pagamento'
                    : paymentReturnState === 'payment_pending'
                      ? 'Pagamento aguardando confirmação'
                    : paymentReturnState === 'provisioning' || paymentReturnState === 'payment_confirmed'
                      ? 'Preparando sua clínica'
                      : paymentReturnState === 'director_ready'
                        ? 'Acesso de Diretor liberado'
                        : paymentReturnState === 'account_activated'
                          ? 'Conta de Diretor ativada'
                          : paymentReturnState === 'review_required'
                            ? 'Pagamento recebido'
                            : 'Confirmação em andamento'}
              </h1>
              <p className="mt-3 max-w-md text-sm font-normal leading-6 text-slate-600">
                {directorOpening
                  ? 'Seu pagamento já foi confirmado. Estamos abrindo a sessão segura do Diretor e levando você para a configuração inicial da clínica.'
                  : paymentReturnState === 'payment_pending'
                    ? 'Se você escolheu Boleto, pague o documento na Stripe e aguarde a compensação. A emissão do boleto não confirma a quitação. Sua clínica só será liberada após confirmação do pagamento pela Stripe. Não inicie outro Checkout; use Atualizar status para consultar novamente.'
                    : paymentReturnState === 'confirming'
                      ? 'A Stripe ainda está verificando o resultado da transação. Não inicie outro Checkout enquanto a confirmação estiver pendente.'
                    : paymentReturnState === 'director_ready'
                    ? 'A Stripe confirmou o pagamento. A Verto já criou o acesso de Diretor e liberou exatamente os módulos contratados. Você pode seguir direto para o onboarding.'
                    : paymentReturnState === 'account_activated'
                      ? 'A conta da clínica está ativa como Diretor e os módulos contratados foram vinculados.'
                      : paymentReturnState === 'review_required'
                        ? 'Seu pagamento foi preservado. Os dados comerciais precisam de revisão antes de liberar o acesso.'
                        : paymentReturnState === 'unavailable'
                          ? 'Ainda não conseguimos consultar o estado final. Atualize esta página em alguns instantes; nenhuma nova cobrança será criada.'
                          : 'A Stripe confirmou a transação e a Verto está concluindo automaticamente a criação da conta, da clínica e dos módulos contratados.'}
              </p>

              {paymentReturnState !== 'confirming' && paymentReturnState !== 'payment_pending' && paymentReturnState !== 'unavailable' ? (
                <div className="mt-6 w-full max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                  {[
                    { label: 'Pagamento confirmado pela Stripe', done: ['payment_confirmed', 'provisioning', 'director_ready', 'account_activated'].includes(paymentReturnState) },
                    { label: 'Diretor e módulos contratados liberados', done: ['director_ready', 'account_activated'].includes(paymentReturnState) || directorOpening },
                    { label: 'Entrada no onboarding da clínica', done: paymentReturnState === 'account_activated' || directorOpening }
                  ].map((step) => (
                    <div key={step.label} className="flex items-center gap-2 py-1.5 text-sm">
                      <span className={step.done ? 'text-emerald-600' : 'text-slate-300'}>{step.done ? '✓' : '○'}</span>
                      <span className={step.done ? 'font-medium text-slate-800' : 'font-normal text-slate-500'}>{step.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {paymentReturnState === 'director_ready' && !directorOpening ? (
                <button
                  type="button"
                  onClick={() => {
                    const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
                    void openDirectorSession(sessionId);
                  }}
                  className="mt-5 min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  Entrar na Verto e continuar onboarding
                </button>
              ) : null}

              {['payment_pending', 'payment_confirmed', 'provisioning', 'director_ready'].includes(paymentReturnState) && !directorOpening ? (
                <button
                  type="button"
                  onClick={() => setPaymentStatusRefreshKey((current) => current + 1)}
                  className="mt-3 min-h-10 rounded-xl border border-violet-200 bg-white px-4 text-sm font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  Atualizar status
                </button>
              ) : null}

              {error ? <p className="mt-3 max-w-md text-xs leading-5 text-rose-600">{error}</p> : null}
            </div>
          ) : loading ? (
            <div className="flex min-h-72 items-center justify-center gap-3 text-sm text-slate-600">
              <Loader2 className="animate-spin" size={20} /> Carregando proposta...
            </div>
          ) : offerUnavailable ? (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-5 py-8 text-center">
              <AlertCircle className="mb-4 text-amber-600" size={30} />
              <h1 className="text-lg font-semibold text-slate-900">Proposta não disponível para nova contratação</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
                Este link pode ter sido concluído, revogado ou expirado. Se você já pagou,
                não faça outro pagamento: use o e-mail de ativação comercial enviado
                após a contratação para definir sua senha e entrar na clínica.
              </p>
              <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
                Caso já tenha ativado sua conta, entre normalmente. Se perdeu o e-mail,
                acesse a tela de login e escolha Esqueci minha senha. Caso não tenha
                contratado, solicite uma nova proposta à Verto.
              </p>
              <a href="/" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-violet-200 bg-white px-5 text-sm font-semibold text-violet-700 hover:bg-violet-50">
                Ir para a tela de acesso
              </a>
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
                            Aceite registrado em {new Date(acceptedAt).toLocaleString('pt-BR')}. Você já pode continuar para o cadastro do cartão.
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
                  {acceptedAt ? (
                    <button
                      type="button"
                      onClick={() => void continueToCheckout()}
                      disabled={continuing || !offer.modularCheckoutEnabled || !offer.stripeReady}
                      className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {continuing ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
                      {continuing
                        ? 'Preparando Checkout...'
                        : offer.modularCheckoutEnabled && offer.stripeReady
                          ? 'Continuar para cadastro do cartão'
                          : 'Configuração Stripe pendente'}
                    </button>
                  ) : null}
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
