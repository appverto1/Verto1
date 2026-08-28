import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Mail,
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
  recipientEmail: string;
  status: string;
  authorizationDeclaredAt?: string | null;
  lastInvitedAt?: string | null;
  shareUrl?: string | null;
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

type Props = {
  patientId: string;
  dark?: boolean;
  canCreate?: boolean;
  canShare?: boolean;
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

export const PatientEvolutionTimelinePanel = ({ patientId, dark = false, canCreate = false, canShare = false }: Props) => {
  const [items, setItems] = useState<EvolutionTimelineItem[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [shareEmailByItem, setShareEmailByItem] = useState<Record<string, string>>({});
  const [shareConfirmedByItem, setShareConfirmedByItem] = useState<Record<string, boolean>>({});
  const [busyItemId, setBusyItemId] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  const load = async () => {
    if (!patientId) return;
    setLoading(true);
    setError('');
    const result = await dataService.getPatientEvolutionTimeline(patientId);
    setLoading(false);
    if (!result?.success) {
      setError(result?.error || 'Não foi possível carregar a timeline de evolução.');
      return;
    }
    setItems(Array.isArray(result?.data) ? result.data : []);
  };

  useEffect(() => {
    setItems([]);
    setSelectedMonth(currentMonthKey());
    setSubject('');
    setContent('');
    setFile(null);
    setError('');
    setSuccess('');
    void load();
  }, [patientId]);

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
    if (selectedItems.length >= 3) {
      setError('Este mês já possui três registros na timeline.');
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
    const email = String(shareEmailByItem[item.id] || '').trim().toLowerCase();
    if (!email) {
      setError('Informe o e-mail do profissional externo.');
      return;
    }
    if (!shareConfirmedByItem[item.id]) {
      setError('Confirme que existe autorização válida do paciente ou responsável para este compartilhamento.');
      return;
    }
    setBusyItemId(item.id);
    const result = await dataService.grantPatientEvolutionTimelineAccess(patientId, item.id, {
      recipientEmail: email,
      authorizationConfirmed: true,
    });
    setBusyItemId('');
    if (!result?.success) {
      setError(result?.error || 'Não foi possível criar o compartilhamento.');
      return;
    }
    setShareEmailByItem((current) => ({ ...current, [item.id]: '' }));
    setShareConfirmedByItem((current) => ({ ...current, [item.id]: false }));
    setSuccess(result?.data?.emailSent ? 'Acesso criado e convite enviado por e-mail.' : 'Acesso criado. O link pode ser copiado manualmente.');
    await load();
  };

  const revokeAccess = async (item: EvolutionTimelineItem, grant: EvolutionGrant) => {
    if (!window.confirm(`Revogar o acesso de ${grant.recipientEmail}?`)) return;
    resetMessages();
    setBusyItemId(`${item.id}:${grant.id}`);
    const result = await dataService.revokePatientEvolutionTimelineAccess(patientId, item.id, grant.id);
    setBusyItemId('');
    if (!result?.success) {
      setError(result?.error || 'Não foi possível revogar o acesso.');
      return;
    }
    setSuccess('Acesso revogado imediatamente.');
    await load();
  };

  const resendAccess = async (item: EvolutionTimelineItem, grant: EvolutionGrant) => {
    resetMessages();
    setBusyItemId(`${item.id}:${grant.id}`);
    const result = await dataService.resendPatientEvolutionTimelineAccess(patientId, item.id, grant.id);
    setBusyItemId('');
    if (!result?.success) {
      setError(result?.error || 'Não foi possível reenviar o convite.');
      return;
    }
    setSuccess(result?.data?.emailSent ? 'Convite reenviado.' : 'O acesso segue ativo; copie o link para enviar manualmente.');
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
              <p className={`mt-0.5 text-xs ${subtleClass}`}>Até três registros independentes por mês, cada um com seus próprios destinatários.</p>
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
                {index > 0 && <div className={`mt-[18px] h-px w-5 ${dark ? 'bg-slate-700' : 'bg-slate-200'}`} aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => { setSelectedMonth(month); resetMessages(); }}
                  className="group flex min-w-[74px] flex-col items-center"
                  aria-current={selected ? 'date' : undefined}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full border text-[10px] font-semibold transition ${selected ? 'border-[#7a32fc] bg-[#7a32fc] text-white shadow-md shadow-violet-500/20' : dark ? 'border-slate-600 bg-slate-800 text-slate-300 group-hover:border-violet-400' : 'border-slate-200 bg-white text-slate-500 group-hover:border-violet-300'}`}>{count}/3</span>
                  <span className={`mt-1.5 text-[10px] font-medium uppercase ${selected ? dark ? 'text-violet-300' : 'text-violet-700' : subtleClass}`}>{compactMonthLabel(month)}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={`text-sm font-semibold capitalize ${textClass}`}>{monthLabel(selectedMonth)}</p>
          <p className={`text-xs ${subtleClass}`}>{selectedItems.length} de 3 registros utilizados neste mês.</p>
        </div>
        <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} className={`min-h-10 rounded-xl border px-3 text-xs outline-none focus:border-[#7a32fc] ${inputClass}`} aria-label="Selecionar mês da timeline" />
      </div>

      {error && <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-medium ${dark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-100 bg-rose-50 text-rose-700'}`}>{error}</div>}
      {success && <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-medium ${dark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>{success}</div>}

      {canCreate && selectedItems.length < 3 && (
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
          <article key={item.id} className={`rounded-2xl border p-4 ${dark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-200 bg-white'}`}>
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
                <p className={`text-xs font-semibold ${textClass}`}>Acesso externo por e-mail</p>
              </div>
              <p className={`mt-1 text-[11px] leading-5 ${subtleClass}`}>O link funciona apenas como endereço. O destinatário precisa confirmar exatamente o e-mail autorizado com código enviado por e-mail.</p>

              {(item.grants || []).length > 0 && (
                <div className="mt-3 space-y-2">
                  {(item.grants || []).map((grant) => (
                    <div key={grant.id} className={`rounded-xl border p-3 ${dark ? 'border-slate-700 bg-slate-800/60' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <UserRound size={14} className="shrink-0 text-[#7a32fc]" />
                          <div className="min-w-0">
                            <p className={`truncate text-xs font-medium ${textClass}`}>{grant.recipientEmail}</p>
                            <p className={`text-[10px] ${subtleClass}`}>Acesso ativo · revogável a qualquer momento</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {grant.shareUrl && (
                            <button type="button" onClick={async () => {
                              const ok = await copyText(String(grant.shareUrl));
                              setCopiedKey(ok ? grant.id : '');
                              if (ok) window.setTimeout(() => setCopiedKey(''), 1800);
                            }} className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium ${dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                              <Clipboard size={11} /> {copiedKey === grant.id ? 'Copiado' : 'Copiar link'}
                            </button>
                          )}
                          <button type="button" onClick={() => void resendAccess(item, grant)} disabled={busyItemId === `${item.id}:${grant.id}`} className={`inline-flex min-h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium ${dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
                            <Mail size={11} /> Reenviar
                          </button>
                          <button type="button" onClick={() => void revokeAccess(item, grant)} disabled={busyItemId === `${item.id}:${grant.id}`} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-medium text-rose-600 hover:bg-rose-50">
                            {busyItemId === `${item.id}:${grant.id}` ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />} Revogar
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canShare ? (
                <div className={`mt-3 rounded-xl border p-3 ${dark ? 'border-slate-700 bg-slate-800/35' : 'border-slate-100 bg-slate-50/70'}`}>
                  <label className={`mb-1 ml-1 block text-[10px] font-medium uppercase tracking-wide ${subtleClass}`}>E-mail do profissional autorizado</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input type="email" value={shareEmailByItem[item.id] || ''} onChange={(event) => setShareEmailByItem((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="profissional@exemplo.com" className={`min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none focus:border-[#7a32fc] ${inputClass}`} />
                    <button type="button" onClick={() => void grantAccess(item)} disabled={busyItemId === item.id} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#7a32fc] px-4 text-xs font-semibold text-white disabled:opacity-60">
                      {busyItemId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Compartilhar
                    </button>
                  </div>
                  <label className={`mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-5 ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                    <input type="checkbox" checked={shareConfirmedByItem[item.id] === true} onChange={(event) => setShareConfirmedByItem((current) => ({ ...current, [item.id]: event.target.checked }))} className="mt-1 h-4 w-4 rounded border-slate-300 text-[#7a32fc] focus:ring-[#7a32fc]" />
                    <span>Declaro que existe autorização válida do paciente ou responsável legal para compartilhar este item com o destinatário informado, para continuidade do cuidado.</span>
                  </label>
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
        <span>Compartilhamentos são independentes por registro. Três documentos no mesmo mês podem ter três grupos de destinatários diferentes, e um único registro pode ser liberado para vários e-mails.</span>
      </div>
    </section>
  );
};
