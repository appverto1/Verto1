import React, { useEffect, useMemo, useState } from 'react';
import { FileText, KeyRound, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';

type Props = { publicId: string };

type PublicMeta = {
  clinicName?: string;
  recipientEmailHint?: string;
};

type SharedTimelineItem = {
  id: string;
  monthKey?: string;
  slot?: number;
  subject?: string;
  content?: string;
  createdAt?: string;
  attachment?: {
    id?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  } | null;
};

type SharedTimelineMonth = {
  monthKey: string;
  items: SharedTimelineItem[];
};

type SharedContent = {
  clinicName?: string;
  patientName?: string;
  sharedWith?: string;
  entryItemId?: string;
  timeline?: SharedTimelineMonth[];
  readOnly?: boolean;
};

const safeJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return { success: false, error: `Falha HTTP ${response.status}` };
  }
};

const normalizeMonth = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
};

const monthLabel = (value: unknown) => {
  const match = normalizeMonth(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
};

const monthCircleParts = (value: unknown) => {
  const match = normalizeMonth(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) return { month: '--', year: '--' };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '').toUpperCase();
  return { month, year: String(match[1]).slice(-2) };
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
  const [selectedMonth, setSelectedMonth] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'loading' | 'email' | 'code' | 'content' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [busyFileId, setBusyFileId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const timeline = useMemo(
    () => (Array.isArray(content?.timeline) ? content!.timeline!.filter((month) => Array.isArray(month?.items) && month.items.length > 0) : []),
    [content],
  );

  const selectedMonthData = useMemo(() => {
    if (!timeline.length) return null;
    return timeline.find((month) => normalizeMonth(month.monthKey) === normalizeMonth(selectedMonth)) || timeline[timeline.length - 1];
  }, [timeline, selectedMonth]);

  const loadContent = async () => {
    const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/content`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const result = await safeJson(response);
    if (response.ok && result?.success) {
      const nextContent = result.data || null;
      const nextTimeline = Array.isArray(nextContent?.timeline) ? nextContent.timeline.filter((month: any) => Array.isArray(month?.items) && month.items.length > 0) : [];
      setContent(nextContent);
      if (nextTimeline.length > 0) {
        const entryItemId = String(nextContent?.entryItemId || '');
        const entryMonth = nextTimeline.find((month: any) => month.items.some((item: any) => String(item?.id || '') === entryItemId));
        setSelectedMonth(normalizeMonth(entryMonth?.monthKey || nextTimeline[nextTimeline.length - 1]?.monthKey));
      }
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
      if (!loaded) throw new Error('A autenticação foi concluída, mas a timeline não pôde ser carregada.');
    } catch (verifyError: any) {
      setError(verifyError?.message || 'Não foi possível validar o código.');
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (item: SharedTimelineItem) => {
    const itemId = String(item?.id || '').trim();
    if (!itemId) return;
    setBusyFileId(itemId);
    setError('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(publicId)}/file/${encodeURIComponent(itemId)}`, {
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
      setBusyFileId('');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <section className="mx-auto w-full max-w-4xl overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
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
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">{meta?.clinicName || 'Clínica'} compartilhou uma timeline clínica com você</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">O link sozinho não libera nenhum dado clínico. Confirme o e-mail autorizado para acessar somente os meses e registros compartilhados com você.</p>
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
            <div data-testid="external-evolution-readonly-timeline">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><ShieldCheck size={22} /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">Acesso autorizado · somente leitura</p>
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">Timeline de evolução</h1>
                  <p className="mt-1 text-sm text-slate-500">{content.patientName || 'Paciente'} · {content.clinicName || 'Clínica'}</p>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex min-w-max items-start gap-2">
                  {timeline.map((month, index) => {
                    const selected = normalizeMonth(month.monthKey) === normalizeMonth(selectedMonthData?.monthKey);
                    const circle = monthCircleParts(month.monthKey);
                    return (
                      <React.Fragment key={month.monthKey}>
                        {index > 0 && <div className="mt-6 h-px w-7 bg-slate-200" aria-hidden="true" />}
                        <button type="button" onClick={() => setSelectedMonth(normalizeMonth(month.monthKey))} className="group flex min-w-[76px] flex-col items-center" aria-current={selected ? 'date' : undefined}>
                          <span className={`flex h-12 w-12 flex-col items-center justify-center rounded-full border text-[9px] font-semibold uppercase leading-tight transition ${selected ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-md shadow-violet-500/20' : 'border-slate-200 bg-white text-slate-600 group-hover:border-violet-300'}`}>
                            <span>{circle.month}</span>
                            <span className="text-[8px] opacity-80">{circle.year}</span>
                          </span>
                          <span className="mt-1.5 flex items-center justify-center gap-1" aria-label={`${month.items.length} registros compartilhados neste mês`}>
                            {month.items.slice(0, 3).map((item) => <span key={`${month.monthKey}-${item.id}`} className="h-1.5 w-1.5 rounded-full bg-violet-500" />)}
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {selectedMonthData && (
                <div className="mt-6">
                  <div className="mb-3">
                    <h2 className="text-base font-semibold capitalize text-slate-900">{monthLabel(selectedMonthData.monthKey)}</h2>
                    <p className="mt-1 text-xs text-slate-500">Somente os registros compartilhados com {content.sharedWith} aparecem aqui.</p>
                  </div>

                  <div className="space-y-4">
                    {selectedMonthData.items.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h3 className="text-sm font-semibold text-slate-900">{item.subject || 'Atualização clínica'}</h3>
                        {item.content && <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.content}</p>}
                        {item.attachment && (
                          <button type="button" onClick={() => void openAttachment(item)} disabled={busyFileId === item.id} className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-left hover:border-violet-200 disabled:opacity-60">
                            <span className="flex min-w-0 items-center gap-3">
                              <FileText size={19} className="shrink-0 text-[#7a32fc]" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-slate-800">{item.attachment.fileName || 'Documento compartilhado'}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">{formatBytes(item.attachment.sizeBytes)}</span>
                              </span>
                            </span>
                            {busyFileId === item.id ? <Loader2 size={16} className="animate-spin text-[#7a32fc]" /> : <span className="text-xs font-semibold text-[#7a32fc]">Abrir</span>}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-500">
                Este acesso é pessoal, somente leitura e vinculado ao e-mail <strong className="text-slate-700">{content.sharedWith}</strong>. Meses sem conteúdo compartilhado com este e-mail não são exibidos. O profissional responsável pode revogar os acessos a qualquer momento.
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
