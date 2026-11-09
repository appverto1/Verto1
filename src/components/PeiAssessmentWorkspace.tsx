import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, FilePlus2, Plus, Save, Trash2 } from 'lucide-react';
import { dataService } from '../services/dataService';

// New evaluation plans are intentionally separate from patient.pei (legacy
// skill/maintenance tracking) and the therapeutic PTS documents.
type PeiTarget = {
  id: string; name: string; instruction: string; criteria: string; observation: string;
  status: 'pending' | 'in_progress' | 'evaluated' | 'cancelled';
};
type PeiGoal = {
  id: string; domainId: string; sourceSkillId: string; title: string;
  objective: string; criteria: string; notes: string;
  status: 'pending' | 'in_progress' | 'evaluated' | 'cancelled';
  targets: PeiTarget[];
};
type Plan = {
  id: string; title: string; specialty: string; responsible_professional_id: string;
  protocol_id: string; protocol_snapshot: any; content: { goals: PeiGoal[] };
  status: string; revision: number; created_at: string; updated_at: string;
};
const newId = () => crypto.randomUUID();
const readableStatus: Record<string, string> = {
  draft: 'Rascunho', active: 'Em avaliação', completed: 'Concluído',
  archived: 'Arquivado', pending: 'Pendente', in_progress: 'Em andamento',
  evaluated: 'Avaliado', cancelled: 'Cancelado',
};
const message = (result: any, fallback: string) =>
  String(result?.message || result?.error || fallback);
const isEvaluation = (value: any) => ['evaluation', 'assessment'].includes(
  String(value?.category || 'evaluation').toLowerCase(),
);

export const PeiAssessmentWorkspace = ({
  patientId, protocols = [], professionals = [], caseTeamLinks = [],
  isDark = false,
}: any) => {
  const [rows, setRows] = useState<Plan[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<PeiGoal[]>([]);
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [responsibleId, setResponsibleId] = useState('');
  const [protocolId, setProtocolId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [serverEditable, setServerEditable] = useState(false);
  const createKeyRef = useRef(newId());
  const card = isDark ? 'border-slate-700 bg-[#142037] text-slate-100' : 'border-slate-200 bg-white text-slate-900';
  const subtle = isDark ? 'text-slate-300' : 'text-slate-500';
  const input = isDark
    ? 'w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-violet-400 focus:outline-none'
    : 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-violet-500 focus:outline-none';
  const button = 'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
  const evaluationProtocols = useMemo(
    () => (Array.isArray(protocols) ? protocols : []).filter(isEvaluation).filter(p => Array.isArray(p.data)),
    [protocols],
  );
  const memberOptions = useMemo(() => {
    const indexed = new Map((Array.isArray(professionals) ? professionals : []).map((p: any) => [String(p.id), p]));
    const links = Array.isArray(caseTeamLinks) ? caseTeamLinks : [];
    const listed = links.filter((l: any) => l.status === 'active' && l.permissions?.write !== false)
      .map((l: any) => {
        const id = String(l.professional_id || '');
        const person: any = indexed.get(id) || l.professional || {};
        return { id, name: person.name || l.name || 'Profissional', specialty: l.specialty || person.specialty || '',
          active: l.accessEnabled !== false && person.membershipActive !== false };
      })
      .filter((p: any) => p.id && p.specialty && p.active);
    return Array.from(new Map(listed.map((p: any) => [p.id, p])).values());
  }, [professionals, caseTeamLinks]);
  const selectedResponsible = memberOptions.find((p: any) => p.id === responsibleId);
  // The backend is the authority. A role string in the browser never grants editing.
  const editable = Boolean(serverEditable && plan && ['draft', 'active'].includes(plan.status));

  useEffect(() => {
    let cancelled = false;
    setSelectedId(''); setPlan(null); setRows([]); setDraft([]); setServerEditable(false);
    setNotice(''); setError(''); setShowCreate(false);
    if (!patientId) return;
    setLoading(true);
    dataService.listPeiAssessmentPlans(patientId).then((r: any) => {
      if (cancelled) return;
      if (r?.success) setRows(Array.isArray(r.data) ? r.data : []);
      else setError(message(r, 'Não foi possível carregar os planos de avaliação.'));
    }).catch(() => { if (!cancelled) setError('Não foi possível carregar os planos de avaliação.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setServerEditable(false);
    if (!selectedId || !patientId) return;
    setLoading(true);
    setError(''); setNotice('');
    dataService.getPeiAssessmentPlan(patientId, selectedId).then((r: any) => {
      if (cancelled) return;
      if (!r?.success || !r?.data) { setError(message(r, 'Não foi possível abrir o plano.')); return; }
      setPlan(r.data);
      setServerEditable(r.canEdit === true);
      setTitle(r.data.title || '');
      setDraft(structuredClone(r.data.content?.goals || []));
      setHistory(Array.isArray(r.history) ? r.history : []);
      setDirty(false);
    }).catch(() => { if (!cancelled) setError('Não foi possível abrir o plano de avaliação.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, patientId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const selectPlan = (id: string) => {
    if (busy || id === selectedId) return;
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return;
    setSelectedId(id); setShowCreate(false); setShowHistory(false);
  };
  const changeGoal = (id: string, patch: Partial<PeiGoal>) => {
    setDraft(current => current.map(g => g.id === id ? { ...g, ...patch } : g)); setDirty(true); setNotice('');
  };
  const changeTarget = (goalId: string, targetId: string, patch: Partial<PeiTarget>) => {
    setDraft(current => current.map(g => g.id !== goalId ? g : {
      ...g, targets: g.targets.map(t => t.id === targetId ? { ...t, ...patch } : t),
    })); setDirty(true); setNotice('');
  };
  const sourceDomain = (goal: PeiGoal) =>
    (plan?.protocol_snapshot?.data || []).find((d: any) => String(d.id) === goal.domainId);
  const sourceSkill = (goal: PeiGoal) =>
    sourceDomain(goal)?.skills?.find((s: any) => String(s.id) === goal.sourceSkillId);
  const addSkill = (domain: any, skill: any) => {
    if (!editable) return;
    const goals = draft.filter(g => g.domainId === String(domain.id) && g.sourceSkillId === String(skill.id));
    if (goals.length) { setError('Essa habilidade já faz parte do plano.'); return; }
    if (draft.length >= 150) { setError('Limite de objetivos por plano atingido.'); return; }
    setDraft(current => [...current, {
      id: newId(), domainId: String(domain.id), sourceSkillId: String(skill.id),
      title: String(skill.name || 'Habilidade').slice(0, 180),
      objective: String(skill.objective || '').slice(0, 1200),
      criteria: String(skill.criteria || '').slice(0, 1200),
      notes: '', status: 'pending', targets: [{
        id: newId(), name: String(skill.name || 'Alvo de avaliação').slice(0, 180),
        instruction: '', criteria: '', observation: '', status: 'pending',
      }],
    }]); setDirty(true); setError('');
  };

  const applySavedPlan = (next: Plan, kind: string) => {
    setPlan(next); setTitle(next.title);
    setDraft(structuredClone(next.content?.goals || []));
    setDirty(false);
    setRows(current => current.map(row => row.id === next.id ? { ...row, ...next } : row));
    setHistory(current => [{ revision: next.revision, event_kind: kind, created_at: new Date().toISOString() }, ...current]);
    setNotice('Alterações confirmadas pelo servidor e salvas no prontuário.');
    setError('');
  };
  const save = async (action: 'save' | 'activate' | 'complete' | 'archive' = 'save') => {
    if (!plan || busy || !editable) return;
    if (!title.trim()) { setError('Informe o nome do plano.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const r: any = await dataService.savePeiAssessmentPlan(patientId, plan.id, {
        action, title: title.trim(), content: { goals: draft }, expectedRevision: plan.revision,
      });
      if (!r?.success || !r?.data) {
        setError(message(r, 'Não foi possível salvar. Nenhuma alteração foi confirmada.'));
        return;
      }
      applySavedPlan(r.data, action);
    } catch { setError('A conexão falhou. Confira o salvamento antes de tentar novamente.'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (busy || !selectedResponsible || !protocolId || !newTitle.trim()) {
      setError('Escolha o profissional, o protocolo de avaliação e o título.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const r: any = await dataService.createPeiAssessmentPlan(patientId, {
        responsibleProfessionalId: responsibleId,
        specialty: selectedResponsible.specialty, protocolId, title: newTitle.trim(),
        idempotencyKey: createKeyRef.current,
      });
      if (!r?.success || !r?.data) { setError(message(r, 'Não foi possível criar o plano.')); return; }
      createKeyRef.current = newId();
      setRows(current => [r.data, ...current.filter(row => row.id !== r.data.id)]);
      setSelectedId(r.data.id); setShowCreate(false);
      setNewTitle(''); setResponsibleId(''); setProtocolId('');
      setNotice('Plano de avaliação criado no servidor.');
    } catch { setError('A conexão falhou. Consulte a lista antes de tentar criar novamente.'); }
    finally { setBusy(false); }
  };

  return (
    <section className={'rounded-2xl border p-4 sm:p-6 ' + card} data-testid="pei-assessment-workspace">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Planos de avaliação por especialidade</h3>
          <p className={'mt-1 text-xs leading-5 ' + subtle}>
            Mesma organização do PTS: objetivos, alvos, critérios, revisões e conclusão. O protocolo oficial permanece preservado.
          </p>
        </div>
        <button type="button" className={button + ' bg-violet-600 text-white hover:bg-violet-700'}
          onClick={() => { if (dirty && !window.confirm('Descartar alterações não salvas?')) return; setShowCreate(true); setError(''); }}
          disabled={busy}><FilePlus2 size={16}/> Novo plano</button>
      </header>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-600">{error}</p>}
      {notice && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-600"><CheckCircle2 size={16}/>{notice}</p>}
      {showCreate && <div className="mt-5 grid gap-3 rounded-xl border border-violet-500/20 p-4 sm:grid-cols-2">
        <label className="text-xs font-medium">Profissional responsável
          <select className={input + ' mt-1'} value={responsibleId} onChange={e => { createKeyRef.current = newId(); setResponsibleId(e.target.value); }}>
            <option value="">Selecione</option>
            {memberOptions.map((p: any) => <option key={p.id} value={p.id}>{p.name} · {p.specialty}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium">Protocolo padronizado de avaliação
          <select className={input + ' mt-1'} value={protocolId} onChange={e => { createKeyRef.current = newId(); setProtocolId(e.target.value); }}>
            <option value="">Selecione</option>
            {evaluationProtocols.map((p: any) => <option key={p.id} value={String(p.id)}>{p.title}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium sm:col-span-2">Nome do plano
          <input className={input + ' mt-1'} value={newTitle} maxLength={180} onChange={e => { createKeyRef.current = newId(); setNewTitle(e.target.value); }}
            placeholder="Ex.: Avaliação inicial de comunicação"/>
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <button type="button" className={button + ' bg-violet-600 text-white'} disabled={busy} onClick={() => void create()}>
            {busy ? 'Salvando...' : 'Salvar novo plano'}
          </button>
          <button type="button" className={button + ' border'} disabled={busy} onClick={() => setShowCreate(false)}>Cancelar</button>
        </div>
      </div>}
      <div className="mt-5 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-2" aria-label="Planos de avaliação">
          {loading && <p className={subtle + ' text-sm'}>Carregando planos...</p>}
          {!rows.length && !loading && <p className={subtle + ' text-sm'}>Nenhum plano de avaliação cadastrado.</p>}
          {rows.map(row => <button type="button" key={row.id} onClick={() => selectPlan(row.id)}
            aria-pressed={selectedId === row.id}
            className={'w-full rounded-xl border p-3 text-left transition-colors ' +
              (selectedId === row.id ? 'border-violet-500 bg-violet-500/10' : (isDark ? 'border-slate-700 hover:border-violet-400' : 'border-slate-200 hover:border-violet-400'))}>
            <span className="block text-sm font-semibold">{row.title}</span>
            <span className={'mt-1 block text-xs ' + subtle}>{row.specialty} · {readableStatus[row.status] || row.status}</span>
          </button>)}
        </aside>
        <div className="min-w-0 space-y-4">
          {!plan && !loading && <p className={subtle + ' rounded-xl border p-4 text-sm'}>Selecione um plano para editar objetivos, alvos e critérios.</p>}
          {plan && <React.Fragment>
            <div className={'space-y-3 rounded-xl border p-4 ' + (isDark ? 'border-slate-700' : 'border-slate-200')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-violet-500">{plan.specialty} · {readableStatus[plan.status] || plan.status}</span>
                <span className={'text-xs ' + subtle}>Versão {plan.revision}</span>
              </div>
              <label className="block text-xs font-medium">Nome do plano
                <input className={input + ' mt-1'} value={title} maxLength={180} disabled={!editable}
                  onChange={e => { setTitle(e.target.value); setDirty(true); }} />
              </label>
              <p className={'text-xs ' + subtle}>Protocolo de referência: {plan.protocol_snapshot?.title || plan.protocol_id} · {plan.protocol_snapshot?.versionLabel || 'versão de origem'}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button + ' bg-violet-600 text-white'}
                  onClick={() => void save('save')} disabled={!editable || busy || !dirty}><Save size={15}/> Salvar</button>
                {plan.status === 'draft' && <button type="button" className={button + ' border border-violet-500 text-violet-500'}
                  onClick={() => void save('activate')} disabled={busy || !draft.length}>Salvar e iniciar avaliação</button>}
                {plan.status === 'active' && <button type="button" className={button + ' border'}
                  onClick={() => { if (window.confirm('Concluir a avaliação?')) void save('complete'); }} disabled={busy}>Salvar e concluir</button>}
                {(plan.status === 'draft' || plan.status === 'active') && <button type="button"
                  className={button + ' border'} onClick={() => { if (window.confirm('Arquivar este plano?')) void save('archive'); }} disabled={busy}>Salvar e arquivar</button>}
                <button type="button" className={button + ' border'} onClick={() => setShowHistory(h => !h)}>
                  <Clock3 size={15}/> Histórico <ChevronDown size={14}/>
                </button>
              </div>
              {dirty && <p className="text-xs text-amber-600" role="status">Alterações ainda não salvas. Use o botão Salvar.</p>}
              {showHistory && <ol className={'space-y-1 rounded-lg border p-3 text-xs ' + subtle}>
                {history.map((h, i) => <li key={String(h.revision) + i}>Versão {h.revision} · {h.event_kind} · {new Date(h.created_at).toLocaleString('pt-BR')}</li>)}
              </ol>}
            </div>
            {editable && <div className={'rounded-xl border p-4 ' + (isDark ? 'border-slate-700' : 'border-slate-200')}>
              <h4 className="text-sm font-semibold">Adicionar habilidade do protocolo</h4>
              <p className={'mt-1 text-xs ' + subtle}>Os itens e métodos oficiais vêm do protocolo. Seus objetivos e critérios do plano poderão ser editados.</p>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {(plan.protocol_snapshot?.data || []).map((domain: any) =>
                  <details key={String(domain.id)} className="rounded-lg border p-2">
                    <summary className="cursor-pointer text-sm font-medium">{domain.name}</summary>
                    <div className="mt-2 grid gap-2">
                      {(domain.skills || []).map((skill: any) => <button type="button" key={String(skill.id)}
                        className="flex items-center gap-2 rounded-lg border border-violet-400/30 px-3 py-2 text-left text-xs hover:bg-violet-500/10"
                        onClick={() => addSkill(domain, skill)}><Plus size={13}/>{skill.name}</button>)}
                    </div>
                  </details>)}
              </div>
            </div>}
            {draft.map(goal => <article key={goal.id} className={'space-y-3 rounded-xl border p-4 ' + (isDark ? 'border-slate-700' : 'border-slate-200')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{sourceDomain(goal)?.name || 'Domínio'} · Habilidade avaliada</h4>
                {editable && <button type="button" className="inline-flex items-center gap-1 text-xs text-rose-500"
                  onClick={() => { setDraft(g => g.filter(item => item.id !== goal.id)); setDirty(true); }}>
                  <Trash2 size={14}/> Remover
                </button>}
              </div>
              <div className={'rounded-lg border border-violet-400/20 p-3 text-xs ' + subtle}>
                <strong className="block">Método e critérios oficiais — somente leitura</strong>
                <p className="mt-1">{sourceSkill(goal)?.question || sourceSkill(goal)?.objective || 'Consulte o protocolo de origem.'}</p>
                <p className="mt-1">Critério original: {sourceSkill(goal)?.criteria || 'Não informado'} · Pontuação máxima: {sourceSkill(goal)?.maxScore ?? 'Não informada'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">Objetivo de avaliação
                  <input className={input + ' mt-1'} value={goal.title} maxLength={180} disabled={!editable}
                    onChange={e => changeGoal(goal.id, { title: e.target.value })}/>
                </label>
                <label className="text-xs">Estado
                  <select className={input + ' mt-1'} value={goal.status} disabled={!editable}
                    onChange={e => changeGoal(goal.id, { status: e.target.value as PeiGoal['status'] })}>
                    {['pending','in_progress','evaluated','cancelled'].map(s => <option key={s} value={s}>{readableStatus[s]}</option>)}
                  </select>
                </label>
                <label className="text-xs sm:col-span-2">Descrição do objetivo
                  <textarea className={input + ' mt-1'} value={goal.objective} maxLength={1200} rows={2} disabled={!editable}
                    onChange={e => changeGoal(goal.id, { objective: e.target.value })}/>
                </label>
                <label className="text-xs sm:col-span-2">Critério personalizado do plano
                  <textarea className={input + ' mt-1'} value={goal.criteria} maxLength={1200} rows={2} disabled={!editable}
                    onChange={e => changeGoal(goal.id, { criteria: e.target.value })}/>
                </label>
                <label className="text-xs sm:col-span-2">Observações
                  <textarea className={input + ' mt-1'} value={goal.notes} maxLength={2000} rows={2} disabled={!editable}
                    onChange={e => changeGoal(goal.id, { notes: e.target.value })}/>
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="text-sm font-semibold">Alvos de avaliação</h5>
                  {editable && <button className={button + ' border border-violet-400/40'} disabled={goal.targets.length >= 30}
                    onClick={() => changeGoal(goal.id, { targets: [...goal.targets, { id: newId(), name: 'Novo alvo', instruction: '', criteria: '', observation: '', status: 'pending' }] })}>
                    <Plus size={14}/> Novo alvo</button>}
                </div>
                {goal.targets.map(target => <div key={target.id} className={'grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ' + (isDark ? 'border-slate-600' : 'border-slate-100')}>
                  <label className="text-xs">Alvo
                    <input className={input + ' mt-1'} value={target.name} maxLength={180} disabled={!editable}
                      onChange={e => changeTarget(goal.id, target.id, { name: e.target.value })}/>
                  </label>
                  <label className="text-xs">Estado
                    <select className={input + ' mt-1'} value={target.status} disabled={!editable}
                      onChange={e => changeTarget(goal.id, target.id, { status: e.target.value as PeiTarget['status'] })}>
                      {['pending','in_progress','evaluated','cancelled'].map(s => <option key={s} value={s}>{readableStatus[s]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs sm:col-span-2">Instrução de avaliação
                    <textarea className={input + ' mt-1'} rows={2} value={target.instruction} maxLength={800} disabled={!editable}
                      onChange={e => changeTarget(goal.id, target.id, { instruction: e.target.value })}/>
                  </label>
                  <label className="text-xs sm:col-span-2">Critério do alvo (editável, independente do protocolo)
                    <textarea className={input + ' mt-1'} rows={2} value={target.criteria || ''} maxLength={1200} disabled={!editable}
                      onChange={e => changeTarget(goal.id, target.id, { criteria: e.target.value })}/>
                  </label>
                  <label className="text-xs sm:col-span-2">Resultado / observação
                    <textarea className={input + ' mt-1'} rows={2} value={target.observation} maxLength={1200} disabled={!editable}
                      onChange={e => changeTarget(goal.id, target.id, { observation: e.target.value })}/>
                  </label>
                  {editable && <button type="button" className="inline-flex items-center gap-1 text-xs text-rose-500"
                    onClick={() => changeGoal(goal.id, { targets: goal.targets.filter(t => t.id !== target.id) })}>
                    <Trash2 size={13}/> Remover alvo</button>}
                </div>)}
              </div>
            </article>)}
          </React.Fragment>}
        </div>
      </div>
    </section>
  );
};
