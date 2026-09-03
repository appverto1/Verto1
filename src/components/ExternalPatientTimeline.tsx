import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileText, Loader2, LockKeyhole, LogIn, MessageCircle, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { getSupabase } from '../lib/supabase';

type Props = { clinicId: string; patientId: string };

type TimelineItem = {
  grantId: string;
  publicId: string;
  timelineItemId: string;
  monthKey?: string | null;
  slot?: number | null;
  subject?: string | null;
  content?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  sharedAt?: string | null;
  canComment?: boolean;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  viewCount?: number;
  comments?: Array<{ id: string; body: string; createdAt?: string | null }>;
  attachment?: { id?: string; fileName?: string; mimeType?: string; sizeBytes?: number; createdAt?: string | null } | null;
};

type TimelineData = {
  clinicId: string;
  clinicName: string;
  patientId: string;
  patientName: string;
  items: TimelineItem[];
};

type Stage = 'loading' | 'login' | 'content' | 'forbidden';

const safeJson = async (response: Response) => {
  try { return await response.json(); } catch { return { success: false, error: `Falha HTTP ${response.status}` }; }
};

const formatDate = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
};

const formatDateTime = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

const formatBytes = (value: unknown) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const monthLabel = (monthKey: unknown, compact = false) => {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return compact ? 'MÊS' : 'Período compartilhado';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const formatted = new Intl.DateTimeFormat('pt-BR', compact ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' }).format(date);
  return compact ? formatted.replace('.', '').toUpperCase() : formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

export const ExternalPatientTimeline = ({ clinicId, patientId }: Props) => {
  const [stage, setStage] = useState<Stage>('loading');
  const [data, setData] = useState<TimelineData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentBusy, setCommentBusy] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const viewedThisVisit = useRef(new Set<string>());
  const itemNodes = useRef(new Map<string, HTMLElement>());

  const timelineUrl = `/api/external/care-network/patients/${encodeURIComponent(clinicId)}/${encodeURIComponent(patientId)}/timeline`;

  const fetchTimeline = async () => {
    const response = await fetch(timelineUrl, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
    const result = await safeJson(response);
    if (response.ok && result?.success) {
      setData(result.data || null);
      setStage('content');
      return true;
    }
    if (response.status === 403 || result?.code === 'EXTERNAL_PATIENT_TIMELINE_FORBIDDEN') {
      setData(null);
      setStage('forbidden');
      return false;
    }
    if (response.status === 401 || result?.code === 'EXTERNAL_AUTH_REQUIRED') {
      setData(null);
      setStage('login');
      return false;
    }
    throw new Error(result?.error || 'Não foi possível carregar esta timeline.');
  };

  const bridgeSupabaseSession = async () => {
    try {
      const supabase = await getSupabase();
      const sessionResult = await supabase.auth.getSession();
      const session = sessionResult.data?.session || null;
      if (!session?.access_token) return false;
      const response = await fetch('/api/external/auth/session', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      const result = await safeJson(response);
      return response.ok && result?.success;
    } catch {
      return false;
    }
  };

  const bootstrap = async () => {
    setStage('loading'); setError(''); setMessage('');
    try {
      const first = await fetch(timelineUrl, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      const firstResult = await safeJson(first);
      if (first.ok && firstResult?.success) {
        setData(firstResult.data || null); setStage('content'); return;
      }
      if (first.status === 403 || firstResult?.code === 'EXTERNAL_PATIENT_TIMELINE_FORBIDDEN') {
        setStage('forbidden'); return;
      }
      if (first.status !== 401 && firstResult?.code !== 'EXTERNAL_AUTH_REQUIRED') throw new Error(firstResult?.error || 'Não foi possível carregar esta timeline.');
      const query = new URLSearchParams(window.location.search);
      const isPartnerOauthReturn = query.get('partner_oauth') === '1';
      if (isPartnerOauthReturn && await bridgeSupabaseSession()) {
        query.delete('partner_oauth');
        const nextQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
        await fetchTimeline();
        return;
      }
      setStage('login');
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar esta timeline.');
      setStage('login');
    }
  };

  useEffect(() => { void bootstrap(); }, [clinicId, patientId]);

  const login = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/external/auth/login', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'E-mail ou senha inválidos.');
      setPassword('');
      await fetchTimeline();
    } catch (loginError: any) { setError(loginError?.message || 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  const loginWithGoogle = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}?partner_oauth=1`,
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
          queryParams: { prompt: 'select_account', ...(email.trim() ? { login_hint: email.trim().toLowerCase() } : {}) },
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError: any) {
      setError(oauthError?.message || 'Não foi possível iniciar o acesso com Google.');
      setBusy(false);
    }
  };

  const requestPasswordRecovery = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await fetch('/api/auth/password/recovery/email/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setMessage('Se este e-mail estiver cadastrado, enviaremos instruções para recuperar o acesso.');
    } catch {
      setMessage('Se este e-mail estiver cadastrado, enviaremos instruções para recuperar o acesso.');
    } finally { setBusy(false); }
  };

  const switchAccount = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await fetch('/api/external/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      try { const supabase = await getSupabase(); await supabase.auth.signOut(); } catch { /* server session is already cleared */ }
      setData(null); setEmail(''); setPassword(''); setStage('login');
    } finally { setBusy(false); }
  };

  const recordView = async (grantId: string) => {
    if (!grantId || viewedThisVisit.current.has(grantId)) return;
    viewedThisVisit.current.add(grantId);
    try {
      const response = await fetch(`/api/external/care-network/patients/${encodeURIComponent(clinicId)}/${encodeURIComponent(patientId)}/items/${encodeURIComponent(grantId)}/view`, {
        method: 'POST', credentials: 'include', headers: { Accept: 'application/json' },
      });
      if (!response.ok) viewedThisVisit.current.delete(grantId);
    } catch {
      viewedThisVisit.current.delete(grantId);
    }
  };

  useEffect(() => {
    if (stage !== 'content' || !data?.items?.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) continue;
        const grantId = String((entry.target as HTMLElement).dataset.grantId || '');
        if (grantId) void recordView(grantId);
      }
    }, { threshold: [0.35, 0.65] });
    for (const node of itemNodes.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [stage, data?.items]);

  const openAttachment = async (item: TimelineItem) => {
    if (!item.publicId || !item.timelineItemId) return;
    setFileBusy(item.grantId); setError('');
    try {
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(item.publicId)}/file/${encodeURIComponent(item.timelineItemId)}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      const result = await safeJson(response);
      if (!response.ok || !result?.success || !result.data?.url) throw new Error(result?.error || 'Não foi possível abrir o documento.');
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } catch (fileError: any) { setError(fileError?.message || 'Não foi possível abrir o documento.'); }
    finally { setFileBusy(null); }
  };

  const sendComment = async (item: TimelineItem) => {
    const body = String(commentDrafts[item.grantId] || '').trim();
    if (!body || !item.publicId) return;
    setCommentBusy(item.grantId); setError(''); setMessage('');
    try {
      const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const response = await fetch(`/api/external/evolution/${encodeURIComponent(item.publicId)}/comments`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ comment: body, idempotencyKey }),
      });
      const result = await safeJson(response);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Não foi possível enviar o comentário.');
      setCommentDrafts((current) => ({ ...current, [item.grantId]: '' }));
      setMessage('Comentário enviado.');
      await fetchTimeline();
    } catch (commentError: any) { setError(commentError?.message || 'Não foi possível enviar o comentário.'); }
    finally { setCommentBusy(null); }
  };

  const months = useMemo(() => Array.from(new Set((data?.items || []).map((item) => String(item.monthKey || '')).filter(Boolean))), [data?.items]);
  const itemsByMonth = useMemo(() => {
    const grouped = new Map<string, TimelineItem[]>();
    for (const item of data?.items || []) {
      const key = String(item.monthKey || 'sem-periodo');
      const list = grouped.get(key) || [];
      list.push(item); grouped.set(key, list);
    }
    return Array.from(grouped.entries());
  }, [data?.items]);

  const scrollToMonth = (key: string) => {
    document.getElementById(`external-month-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (stage === 'loading') {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50"><div className="flex items-center gap-3 text-sm font-medium text-slate-500"><Loader2 size={20} className="animate-spin text-[#7a32fc]" /> Carregando timeline compartilhada...</div></main>;
  }

  if (stage === 'login') {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14">
        <section className="mx-auto w-full max-w-md rounded-[30px] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
          <LogoVerto size={36} showText />
          <div className="mt-8 rounded-2xl bg-violet-50 p-4 text-violet-800"><ShieldCheck size={20} /><p className="mt-2 text-sm font-semibold">Rede de cuidado</p><p className="mt-1 text-xs leading-5 text-violet-700">Entre com sua conta Verto para abrir a timeline compartilhada. Nenhum dado clínico é exibido antes da autenticação.</p></div>
          <div className="mt-6 space-y-4">
            <label className="block"><span className="text-xs font-medium text-slate-600">E-mail</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
            <label className="block"><span className="text-xs font-medium text-slate-600">Senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login(); }} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
            <button type="button" disabled={busy || !email.trim() || !password} onClick={() => void login()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : <LogIn size={17} />} Entrar e abrir timeline</button>
            <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou</span><span className="h-px flex-1 bg-slate-200" /></div>
            <button type="button" disabled={busy} onClick={() => void loginWithGoogle()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><GoogleIcon className="h-4 w-4" /> Continuar com Google</button>
            <button type="button" disabled={busy || !email.trim()} onClick={() => void requestPasswordRecovery()} className="w-full text-center text-xs font-medium text-[#7a32fc] hover:underline disabled:opacity-50">Definir ou recuperar senha</button>
            {message && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{message}</p>}
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'forbidden') {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14">
        <section className="mx-auto flex min-h-[420px] w-full max-w-xl flex-col items-center justify-center rounded-[30px] border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5">
          <LockKeyhole size={32} className="text-slate-400" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Timeline indisponível para esta conta</h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">O vínculo pode ter sido revogado ou este endereço pertence a outro contexto. Nenhum dado clínico foi exibido.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2"><a href="/rede-de-cuidado" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"><ArrowLeft size={15} /> Compartilhados comigo</a><button type="button" disabled={busy} onClick={() => void switchAccount()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-50"><LogIn size={15} /> Trocar conta</button></div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6"><div><LogoVerto size={32} showText /><p className="mt-1 text-[11px] font-medium text-slate-400">Rede de cuidado</p></div><a href="/rede-de-cuidado" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"><ArrowLeft size={14} /> Compartilhados comigo</a></div></header>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-violet-500">Timeline compartilhada</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{data?.patientName || 'Paciente'}</h1>
          <p className="mt-1 text-sm text-slate-500">{data?.clinicName || 'Clínica'}</p>
          {months.length > 0 && <div className="mt-5 flex gap-2 overflow-x-auto pb-1">{months.map((month) => <button key={month} type="button" onClick={() => scrollToMonth(month)} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">{monthLabel(month, true)}</button>)}</div>}
        </section>

        {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</p>}
        {message && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">{message}</p>}

        <div className="mt-6 space-y-8">
          {itemsByMonth.map(([month, items]) => (
            <section key={month} id={`external-month-${month}`} className="scroll-mt-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-slate-500">{monthLabel(month)}</h2>
              <div className="space-y-4">
                {items.map((item) => (
                  <article key={item.grantId} data-grant-id={item.grantId} ref={(node) => { if (node) itemNodes.current.set(item.grantId, node); else itemNodes.current.delete(item.grantId); }} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-900">{item.subject || 'Evolução compartilhada'}</h3><p className="mt-1 text-xs text-slate-400">{formatDate(item.createdAt) || 'Data não informada'}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${item.canComment ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{item.canComment ? 'Comentários permitidos' : 'Somente leitura'}</span></div>
                    {item.content && <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.content}</p>}
                    {item.attachment && <button type="button" onClick={() => void openAttachment(item)} disabled={fileBusy === item.grantId} className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left hover:border-violet-200"><span className="flex min-w-0 items-center gap-2"><FileText size={16} className="shrink-0 text-[#7a32fc]" /><span><span className="block truncate text-xs font-medium text-slate-800">{item.attachment.fileName || 'Documento'}</span><span className="block text-[10px] text-slate-400">{formatBytes(item.attachment.sizeBytes)}</span></span></span>{fileBusy === item.grantId ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} className="text-slate-400" />}</button>}
                    <div className="mt-5 border-t border-slate-100 pt-4"><div className="flex items-center gap-2"><MessageCircle size={15} className="text-[#7a32fc]" /><h4 className="text-sm font-semibold text-slate-900">Comentários</h4></div>{(item.comments || []).length > 0 ? <div className="mt-3 space-y-2">{(item.comments || []).map((entry) => <div key={entry.id} className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{entry.body}</p>{entry.createdAt && <p className="mt-1 text-[9px] text-slate-400">{formatDateTime(entry.createdAt)}</p>}</div>)}</div> : <p className="mt-2 text-xs text-slate-400">Nenhum comentário nesta autorização.</p>}
                      {item.canComment ? <><textarea value={commentDrafts[item.grantId] || ''} maxLength={4000} onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.grantId]: event.target.value }))} placeholder="Escreva sua devolutiva" className="mt-3 min-h-24 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-[#7a32fc]" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-400">{(commentDrafts[item.grantId] || '').length}/4000</span><button type="button" onClick={() => void sendComment(item)} disabled={commentBusy === item.grantId || !(commentDrafts[item.grantId] || '').trim()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-xs font-semibold text-white disabled:opacity-60">{commentBusy === item.grantId ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />} Enviar</button></div></> : <p className="mt-3 text-xs text-slate-500">Este registro está disponível somente para visualização.</p>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
};
