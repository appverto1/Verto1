import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileText, Loader2, X } from 'lucide-react';
import { getSupabase } from '../lib/supabase';

type Review = {
  available: boolean;
  canAccept: boolean;
  status?: string;
  termsText?: string;
  termsSha256?: string;
  effectiveStartDate?: string;
  effectiveEndDate?: string;
  acceptedAt?: string;
  acceptedByName?: string;
};
export function ClinicLoyaltyTermsPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) { setChecked(false); setReview(null); setError(''); return; }
    let active = true;
    setLoading(true);
    closeRef.current?.focus();
    (async () => {
      try {
        const sb = await getSupabase();
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
        const response = await fetch('/api/clinic/loyalty/review', {
          credentials: 'include', cache: 'no-store',
          headers: { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success !== true) throw new Error('Termo indisponível nesta clínica.');
        if (active) setReview(payload.data);
      } catch (cause: any) {
        if (active) setError(cause?.message || 'Não foi possível carregar o contrato.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, saving]);

  const accept = async () => {
    if (!checked || !review?.canAccept || !review.termsSha256 || saving) return;
    setSaving(true);
    setError('');
    try {
      const sb = await getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/clinic/loyalty/accept', {
        method:'POST', credentials:'include', cache:'no-store',
        headers: { Authorization:`Bearer ${session.access_token}`,
          'Content-Type':'application/json', Accept:'application/json' },
        body:JSON.stringify({ acceptTerms:true, termsSha256:review.termsSha256 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true || payload.data?.status !== 'accepted') {
        throw new Error(payload.error === 'LOYALTY_OFFER_STALE'
          ? 'O contrato ou a assinatura foi alterado. Feche e reabra para consultar a versão atual.'
          : 'Não foi possível registrar o aceite.');
      }
      setReview((old) => old ? { ...old, status:'accepted', canAccept:false,
        acceptedAt:payload.data.acceptedAt, acceptedByName:payload.data.acceptedByName } : old);
      setChecked(false);
    } catch (cause: any) {
      setError(cause?.message || 'Falha ao salvar o aceite.');
    } finally { setSaving(false); }
  };

  const exportCopy = () => {
    if (!review?.termsText) return;
    const receipt = review.status === 'accepted'
      ? `\n\nCOMPROVANTE DE ACEITE\nRepresentante: ${review.acceptedByName || 'Registrado no sistema'}\nData/hora: ${review.acceptedAt || 'Registrado no sistema'}\nSHA-256 do termo: ${review.termsSha256 || ''}\n`
      : '\n\nCÓPIA DE OFERTA — SEM ACEITE REGISTRADO\n';
    const blob = new Blob([review.termsText + receipt], { type:'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'verto-termo-fidelidade-12-meses.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/60 p-3 md:p-6"
      role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Termo aditivo de fidelidade"
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 p-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <FileText size={20} aria-hidden="true"/> Fidelidade de 12 meses
          </h2>
          <button type="button" ref={closeRef} disabled={saving} onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Fechar contrato"><X size={20}/></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {loading && <p className="flex items-center gap-2 text-slate-600"><Loader2 size={16} className="animate-spin"/> Carregando contrato...</p>}
          {!loading && !review?.available && !error && (
            <p className="text-sm text-slate-600">Sua clínica ainda não recebeu uma oferta de fidelidade. A assinatura atual permanece inalterada.</p>
          )}
          {error && <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><AlertCircle size={17} className="shrink-0"/>{error}</p>}
          {review?.termsText && (
            <>
              {review.status === 'accepted' && (
                <p className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
                  <CheckCircle2 size={19} className="shrink-0"/>
                  Aceite registrado em {review.acceptedAt ? new Date(review.acceptedAt).toLocaleString('pt-BR') : 'data registrada'}.
                  O termo continua disponível para consulta.
                </p>
              )}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
                {review.termsText.split('\n').map((line, index) => {
                  const fragments = line.split('**').map((part, j) => j % 2
                    ? <strong key={j}>{part}</strong> : <React.Fragment key={j}>{part}</React.Fragment>);
                  return line.startsWith('### ')
                    ? <h3 key={index} className="mb-2 mt-5 font-bold text-slate-900">{line.slice(4)}</h3>
                    : line.startsWith('---')
                      ? <hr key={index} className="my-4 border-slate-200"/>
                      : <p key={index} className={line.trim() ? 'mb-2 whitespace-pre-wrap' : 'h-2'}>{fragments}</p>;
                })}
              </div>
            </>
          )}
        </div>
        {review?.termsText && (
          <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white p-4">
            {review.status === 'offered' && (
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-slate-700">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
                  disabled={!review.canAccept || saving} className="mt-0.5 h-5 w-5 shrink-0 accent-violet-600"/>
                <span>Li e aceito os termos de fidelidade de 12 meses da Verto, incluindo a multa proporcional
                  por rescisão antecipada, e declaro possuir poderes para representar a clínica.</span>
              </label>
            )}
            {review.status === 'offered' && !review.canAccept && (
              <p className="text-xs text-amber-700">Esta oferta ainda não está apta para aceite ou sua data de início já passou.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={exportCopy}
                className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Download size={16}/> Salvar cópia
              </button>
              {review.status === 'offered' && (
                <button type="button" disabled={!review.canAccept || !checked || saving}
                  onClick={() => void accept()}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {saving && <Loader2 size={16} className="animate-spin"/>}
                  {saving ? 'Registrando aceite...' : 'Confirmar aceite'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
