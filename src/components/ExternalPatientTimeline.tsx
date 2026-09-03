import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, CalendarDays, ChevronDown, ChevronRight, Loader2, LockKeyhole, LogIn, MessageCircle, Paperclip, ShieldCheck } from 'lucide-react';
import { LogoVerto } from './Common';
import { GoogleIcon } from './GoogleIcon';
import { getSupabase } from '../lib/supabase';
import { externalTimelineClinicalDateLabel, externalTimelineComparisonGroups, externalTimelineLatestMonth, externalTimelineNavigationMonths, externalTimelineYears, groupExternalTimelineItemsByMonth, normalizeExternalTimelineMonthKey, updateExternalTimelineComparisonSelection } from '../utils/externalPatientTimelinePresentation.mjs';

type Props = { clinicId: string; patientId: string };

type TimelineItem = {
  grantId: string;
  publicId: string;
  timelineItemId: string;
  monthKey?: string | null;
  slot?: number | null;
  subject?: string | null;
  content?: string | null;
  clinicalDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  sharedAt?: string | null;
  authorName?: string | null;
  senderName?: string | null;
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

type MonthGroup = {
  key: string;
  year: string;
  month: string;
  items: TimelineItem[];
};

const safeJson = async (response: Response) => {
  try { return await response.json(); } catch { return { success: false, error: `Falha HTTP ${response.status}` }; }
};

const monthDate = (monthKey: string) => {
  const match = normalizeExternalTimelineMonthKey(monthKey).match(/^(\d{4})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : null;
};

const monthLabel = (monthKey: string, compact = false) => {
  const date = monthDate(monthKey);
  if (!date) return '';
  const formatted = new Intl.DateTimeFormat('pt-BR', compact ? { month: 'short' } : { month: 'long', year: 'numeric' }).format(date);
  return compact ? formatted.replace('.', '').toUpperCase() : formatted.toUpperCase();
};

const formatSharedAt = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '').toLowerCase();
  return `${String(date.getDate()).padStart(2, '0')} ${month}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const comparisonPeriodLabel = (monthKey: string) => {
  const normalized = normalizeExternalTimelineMonthKey(monthKey);
  return normalized ? `${monthLabel(normalized, true)} ${normalized.slice(2, 4)}` : '';
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

const attachmentTypeLabel = (mimeType: unknown) => {
  const value = String(mimeType || '').toLowerCase();
  if (value.startsWith('image/')) return 'Imagem';
  if (value === 'application/pdf') return 'PDF';
  if (value.startsWith('audio/')) return 'Áudio';
  if (value.startsWith('video/')) return 'Vídeo';
  return value ? 'Documento' : '';
};

const pluralRecords = (count: number, shared = false) => `${count} ${count === 1 ? 'registro' : 'registros'}${shared ? (count === 1 ? ' compartilhado' : ' compartilhados') : ' disponíveis'}`;

export const ExternalPatientTimeline = ({ clinicId, patientId }: Props) => {
  const [stage, setStage] = useState<Stage>('loading');
  const [data, setData] = useState<TimelineData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [commentBusy, setCommentBusy] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState('');
  const [activeMonth, setActiveMonth] = useState('');
  const [comparisonMode, setComparisonMode] = useState<'off' | 'selecting' | 'view'>('off');
  const [comparisonSelection, setComparisonSelection] = useState<string[]>([]);
  const viewedThisVisit = useRef(new Set<string>());
  const itemNodes = useRef(new Map<string, HTMLElement>());
  const monthNodes = useRef(new Map<string, HTMLElement>());
  const monthStripRef = useRef<HTMLDivElement | null>(null);
  const monthChipNodes = useRef(new Map<string, HTMLButtonElement>());

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
      setData(null); setStage('forbidden'); return false;
    }
    if (response.status === 401 || result?.code === 'EXTERNAL_AUTH_REQUIRED') {
      setData(null); setStage('login'); return false;
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
    } catch { return false; }
  };

  const bootstrap = async () => {
    setStage('loading'); setError(''); setMessage('');
    try {
      const first = await fetch(timelineUrl, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      const firstResult = await safeJson(first);
      if (first.ok && firstResult?.success) { setData(firstResult.data || null); setStage('content'); return; }
      if (first.status === 403 || firstResult?.code === 'EXTERNAL_PATIENT_TIMELINE_FORBIDDEN') { setStage('forbidden'); return; }
      if (first.status !== 401 && firstResult?.code !== 'EXTERNAL_AUTH_REQUIRED') throw new Error(firstResult?.error || 'Não foi possível carregar esta timeline.');
      const query = new URLSearchParams(window.location.search);
      const isPartnerOauthReturn = query.get('partner_oauth') === '1';
      if (isPartnerOauthReturn && await bridgeSupabaseSession()) {
        query.delete('partner_oauth');
        const nextQuery = query.toString();
        window.history.replaceState({}, document.title, `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
        await fetchTimeline(); return;
      }
      setStage('login');
    } catch (loadError: any) {
      setError(loadError?.message || 'Não foi possível carregar esta timeline.'); setStage('login');
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
      setPassword(''); await fetchTimeline();
    } catch (loginError: any) { setError(loginError?.message || 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  const loginWithGoogle = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const supabase = await getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google', options: {
          redirectTo: `${window.location.origin}${window.location.pathname}?partner_oauth=1`,
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
          queryParams: { prompt: 'select_account', ...(email.trim() ? { login_hint: email.trim().toLowerCase() } : {}) },
        },
      });
      if (oauthError) throw oauthError;
    } catch (oauthError: any) { setError(oauthError?.message || 'Não foi possível iniciar o acesso com Google.'); setBusy(false); }
  };

  const requestPasswordRecovery = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await fetch('/api/auth/password/recovery/email/request', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setMessage('Se este e-mail estiver cadastrado, enviaremos instruções para recuperar o acesso.');
    } catch { setMessage('Se este e-mail estiver cadastrado, enviaremos instruções para recuperar o acesso.'); }
    finally { setBusy(false); }
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
    } catch { viewedThisVisit.current.delete(grantId); }
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
  }, [stage, data?.items, activeMonth, comparisonMode]);

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
      setOpenComments((current) => ({ ...current, [item.grantId]: true }));
    } catch (commentError: any) { setError(commentError?.message || 'Não foi possível enviar o comentário.'); }
    finally { setCommentBusy(null); }
  };

  const monthGroups = useMemo<MonthGroup[]>(() => groupExternalTimelineItemsByMonth(data?.items || []) as MonthGroup[], [data?.items]);
  const years = useMemo(() => externalTimelineYears(monthGroups), [monthGroups]);

  useEffect(() => {
    if (!years.length) { setSelectedYear(''); setActiveMonth(''); return; }
    if (!selectedYear || !years.includes(selectedYear)) setSelectedYear(years[0]);
  }, [years, selectedYear]);

  const visibleMonthGroups = useMemo(() => selectedYear ? monthGroups.filter((group) => group.year === selectedYear) : monthGroups, [monthGroups, selectedYear]);
  const navigationMonthGroups = useMemo(() => externalTimelineNavigationMonths(monthGroups, selectedYear) as MonthGroup[], [monthGroups, selectedYear]);
  const comparisonGroups = useMemo(() => externalTimelineComparisonGroups(monthGroups, comparisonSelection) as MonthGroup[], [monthGroups, comparisonSelection]);

  useEffect(() => {
    if (!visibleMonthGroups.length) { setActiveMonth(''); return; }
    if (!visibleMonthGroups.some((group) => group.key === activeMonth)) setActiveMonth(externalTimelineLatestMonth(monthGroups, selectedYear));
  }, [visibleMonthGroups, activeMonth, monthGroups, selectedYear]);

  useEffect(() => {
    const strip = monthStripRef.current;
    const chip = monthChipNodes.current.get(activeMonth);
    if (!strip || !chip) return;
    const left = chip.offsetLeft - Math.max(0, (strip.clientWidth - chip.clientWidth) / 2);
    strip.scrollTo({ left, behavior: 'smooth' });
  }, [activeMonth, selectedYear]);

  const openMonth = (key: string) => {
    setActiveMonth(key);
    window.requestAnimationFrame(() => monthNodes.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const toggleComparisonMonth = (key: string) => {
    setComparisonSelection((current) => updateExternalTimelineComparisonSelection(current, key));
  };

  const handleMonthChip = (key: string) => {
    if (comparisonMode === 'selecting') { toggleComparisonMonth(key); return; }
    openMonth(key);
  };

  const startComparison = () => {
    setComparisonSelection([]);
    setComparisonMode('selecting');
  };

  const cancelComparison = () => {
    setComparisonSelection([]);
    setComparisonMode('off');
  };

  const authorLine = (item: TimelineItem) => {
    const author = String(item.authorName || '').trim();
    const sender = String(item.senderName || '').trim();
    const sharedAt = formatSharedAt(item.sharedAt);
    if (author && sender && author !== sender) return { primary: author, secondary: `Compartilhado por ${sender}${sharedAt ? ` · ${sharedAt}` : ''}` };
    if (author && sender && author === sender) return { primary: author, secondary: sharedAt ? `Compartilhado em ${sharedAt}` : '' };
    if (author) return { primary: author, secondary: sharedAt ? `Compartilhado em ${sharedAt}` : '' };
    if (sender) return { primary: '', secondary: `Compartilhado por ${sender}${sharedAt ? ` · ${sharedAt}` : ''}` };
    return { primary: '', secondary: sharedAt ? `Compartilhado em ${sharedAt}` : '' };
  };

  const renderTimelineItem = (item: TimelineItem, index: number, options: { comparison?: boolean } = {}) => {
    const comments = item.comments || [];
    const commentsOpen = openComments[item.grantId] === true;
    const author = authorLine(item);
    const attachmentMeta = [attachmentTypeLabel(item.attachment?.mimeType), formatBytes(item.attachment?.sizeBytes)].filter(Boolean).join(' · ');
    const clinicalDateLabel = externalTimelineClinicalDateLabel(item.clinicalDate);
    const comparison = options.comparison === true;
    const commentLabel = comments.length
      ? `${comments.length} ${comments.length === 1 ? 'comentário' : 'comentários'}${!item.canComment ? ' · novas respostas desabilitadas' : ''}`
      : comparison ? 'Sem comentários' : item.canComment ? 'Comentar' : 'Comentários desabilitados';

    return (
      <article key={item.grantId} data-grant-id={item.grantId} ref={(node) => { if (node) itemNodes.current.set(item.grantId, node); else itemNodes.current.delete(item.grantId); }} className={`${comparison ? 'py-5' : 'py-6 sm:py-7'} ${index > 0 ? 'border-t border-slate-100' : ''}`}>
        <div className={clinicalDateLabel ? 'grid gap-3 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-6' : ''}>
          {clinicalDateLabel && <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-600">{clinicalDateLabel}</div>}
          <div className="min-w-0">
            <h3 className={`${comparison ? 'text-sm sm:text-base' : 'text-base sm:text-lg'} font-semibold leading-6 text-slate-950`}>{item.subject || 'Evolução compartilhada'}</h3>
            {(author.primary || author.secondary) && <div className="mt-2 text-xs leading-5 text-slate-500">{author.primary && <span className="text-slate-600">{author.primary}</span>}{author.secondary && <span className={`block text-slate-400 ${author.primary ? 'sm:ml-2 sm:inline' : ''}`}>{author.secondary}</span>}</div>}
            {item.content && <p className={`${comparison ? 'mt-3 text-sm leading-6' : 'mt-4 text-sm leading-7 sm:text-[15px]'} whitespace-pre-wrap text-slate-700`}>{item.content}</p>}

            {item.attachment && (
              <button type="button" onClick={() => void openAttachment(item)} disabled={fileBusy === item.grantId} title={item.attachment.fileName || 'Documento compartilhado'} className="mt-4 flex w-full items-center gap-3 rounded-xl bg-violet-50/65 px-3 py-2.5 text-left transition hover:bg-violet-100/70 disabled:opacity-60 sm:max-w-2xl">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm"><Paperclip size={15} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-800">{item.attachment.fileName || 'Documento compartilhado'}</span>{attachmentMeta && <span className="mt-0.5 block text-[10px] text-slate-400">{attachmentMeta}</span>}</span>
                <span className="shrink-0 text-[11px] font-medium text-violet-700">{fileBusy === item.grantId ? 'Abrindo…' : 'Abrir'}</span>
              </button>
            )}

            <div className="mt-4">
              <button type="button" onClick={() => setOpenComments((current) => ({ ...current, [item.grantId]: !current[item.grantId] }))} aria-expanded={commentsOpen} disabled={(comparison && comments.length === 0) || (!comparison && !item.canComment && comments.length === 0)} className={`inline-flex min-h-9 items-center gap-2 rounded-xl px-2 text-xs font-medium transition ${item.canComment || comments.length ? 'text-violet-700 hover:bg-violet-50' : 'cursor-default bg-slate-50 px-3 text-slate-400'}`}>
                <MessageCircle size={15} /> {commentLabel}
              </button>

              {commentsOpen && comments.length > 0 && (
                <div className="mt-3 max-w-2xl rounded-2xl bg-slate-50/80 p-3 sm:p-4">
                  <div className="space-y-3">{comments.map((entry) => <div key={entry.id}><p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">{entry.body}</p>{entry.createdAt && <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(entry.createdAt)}</p>}</div>)}</div>
                  {!comparison && item.canComment && <div className="mt-4 border-t border-slate-100 pt-4"><label className="block text-xs text-slate-500">Sua devolutiva</label><textarea value={commentDrafts[item.grantId] || ''} maxLength={4000} rows={2} onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.grantId]: event.target.value }))} placeholder="Escreva um comentário" className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-5 outline-none focus:border-violet-300" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-400">{(commentDrafts[item.grantId] || '').length}/4000</span><button type="button" onClick={() => void sendComment(item)} disabled={commentBusy === item.grantId || !(commentDrafts[item.grantId] || '').trim()} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-[#7a32fc] px-3.5 text-xs font-semibold text-white disabled:opacity-50">{commentBusy === item.grantId ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} Enviar</button></div></div>}
                </div>
              )}

              {commentsOpen && comments.length === 0 && !comparison && item.canComment && (
                <div className="mt-3 max-w-2xl rounded-2xl bg-slate-50/80 p-3 sm:p-4"><label className="block text-xs text-slate-500">Sua devolutiva</label><textarea value={commentDrafts[item.grantId] || ''} maxLength={4000} rows={2} onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.grantId]: event.target.value }))} placeholder="Escreva um comentário" className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-5 outline-none focus:border-violet-300" /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-400">{(commentDrafts[item.grantId] || '').length}/4000</span><button type="button" onClick={() => void sendComment(item)} disabled={commentBusy === item.grantId || !(commentDrafts[item.grantId] || '').trim()} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-[#7a32fc] px-3.5 text-xs font-semibold text-white disabled:opacity-50">{commentBusy === item.grantId ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />} Enviar</button></div></div>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  };

  if (stage === 'loading') {
    return (
      <main className="min-h-screen bg-[#f8f7fc]">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
          <div className="h-10 w-32 animate-pulse rounded-xl bg-violet-100" />
          <div className="mt-8 h-7 w-2/3 animate-pulse rounded-lg bg-slate-200" />
          <div className="mt-3 h-4 w-40 animate-pulse rounded bg-slate-100" />
          <div className="mt-8 h-12 animate-pulse rounded-2xl bg-white" />
          <div className="mt-10 space-y-5"><div className="h-5 w-48 animate-pulse rounded bg-slate-200" /><div className="h-40 animate-pulse rounded-3xl bg-white" /><div className="h-36 animate-pulse rounded-3xl bg-white" /></div>
        </div>
      </main>
    );
  }

  if (stage === 'login') {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14">
        <section className="mx-auto w-full max-w-md rounded-[30px] border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
          <LogoVerto size={36} showText />
          <div className="mt-8 rounded-2xl bg-violet-50 p-4 text-violet-800"><ShieldCheck size={20} /><p className="mt-2 text-sm font-semibold">Rede de cuidado</p><p className="mt-1 text-xs leading-5 text-violet-700">Entre com sua conta Verto para abrir a timeline compartilhada. Nenhum dado clínico é exibido antes da autenticação.</p></div>
          <div className="mt-6 space-y-4">
            <label className="block"><span className="text-xs text-slate-600">E-mail</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
            <label className="block"><span className="text-xs text-slate-600">Senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void login(); }} className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#7a32fc]" /></label>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
            <button type="button" disabled={busy || !email.trim() || !password} onClick={() => void login()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : <LogIn size={17} />} Entrar e abrir timeline</button>
            <div className="flex items-center gap-3 py-1 text-[10px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>ou</span><span className="h-px flex-1 bg-slate-200" /></div>
            <button type="button" disabled={busy} onClick={() => void loginWithGoogle()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><GoogleIcon className="h-4 w-4" /> Continuar com Google</button>
            <button type="button" disabled={busy || !email.trim()} onClick={() => void requestPasswordRecovery()} className="w-full text-center text-xs text-[#7a32fc] hover:underline disabled:opacity-50">Definir ou recuperar senha</button>
            {message && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p>}
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
          <div className="mt-6 flex flex-wrap justify-center gap-2"><a href="/rede-de-cuidado" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm text-slate-600 hover:bg-slate-50"><ArrowLeft size={15} /> Compartilhados comigo</a><button type="button" disabled={busy} onClick={() => void switchAccount()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-sm font-semibold text-white disabled:opacity-50"><LogIn size={15} /> Trocar conta</button></div>
        </section>
      </main>
    );
  }

  const totalItems = monthGroups.reduce((total, group) => total + group.items.length, 0);
  const comparisonReady = comparisonSelection.length === 2;
  const comparisonActionLabel = comparisonReady
    ? `Comparar ${comparisonPeriodLabel(comparisonSelection[0])} × ${comparisonPeriodLabel(comparisonSelection[1])}`
    : 'Selecione dois meses';

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f3ff_0px,#fbfbfd_250px,#f8fafc_100%)] text-slate-800">
      <header className="border-b border-violet-100/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3"><LogoVerto size={29} showText /><span className="hidden h-5 w-px bg-violet-100 sm:block" /><span className="hidden text-xs text-violet-500 sm:block">Rede de cuidado</span></div>
          <a href="/rede-de-cuidado" className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs text-slate-600 transition hover:bg-violet-50 hover:text-violet-700"><ArrowLeft size={14} /> Compartilhados comigo</a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <section className="relative overflow-hidden rounded-[26px] border border-violet-100 bg-white px-5 py-5 shadow-[0_22px_55px_-40px_rgba(86,41,170,0.45)] sm:px-7 sm:py-6">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#7a32fc] via-violet-400 to-fuchsia-300" />
          <p className="text-[10px] uppercase tracking-[0.22em] text-violet-500">Timeline compartilhada</p>
          <h1 className="mt-1.5 max-w-3xl break-words text-2xl font-semibold uppercase leading-tight text-slate-950 sm:text-3xl">{data?.patientName || 'Paciente'}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500"><span>{data?.clinicName || 'Clínica'}</span><span className="hidden text-violet-200 sm:inline">•</span><span>{pluralRecords(totalItems)}</span></div>
        </section>

        {monthGroups.length > 0 && (
          <nav className="sticky top-0 z-20 mt-4 border-y border-violet-100 bg-white/95 px-1.5 py-2 backdrop-blur" aria-label="Navegação por período">
            {comparisonMode === 'selecting' && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1"><div><p className="text-xs font-semibold text-slate-800">Comparar períodos</p><p className="text-[11px] text-slate-400">Selecione dois meses disponíveis.</p></div><button type="button" onClick={cancelComparison} className="min-h-8 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Cancelar</button></div>}
            <div className="flex items-center gap-2">
              {years.length > 1 ? (
                <label className="relative shrink-0">
                  <span className="sr-only">Ano</span>
                  <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} className="min-h-8 appearance-none rounded-lg border border-violet-100 bg-violet-50 py-1 pl-2.5 pr-7 text-xs font-semibold text-violet-800 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100">
                    {years.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-violet-500" />
                </label>
              ) : <span className="shrink-0 px-1 text-xs font-semibold text-slate-500">{years[0] || ''}</span>}
              <div ref={monthStripRef} className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {navigationMonthGroups.map((group) => {
                  const selectionIndex = comparisonSelection.indexOf(group.key);
                  const selectedForComparison = selectionIndex >= 0;
                  const active = comparisonMode === 'off' && activeMonth === group.key;
                  return <button key={group.key} ref={(node) => { if (node) monthChipNodes.current.set(group.key, node); else monthChipNodes.current.delete(group.key); }} type="button" onClick={() => handleMonthChip(group.key)} aria-selected={comparisonMode === 'selecting' ? selectedForComparison : active} className={`min-h-8 shrink-0 rounded-full px-2.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${selectedForComparison ? 'bg-violet-700 text-white' : active ? 'bg-[#7a32fc] text-white' : 'bg-violet-50/70 text-violet-700 hover:bg-violet-100'}`}>{monthLabel(group.key, true)}{comparisonMode === 'selecting' && selectedForComparison ? ` · ${selectionIndex === 0 ? 'A' : 'B'}` : ''}</button>;
                })}
              </div>
              {comparisonMode === 'off' ? <button type="button" onClick={startComparison} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"><ArrowLeftRight size={14} /> <span className="hidden sm:inline">Comparar</span></button> : comparisonMode === 'view' ? <button type="button" onClick={cancelComparison} className="min-h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Voltar à timeline</button> : null}
            </div>
            {comparisonMode === 'selecting' && <div className="mt-2 flex justify-end px-1"><button type="button" disabled={!comparisonReady} onClick={() => { if (comparisonReady) setComparisonMode('view'); }} className="min-h-9 rounded-xl bg-[#7a32fc] px-3.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40">{comparisonActionLabel}</button></div>}
          </nav>
        )}

        {error && <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{error}</p>}
        {message && <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{message}</p>}

        {visibleMonthGroups.length === 0 ? (
          <section className="mt-8 rounded-[28px] border border-dashed border-violet-100 bg-white/80 px-6 py-14 text-center">
            <CalendarDays size={28} className="mx-auto text-violet-300" />
            <h2 className="mt-4 text-base font-semibold text-slate-800">Nenhum conteúdo compartilhado no momento</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Os conteúdos aparecem aqui enquanto estiverem compartilhados com sua conta.</p>
          </section>
        ) : comparisonMode === 'view' ? (
          <section className="mt-7">
            <div className="mb-4"><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-violet-500">Comparar períodos</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Leitura lado a lado dos conteúdos compartilhados</h2><p className="mt-1 text-xs leading-5 text-slate-500">A Verto apresenta os períodos sem interpretar evolução, melhora ou regressão.</p></div>
            <div className="grid gap-5 lg:grid-cols-2">
              {comparisonGroups.map((group, groupIndex) => <section key={group.key} className="min-w-0 rounded-[22px] border border-violet-100 bg-white px-4 py-4 shadow-sm sm:px-5">
                <div className="border-b border-violet-100 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">Período {groupIndex === 0 ? 'A' : 'B'}</p><h3 className="mt-1 text-sm font-semibold uppercase tracking-[0.08em] text-slate-800">{monthLabel(group.key)}</h3><p className="mt-1 text-xs text-slate-400">{pluralRecords(group.items.length, true)}</p></div>
                <div>{group.items.map((item, index) => renderTimelineItem(item, index, { comparison: true }))}</div>
              </section>)}
            </div>
          </section>
        ) : (
          <div className="mt-7 space-y-4">
            {visibleMonthGroups.map((group) => {
              const expanded = activeMonth === group.key;
              return <section key={group.key} id={`external-month-${group.key}`} data-month-key={group.key} ref={(node) => { if (node) monthNodes.current.set(group.key, node); else monthNodes.current.delete(group.key); }} className="scroll-mt-20 rounded-[22px] border border-violet-100/80 bg-white px-4 shadow-[0_14px_35px_-32px_rgba(86,41,170,0.35)] sm:px-5">
                <button type="button" onClick={() => openMonth(group.key)} aria-expanded={expanded} className="flex w-full items-center gap-3 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300">
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold uppercase tracking-[0.11em] text-slate-800">{monthLabel(group.key)}</span><span className="mt-1 block text-xs text-slate-400">{pluralRecords(group.items.length, true)}</span></span>
                  {!expanded && <span className="hidden text-xs font-medium text-violet-600 sm:inline">Ver período</span>}
                  <ChevronRight size={16} className={`shrink-0 text-violet-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                </button>
                {expanded && <div className="border-t border-violet-50">{group.items.map((item, index) => renderTimelineItem(item, index))}</div>}
              </section>;
            })}
          </div>
        )}
      </div>
    </main>
  );

};
