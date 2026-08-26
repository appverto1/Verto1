import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  HeartHandshake,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  ShieldAlert,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import {
  hydratePtsClinicalPayloadFromPlan,
  normalizePtsClinicalPayload,
  ptsCommonObjectives,
  ptsLastReviewedAt,
  ptsSpecialtyObjectives,
  type PtsClinicalPayload,
  type PtsGoal,
  type PtsNeed,
  type PtsNetworkContact,
  type PtsResponsibility,
  type PtsReview,
  type PtsRisk,
} from '../utils/ptsClinicalWorkspace';

const makeId = (prefix: string) => {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  achieved: 'Alcançada',
  paused: 'Pausada',
  cancelled: 'Cancelada',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

const HORIZON_LABELS: Record<string, string> = {
  short: 'Curto prazo',
  medium: 'Médio prazo',
  long: 'Longo prazo',
};

const ACTOR_LABELS: Record<string, string> = {
  professional: 'Profissional',
  patient: 'Paciente',
  family: 'Família',
  school: 'Escola',
  network: 'Rede de apoio',
};

const NETWORK_LABELS: Record<string, string> = {
  family: 'Família',
  school: 'Escola',
  health: 'Saúde',
  social_assistance: 'Assistência social',
  justice: 'Justiça / proteção',
  community: 'Comunidade',
  other: 'Outro',
};

const toDateTimeLocal = (value: string) => value ? value.slice(0, 16) : '';
const fromDateTimeLocal = (value: string) => value ? new Date(value).toISOString() : '';

export function PtsWorkspaceEditor({
  scope,
  professionals,
  programs = [],
  isDark = false,
  saving = false,
  onSave,
}: {
  scope: any;
  professionals: any[];
  programs?: any[];
  isDark?: boolean;
  saving?: boolean;
  onSave: (payload: {
    ptsPayload: PtsClinicalPayload;
    commonObjectives: string[];
    specialtyObjectives: Record<string, string[]>;
    reviewDueDate: string | null;
    lastReviewedAt: string | null;
    status: string;
    expectedVersion: number;
  }) => Promise<void> | void;
}) {
  const participantIds = useMemo<string[]>(() => Array.from(new Set<string>([
    String(scope?.responsible_professional_id || ''),
    ...(Array.isArray(scope?.participant_professional_ids) ? scope.participant_professional_ids.map(String) : []),
  ].filter(Boolean))), [scope]);
  const specialties = useMemo<string[]>(() => Array.from(new Set<string>(
    (Array.isArray(scope?.participant_specialties) ? scope.participant_specialties : [])
      .map(String)
      .filter(Boolean),
  )), [scope]);
  const professionalById = useMemo<Map<string, any>>(() => new Map<string, any>(
    (Array.isArray(professionals) ? professionals : []).map((professional) => [String(professional.id), professional]),
  ), [professionals]);
  const scopedPrograms = useMemo(() => (
    (Array.isArray(programs) ? programs : [])
      .filter((program) => String(program?.therapeutic_plan_id || '') === String(scope?.id || ''))
  ), [programs, scope?.id]);
  const [draft, setDraft] = useState<PtsClinicalPayload>(() => hydratePtsClinicalPayloadFromPlan(scope));
  const [status, setStatus] = useState(String(scope?.status || 'draft'));
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    context: true,
    goals: true,
    evidence: true,
    responsibilities: true,
    network: false,
    risks: false,
    reviews: true,
  });

  const field = `w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition focus:border-violet-500 ${
    isDark
      ? 'border-slate-700 bg-slate-950/50 text-slate-100 placeholder:text-slate-500'
      : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
  }`;
  const subtle = isDark ? 'text-slate-400' : 'text-slate-500';
  const strongText = isDark ? 'text-slate-100' : 'text-slate-900';
  const secondaryStrongText = isDark ? 'text-slate-200' : 'text-slate-800';
  const surface = isDark ? 'border-slate-700 bg-slate-900/55' : 'border-slate-200 bg-white';
  const inset = isDark ? 'border-slate-700 bg-slate-950/35' : 'border-slate-100 bg-slate-50';
  const secondaryButton = `inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm ${
    isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
  }`;

  const achievedGoals = draft.goals.filter((goal) => goal.status === 'achieved').length;
  const overdueGoals = draft.goals.filter((goal) => goal.dueDate && goal.status !== 'achieved' && new Date(`${goal.dueDate}T23:59:59`).getTime() < Date.now()).length;
  const pendingResponsibilities = draft.responsibilities.filter((item) => !['achieved', 'cancelled'].includes(item.status)).length;

  const setList = <K extends keyof PtsClinicalPayload>(key: K, value: PtsClinicalPayload[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const sectionHeader = (id: string, icon: React.ReactNode, title: string, description: string) => {
    const open = openSections[id] !== false;
    return (
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 text-left"
        onClick={() => setOpenSections((current) => ({ ...current, [id]: !open }))}
      >
        <span className="flex items-start gap-3">
          <span className="mt-0.5 text-violet-500">{icon}</span>
          <span>
            <span className={`block text-sm font-semibold ${strongText}`}>{title}</span>
            <span className={`mt-0.5 block text-xs leading-5 ${subtle}`}>{description}</span>
          </span>
        </span>
        {open ? <ChevronUp size={18} className={subtle} /> : <ChevronDown size={18} className={subtle} />}
      </button>
    );
  };

  const addNeed = () => setList('needs', [...draft.needs, {
    id: makeId('need'), title: '', domain: '', description: '', priority: 'medium', status: 'pending',
  } as PtsNeed]);
  const addGoal = () => setList('goals', [...draft.goals, {
    id: makeId('goal'), title: '', description: '', horizon: 'short', goalType: 'qualitative', baseline: '', target: '', currentValue: '', unit: '', dueDate: '', responsibleProfessionalIds: draft.caseManagerId ? [draft.caseManagerId] : [], specialties: [], status: 'pending',
  } as PtsGoal]);
  const addResponsibility = () => setList('responsibilities', [...draft.responsibilities, {
    id: makeId('responsibility'), actorType: 'professional', actorId: draft.caseManagerId || '', actorName: '', action: '', frequency: '', dueDate: '', status: 'pending',
  } as PtsResponsibility]);
  const addNetwork = () => setList('network', [...draft.network, {
    id: makeId('network'), type: 'family', name: '', role: '', contact: '', consentStatus: 'pending',
  } as PtsNetworkContact]);
  const addRisk = () => setList('risks', [...draft.risks, {
    id: makeId('risk'), title: '', description: '', severity: 'medium', responsePlan: '', status: 'active',
  } as PtsRisk]);
  const addReview = () => setList('reviews', [...draft.reviews, {
    id: makeId('review'), scheduledFor: draft.nextReviewDate || '', completedAt: '', summary: '', decisions: '', nextReviewDate: '', recordedBy: '',
  } as PtsReview]);

  const persist = async () => {
    const normalized = normalizePtsClinicalPayload(draft, {
      participantIds,
      specialties,
      defaultCaseManagerId: String(scope?.responsible_professional_id || ''),
      defaultStartedAt: String(scope?.created_at || '').slice(0, 10),
    });
    await onSave({
      ptsPayload: normalized,
      commonObjectives: ptsCommonObjectives(normalized),
      specialtyObjectives: ptsSpecialtyObjectives(normalized),
      reviewDueDate: normalized.nextReviewDate || null,
      lastReviewedAt: ptsLastReviewedAt(normalized),
      status,
      expectedVersion: Number(scope?.edit_version || 1),
    });
  };

  return (
    <div className="space-y-4">
      <div className={`grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 xl:grid-cols-4 ${inset}`}>
        <label className={`text-xs ${subtle}`}>
          Técnico de referência
          <select className={`${field} mt-1.5`} value={draft.caseManagerId} onChange={(event) => setDraft((current) => ({ ...current, caseManagerId: event.target.value }))}>
            <option value="">Selecione</option>
            {participantIds.map((professionalId) => (
              <option key={professionalId} value={professionalId}>{professionalById.get(professionalId)?.name || 'Profissional da equipe'}</option>
            ))}
          </select>
        </label>
        <label className={`text-xs ${subtle}`}>
          Início do PTS
          <input className={`${field} mt-1.5`} type="date" value={draft.startedAt} onChange={(event) => setDraft((current) => ({ ...current, startedAt: event.target.value }))} />
        </label>
        <label className={`text-xs ${subtle}`}>
          Próxima reavaliação
          <input className={`${field} mt-1.5`} type="date" value={draft.nextReviewDate} onChange={(event) => setDraft((current) => ({ ...current, nextReviewDate: event.target.value }))} />
        </label>
        <label className={`text-xs ${subtle}`}>
          Estado do PTS
          <select className={`${field} mt-1.5`} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="draft">Rascunho</option>
            <option value="active">Vigente</option>
            <option value="paused">Pausado</option>
            <option value="completed">Concluído</option>
            <option value="archived">Arquivado</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [Target, 'Metas', String(draft.goals.length), `${achievedGoals} alcançada(s)`],
          [AlertTriangle, 'Atenção', String(overdueGoals), 'meta(s) vencida(s)'],
          [ClipboardCheck, 'Ações', String(pendingResponsibilities), 'responsabilidade(s) aberta(s)'],
          [RefreshCw, 'Reavaliação', draft.nextReviewDate ? new Date(`${draft.nextReviewDate}T12:00:00`).toLocaleDateString('pt-BR') : 'Não definida', `${draft.reviews.length} registro(s)`],
        ].map(([Icon, label, value, detail]: any) => (
          <div key={label} className={`rounded-2xl border p-4 ${surface}`}>
            <div className="flex items-center gap-2 text-violet-500"><Icon size={17} /><span className={`text-xs ${subtle}`}>{label}</span></div>
            <p className={`mt-2 text-xl font-semibold ${strongText}`}>{value}</p>
            <p className={`mt-1 text-xs ${subtle}`}>{detail}</p>
          </div>
        ))}
      </div>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('context', <HeartHandshake size={20} />, 'Visão compartilhada do caso', 'Registre o que importa para o paciente e a família, além das potencialidades e necessidades prioritárias.')}
        {openSections.context !== false && (
          <div className="mt-4 space-y-4">
            <label className={`block text-xs ${subtle}`}>Síntese situacional<textarea className={`${field} mt-1.5 min-h-24`} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="Síntese biopsicossocial do momento atual, sem repetir a anamnese." /></label>
            <div className="grid gap-4 lg:grid-cols-2">
              <label className={`block text-xs ${subtle}`}>Prioridades expressas pelo paciente<textarea className={`${field} mt-1.5 min-h-20`} value={draft.patientVoice} onChange={(event) => setDraft((current) => ({ ...current, patientVoice: event.target.value }))} placeholder="Preferências, desejos, dificuldades e objetivos relatados pelo paciente." /></label>
              <label className={`block text-xs ${subtle}`}>Prioridades expressas pela família<textarea className={`${field} mt-1.5 min-h-20`} value={draft.familyVoice} onChange={(event) => setDraft((current) => ({ ...current, familyVoice: event.target.value }))} placeholder="Expectativas, barreiras e prioridades relatadas pela família." /></label>
            </div>
            <label className={`block text-xs ${subtle}`}>Potencialidades e interesses<input className={`${field} mt-1.5`} value={draft.strengths.join(' · ')} onChange={(event) => setDraft((current) => ({ ...current, strengths: event.target.value.split('·').map((item) => item.trim()).filter(Boolean) }))} placeholder="Separe os itens com ·" /></label>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><p className={`text-sm font-semibold ${strongText}`}>Necessidades prioritárias</p><button type="button" className={secondaryButton} onClick={addNeed}><Plus size={15} /> Adicionar</button></div>
              {draft.needs.length === 0 && <p className={`rounded-xl border border-dashed p-4 text-xs ${subtle}`}>Nenhuma necessidade priorizada ainda.</p>}
              {draft.needs.map((need, index) => (
                <div key={need.id} className={`grid gap-3 rounded-xl border p-3 lg:grid-cols-[1.2fr_0.8fr_0.6fr_auto] ${inset}`}>
                  <input className={field} value={need.title} onChange={(event) => setList('needs', draft.needs.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="Necessidade ou problema ativo" />
                  <input className={field} value={need.domain} onChange={(event) => setList('needs', draft.needs.map((item, itemIndex) => itemIndex === index ? { ...item, domain: event.target.value } : item))} placeholder="Domínio: comunicação, escola..." />
                  <select className={field} value={need.priority} onChange={(event) => setList('needs', draft.needs.map((item, itemIndex) => itemIndex === index ? { ...item, priority: event.target.value as PtsNeed['priority'] } : item))}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <button type="button" aria-label="Remover necessidade" className="rounded-xl p-3 text-rose-500 hover:bg-rose-500/10" onClick={() => setList('needs', draft.needs.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
                  <textarea className={`${field} min-h-16 lg:col-span-4`} value={need.description} onChange={(event) => setList('needs', draft.needs.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Contexto, impacto funcional e evidências relevantes." />
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`text-xs ${subtle}`}>Participação do paciente e da família<select className={`${field} mt-1.5`} value={draft.participationStatus} onChange={(event) => setDraft((current) => ({ ...current, participationStatus: event.target.value as PtsClinicalPayload['participationStatus'] }))}><option value="not_started">Ainda não discutido</option><option value="discussed">Discutido</option><option value="agreed">Pactuado</option><option value="declined">Participação recusada/adiada</option></select></label>
              <label className={`text-xs ${subtle}`}>Data da pactuação<input className={`${field} mt-1.5`} type="datetime-local" value={toDateTimeLocal(draft.participationRecordedAt)} onChange={(event) => setDraft((current) => ({ ...current, participationRecordedAt: fromDateTimeLocal(event.target.value) }))} /></label>
            </div>
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('goals', <Target size={20} />, 'Metas compartilhadas', 'Combine metas quantitativas e qualitativas, responsáveis, prazo e resultado esperado.')}
        {openSections.goals !== false && (
          <div className="mt-4 space-y-3">
            <div className="flex justify-end"><button type="button" className={secondaryButton} onClick={addGoal}><Plus size={15} /> Nova meta</button></div>
            {draft.goals.length === 0 && <p className={`rounded-xl border border-dashed p-4 text-xs ${subtle}`}>Crie a primeira meta compartilhada do PTS.</p>}
            {draft.goals.map((goal, index) => (
              <div key={goal.id} className={`rounded-2xl border p-4 ${inset}`}>
                <div className="grid gap-3 lg:grid-cols-[1.4fr_0.6fr_0.6fr_auto]">
                  <input className={field} value={goal.title} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="Resultado que se deseja alcançar" />
                  <select className={field} value={goal.horizon} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, horizon: event.target.value as PtsGoal['horizon'] } : item))}>{Object.entries(HORIZON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <select className={field} value={goal.status} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as PtsGoal['status'] } : item))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <button type="button" aria-label="Remover meta" className="rounded-xl p-3 text-rose-500 hover:bg-rose-500/10" onClick={() => setList('goals', draft.goals.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
                </div>
                <textarea className={`${field} mt-3 min-h-16`} value={goal.description} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Por que esta meta é relevante para a vida do paciente?" />
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <select className={field} value={goal.goalType} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, goalType: event.target.value as PtsGoal['goalType'] } : item))}><option value="qualitative">Qualitativa</option><option value="quantitative">Quantitativa</option></select>
                  <input className={field} value={goal.baseline} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, baseline: event.target.value } : item))} placeholder="Linha de base" />
                  <input className={field} value={goal.target} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} placeholder="Resultado esperado" />
                  <input className={field} value={goal.currentValue} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, currentValue: event.target.value } : item))} placeholder="Situação atual" />
                  <input className={field} type="date" value={goal.dueDate} onChange={(event) => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value } : item))} />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <fieldset className={`rounded-xl border p-3 ${surface}`}><legend className={`px-1 text-xs ${subtle}`}>Profissionais responsáveis</legend><div className="grid gap-2 sm:grid-cols-2">{participantIds.map((professionalId) => { const selected = goal.responsibleProfessionalIds.includes(professionalId); return <label key={professionalId} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected} onChange={() => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, responsibleProfessionalIds: selected ? item.responsibleProfessionalIds.filter((id) => id !== professionalId) : [...item.responsibleProfessionalIds, professionalId] } : item))} /><span>{professionalById.get(professionalId)?.name || 'Profissional'}</span></label>; })}</div></fieldset>
                  <fieldset className={`rounded-xl border p-3 ${surface}`}><legend className={`px-1 text-xs ${subtle}`}>Especialidades relacionadas</legend><div className="grid gap-2 sm:grid-cols-2">{specialties.map((specialty) => { const selected = goal.specialties.includes(specialty); return <label key={specialty} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected} onChange={() => setList('goals', draft.goals.map((item, itemIndex) => itemIndex === index ? { ...item, specialties: selected ? item.specialties.filter((value) => value !== specialty) : [...item.specialties, specialty] } : item))} /><span>{specialty}</span></label>; })}</div></fieldset>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('evidence', <Activity size={20} />, 'Evidências do cuidado', 'Programas e registros já vinculados ao PTS aparecem aqui sem duplicar informações clínicas.')}
        {openSections.evidence !== false && (
          <div className="mt-4 space-y-3">
            {scopedPrograms.length === 0 ? (
              <p className={`rounded-xl border border-dashed p-4 text-xs ${subtle}`}>Nenhum programa clínico foi vinculado a este PTS ainda.</p>
            ) : scopedPrograms.map((program) => (
              <div key={program.id} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${inset}`}>
                <div>
                  <p className={`text-sm font-semibold ${strongText}`}>{program.name || 'Programa terapêutico'}</p>
                  <p className={`mt-1 text-xs ${subtle}`}>{program.category || 'Sem categoria'} · {(program.targets || []).length} alvo(s)</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className={`text-xs ${subtle}`}>Última aplicação</p>
                  <p className={`mt-1 text-sm ${secondaryStrongText}`}>{program.last_applied_at ? new Date(program.last_applied_at).toLocaleDateString('pt-BR') : 'Sem registro'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('responsibilities', <Users size={20} />, 'Responsabilidades pactuadas', 'Defina claramente o que cabe à equipe, ao paciente, à família, à escola e à rede de apoio.')}
        {openSections.responsibilities !== false && (
          <div className="mt-4 space-y-3">
            <div className="flex justify-end"><button type="button" className={secondaryButton} onClick={addResponsibility}><Plus size={15} /> Nova responsabilidade</button></div>
            {draft.responsibilities.map((item, index) => (
              <div key={item.id} className={`grid gap-3 rounded-xl border p-3 lg:grid-cols-[0.7fr_1fr_1.4fr_0.7fr_0.6fr_auto] ${inset}`}>
                <select className={field} value={item.actorType} onChange={(event) => setList('responsibilities', draft.responsibilities.map((current, itemIndex) => itemIndex === index ? { ...current, actorType: event.target.value as PtsResponsibility['actorType'], actorId: '', actorName: '' } : current))}>{Object.entries(ACTOR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                {item.actorType === 'professional' ? <select className={field} value={item.actorId} onChange={(event) => setList('responsibilities', draft.responsibilities.map((current, itemIndex) => itemIndex === index ? { ...current, actorId: event.target.value } : current))}><option value="">Selecione</option>{participantIds.map((professionalId) => <option key={professionalId} value={professionalId}>{professionalById.get(professionalId)?.name || 'Profissional'}</option>)}</select> : <input className={field} value={item.actorName} onChange={(event) => setList('responsibilities', draft.responsibilities.map((current, itemIndex) => itemIndex === index ? { ...current, actorName: event.target.value } : current))} placeholder="Pessoa ou instituição" />}
                <input className={field} value={item.action} onChange={(event) => setList('responsibilities', draft.responsibilities.map((current, itemIndex) => itemIndex === index ? { ...current, action: event.target.value } : current))} placeholder="Ação combinada" />
                <input className={field} value={item.frequency} onChange={(event) => setList('responsibilities', draft.responsibilities.map((current, itemIndex) => itemIndex === index ? { ...current, frequency: event.target.value } : current))} placeholder="Frequência" />
                <select className={field} value={item.status} onChange={(event) => setList('responsibilities', draft.responsibilities.map((current, itemIndex) => itemIndex === index ? { ...current, status: event.target.value as PtsResponsibility['status'] } : current))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <button type="button" aria-label="Remover responsabilidade" className="rounded-xl p-3 text-rose-500 hover:bg-rose-500/10" onClick={() => setList('responsibilities', draft.responsibilities.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('network', <Network size={20} />, 'Rede de apoio e articulação', 'Registre somente contatos necessários ao cuidado e respeite a autorização de compartilhamento.')}
        {openSections.network !== false && (
          <div className="mt-4 space-y-3">
            <div className="flex justify-end"><button type="button" className={secondaryButton} onClick={addNetwork}><Plus size={15} /> Adicionar contato</button></div>
            {draft.network.map((item, index) => (
              <div key={item.id} className={`grid gap-3 rounded-xl border p-3 lg:grid-cols-[0.8fr_1fr_1fr_1fr_0.8fr_auto] ${inset}`}>
                <select className={field} value={item.type} onChange={(event) => setList('network', draft.network.map((current, itemIndex) => itemIndex === index ? { ...current, type: event.target.value as PtsNetworkContact['type'] } : current))}>{Object.entries(NETWORK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <input className={field} value={item.name} onChange={(event) => setList('network', draft.network.map((current, itemIndex) => itemIndex === index ? { ...current, name: event.target.value } : current))} placeholder="Nome" />
                <input className={field} value={item.role} onChange={(event) => setList('network', draft.network.map((current, itemIndex) => itemIndex === index ? { ...current, role: event.target.value } : current))} placeholder="Papel no cuidado" />
                <input className={field} value={item.contact} onChange={(event) => setList('network', draft.network.map((current, itemIndex) => itemIndex === index ? { ...current, contact: event.target.value } : current))} placeholder="Contato" />
                <select className={field} value={item.consentStatus} onChange={(event) => setList('network', draft.network.map((current, itemIndex) => itemIndex === index ? { ...current, consentStatus: event.target.value as PtsNetworkContact['consentStatus'] } : current))}><option value="pending">Autorização pendente</option><option value="authorized">Autorizado</option><option value="not_required">Não aplicável</option><option value="revoked">Revogado</option></select>
                <button type="button" aria-label="Remover contato" className="rounded-xl p-3 text-rose-500 hover:bg-rose-500/10" onClick={() => setList('network', draft.network.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('risks', <ShieldAlert size={20} />, 'Riscos e plano de proteção', 'Área clínica restrita aos profissionais autorizados do caso. Registre apenas informações necessárias à segurança.')}
        {openSections.risks !== false && (
          <div className="mt-4 space-y-3">
            <div className="flex justify-end"><button type="button" className={secondaryButton} onClick={addRisk}><Plus size={15} /> Registrar risco</button></div>
            {draft.risks.map((item, index) => (
              <div key={item.id} className={`rounded-xl border p-3 ${inset}`}>
                <div className="grid gap-3 lg:grid-cols-[1.2fr_0.5fr_0.5fr_auto]">
                  <input className={field} value={item.title} onChange={(event) => setList('risks', draft.risks.map((current, itemIndex) => itemIndex === index ? { ...current, title: event.target.value } : current))} placeholder="Risco ou situação de atenção" />
                  <select className={field} value={item.severity} onChange={(event) => setList('risks', draft.risks.map((current, itemIndex) => itemIndex === index ? { ...current, severity: event.target.value as PtsRisk['severity'] } : current))}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <select className={field} value={item.status} onChange={(event) => setList('risks', draft.risks.map((current, itemIndex) => itemIndex === index ? { ...current, status: event.target.value as PtsRisk['status'] } : current))}><option value="active">Ativo</option><option value="controlled">Controlado</option><option value="resolved">Resolvido</option></select>
                  <button type="button" aria-label="Remover risco" className="rounded-xl p-3 text-rose-500 hover:bg-rose-500/10" onClick={() => setList('risks', draft.risks.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2"><textarea className={`${field} min-h-20`} value={item.description} onChange={(event) => setList('risks', draft.risks.map((current, itemIndex) => itemIndex === index ? { ...current, description: event.target.value } : current))} placeholder="Sinais, contexto e fatores associados." /><textarea className={`${field} min-h-20`} value={item.responsePlan} onChange={(event) => setList('risks', draft.risks.map((current, itemIndex) => itemIndex === index ? { ...current, responsePlan: event.target.value } : current))} placeholder="Conduta combinada e critérios de escalonamento." /></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`rounded-2xl border p-4 ${surface}`}>
        {sectionHeader('reviews', <CalendarClock size={20} />, 'Reavaliações e decisões da equipe', 'Registre reuniões, decisões e a próxima data de revisão sem sobrescrever o histórico anterior.')}
        {openSections.reviews !== false && (
          <div className="mt-4 space-y-3">
            <div className="flex justify-end"><button type="button" className={secondaryButton} onClick={addReview}><Plus size={15} /> Registrar reavaliação</button></div>
            {draft.reviews.map((item, index) => (
              <div key={item.id} className={`rounded-xl border p-3 ${inset}`}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className={`text-xs ${subtle}`}>Data prevista<input className={`${field} mt-1.5`} type="date" value={item.scheduledFor} onChange={(event) => setList('reviews', draft.reviews.map((current, itemIndex) => itemIndex === index ? { ...current, scheduledFor: event.target.value } : current))} /></label>
                  <label className={`text-xs ${subtle}`}>Reunião concluída em<input className={`${field} mt-1.5`} type="datetime-local" value={toDateTimeLocal(item.completedAt)} onChange={(event) => setList('reviews', draft.reviews.map((current, itemIndex) => itemIndex === index ? { ...current, completedAt: fromDateTimeLocal(event.target.value) } : current))} /></label>
                  <label className={`text-xs ${subtle}`}>Próxima revisão<input className={`${field} mt-1.5`} type="date" value={item.nextReviewDate} onChange={(event) => setList('reviews', draft.reviews.map((current, itemIndex) => itemIndex === index ? { ...current, nextReviewDate: event.target.value } : current))} /></label>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2"><textarea className={`${field} min-h-20`} value={item.summary} onChange={(event) => setList('reviews', draft.reviews.map((current, itemIndex) => itemIndex === index ? { ...current, summary: event.target.value } : current))} placeholder="Síntese do que foi observado desde a última revisão." /><textarea className={`${field} min-h-20`} value={item.decisions} onChange={(event) => setList('reviews', draft.reviews.map((current, itemIndex) => itemIndex === index ? { ...current, decisions: event.target.value } : current))} placeholder="Decisões, mudanças de rota e responsabilidades pactuadas." /></div>
                <div className="mt-2 flex justify-end"><button type="button" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-500 hover:bg-rose-500/10" onClick={() => setList('reviews', draft.reviews.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /> Remover</button></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className={`sticky bottom-3 z-10 flex flex-col gap-3 rounded-2xl border p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between ${surface}`}>
        <div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 text-emerald-500" size={18} /><p className={`text-xs leading-5 ${subtle}`}>O salvamento cria uma nova versão e preserva integralmente o histórico anterior.</p></div>
        <button type="button" disabled={saving} onClick={() => void persist()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm text-white disabled:opacity-50">{saving ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : 'Salvar nova versão do PTS'}</button>
      </div>
    </div>
  );
}
