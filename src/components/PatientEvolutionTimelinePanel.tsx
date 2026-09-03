import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Clipboard,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  XCircle,
} from 'lucide-react';
import { dataService } from '../services/dataService';

type EvolutionGrant = {
  id: string;
  publicId?: string | null;
  careNetworkContactId?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  recipientSpecialty?: string | null;
  canComment?: boolean;
  status: string;
  authorizationDeclaredAt?: string | null;
  lastInvitedAt?: string | null;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  viewCount?: number;
  commentCount?: number;
  comments?: Array<{ id: string; body: string; createdAt?: string | null }>;
  shareUrl?: string | null;
};

type CareNetworkOption = {
  id: string;
  professional_name: string;
  specialty?: string | null;
  email?: string | null;
};

type EvolutionTimelineItem = {
  id: string;
  monthKey: string;
  slot: number;
  subject: string;
  content?: string;
  createdAt?: string;
  attachment?: {
    id: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  } | null;
  grants?: EvolutionGrant[];
};

type TimelineEntitlement = {
  tier: 'STANDARD' | 'PLUS3';
  billingStatus?: string;
  monthlyLimit: 1 | 3;
  unitAmountCents: number;
  currency?: string;
  canUseThreeItems: boolean;
};

type Props = {
  patientId: string;
  dark?: boolean;
  canCreate?: boolean;
  canShare?: boolean;
  canManageBilling?: boolean;
};

const currentMonthKey = () => new Date().toISOString().slice(0, 7);

const normalizeMonth = (value: unknown) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
};

const monthLabel = (value: string) => {
  const match = normalizeMonth(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) return value || '-';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
};

const compactMonthLabel = (value: string) => {
  const match = normalizeMonth(value).match(/^(\d{4})-(\d{2})$/);
  if (!match) return value || '-';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(date).replace('.', '');
  return `${month} ${String(match[1]).slice(-2)}`;
};

const monthOffset = (offset: number) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1, 12));
  return date.toISOString().slice(0, 7);
};

const formatBytes = (value: unknown) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatSharedAt = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
};

const copyText = async (value: string) => {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }
};

export const PatientEvolutionTimelinePanel = ({ patientId, dark = false, canCreate = false, canShare = false, canManageBilling = false }: Props) => {
  const [items, setItems] = useState<EvolutionTimelineItem[]>([]);
  const [entitlement, setEntitlement] = useState<TimelineEntitlement>({
    tier: 'STANDARD',
    billingStatus: 'INCLUDED',
    monthlyLimit: 1,
    unitAmountCents: 200,
    currency: 'BRL',
    canUseThreeItems: false,
  });
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [careNetwork, setCareNetwork] = useState<CareNetworkOption[]>([]);
  const [shareContactByItem, setShareContactByItem] = useState<Record<string, string>>({});
  const [shareCanCommentByItem, setShareCanCommentByItem] = useState<Record<string, boolean>>({});
  const [shareConfirmedByItem, setShareConfirmedByItem] = useState<Record<string, boolean>>({});
  const [busyItemId, setBusyItemId] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  const load = async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    const [result, careResult] = await Promise.all([
      dataService.getPatientEvolutionTimeline(patientId),
      canShare ? dataService.getPatientCareNetwork(patientId) : Promise.resolve({ success: true, data: [] }),
    ]);
    setLoading(false);
    if (!result?.success) {
      setError(result?.error || 'Não foi possível carregar a timeline de evolução.');
      return;
    }
    setItems(Array.isArray(result?.data) ? result.data : []);
    if (careResult?.success) setCareNetwork((Array.isArray(careResult.data) ? careResult.data : []).filter((contact: any) => String(contact?.email || '').trim()));
    const nextEntitlement = result?.entitlement;
    setEntitlement({
      tier: nextEntitlement?.canUseThreeItems ? 'PLUS3' : 'STANDARD',
      billingStatus: String(nextEntitlement?.billingStatus || (nextEntitlement?.canUseThreeItems ? 'ACTIVE' : 'INCLUDED')),
      monthlyLimit: nextEntitlement?.canUseThreeItems ? 3 : 1,
      unitAmountCents: Number(nextEntitlement?.unitAmountCents || 200),
      currency: String(nextEntitlement?.currency || 'BRL'),
      canUseThreeItems: nextEntitlement?.canUseThreeItems === true,
    });
  };

  useEffect(() => {
    setItems([]);
    setEntitlement({ tier: 'STANDARD', billingStatus: 'INCLUDED', monthlyLimit: 1, unitAmountCents: 200, currency: 'BRL', canUseThreeItems: false });
    setSelectedMonth(currentMonthKey());
    setSubject('');
    setContent('');
    setFile(null);
    setError('');
    setSuccess('');
    void load();
  }, [patientId]);

  useEffect(() => {
    if (typeof window === 'undefined' || loading || items.length === 0) return;
    const focusItemId = String(window.sessionStorage.getItem('verto_focus_evolution_timeline_item') || '').trim();
    if (!focusItemId) return;
    const target = items.find((item) => item.id === focusItemId);
    if (!target) return;
    setSelectedMonth(normalizeMonth(target.monthKey));
    window.sessionStorage.removeItem('verto_focus_evolution_timeline_item');
    window.setTimeout(() => document.getElementById(`evolution-timeline-item-${focusItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  }, [items, loading]);

  const monthKeys = useMemo(() => {
    const keys = new Set<string>();
    for (let offset = -5; offset <= 0; offset += 1) keys.add(monthOffset(offset));
    items.forEach((item) => {
      const key = normalizeMonth(item.monthKey);
      if (key) keys.add(key);
    });
    return Array.from(keys).sort();
  }, [items]);

  const selectedItems = useMemo(
    () => items.filter((item) => normalizeMonth(item.monthKey) === selectedMonth).sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0)),
    [items, selectedMonth],
  );

  const countByMonth = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      const key = normalizeMonth(item.monthKey);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [items]);

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const createItem = async () => {
    resetMessages();
    const cleanSubject = subject.trim();
    const cleanContent = content.trim();
    if (!cleanSubject) {
      setError('Informe o assunto/tema do registro.');
      return;
    }
    if (!cleanContent && !file) {
      setError('Escreva o conteúdo ou anexe um documento.');
      return;
    }
    if (selectedItems.length >= entitlement.monthlyLimit) {
      setError(entitlement.monthlyLimit === 1
        ? 'O limite incluído é de um registro por paciente/mês. Ative até três por R$ 2,00 por paciente/mês.'
        : 'Este mês já possui três registros na timeline.');
      return;
    }

    setSaving(true);
    let patientFileId = '';
    try {
      if (file) {
        const upload = await dataService.uploadPatientFile(patientId, {
          fileBlob: file,
          fileName: file.name,
          contentType: file.type,
          source: 'evolution_timeline',
          metadata: {
            timelineMonth: selectedMonth,
            timelineSubject: cleanSubject,
            releasedToPatient: false,
            externalSharingCandidate: true,
          },
        });
        if (!upload?.success || !upload?.data?.id) {
          throw new Error(upload?.error || 'Não foi possível anexar o documento.');
        }
        patientFileId = String(upload.data.id);
      }

      const result = await dataService.createPatientEvolutionTimelineItem(patientId, {
        monthKey: selectedMonth,
        subject: cleanSubject,
        content: cleanContent,
        patientFileId: patientFileId || null,
      });
      if (!result?.success) throw new Error(result?.error || 'Não foi possível salvar o registro.');
      setItems(Array.isArray(result?.timeline) ? result.timeline : items);
      if (result?.entitlement) {
        setEntitlement({
          tier: result.entitlement?.canUseThreeItems ? 'PLUS3' : 'STANDARD',
          billingStatus: String(result.entitlement?.billingStatus || (result.entitlement?.canUseThreeItems ? 'ACTIVE' : 'INCLUDED')),
          monthlyLimit: result.entitlement?.canUseThreeItems ? 3 : 1,
          unitAmountCents: Number(result.entitlement?.unitAmountCents || 200),
          currency: String(result.entitlement?.currency || 'BRL'),
          canUseThreeItems: result.entitlement?.canUseThreeItems === true,
        });
      }
      setSubject('');
      setContent('');
      setFile(null);
      setSuccess('Registro adicionado à timeline.');
      if (!Array.isArray(result?.timeline)) await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'Não foi possível salvar o registro.');
    } finally {
      setSaving(false);
    }
  };

  const upgradeToPlus3 = async () => {
    resetMessages();
    if (!canManageBilling) {
      setError('A ativação do adicional deve ser feita por um perfil com permissão financeira.');
      return;
    }
    if (!window.confirm('Ativar até 3 registros por paciente/mês por R$ 2,00 adicionais ao mês para este paciente?')) return;
    setSaving(true);
    try {
      const result = await dataService.upgradePatientEvolutionTimelinePlus3(patientId);
      if (!result?.success) throw new Error(result?.error || 'Não foi possível ativar o adicional.');
      const nextEntitlement = result?.entitlement;
      setEntitlement({
        tier: nextEntitlement?.canUseThreeItems ? 'PLUS3' : 'STANDARD',
        billingStatus: String(nextEntitlement?.billingStatus || (nextEntitlement?.canUseThreeItems ? 'ACTIVE' : 'INCLUDED')),
        monthlyLimit: nextEntitlement?.canUseThreeItems ? 3 : 1,
        unitAmountCents: Number(nextEntitlement?.unitAmountCents || 200),
        currency: String(nextEntitlement?.currency || 'BRL'),
        canUseThreeItems: nextEntitlement?.canUseThreeItems === true,
      });
      setSuccess('Até 3 registros por mês foram ativados para este paciente.');
      await load();
    } catch (upgradeError: any) {
      setError(upgradeError?.message || 'Não foi possível ativar o adicional da timeline.');
    } finally {
      setSaving(false);
    }
  };

  const archiveItem = async (item: EvolutionTimelineItem) => {
    if (!window.confirm('Remover este registro da timeline? Os acessos externos ativos também serão revogados.')) return;
    resetMessages();
    setBusyItemId(item.id);
    const result = await dataService.archivePatientEvolutionTimelineItem(patientId, item.id);
    setBusyItemId('');
    if (!result?.success) {
      setError(result?.error || 'Não foi possível remover o registro.');
      return;
    }
    setSuccess('Registro removido e acessos externos revogados.');
    await load();
  };

  const grantAccess = async (item: EvolutionTimelineItem) => {
    resetMessages();
    const careNetworkContactId = String(shareContactByItem[item.id] || '').trim();
    if (!careNetworkContactId) { setError('Selecione um profissional da Rede de cuidado.'); return; }
    if (!shareConfirmedByItem[item.id]) { setError('Confirme que existe autorização válida do paciente ou responsável para este compartilhamento.'); return; }
    setBusyItemId(item.id);
    const result = await dataService.grantPatientEvolutionTimelineAccess(patientId, item.id, {
      careNetworkContactId,
      canComment: shareCanCommentByItem[item.id] === true,
      authorizationConfirmed: true,
    });
    setBusyItemId('');
    if (!result?.success) { setError(result?.error || 'Não foi possível criar o compartilhamento.'); return; }
    setShareContactByItem((current) => ({ ...current, [item.id]: '' }));
    setShareCanCommentByItem((current) => ({ ...current, [item.id]: false }));
    setShareConfirmedByItem((current) => ({ ...current, [item.id]: false }));
    setSuccess(result?.data?.emailSent ? 'Acesso criado e convite enviado por e-mail.' : 'Acesso criado. Você pode reenviar ou copiar um novo acesso seguro.');
    await load();
  };

  const revokeAccess = async (item: EvolutionTimelineItem, grant: EvolutionGrant) => {
    if (!window.confirm(`Revogar o acesso de ${grant.recipientName || grant.recipientEmail}?`)) return;
    resetMessages(); setBusyItemId(`${item.id}:${grant.id}`);
    const result = await dataService.revokePatientEvolutionTimelineAccess(patientId, item.id, grant.id);
    setBusyItemId('');
    if (!result?.success) { setError(result?.error || 'Não foi possível revogar o acesso.'); return; }
    setSuccess('Acesso revogado imediatamente. O histórico foi preservado.'); await load();
  };

  const resendAccess = async (item: EvolutionTimelineItem, grant: EvolutionGrant) => {
    resetMessages(); setBusyItemId(`${item.id}:${grant.id}`);
    const result = await dataService.resendPatientEvolutionTimelineAccess(patientId, item.id, grant.id);
    setBusyItemId('');
    if (!result?.success) { setError(result?.error || 'Não foi possível reenviar o acesso.'); return; }
    setSuccess(result?.data?.emailSent ? 'Novo acesso seguro enviado por e-mail.' : 'O compartilhamento segue ativo.'); await load();
  };

  const copyAccess = async (item: EvolutionTimelineItem, grant: EvolutionGrant) => {
    resetMessages(); setBusyItemId(`${item.id}:${grant.id}:copy`);
    const result = await dataService.createPatientEvolutionTimelineAccessLink(patientId, item.id, grant.id);
    setBusyItemId('');
    const accessUrl = String(result?.data?.accessUrl || '').trim();
    if (!result?.success || !accessUrl) { setError(result?.error || 'Não foi possível gerar um novo acesso.'); return; }
    const ok = await copyText(accessUrl);
    if (!ok) { setError('Não foi possível copiar o acesso automaticamente.'); return; }
    setCopiedKey(grant.id); window.setTimeout(() => setCopiedKey(''), 1800);
    setSuccess('Novo acesso seguro copiado. O link anterior de ativação foi invalidado.');
  };

  const toggleCommentPermission = async (item: EvolutionTimelineItem, grant: EvolutionGrant) => {
    if (!grant.careNetworkContactId) { setError('Reenvie o compartilhamento usando um profissional da Rede de cuidado antes de alterar comentários.'); return; }
    resetMessages(); setBusyItemId(`${item.id}:${grant.id}:comment`);
    const result = await dataService.grantPatientEvolutionTimelineAccess(patientId, item.id, {
      careNetworkContactId: grant.careNetworkContactId,
      canComment: !grant.canComment,
      authorizationConfirmed: true,
    });
    setBusyItemId('');
    if (!result?.success) { setError(result?.error || 'Não foi possível alterar a permissão de comentário.'); return; }
    setSuccess(!grant.canComment ? 'Comentários habilitados para este profissional.' : 'Comentários desabilitados para este profissional.');
    await load();
  };

  const openAttachment = async (item: EvolutionTimelineItem) => {
    if (!item.attachment?.id) return;
    resetMessages();
    setBusyItemId(`${item.id}:file`);
    const result = await dataService.accessPatientFile(patientId, item.attachment.id, 'view');
    setBusyItemId('');
    const url = String(result?.data?.url || result?.data?.signedUrl || result?.url || '').trim();
    if (!result?.success || !url) {
      setError(result?.error || 'Não foi possível abrir o documento.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const panelClass = dark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const subtleClass = dark ? 'text-slate-400' : 'text-slate-500';
  const textClass = dark ? 'text-slate-100' : 'text-slate-900';
  const inputClass = dark
    ? 'border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500'
    : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400';

  return (
    <section className={`rounded-[28px] border p-5 shadow-sm sm:p-6 ${panelClass}`} data-testid="patient-evolution-share-timeline">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className={`rounded-xl p-2 ${dark ? 'bg-violet-500/10 text-violet-300' : 'bg-violet-50 text-[#7a32fc]'}`}>
              <CalendarDays size={18} />
            </div>
            <div>
              <h3 className={`text-base font-semibold ${textClass}`}>Timeline de evolução compartilhável</h3>
              <p className={`mt-0.5 text-xs ${subtleClass}`}>Resumos mensais com compartilhamento individual por profissional da Rede de cuidado.</p>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-medium ${dark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Atualizar
        </button>
      </div>

      <div className={`mt-5 overflow-x-auto rounded-2xl border p-3 ${dark ? 'border-slate-700 bg-slate-900/50' : 'border-slate-100 bg-slate-50'}`}>
        <div className="flex min-w-max items-start gap-1.5">
          {monthKeys.map((month, index) => {
            const selected = month === selectedMonth;
            const count = countByMonth.get(month) || 0;
            return (
              <React.Fragment key={month}>
                {index > 0 && <div className={`mt-[24px] h-px w-5 ${dark ? 'bg-slate-700' : 'bg-slate-200'}`} aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => { setSelectedMonth(month); resetMessages(); }}
                  className="group flex min-w-[74px] flex-col items-center"
                  aria-current={selected ? 'date' : undefined}
                >
                  <span className={`flex h-12 w-12 flex-col items-center justify-center rounded-full border text-[9px] font-semibold uppercase leading-tight transition ${selected ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-md shadow-violet-500/20' : dark ? 'border-slate-600 bg-slate-800 text-slate-300 group-hover:border-violet-400' : 'border-slate-200 bg-white text-slate-600 group-hover:border-violet-300'}`}>
                    <span>{compactMonthLabel(month).split(' ')[0]}</span>
                    <span className="text-[8px] opacity-80">{compactMonthLabel(month).split(' ')[1]}</span>
                  </span>
                  {canCreate ? (
                    <span className="mt-1.5 flex items-center justify-center gap-1" aria-label={`${count} de ${entitlement.monthlyLimit} registros usados`}>
                      {Array.from({ length: entitlement.monthlyLimit }).map((_, dotIndex) => (
                        <span key={`${month}-capacity-${dotIndex}`} className={`h-1.5 w-1.5 rounded-full ${dotIndex < count ? selected ? 'bg-[#7a32fc]' : dark ? 'bg-violet-300' : 'bg-violet-500' : dark ? 'bg-slate-700' : 'bg-slate-200'}`} />
                      ))}
                    </span>
                  ) : count > 0 ? (
                    <span className="mt-1.5 flex items-center justify-center gap-1" aria-label={`${count} registros neste mês`}>
                      {Array.from({ length: Math.min(count, 3) }).map((_, dotIndex) => <span key={`${month}-visible-${dotIndex}`} className={`h-1.5 w-1.5 rounded-full ${dark ? 'bg-violet-300' : 'bg-violet-500'}`} />)}
                    </span>
                  ) : null}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={`text-sm font-semibold capitalize ${textClass}`}>{monthLabel(selectedMonth)}</p>
          <p className={`text-xs ${subtleClass}`}>{selectedItems.length} de {entitlement.monthlyLimit} registro{entitlement.monthlyLimit === 1 ? '' : 's'} utilizado{selectedItems.length === 1 ? '' : 's'} neste mês.</p>
        </div>
        <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className={`min-h-10 rounded-xl border px-3 text-xs outline-none focus:border-[#7a32fc] ${inputClass}`} aria-label="Selecionar mês da timeline" />
      </div>

      {canCreate && (
        <div className={`mt-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${dark ? 'border-violet-500/20 bg-violet-500/5' : 'border-violet-100 bg-violet-50/60'}`} data-testid="evolution-timeline-capacity">
          <div className="flex items-start gap-2.5">
            <CreditCard size={16} className="mt-0.5 shrink-0 text-[#7a32fc]" />
            <div>
              <p className={`text-xs font-semibold ${textClass}`}>{entitlement.canUseThreeItems ? 'Até 3 registros por paciente/mês' : '1 registro por paciente/mês incluído'}</p>
              <p className={`mt-1 text-[11px] leading-5 ${subtleClass}`}>{entitlement.canUseThreeItems ? 'Adicional ativo para este paciente.' : 'Para usar até 3 registros no mesmo mês, o adicional é de R$ 2,00 por paciente/mês.'}</p>
            </div>
          </div>
          {!entitlement.canUseThreeItems && canManageBilling && (
            <button type="button" onClick={() => void upgradeToPlus3()} disabled={saving} className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl bg-[#7a32fc] px-3 text-[11px] font-semibold text-white disabled:opacity-60">
              {saving ? 'Ativando...' : 'Ativar até 3 · +R$ 2/mês'}
            </button>
          )}
          {!entitlement.canUseThreeItems && !canManageBilling && (
            <span className={`text-[10px] ${subtleClass}`}>Ativação disponível ao responsável financeiro.</span>
          )}
        </div>
      )}

      {error && <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-medium ${dark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-100 bg-rose-50 text-rose-700'}`}>{error}</div>}
      {success && <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-medium ${dark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{success}</div>}

      {canCreate && selectedItems.length < entitlement.monthlyLimit && (
        <div className={`mt-5 rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/40' : 'border-slate-100 bg-slate-50/70'}`}>
          <div className="flex items-center gap-2">
            <Plus size={15} className="text-[#7a32fc]" />
            <p className={`text-xs font-semibold ${textClass}`}>Adicionar registro neste mês</p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <div>
              <label className={`mb-1 ml-1 block text-[10px] font-medium uppercase tracking-wide ${subtleClass}`}>Assunto / tema</label>
              <input value={subject} maxLength={180} onChange={(event) => setSubject(event.target.value)} placeholder="Ex.: Evolução da comunicação funcional" className={`w-full rounded-xl border p-3 text-sm outline-none focus:border-[#7a32fc] ${inputClass}`} />
            </div>
            <div>
              <label className={`mb-1 ml-1 block text-[10px] font-medium uppercase tracking-wide ${subtleClass}`}>Conteúdo</label>
              <textarea value={content} maxLength={12000} onChange={(event) => setContent(event.target.value)} rows={4} placeholder="Escreva o resumo ou a informação clínica que será disponibilizada neste ponto da timeline." className={`w-full resize-y rounded-xl border p-3 text-sm leading-6 outline-none focus:border-[#7a32fc] ${inputClass}`} />
            </div>
            <div>
              <label className={`mb-1 ml-1 block text-[10px] font-medium uppercase tracking-wide ${subtleClass}`}>Documento opcional</label>
              <label className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2 ${dark ? 'border-slate-600 bg-slate-800/60 hover:border-violet-400' : 'border-slate-300 bg-white hover:border-violet-300'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip size={15} className="shrink-0 text-[#7a32fc]" />
                  <span className={`truncate text-xs ${file ? textClass : subtleClass}`}>{file?.name || 'PDF, DOCX, JPG, PNG ou WEBP · até 10 MB'}</span>
                </span>
                <span className="text-[10px] font-semibold text-[#7a32fc]">Selecionar</span>
                <input type="file" className="hidden" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </label>
              {file && <button type="button" onClick={() => setFile(null)} className="mt-1 text-[10px] font-medium text-rose-500">Remover anexo</button>}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => void createItem()} disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-5 text-xs font-semibold text-white shadow-md shadow-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {saving ? 'Salvando...' : 'Adicionar à timeline'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {!loading && selectedItems.length === 0 && (
          <div className={`rounded-2xl border border-dashed px-5 py-8 text-center ${dark ? 'border-slate-700 bg-slate-900/30' : 'border-slate-200 bg-slate-50'}`}>
            <FileText size={24} className="mx-auto text-slate-400" />
            <p className={`mt-2 text-sm font-medium ${textClass}`}>Nenhum registro neste mês</p>
            <p className={`mt-1 text-xs ${subtleClass}`}>A timeline começa a ser construída à medida que os resumos são adicionados.</p>
          </div>
        )}

        {selectedItems.map((item) => (
          <article id={`evolution-timeline-item-${item.id}`} key={item.id} className={`rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${dark ? 'bg-violet-500/15 text-violet-200' : 'bg-violet-50 text-violet-700'}`}>Registro {item.slot}</span>
                  <h4 className={`text-sm font-semibold ${textClass}`}>{item.subject}</h4>
                </div>
                {item.content && <p className={`mt-2 whitespace-pre-wrap text-xs leading-5 ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{item.content}</p>}
              </div>
              {canCreate && (
                <button type="button" onClick={() => void archiveItem(item)} disabled={busyItemId === item.id} title="Remover registro e revogar acessos" className={`rounded-lg p-2 ${dark ? 'text-slate-500 hover:bg-rose-500/10 hover:text-rose-300' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-600'}`}>
                  {busyItemId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </div>

            {item.attachment && (
              <button type="button" onClick={() => void openAttachment(item)} disabled={busyItemId === `${item.id}:file`} className={`mt-3 flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left ${dark ? 'border-slate-700 bg-slate-800/70 hover:border-violet-500/40' : 'border-slate-100 bg-slate-50 hover:border-violet-200'}`}>
                <span className="flex min-w-0 items-center gap-2">
                  <FileText size={15} className="shrink-0 text-[#7a32fc]" />
                  <span className="min-w-0">
                    <span className={`block truncate text-xs font-medium ${textClass}`}>{item.attachment.fileName || 'Documento'}</span>
                    <span className={`block text-[10px] ${subtleClass}`}>{formatBytes(item.attachment.sizeBytes)}</span>
                  </span>
                </span>
                {busyItemId === `${item.id}:file` ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} className={subtleClass} />}
              </button>
            )}

            <div className={`mt-4 border-t pt-4 ${dark ? 'border-slate-700' : 'border-slate-100'}`}>
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-emerald-500" />
                <p className={`text-xs font-semibold ${textClass}`}>Compartilhado com</p>
              </div>
              <p className={`mt-1 text-[11px] leading-5 ${subtleClass}`}>Cada acesso pertence somente a esta evolução. O profissional externo precisa entrar na própria conta Verto para visualizar o conteúdo.</p>

              {(item.grants || []).length > 0 ? (
                <div className="mt-3 space-y-2">
                  {(item.grants || []).map((grant) => {
                    const viewed = Boolean(grant.firstViewedAt);
                    const comments = Array.isArray(grant.comments) ? grant.comments : [];
                    return (
                      <div key={grant.id} className={`rounded-xl border p-3 ${dark ? 'border-slate-700 bg-slate-800/60' : 'border-slate-100 bg-slate-50'}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-2">
                            <UserRound size={14} className="mt-0.5 shrink-0 text-[#7a32fc]" />
                            <div className="min-w-0">
                              <p className={`truncate text-xs font-semibold ${textClass}`}>{grant.recipientName || grant.recipientEmail}{grant.recipientSpecialty ? ` · ${grant.recipientSpecialty}` : ''}</p>
                              {grant.recipientName && <p className={`mt-0.5 truncate text-[10px] ${subtleClass}`}>{grant.recipientEmail}</p>}
                              <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] ${subtleClass}`}>
                                <span>{viewed ? `✓✓ Visualizado ${formatSharedAt(grant.lastViewedAt || grant.firstViewedAt)}` : grant.lastInvitedAt ? `✓ Enviado ${formatSharedAt(grant.lastInvitedAt)}` : 'Acesso criado'}</span>
                                {!viewed && <span>Ainda não visualizado</span>}
                                <span className="inline-flex items-center gap-1"><MessageCircle size={10} /> {Number(grant.commentCount || comments.length || 0)} comentário(s)</span>
                                <span>{grant.canComment ? 'Pode comentar' : 'Somente visualizar'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => void copyAccess(item, grant)} disabled={busyItemId === `${item.id}:${grant.id}:copy`} className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium ${dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                              {busyItemId === `${item.id}:${grant.id}:copy` ? <Loader2 size={11} className="animate-spin" /> : <Clipboard size={11} />} {copiedKey === grant.id ? 'Copiado' : 'Copiar acesso'}
                            </button>
                            <button type="button" onClick={() => void resendAccess(item, grant)} disabled={busyItemId === `${item.id}:${grant.id}`} className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium ${dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                              <Mail size={11} /> Reenviar
                            </button>
                            <button type="button" onClick={() => void toggleCommentPermission(item, grant)} disabled={!grant.careNetworkContactId || busyItemId === `${item.id}:${grant.id}:comment`} className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium ${grant.canComment ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' : dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                              <MessageCircle size={11} /> {grant.canComment ? 'Desabilitar comentário' : 'Habilitar comentário'}
                            </button>
                            <button type="button" onClick={() => void revokeAccess(item, grant)} disabled={busyItemId === `${item.id}:${grant.id}`} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-medium text-rose-600 hover:bg-rose-50">
                              {busyItemId === `${item.id}:${grant.id}` ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />} Revogar
                            </button>
                          </div>
                        </div>
                        {comments.length > 0 && (
                          <div className={`mt-3 space-y-2 border-t pt-3 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
                            {comments.map((comment) => (
                              <div key={comment.id} className={`rounded-lg px-3 py-2 ${dark ? 'bg-slate-900/60' : 'bg-white'}`}>
                                <p className={`whitespace-pre-wrap text-[11px] leading-5 ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{comment.body}</p>
                                {comment.createdAt && <p className={`mt-1 text-[9px] ${subtleClass}`}>{formatSharedAt(comment.createdAt)}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={`mt-3 text-[11px] ${subtleClass}`}>Esta evolução ainda não foi compartilhada.</p>
              )}

              {canShare ? (
                <div className={`mt-3 rounded-xl border p-3 ${dark ? 'border-slate-700 bg-slate-800/35' : 'border-slate-100 bg-slate-50/70'}`}>
                  <p className={`text-xs font-semibold ${textClass}`}>Gerenciar compartilhamento</p>
                  <label className={`mb-1 ml-1 mt-3 block text-[10px] font-medium uppercase tracking-wide ${subtleClass}`}>Profissional da Rede de cuidado</label>
                  <select value={shareContactByItem[item.id] || ''} onChange={(event) => setShareContactByItem((current) => ({ ...current, [item.id]: event.target.value }))} className={`min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-[#7a32fc] ${inputClass}`}>
                    <option value="">Selecione um profissional</option>
                    {careNetwork.map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.professional_name}{contact.specialty ? ` · ${contact.specialty}` : ''} · {contact.email}</option>
                    ))}
                  </select>
                  {careNetwork.length === 0 && <p className={`mt-2 text-[10px] ${subtleClass}`}>Adicione primeiro um profissional com e-mail na Rede de cuidado deste paciente.</p>}
                  <div className={`mt-3 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${dark ? 'border-slate-700 bg-slate-900/30' : 'border-slate-100 bg-white'}`}>
                    <label className={`flex items-center gap-2 text-[11px] ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                      <input type="checkbox" checked={Boolean(shareContactByItem[item.id])} readOnly className="h-4 w-4 rounded border-slate-300 text-[#7a32fc]" />
                      <span>Visualizar</span>
                    </label>
                    <label className={`flex cursor-pointer items-center gap-2 text-[11px] ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                      <input type="checkbox" disabled={!shareContactByItem[item.id]} checked={shareCanCommentByItem[item.id] === true} onChange={(event) => setShareCanCommentByItem((current) => ({ ...current, [item.id]: event.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]" />
                      <span>Comentar</span>
                    </label>
                  </div>
                  <label className={`mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-5 ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                    <input type="checkbox" checked={shareConfirmedByItem[item.id] === true} onChange={(event) => setShareConfirmedByItem((current) => ({ ...current, [item.id]: event.target.checked }))} className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]" />
                    <span>Declaro que existe autorização válida do paciente ou responsável legal para compartilhar esta evolução com o profissional selecionado, para continuidade do cuidado.</span>
                  </label>
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => void grantAccess(item)} disabled={busyItemId === item.id || !shareContactByItem[item.id]} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-xs font-semibold text-white disabled:opacity-60">
                      {busyItemId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Compartilhar
                    </button>
                  </div>
                </div>
              ) : (
                <p className={`mt-3 text-[11px] ${subtleClass}`}>Seu perfil pode visualizar esta timeline, mas não possui permissão para conceder acesso externo.</p>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className={`mt-5 flex items-start gap-2 rounded-xl border px-3 py-3 text-[11px] leading-5 ${dark ? 'border-sky-500/20 bg-sky-500/5 text-sky-200' : 'border-sky-100 bg-sky-50 text-sky-800'}`}>
        <Link2 size={14} className="mt-0.5 shrink-0" />
        <span>Compartilhamentos são independentes por evolução. Estar na Rede de cuidado não concede acesso automático: somente profissionais selecionados explicitamente podem visualizar, e comentários dependem de permissão própria.</span>
      </div>
    </section>
  );
};
