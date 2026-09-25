import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Bell, ChevronLeft, Loader2, MessageCircle, Plus, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import {
  billingCommunicationService,
  createBillingCommunicationIdempotencyKey,
  type BillingCommunicationMentionTarget,
  type BillingCommunicationMessage,
  type BillingCommunicationNotification,
  type BillingCommunicationThread,
  type BillingCommunicationThreadCursor,
} from '../services/billingCommunicationService';

type Props = { clinicId: string; clinicName?: string; canManage?: boolean };
type Mention = BillingCommunicationMentionTarget;

const roleLabel = (role?: string | null) => ({
  director: 'Direção', coordinator: 'Coordenação', biller: 'Faturamento', receptionist: 'Recepção', therapist: 'Profissional', supervisor: 'Supervisão',
}[String(role || '').toLowerCase()] || role || 'Equipe');

const dateLabel = (value?: string | null) => {
  if (!value) return 'Sem horário';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem horário';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
};

const errorLabel = (error: unknown) => {
  const raw = String((error as any)?.message || (error as any)?.details || error || '').toUpperCase();
  if (raw.includes('COMMUNICATION_MENTION_UNAVAILABLE')) return 'Uma das pessoas mencionadas não está mais disponível nesta clínica. Revise as menções e tente novamente.';
  if (raw.includes('COMMUNICATION_ACCESS_DENIED') || raw.includes('42501')) return 'Você não tem acesso a esta atualização neste contexto.';
  if (raw.includes('COMMUNICATION_THREAD_UNAVAILABLE') || raw.includes('P0002')) return 'Esta atualização não está disponível neste contexto.';
  if (raw.includes('COMMUNICATION_SUBJECT_INVALID')) return 'Informe um assunto válido de até 120 caracteres.';
  if (raw.includes('COMMUNICATION_MESSAGE_INVALID')) return 'A mensagem deve ter entre 1 e 2.000 caracteres.';
  return 'Não foi possível concluir esta ação. Tente novamente.';
};

const refLabel = (thread: BillingCommunicationThread) => {
  if (!thread.referenceType) return '';
  if (thread.referenceState === 'AVAILABLE') return 'Lote TISS';
  if (thread.referenceState === 'RESTRICTED') return 'Referência restrita';
  return 'Referência indisponível';
};

const activeMentionIds = (text: string, mentions: Mention[]) => mentions.filter((item) => text.includes(`@${item.name}`)).map((item) => item.userId);

function MentionComposer({ clinicId, value, setValue, mentions, setMentions, disabled, placeholder }: {
  clinicId: string;
  value: string;
  setValue: (value: string) => void;
  mentions: Mention[];
  setMentions: (value: Mention[]) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [targets, setTargets] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const token = useMemo(() => value.match(/(?:^|\s)@([^@\n]{0,60})$/)?.[1]?.trimStart() ?? null, [value]);

  useEffect(() => {
    revision.current += 1;
    const current = revision.current;
    if (disabled || token === null) { setTargets([]); setLoading(false); return; }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const next = await billingCommunicationService.listMentionTargets(clinicId, token.trim());
        if (current === revision.current) setTargets(next.slice(0, 8));
      } catch {
        if (current === revision.current) setTargets([]);
      } finally {
        if (current === revision.current) setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [clinicId, disabled, token]);

  const choose = (target: Mention) => {
    const match = value.match(/(?:^|\s)@([^@\n]{0,60})$/);
    if (!match || match.index === undefined) return;
    const prefix = value.slice(0, match.index);
    const spacer = match[0].startsWith(' ') ? ' ' : '';
    setValue(`${prefix}${spacer}@${target.name} `.slice(0, 2000));
    if (!mentions.some((item) => item.userId === target.userId)) setMentions([...mentions, target]);
    setTargets([]);
  };

  return (
    <div className="relative">
      <textarea
        value={value}
        disabled={disabled}
        rows={4}
        maxLength={2000}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          setMentions(mentions.filter((item) => next.includes(`@${item.name}`)));
        }}
        className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50"
      />
      {value.length >= 1600 && <div className="mt-1 text-right text-xs text-slate-500">{value.length}/2000</div>}
      {token !== null && (loading || targets.length > 0) && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
          {loading && <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Buscando pessoas desta clínica…</div>}
          {!loading && targets.map((target) => (
            <button key={target.userId} type="button" onClick={() => choose(target)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
              <span className="truncate text-sm font-semibold text-slate-800">{target.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{roleLabel(target.role)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BillingCommunicationPanel({ clinicId, clinicName = 'Clínica atual', canManage = false }: Props) {
  const scope = String(clinicId || '').trim();
  const scopeRevision = useRef(0);
  const [threads, setThreads] = useState<BillingCommunicationThread[]>([]);
  const [cursor, setCursor] = useState<BillingCommunicationThreadCursor | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<BillingCommunicationMessage[]>([]);
  const [beforeSequence, setBeforeSequence] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<BillingCommunicationNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busyMore, setBusyMore] = useState(false);
  const [error, setError] = useState('');
  const [threadError, setThreadError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [newText, setNewText] = useState('');
  const [newMentions, setNewMentions] = useState<Mention[]>([]);
  const [newKey, setNewKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [reply, setReply] = useState('');
  const [replyMentions, setReplyMentions] = useState<Mention[]>([]);
  const [replyKey, setReplyKey] = useState('');
  const [sending, setSending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deepLinkUnavailable, setDeepLinkUnavailable] = useState(false);

  const selected = useMemo(() => threads.find((item) => item.id === selectedId) || null, [threads, selectedId]);

  const loadOverview = useCallback(async (revision: number) => {
    if (!scope) return;
    setLoading(true);
    setError('');
    try {
      const [threadResult, notificationResult, unreadCount] = await Promise.all([
        billingCommunicationService.listThreads(scope),
        billingCommunicationService.listNotifications(),
        billingCommunicationService.getUnreadCount(scope),
      ]);
      if (revision !== scopeRevision.current) return;
      setThreads(threadResult.items);
      setCursor(threadResult.nextCursor);
      setNotifications(notificationResult.items.filter((item) => item.clinicId === scope));
      setUnread(unreadCount);
      const deep = new URLSearchParams(window.location.search).get('billingThread');
      if (deep) {
        if (threadResult.items.some((item) => item.id === deep)) setSelectedId(deep);
        else setDeepLinkUnavailable(true);
      }
    } catch (caught) {
      if (revision === scopeRevision.current) setError(errorLabel(caught));
    } finally {
      if (revision === scopeRevision.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    scopeRevision.current += 1;
    const revision = scopeRevision.current;
    setThreads([]); setCursor(null); setSelectedId(''); setMessages([]); setBeforeSequence(null); setNotifications([]); setUnread(0);
    setError(''); setThreadError(''); setNewOpen(false); setSubject(''); setNewText(''); setNewMentions([]); setNewKey('');
    setReply(''); setReplyMentions([]); setReplyKey(''); setDeepLinkUnavailable(false);
    if (scope) void loadOverview(revision); else setLoading(false);
    return () => { scopeRevision.current += 1; };
  }, [scope, loadOverview]);

  const loadMessages = useCallback(async (threadId: string) => {
    const revision = scopeRevision.current;
    setLoadingMessages(true); setThreadError('');
    try {
      const result = await billingCommunicationService.listMessages(threadId);
      if (revision !== scopeRevision.current) return;
      const ordered = [...result.items].sort((a, b) => Number(a.sequence) - Number(b.sequence));
      setMessages(ordered); setBeforeSequence(result.nextBeforeSequence);
      const observed = ordered.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0);
      if (observed > 0) {
        try {
          await billingCommunicationService.markThreadRead(threadId, observed);
          if (revision === scopeRevision.current) {
            setThreads((current) => current.map((item) => item.id === threadId ? { ...item, unreadCount: 0 } : item));
            setUnread((current) => Math.max(0, current - Number(threads.find((item) => item.id === threadId)?.unreadCount || 0)));
          }
        } catch { /* read cursor is independent from message access */ }
      }
    } catch (caught) {
      if (revision === scopeRevision.current) setThreadError(errorLabel(caught));
    } finally {
      if (revision === scopeRevision.current) setLoadingMessages(false);
    }
  }, [threads]);

  useEffect(() => {
    setMessages([]); setBeforeSequence(null); setThreadError(''); setReply(''); setReplyMentions([]); setReplyKey('');
    if (selectedId) void loadMessages(selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    scopeRevision.current += 1;
    const revision = scopeRevision.current;
    setSelectedId(''); setMessages([]); setDeepLinkUnavailable(false);
    await loadOverview(revision);
  };

  const openNotification = async (item: BillingCommunicationNotification) => {
    setSelectedId(item.threadId); setDeepLinkUnavailable(false);
    if (!item.readAt) {
      try {
        await billingCommunicationService.markNotificationRead(item.mentionId);
        setNotifications((current) => current.map((entry) => entry.mentionId === item.mentionId ? { ...entry, readAt: new Date().toISOString() } : entry));
      } catch { /* notification state is independent from thread state */ }
    }
  };

  const loadMoreThreads = async () => {
    if (!cursor || busyMore) return;
    const revision = scopeRevision.current; setBusyMore(true);
    try {
      const result = await billingCommunicationService.listThreads(scope, cursor);
      if (revision !== scopeRevision.current) return;
      const map = new Map<string, BillingCommunicationThread>();
      [...threads, ...result.items].forEach((item) => map.set(item.id, item));
      setThreads(Array.from(map.values()).sort((a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || ''))));
      setCursor(result.nextCursor);
    } catch (caught) { if (revision === scopeRevision.current) setError(errorLabel(caught)); }
    finally { if (revision === scopeRevision.current) setBusyMore(false); }
  };

  const loadOlder = async () => {
    if (!selectedId || beforeSequence === null || busyMore) return;
    const revision = scopeRevision.current; setBusyMore(true);
    try {
      const result = await billingCommunicationService.listMessages(selectedId, beforeSequence);
      if (revision !== scopeRevision.current) return;
      const map = new Map<string, BillingCommunicationMessage>();
      [...result.items, ...messages].forEach((item) => map.set(item.id, item));
      setMessages(Array.from(map.values()).sort((a, b) => Number(a.sequence) - Number(b.sequence)));
      setBeforeSequence(result.nextBeforeSequence);
    } catch (caught) { if (revision === scopeRevision.current) setThreadError(errorLabel(caught)); }
    finally { if (revision === scopeRevision.current) setBusyMore(false); }
  };

  const createThread = async () => {
    const cleanSubject = subject.trim(); const cleanBody = newText.trim();
    if (!cleanSubject || !cleanBody || creating) return;
    const revision = scopeRevision.current; const key = newKey || createBillingCommunicationIdempotencyKey();
    if (!newKey) setNewKey(key); setCreating(true); setError('');
    try {
      const result = await billingCommunicationService.createThread({ clinicId: scope, subject: cleanSubject, message: cleanBody, mentionUserIds: activeMentionIds(newText, newMentions), idempotencyKey: key });
      if (revision !== scopeRevision.current) return;
      setSubject(''); setNewText(''); setNewMentions([]); setNewKey(''); setNewOpen(false);
      await loadOverview(revision);
      if (revision === scopeRevision.current) setSelectedId(result.threadId);
    } catch (caught) { if (revision === scopeRevision.current) setError(errorLabel(caught)); }
    finally { if (revision === scopeRevision.current) setCreating(false); }
  };

  const sendReply = async () => {
    const cleanBody = reply.trim();
    if (!selectedId || !cleanBody || sending || selected?.status !== 'open') return;
    const revision = scopeRevision.current; const key = replyKey || createBillingCommunicationIdempotencyKey();
    if (!replyKey) setReplyKey(key); setSending(true); setThreadError('');
    try {
      await billingCommunicationService.sendMessage({ threadId: selectedId, message: cleanBody, mentionUserIds: activeMentionIds(reply, replyMentions), idempotencyKey: key });
      if (revision !== scopeRevision.current) return;
      setReply(''); setReplyMentions([]); setReplyKey('');
      await loadMessages(selectedId);
      const refreshed = await billingCommunicationService.listThreads(scope);
      if (revision === scopeRevision.current) { setThreads(refreshed.items); setCursor(refreshed.nextCursor); }
    } catch (caught) { if (revision === scopeRevision.current) setThreadError(errorLabel(caught)); }
    finally { if (revision === scopeRevision.current) setSending(false); }
  };

  const toggleArchive = async () => {
    if (!selected || !canManage || archiving) return;
    const revision = scopeRevision.current; const archived = selected.status !== 'archived'; setArchiving(true); setThreadError('');
    try {
      await billingCommunicationService.setArchived(selected.id, archived);
      if (revision === scopeRevision.current) setThreads((current) => current.map((item) => item.id === selected.id ? { ...item, status: archived ? 'archived' : 'open' } : item));
    } catch (caught) { if (revision === scopeRevision.current) setThreadError(errorLabel(caught)); }
    finally { if (revision === scopeRevision.current) setArchiving(false); }
  };

  if (!scope) return <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">Selecione uma clínica para acessar as atualizações do faturamento.</div>;

  return (
    <section className="space-y-4" aria-label="Atualizações do faturamento">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight text-slate-900">Atualizações do faturamento</h2>{unread > 0 && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">{unread} não lida{unread === 1 ? '' : 's'}</span>}</div>
          <p className="mt-1 truncate text-sm text-slate-500">{clinicName} · comunicação operacional da unidade ativa</p>
        </div>
        <div className="flex gap-2"><button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar</button><button type="button" onClick={() => setNewOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700"><Plus size={16} /> Nova conversa</button></div>
      </div>

      {notifications.length > 0 && <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><Bell size={16} /> Menções recentes</div><div className="flex gap-2 overflow-x-auto pb-1">{notifications.slice(0, 8).map((item) => <button key={item.mentionId} type="button" onClick={() => void openNotification(item)} className={`min-w-[260px] rounded-2xl border px-3 py-2 text-left text-xs ${item.readAt ? 'border-slate-200 text-slate-500' : 'border-violet-200 bg-violet-50 text-violet-800'}`}><div className="font-semibold">{item.copy || 'Você foi mencionado em uma atualização da clínica.'}</div><div className="mt-1 text-[11px] opacity-75">{dateLabel(item.createdAt)}</div></button>)}</div></div>}
      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {newOpen && <div className="rounded-3xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold text-slate-900">Nova conversa</h3><p className="text-xs text-slate-500">Assunto operacional, com @menções opcionais da mesma clínica.</p></div><button type="button" onClick={() => setNewOpen(false)} disabled={creating} className="rounded-xl p-2 text-slate-500 hover:bg-white"><X size={17} /></button></div><input value={subject} onChange={(event) => setSubject(event.target.value.slice(0, 120))} maxLength={120} disabled={creating} placeholder="Assunto da conversa" className="mb-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /><MentionComposer clinicId={scope} value={newText} setValue={setNewText} mentions={newMentions} setMentions={setNewMentions} disabled={creating} placeholder="Escreva a atualização. Use @ para mencionar alguém da clínica." /><div className="mt-3 flex justify-end"><button type="button" onClick={() => void createThread()} disabled={creating || !subject.trim() || !newText.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{creating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {creating ? 'Enviando…' : newKey ? 'Tentar novamente' : 'Criar conversa'}</button></div></div>}

      {deepLinkUnavailable && <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p className="font-semibold">Esta atualização não está disponível na unidade ativa.</p><p className="mt-1 text-amber-800">Troque de unidade para continuar, caso você tenha acesso ao contexto correto.</p><button type="button" onClick={() => window.location.assign('/workspaces')} className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 font-semibold">Trocar unidade</button></div>}

      <div className="grid min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <div className={`${selectedId ? 'hidden md:block' : 'block'} border-b border-slate-200 md:border-b-0 md:border-r`}><div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Conversas</div>{loading ? <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Carregando atualizações…</div> : threads.length === 0 ? <div className="p-5 text-sm text-slate-500">Nenhuma atualização nesta clínica. Inicie uma conversa para alinhar rotinas de faturamento com a equipe autorizada.</div> : <div className="divide-y divide-slate-100">{threads.map((thread) => <button key={thread.id} type="button" onClick={() => setSelectedId(thread.id)} className={`w-full px-4 py-3 text-left ${selectedId === thread.id ? 'bg-violet-50' : 'hover:bg-slate-50'}`}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{thread.subject}</div><div className="mt-1 text-[11px] text-slate-500">{roleLabel(thread.lastAuthorRole)} · {dateLabel(thread.lastMessageAt || thread.lastActivityAt)}</div><div className="mt-2 flex flex-wrap gap-1.5">{thread.status === 'archived' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Arquivada</span>}{refLabel(thread) && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{refLabel(thread)}</span>}</div></div>{Number(thread.unreadCount || 0) > 0 && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{thread.unreadCount}</span>}</div></button>)}{cursor && <div className="p-3"><button type="button" onClick={() => void loadMoreThreads()} disabled={busyMore} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">{busyMore ? 'Carregando…' : 'Carregar mais'}</button></div>}</div>}</div>

        <div className={`${selectedId ? 'block' : 'hidden md:block'} min-w-0`}>{!selected ? <div className="flex min-h-[520px] flex-col items-center justify-center gap-2 p-8 text-center text-slate-500"><MessageCircle size={26} /><p className="text-sm">Selecione uma conversa para acompanhar as atualizações.</p></div> : <div className="flex min-h-[520px] flex-col"><div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3"><button type="button" onClick={() => setSelectedId('')} className="mt-0.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"><ChevronLeft size={18} /></button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-slate-900">{selected.subject}</h3>{refLabel(selected) && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{refLabel(selected)}</span>}{selected.status === 'archived' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Arquivada</span>}</div><p className="mt-0.5 text-xs text-slate-500">{clinicName}</p></div>{canManage && <button type="button" onClick={() => void toggleArchive()} disabled={archiving} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">{archiving ? <Loader2 size={14} className="animate-spin" /> : selected.status === 'archived' ? <RotateCcw size={14} /> : <Archive size={14} />}{selected.status === 'archived' ? 'Reabrir' : 'Arquivar'}</button>}</div><div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">{beforeSequence !== null && <div className="text-center"><button type="button" onClick={() => void loadOlder()} disabled={busyMore} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">{busyMore ? 'Carregando…' : 'Carregar mensagens anteriores'}</button></div>}{loadingMessages && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Carregando conversa…</div>}{threadError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{threadError}</div>}{!loadingMessages && messages.map((message) => <article key={message.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className="font-semibold text-slate-700">{message.authorName || 'Equipe'}</span><span>·</span><span>{roleLabel(message.authorRole)}</span><span>·</span><time>{dateLabel(message.createdAt)}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{message.body}</p></article>)}</div><div className="border-t border-slate-100 bg-white p-4">{selected.status === 'archived' ? <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">Esta conversa está arquivada e permanece disponível somente para leitura.</div> : <><MentionComposer clinicId={scope} value={reply} setValue={setReply} mentions={replyMentions} setMentions={setReplyMentions} disabled={sending} placeholder="Responder nesta conversa. Use @ para mencionar alguém da clínica." /><div className="mt-3 flex justify-end"><button type="button" onClick={() => void sendReply()} disabled={sending || !reply.trim()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {sending ? 'Enviando…' : replyKey ? 'Tentar novamente' : 'Enviar'}</button></div></>}</div></div>}</div>
      </div>
      <p className="text-xs text-slate-400">As mensagens são limitadas à clínica ativa e não alteram o estado do faturamento/TISS.</p>
    </section>
  );
}
