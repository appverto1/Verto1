import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, CheckCircle2, Copy, Library, Loader2, MoreHorizontal, Pencil, Plus, Search, X } from 'lucide-react';
import { dataService } from '../services/dataService';
import { THERAPEUTIC_MEASUREMENT_OPTIONS, masteryCriterionLabel } from '../utils/therapeuticPlan';
import { normalizeClinicalTextRecord } from '../utils/clinicalText';

const CATEGORIES = [
  ['COMUNICACAO', 'Comunicação'], ['SOCIAL', 'Social'], ['AUTONOMIA', 'Autonomia'],
  ['BRINCADEIRA', 'Brincadeira'], ['ACADEMICO', 'Acadêmico'], ['REGULACAO', 'Regulação'],
  ['SEGURANCA', 'Segurança'], ['MOTRICIDADE', 'Motricidade'], ['CUIDADOS_PESSOAIS', 'Cuidados pessoais'], ['OUTRO', 'Outro'],
] as const;

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);

const emptyForm = (canShareWithClinic = true) => ({
  name: '', objective: '', description: '', category: 'COMUNICACAO', targets: [] as string[],
  measurementType: 'independent_prompted_no_response', accuracy: '80', sessions: '3', status: canShareWithClinic ? 'PUBLISHED' : 'DRAFT',
  specialty: '', tags: '', visibility: canShareWithClinic ? 'clinic' : 'private',
});

const idempotencyKey = () => `program-template-direct:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;

export const TherapeuticProgramLibrary = ({ isDark = false, canManageLibrary = true }: any) => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [category, setCategory] = useState('all');
  const [specialty, setSpecialty] = useState('all');
  const [author, setAuthor] = useState('all');
  const [status, setStatus] = useState('active');
  const [openMenuId, setOpenMenuId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(() => emptyForm(canManageLibrary));
  const [targetInput, setTargetInput] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [requestKey, setRequestKey] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const panel = isDark ? 'border-white/10 bg-[#101a2d] text-slate-100' : 'border-slate-200 bg-white text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const field = `w-full rounded-xl border px-3.5 py-3 text-sm outline-none focus:border-violet-500 ${isDark ? 'border-white/10 bg-[#0b1220] text-white' : 'border-slate-200 bg-white text-slate-800'}`;

  const loadTemplates = async (force = false) => {
    setLoading(true);
    setError('');
    const response = await dataService.getTherapeuticProgramTemplates({ force, includeArchived: true });
    if (response?.success === false) {
      setError(response?.message || response?.error || 'Não foi possível carregar a biblioteca de programas.');
      setLoading(false);
      return;
    }
    setTemplates(Array.isArray(response?.data) ? response.data : []);
    setLoading(false);
  };

  useEffect(() => { void loadTemplates(false); }, []);

  const visibleTemplates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return templates.filter((template: any) => {
      const templateScope = String(template?.source_scope || '').toUpperCase();
      const templateStatus = String(template?.status || '').toUpperCase();
      const scopeMatch = scope === 'all' || (scope === 'verto' && templateScope === 'VERTO') || (scope === 'clinic' && templateScope === 'CLINIC') || (scope === 'mine' && templateScope === 'PERSONAL');
      const categoryMatch = category === 'all' || String(template?.category || '').toUpperCase() === category;
      const specialtyMatch = specialty === 'all' || String(template?.specialty || '') === specialty;
      const authorMatch = author === 'all' || String(template?.created_by || '') === author;
      const statusMatch = status === 'all' || (status === 'active' && templateStatus !== 'ARCHIVED') || (status === 'archived' && templateStatus === 'ARCHIVED');
      const content = `${template?.name || ''} ${template?.objective || ''} ${template?.description || ''} ${(template?.suggested_targets || []).join(' ')} ${(template?.tags || []).join(' ')} ${template?.specialty || ''}`.toLocaleLowerCase('pt-BR');
      return scopeMatch && categoryMatch && specialtyMatch && authorMatch && statusMatch && (!needle || content.includes(needle));
    });
  }, [author, category, query, scope, specialty, status, templates]);
  const specialties = useMemo(() => Array.from(new Set<string>(templates.map((template) => String(template?.specialty || '').trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'pt-BR')), [templates]);
  const authors = useMemo(() => Array.from(new Map<string, string>(templates.map((template) => [String(template?.created_by || ''), String(template?.author_name || 'Profissional')] as [string, string]).filter(([id]) => Boolean(id))).entries()).sort((left, right) => left[1].localeCompare(right[1], 'pt-BR')), [templates]);
  const totalPages = Math.max(1, Math.ceil(visibleTemplates.length / pageSize));
  const pagedTemplates = useMemo(() => visibleTemplates.slice((page - 1) * pageSize, page * pageSize), [page, visibleTemplates]);

  useEffect(() => { setPage(1); }, [author, category, query, scope, specialty, status]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const canManageTemplate = (template: any) => {
    const templateScope = String(template?.source_scope || '').toUpperCase();
    return templateScope === 'PERSONAL' || (templateScope === 'CLINIC' && canManageLibrary);
  };

  const openCreate = () => {
    setEditingId(''); setForm(emptyForm(canManageLibrary)); setTargetInput(''); setFormError(''); setRequestKey(idempotencyKey()); setModalOpen(true);
  };

  const openEdit = (template: any, duplicate = false) => {
    const criteria = template?.mastery_criteria || {};
    setEditingId(duplicate ? '' : String(template.id));
    setForm({
      ...emptyForm(canManageLibrary),
      name: duplicate ? `Cópia de ${template.name}` : String(template.name || ''),
      objective: String(template.objective || ''), description: String(template.description || ''),
      category: String(template.category || 'OUTRO').toUpperCase(),
      targets: Array.isArray(template.suggested_targets) ? template.suggested_targets.map(String) : [],
      measurementType: String(template.measurement_type || 'independent_prompted_no_response'),
      accuracy: String(criteria.minAccuracyPercent ?? criteria.min_accuracy_percent ?? 80),
      sessions: String(criteria.requiredSessions ?? criteria.required_sessions ?? 3),
      status: duplicate ? 'DRAFT' : String(template.status || 'DRAFT').toUpperCase(),
      specialty: String(template.specialty || ''),
      tags: Array.isArray(template.tags) ? template.tags.join(', ') : '',
      visibility: canManageLibrary
        ? String(template.visibility || (String(template.source_scope || '').toUpperCase() === 'PERSONAL' ? 'private' : 'clinic'))
        : 'private',
    });
    setRequestKey(idempotencyKey()); setTargetInput(''); setFormError(''); setModalOpen(true); setOpenMenuId('');
  };

  const addTarget = () => {
    const value = targetInput.trim().replace(/\s+/g, ' ');
    if (!value || form.targets.some((target) => target.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))) { setTargetInput(''); return; }
    setForm((current) => ({ ...current, targets: [...current.targets, value].slice(0, 50) }));
    setTargetInput('');
  };

  const saveTemplate = async () => {
    if (!form.name.trim() || !form.objective.trim() || form.targets.length === 0) {
      setFormError('Informe nome, objetivo e ao menos um alvo sugerido.'); return;
    }
    if (saving) return;
    setSaving(true); setFormError('');
    const normalizedForm = normalizeClinicalTextRecord(form);
    const payload = {
      name: normalizedForm.name.trim(), objective: normalizedForm.objective.trim(), description: normalizedForm.description.trim() || normalizedForm.objective.trim(),
      category: normalizedForm.category, suggestedTargets: normalizedForm.targets, measurementType: normalizedForm.measurementType,
      specialty: normalizedForm.specialty.trim() || null,
      tags: normalizedForm.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean).slice(0, 30),
      visibility: normalizedForm.visibility,
      masteryCriteria: { type: 'accuracy_sessions', minAccuracyPercent: Math.max(1, Math.min(100, Number(normalizedForm.accuracy) || 80)), requiredSessions: Math.max(1, Math.min(30, Number(normalizedForm.sessions) || 3)) },
      status: normalizedForm.status, idempotencyKey: requestKey || idempotencyKey(),
    };
    const currentTemplate = templates.find((template) => String(template.id) === editingId);
    const response = editingId
      ? await dataService.updateTherapeuticProgramTemplate(editingId, {
          ...payload,
          action: 'new_version',
          expectedVersion: Number(currentTemplate?.template_version || 1),
          changeReason: 'Conteúdo revisado na biblioteca'
        })
      : await dataService.saveTherapeuticProgramTemplate(payload);
    if (response?.success === false) {
      setFormError(response?.message || response?.error || 'Não foi possível salvar o modelo.'); setSaving(false); return;
    }
    setNotice(response?.message || 'Modelo salvo.'); setModalOpen(false); await loadTemplates(true); setSaving(false);
  };

  const changeStatus = async (template: any, nextStatus: string) => {
    if (!canManageTemplate(template) || String(template?.source_scope).toUpperCase() === 'VERTO') return;
    setOpenMenuId('');
    const response = await dataService.updateTherapeuticProgramTemplate(String(template.id), { status: nextStatus });
    setNotice(response?.success === false ? response?.message || response?.error || 'Não foi possível atualizar o modelo.' : response?.message || 'Modelo atualizado.');
    if (response?.success !== false) await loadTemplates(true);
  };

  return <section className="mx-auto w-full max-w-6xl space-y-6" data-testid="therapeutic-program-library">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h2 className="text-xl font-medium">Biblioteca de programas</h2><p className={`mt-1 text-sm ${muted}`}>Modelos reutilizáveis sem dados clínicos de pacientes.</p></div>
      <button type="button" className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white" onClick={openCreate}><Plus size={17} /> Criar modelo pessoal</button>
    </div>
    {notice && <div className={`flex justify-between rounded-xl border px-4 py-3 text-sm ${isDark ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><span>{notice}</span><button onClick={() => setNotice('')}><X size={15} /></button></div>}
    {error && <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error} <button className="underline" onClick={() => void loadTemplates(true)}>Tentar novamente</button></div>}
    <div className={`grid grid-cols-1 gap-3 rounded-2xl border p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_repeat(5,minmax(150px,auto))] ${panel}`}>
      <label className="relative"><Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} /><input className={`${field} pl-10`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelo ou alvo" /></label>
      <select className={field} value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">Todas as fontes</option><option value="verto">Modelos Verto</option><option value="clinic">Modelos da clínica</option><option value="mine">Meus modelos</option></select>
      <select className={field} value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Todas as categorias</option>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select className={field} value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option value="all">Todas as especialidades</option>{specialties.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select className={field} value={author} onChange={(event) => setAuthor(event.target.value)}><option value="all">Todos os autores</option>{authors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select className={field} value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option></select>
    </div>
    {loading ? <div className={`flex items-center justify-center gap-2 py-16 text-sm ${muted}`}><Loader2 size={20} className="animate-spin" /> Carregando modelos...</div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{pagedTemplates.map((template: any) => {
      const source = String(template.source_scope || '').toUpperCase(); const isVerto = source === 'VERTO'; const templateStatus = String(template.status || 'DRAFT').toUpperCase();
      return <article key={template.id} className={`relative flex min-h-[285px] flex-col rounded-2xl border p-5 ${panel}`}><div className="flex items-start justify-between gap-3"><div className={`rounded-xl p-2.5 ${isDark ? 'bg-violet-500/15 text-violet-300' : 'bg-violet-50 text-violet-600'}`}><Library size={19} /></div>{canManageTemplate(template) && !isVerto && <button className={`rounded-lg p-2 ${isDark ? 'text-slate-400 hover:bg-white/5' : 'text-slate-400 hover:bg-slate-100'}`} onClick={() => setOpenMenuId((current) => current === String(template.id) ? '' : String(template.id))}><MoreHorizontal size={18} /></button>}</div>{openMenuId === String(template.id) && <div className={`absolute right-5 top-12 z-10 w-48 rounded-xl border p-1.5 shadow-xl ${panel}`}><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-500/10" onClick={() => openEdit(template)}><Pencil size={15} /> Editar</button><button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-500/10" onClick={() => openEdit(template, true)}><Copy size={15} /> Duplicar</button>{templateStatus !== 'PUBLISHED' && <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-emerald-500/10" onClick={() => void changeStatus(template, 'PUBLISHED')}><CheckCircle2 size={15} /> Publicar</button>}{templateStatus !== 'ARCHIVED' && <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-amber-500/10" onClick={() => void changeStatus(template, 'ARCHIVED')}><Archive size={15} /> Arquivar modelo</button>}</div>}<div className="mt-4 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] ${isDark ? 'bg-white/5 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{isVerto ? 'Modelo Verto' : source === 'PERSONAL' ? 'Meu modelo' : 'Clínica'}</span><span className={`rounded-full px-2.5 py-1 text-[10px] ${templateStatus === 'PUBLISHED' ? 'bg-emerald-500/10 text-emerald-500' : templateStatus === 'ARCHIVED' ? 'bg-slate-500/10 text-slate-400' : 'bg-amber-500/10 text-amber-500'}`}>{templateStatus === 'PUBLISHED' ? 'Publicado' : templateStatus === 'ARCHIVED' ? 'Arquivado' : 'Rascunho'}</span>{template.specialty && <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[10px] text-sky-600">{template.specialty}</span>}</div><h3 className="mt-3 text-lg font-medium">{template.name}</h3><p className={`mt-2 line-clamp-3 text-sm leading-relaxed ${muted}`}>{template.objective || template.description}</p>{Array.isArray(template.tags) && template.tags.length > 0 && <p className={`mt-2 line-clamp-1 text-xs ${muted}`}>{template.tags.map((tag: string) => `#${tag}`).join(' ')}</p>}<div className={`mt-auto border-t pt-4 text-xs ${isDark ? 'border-white/10' : 'border-slate-100'} ${muted}`}><p>{Array.isArray(template.suggested_targets) ? template.suggested_targets.length : 0} alvos · {masteryCriterionLabel(template.mastery_criteria)}</p><p className="mt-1">{template.author_name || 'Profissional'} · usado por {Number(template.patient_usage_count || 0)} paciente(s)</p></div></article>;
    })}{!visibleTemplates.length && <div className={`col-span-full rounded-2xl border border-dashed py-14 text-center text-sm ${isDark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhum modelo encontrado.</div>}</div>}
    {!loading && visibleTemplates.length > pageSize && <nav className="flex items-center justify-between" aria-label="Paginação dos modelos"><button type="button" className="min-h-10 rounded-xl border px-4 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><span className={`text-xs ${muted}`}>Página {page} de {totalPages}</span><button type="button" className="min-h-10 rounded-xl border px-4 text-sm disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Próxima</button></nav>}

    {modalOpen && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-slate-950/60 p-3 pt-4 backdrop-blur-sm sm:p-6"><div className={`flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border shadow-2xl ${panel}`}><header className={`sticky top-0 z-10 flex shrink-0 items-center justify-between border-b px-5 py-4 ${isDark ? 'border-white/10 bg-[#101a2d]' : 'border-slate-100 bg-white'}`}><div><h3 className="text-lg font-medium">{editingId ? 'Editar modelo' : 'Criar modelo'}</h3><p className={`mt-1 text-xs ${muted}`}>Somente estrutura clínica, sem dados de pacientes.</p></div><button className="rounded-xl p-2 hover:bg-violet-500/10" onClick={() => setModalOpen(false)}><X size={19} /></button></header><div className="space-y-4 overflow-y-auto p-5">{formError && <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</div>}<div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className={`text-xs ${muted}`}>Nome<input className={`${field} mt-1.5`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label className={`text-xs ${muted}`}>Categoria<select className={`${field} mt-1.5`} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className={`text-xs ${muted}`}>Especialidade<input className={`${field} mt-1.5`} value={form.specialty} onChange={(event) => setForm((current) => ({ ...current, specialty: event.target.value }))} placeholder="Ex.: Psicologia" /></label><label className={`text-xs ${muted}`}>Tags<input className={`${field} mt-1.5`} value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="comunicação, autonomia" /></label></div><label className={`block text-xs ${muted}`}>Objetivo<textarea className={`${field} mt-1.5 min-h-[90px]`} value={form.objective} onChange={(event) => setForm((current) => ({ ...current, objective: event.target.value }))} /></label><label className={`block text-xs ${muted}`}>Descrição curta<textarea className={`${field} mt-1.5`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label><div><p className={`text-xs ${muted}`}>Alvos sugeridos</p><div className={`mt-1.5 rounded-xl border p-3 ${isDark ? 'border-white/10 bg-[#0b1220]' : 'border-slate-200 bg-white'}`}><div className="flex flex-wrap gap-2">{form.targets.map((target) => <span key={target} className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-3 py-1.5 text-xs text-violet-500">{target}<button onClick={() => setForm((current) => ({ ...current, targets: current.targets.filter((item) => item !== target) }))}><X size={12} /></button></span>)}</div><div className="mt-2 flex gap-2"><input className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" value={targetInput} onChange={(event) => setTargetInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTarget(); } }} placeholder="Digite e pressione Enter" /><button className="rounded-lg bg-violet-600 px-3 text-white" onClick={addTarget}><Plus size={15} /></button></div></div></div><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><label className={`text-xs ${muted}`}>Registro<select className={`${field} mt-1.5`} value={form.measurementType} onChange={(event) => setForm((current) => ({ ...current, measurementType: event.target.value }))}>{THERAPEUTIC_MEASUREMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={`text-xs ${muted}`}>Domínio (%)<input type="number" min="1" max="100" className={`${field} mt-1.5`} value={form.accuracy} onChange={(event) => setForm((current) => ({ ...current, accuracy: event.target.value }))} /></label><label className={`text-xs ${muted}`}>Sessões<input type="number" min="1" max="30" className={`${field} mt-1.5`} value={form.sessions} onChange={(event) => setForm((current) => ({ ...current, sessions: event.target.value }))} /></label></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><label className={`block text-xs ${muted}`}>Visibilidade<select className={`${field} mt-1.5`} value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}>{canManageLibrary && <option value="clinic">Compartilhado com a clínica</option>}<option value="private">Meu modelo pessoal</option></select></label><label className={`block text-xs ${muted}`}>Estado<select className={`${field} mt-1.5`} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}><option value="DRAFT">Rascunho</option><option value="PUBLISHED">Publicado</option><option value="ARCHIVED">Arquivado</option></select></label></div><div className="flex justify-end gap-2"><button className={`rounded-xl border px-4 py-2.5 text-sm ${isDark ? 'border-white/10' : 'border-slate-200'}`} onClick={() => setModalOpen(false)}>Cancelar</button><button className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm text-white disabled:opacity-50" disabled={saving} onClick={() => void saveTemplate()}>{saving && <Loader2 size={16} className="animate-spin" />} {editingId ? 'Salvar nova versão' : 'Salvar modelo'}</button></div></div></div></div>, document.body)}
  </section>;
};
