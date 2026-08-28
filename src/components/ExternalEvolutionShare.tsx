import React, { useEffect, useState } from 'react';
import { FileText, KeyRound, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';

type Props = { publicId: string };

type PublicMeta = {
  clinicName?: string;
  recipientEmailHint?: string;
};

type SharedContent = {
  clinicName?: string;
  patientName?: string;
  monthKey?: string;
  subject?: string;
  content?: string;
  sharedWith?: string;
  attachment?: {
    id?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  } | null;
};

const safeJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return { success: false, error: `Falha HTTP ${response.status}` };
  }
};

const monthLabel = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
};

const formatBytes = (value: unknown) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const ExternalEvolutionShare = ({ publicId }: Props) => {
  const [meta, setMeta] = useState<PublicMeta | null>(null);
  const [content, setContent] = useState<SharedContent | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'loading' | 'email' | 'code' | 'content' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadContent = async () => {
    const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/content`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const result = await safeJson(response);
    if (response.ok && result?.success) {
      setContent(result.data || null);
      setStage('content');
      return true;
    }
    return false;
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setStage('loading');
      setError('');
      try {
        const metaResponse = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}`, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const metaResult = await safeJson(metaResponse);
        if (cancelled) return;
        if (!metaResponse.ok || !metaResult?.success) {
          setStage('unavailable');
          return;
        }
        setMeta(metaResult.data || {});
        const alreadyAuthorized = await loadContent();
        if (!cancelled && !alreadyAuthorized) setStage('email');
      } catch {
        if (!cancelled) setStage('unavailable');
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [publicId]);

  const requestCode = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError('Informe o e-mail que recebeu autorização para este compartilhamento.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/request-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      const result = await safeJson(response);
      if (!result?.success) throw new Error(result?.error || 'Não foi possível solicitar o código.');
      setStage('code');
      setMessage('Se este e-mail estiver autorizado, o código foi enviado.');
    } catch (requestError: any) {
      setError(requestError?.message || 'Não foi possível solicitar o código.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.replace(/\D/g, '').slice(0, 6);
    if (!normalizedEmail || normalizedCode.length !== 6) {
      setError('Digite o código de seis dígitos recebido por e-mail.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/verify-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, code: normalizedCode }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.message || result?.error || 'Código inválido ou expirado.');
      const loaded = await loadContent();
      if (!loaded) throw new Error('A autenticação foi concluída, mas o conteúdo não pôde ser carregado.');
    } catch (verifyError: any) {
      setError(verifyError?.message || 'Não foi possível validar o código.');
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/file`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      const result = await safeJson(response);
      const url = String(result?.data?.url || '').trim();
      if (!response.ok || !result?.success || !url) throw new Error(result?.error || 'Documento indisponível.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (fileError: any) {
      setError(fileError?.message || 'Não foi possível abrir o documento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
          <LogoVerto size={34} showText={true} />
        </div>

        <div className="p-5 sm:p-7">
          {stage === 'loading' && (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
              <Loader2 size={30} className="animate-spin text-[#7a32fc]" />
              <p className="text-sm font-medium text-slate-500">Validando compartilhamento...</p>
            </div>
          )}

          {stage === 'unavailable' && (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <LockKeyhole size={32} className="text-slate-400" />
              <h1 className="mt-4 text-xl font-semibold text-slate-900">Compartilhamento indisponível</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Este acesso pode ter sido revogado ou o endereço não é mais válido. Solicite um novo acesso ao profissional responsável.</p>
            </div>
          )}

          {(stage === 'email' || stage === 'code') && (
            <div>
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-violet-50 p-3 text-[#7a32fc]"><ShieldCheck size={22} /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Acesso clínico protegido</p>
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">{meta?.clinicName || 'Clínica'} compartilhou uma atualização com você</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">O link sozinho não libera nenhum dado clínico. Confirme o e-mail autorizado para acessar o conteúdo.</p>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">E-mail autorizado</label>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={stage === 'code'} placeholder={meta?.recipientEmailHint || 'seu@email.com'} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-[#7a32fc] disabled:bg-slate-100" />

                {stage === 'email' ? (
                  <button type="button" onClick={() => void requestCode()} disabled={busy} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-60">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Enviar código de acesso
                  </button>
                ) : (
                  <>
                    <label className="mb-1.5 mt-4 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Código de seis dígitos</label>
                    <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="w-full rounded-xl border border-slate-200 bg-white p-3 text-center text-lg font-semibold tracking-[0.3em] text-slate-800 outline-none focus:border-[#7a32fc]" />
                    <button type="button" onClick={() => void verifyCode()} disabled={busy} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-60">
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Confirmar acesso
                    </button>
                    <button type="button" onClick={() => { setStage('email'); setCode(''); setMessage(''); setError(''); }} className="mt-2 w-full text-xs font-medium text-slate-500 hover:text-slate-700">Usar outro e-mail</button>
                  </>
                )}
              </div>
            </div>
          )}

          {stage === 'content' && content && (
            <div>
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><ShieldCheck size={22} /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">Acesso autorizado</p>
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">{content.subject || 'Atualização clínica'}</h1>
                  <p className="mt-1 text-sm text-slate-500">{content.patientName || 'Paciente'} · <span className="capitalize">{monthLabel(content.monthKey)}</span></p>
                </div>
              </div>

              {content.content && (
                <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{content.content}</p>
                </article>
              )}

              {content.attachment && (
                <button type="button" onClick={() => void openAttachment()} disabled={busy} className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-left hover:border-violet-200 disabled:opacity-60">
                  <span className="flex min-w-0 items-center gap-3">
                    <FileText size={19} className="shrink-0 text-[#7a32fc]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{content.attachment.fileName || 'Documento compartilhado'}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{formatBytes(content.attachment.sizeBytes)}</span>
                    </span>
                  </span>
                  {busy ? <Loader2 size={16} className="animate-spin text-[#7a32fc]" /> : <span className="text-xs font-semibold text-[#7a32fc]">Abrir</span>}
                </button>
              )}

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-500">
                Este acesso é pessoal e está vinculado ao e-mail <strong className="text-slate-700">{content.sharedWith}</strong>. O profissional responsável pode revogá-lo a qualquer momento.
              </div>
            </div>
          )}

          {message && <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">{message}</div>}
          {error && <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</div>}
        </div>
      </section>
    </main>
  );
};
