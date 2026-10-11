import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, PackageOpen, RefreshCw, X } from 'lucide-react';

type EligibilityState =
  | 'eligible'
  | 'already_entitled'
  | 'permission_only'
  | 'billing_recovery'
  | 'cancelled_reactivation'
  | 'legacy_full_not_sellable'
  | 'baseline_not_sellable'
  | 'demo_forbidden'
  | 'no_direct_price'
  | 'not_commercially_available';

type ModuleRow = {
  moduleKey: string;
  state: EligibilityState;
  canPurchase: boolean;
  alreadyEntitled: boolean;
  hasUseCapability: boolean;
  directOfferId: string | null;
  commercialCapability: boolean;
};

type Review = {
  moduleKey: string;
  intentId: string;
  intentStatus: string;
  offer: {
    id: string;
    currency: string;
    baseUnitAmountCents: number;
    promotionalMonthlyAmountCents: number | null;
    postDiscountMonthlyAmountCents: number | null;
    trialDays: number;
    expiresAt: string | null;
  };
};

type Props = { open: boolean; onClose: () => void };

const MODULE_LABELS: Record<string, { name: string; description: string }> = {
  appointments_communication: { name: 'Agenda e Comunicação', description: 'Organize agenda, salas e comunicação operacional da clínica.' },
  financial_management: { name: 'Gestão Financeira', description: 'Acompanhe o financeiro operacional da clínica em uma área dedicada.' },
  insurance_tiss: { name: 'Convênios e TISS', description: 'Gerencie fluxos de convênios, autorizações e rotinas TISS.' },
  school_management: { name: 'Gestão Escolar', description: 'Acompanhe vínculos e rotinas escolares relacionadas ao cuidado.' },
};

const stateCopy = (row: ModuleRow) => {
  switch (row.state) {
    case 'eligible': return 'Este módulo está disponível para sua clínica.';
    case 'already_entitled': return 'Sua clínica já possui este módulo.';
    case 'permission_only': return 'O módulo já faz parte da clínica, mas sua conta não tem permissão para acessá-lo.';
    case 'billing_recovery': return 'Este módulo precisa de regularização de cobrança antes de qualquer alteração.';
    case 'cancelled_reactivation': return 'A contratação anterior foi cancelada e exige um fluxo específico de reativação.';
    case 'legacy_full_not_sellable': return 'Sua clínica usa o acesso legado completo; não há contratação adicional por este fluxo.';
    case 'demo_forbidden': return 'Compras não estão disponíveis neste ambiente de demonstração.';
    case 'no_direct_price': return row.commercialCapability
      ? 'A condição comercial precisa ser preparada para sua clínica antes da revisão.'
      : 'A contratação precisa ser feita por um administrador autorizado.';
    case 'not_commercially_available': return 'Este módulo não está disponível para contratação direta no momento.';
    default: return 'Este módulo faz parte do núcleo obrigatório da Verto.';
  }
};

const money = (cents: number | null | undefined, currency = 'brl') => {
  if (!Number.isFinite(Number(cents))) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(Number(cents) / 100);
};

const stableKey = (moduleKey: string) => {
  const storageKey = `verto:module-upgrade-intent:${moduleKey}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const value = `module-upgrade-${moduleKey}-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(storageKey, value);
  return value;
};

export function ModuleDiscoveryInterstitial({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(false);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [error, setError] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [transactionState, setTransactionState] = useState<'idle'|'reviewing'|'processing'|'requires_action'|'pending'|'failed'|'confirmed'|'stale'>('idle');
  const [transactionMessage, setTransactionMessage] = useState('');

  const visibleModules = useMemo(() => modules.filter((row) => row.moduleKey !== 'clinical_core'), [modules]);

  const loadEligibility = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/clinic/modules/purchase-eligibility', { credentials: 'include', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success || !Array.isArray(payload?.data?.modules)) throw new Error('Não foi possível carregar a disponibilidade dos módulos.');
      setModules(payload.data.modules);
    } catch (cause: any) {
      setError(String(cause?.message || 'Não foi possível carregar os módulos.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setReview(null);
    setTransactionState('idle');
    setTransactionMessage('');
    void loadEligibility();
    window.requestAnimationFrame(() => closeRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const prepareReview = async (row: ModuleRow) => {
    if (!row.commercialCapability || !['eligible', 'no_direct_price'].includes(row.state)) return;
    setTransactionState('reviewing');
    setTransactionMessage('Revalidando condições com a fonte comercial da Verto…');
    try {
      const response = await fetch(`/api/clinic/modules/${encodeURIComponent(row.moduleKey)}/upgrade-intents`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ offerId: row.directOfferId || undefined, idempotencyKey: stableKey(row.moduleKey) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && ['MODULE_UPGRADE_OFFER_STALE', 'MODULE_UPGRADE_STALE_AUTHORITY', 'MODULE_UPGRADE_ALREADY_ENTITLED'].includes(payload?.error)) {
        setTransactionState('stale');
        setTransactionMessage('As condições mudaram. Atualize a revisão antes de confirmar.');
        await loadEligibility();
        return;
      }
      if (!response.ok || !payload?.success || !payload?.data?.intentId) throw new Error(payload?.error === 'MODULE_UPGRADE_DIRECT_PRICE_UNAVAILABLE' ? 'A condição comercial ainda não está disponível para contratação direta.' : 'Não foi possível preparar a revisão agora.');
      setReview({ moduleKey: row.moduleKey, intentId: payload.data.intentId, intentStatus: payload.data.intentStatus, offer: payload.data.offer });
      setTransactionState('idle');
      setTransactionMessage('Condições revalidadas. Confirme somente depois de revisar o resumo abaixo.');
    } catch (cause: any) {
      setTransactionState('failed');
      setTransactionMessage(String(cause?.message || 'Falha ao preparar a contratação.'));
    }
  };

  const execute = async () => {
    if (!review?.intentId || transactionState === 'processing') return;
    setTransactionState('processing');
    setTransactionMessage('Processando a alteração na assinatura existente. O módulo ainda não foi ativado.');
    try {
      const response = await fetch(`/api/clinic/modules/upgrade-intents/${encodeURIComponent(review.intentId)}/execute`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ acceptTerms: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setTransactionState('stale');
        setTransactionMessage('A assinatura ou a oferta mudou. Revise novamente antes de continuar.');
        setReview(null);
        await loadEligibility();
        return;
      }
      if (!response.ok || !payload?.success) throw new Error('Não foi possível concluir a alteração agora. Nenhum acesso novo foi concedido.');
      const state = String(payload?.data?.state || 'pending');
      if (state === 'provisioned' && payload?.data?.entitlementGranted === true) {
        setTransactionState('confirmed');
        setTransactionMessage('Contratação confirmada e módulo provisionado pela fonte autoritativa.');
        setReview(null);
        await loadEligibility();
      } else if (state === 'requires_action') {
        setTransactionState('requires_action');
        setTransactionMessage('A cobrança exige uma ação adicional. O módulo continua sem ativação até a confirmação do Stripe.');
      } else if (state === 'failed') {
        setTransactionState('failed');
        setTransactionMessage('A cobrança não foi concluída. O módulo continua sem ativação.');
      } else {
        setTransactionState('pending');
        setTransactionMessage('Pagamento em processamento. O módulo ainda não foi ativado.');
      }
    } catch (cause: any) {
      setTransactionState('failed');
      setTransactionMessage(String(cause?.message || 'Falha ao processar a contratação.'));
    }
  };

  if (!open) return null;
  const selected = review ? MODULE_LABELS[review.moduleKey] : null;
  const amount = review ? (review.offer.promotionalMonthlyAmountCents ?? review.offer.postDiscountMonthlyAmountCents ?? review.offer.baseUnitAmountCents) : null;

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="module-discovery-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-violet-600">Módulos Verto</p>
            <h2 id="module-discovery-title" className="mt-1 text-xl font-semibold text-slate-900">Conheça recursos para sua clínica</h2>
            <p className="mt-1 max-w-xl text-sm text-slate-500">A disponibilidade e as condições vêm do servidor. Nenhum módulo é liberado antes da confirmação autoritativa da cobrança.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar módulos" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"><X size={20}/></button>
        </header>

        <div className="p-5 sm:p-7" aria-busy={loading}>
          <div className="sr-only" aria-live="polite">{transactionMessage || (loading ? 'Carregando disponibilidade dos módulos' : '')}</div>
          {error && <div role="alert" className="mb-4 flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertCircle className="mt-0.5 shrink-0" size={18}/><div>{error}<button type="button" onClick={() => void loadEligibility()} className="ml-2 font-semibold underline">Tentar novamente</button></div></div>}
          {transactionMessage && <div role="status" className={`mb-4 rounded-2xl border p-4 text-sm ${transactionState === 'confirmed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : transactionState === 'failed' || transactionState === 'stale' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-violet-200 bg-violet-50 text-violet-900'}`}>{transactionMessage}</div>}

          {review && selected ? (
            <div className="space-y-5">
              <button type="button" onClick={() => { setReview(null); setTransactionState('idle'); }} className="inline-flex items-center gap-2 rounded-lg text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500"><ArrowLeft size={16}/>Voltar aos módulos</button>
              <div className="rounded-3xl border border-slate-200 p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-slate-900">Revisar contratação — {selected.name}</h3>
                <p className="mt-2 text-sm text-slate-500">{selected.description}</p>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Condição mensal</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{money(amount, review.offer.currency) || 'Condição server-owned'}</dd></div>
                  <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Validade da oferta</dt><dd className="mt-1 text-sm font-medium text-slate-700">{review.offer.expiresAt ? new Date(review.offer.expiresAt).toLocaleDateString('pt-BR') : 'Conforme oferta'}</dd></div>
                </dl>
                <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">Ao confirmar, a Verto altera a assinatura existente. Proration, cobrança única quando aplicável e provisionamento são validados no servidor. Se o pagamento exigir ação ou falhar, o acesso atual permanece intacto.</p>
                <button type="button" disabled={transactionState === 'processing'} onClick={() => void execute()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:w-auto">{transactionState === 'processing' ? <Loader2 className="animate-spin" size={17}/> : <CheckCircle2 size={17}/>}Confirmar contratação</button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-500"><Loader2 className="animate-spin" size={20}/>Carregando disponibilidade…</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleModules.map((row) => {
                const info = MODULE_LABELS[row.moduleKey] || { name: row.moduleKey, description: 'Recurso adicional da Verto.' };
                const actionable = row.commercialCapability && ['eligible', 'no_direct_price'].includes(row.state);
                return <article key={row.moduleKey} className="flex min-h-56 flex-col rounded-3xl border border-slate-200 p-5">
                  <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><PackageOpen size={20}/></span><div><h3 className="font-semibold text-slate-900">{info.name}</h3>{row.state === 'eligible' && <span className="text-xs font-medium text-violet-700">Disponível</span>}</div></div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-500">{info.description}</p>
                  <p className="mt-3 text-sm font-medium text-slate-700">{stateCopy(row)}</p>
                  <div className="mt-auto pt-5">{actionable && <button type="button" onClick={() => void prepareReview(row)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 focus:outline-none focus:ring-2 focus:ring-violet-500">{row.state === 'eligible' ? 'Revisar contratação' : 'Preparar condição'}<RefreshCw size={15}/></button>}</div>
                </article>;
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
