import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  History,
  Plus,
  Search,
  Target,
} from 'lucide-react';
import { hydratePtsClinicalPayloadFromPlan } from '../utils/ptsClinicalWorkspace';
import { formatTherapeuticPlanDate, normalizeTherapeuticProgramStatus } from '../utils/therapeuticPlan';

type WorkspaceTab = 'programs' | 'maintenance' | 'generalization' | 'history';

type PtsTherapeuticDashboardProps = {
  scope: any;
  availableScopes: any[];
  professionals: any[];
  programs: any[];
  loading?: boolean;
  isDark?: boolean;
  canCreateProgram?: boolean;
  canEditScope?: boolean;
  canManagePlans?: boolean;
  onScopeChange: (scopeId: string) => void;
  onAddProgram: () => void;
  onNewVersion: () => void;
  onManagePlans: () => void;
  renderProgramCard: (program: any) => React.ReactNode;
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  draft: 'Rascunho',
  paused: 'Pausado',
  completed: 'Concluído',
  archived: 'Arquivado',
};

const FILTERS = [
  ['all', 'Todos'],
  ['teaching', 'Em ensino'],
  ['maintenance', 'Manutenção'],
  ['paused', 'Pausados'],
  ['completed', 'Concluídos'],
] as const;

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'programs', label: 'Programas' },
  { id: 'maintenance', label: 'Manutenção' },
  { id: 'generalization', label: 'Generalização' },
  { id: 'history', label: 'Histórico' },
];

const initials = (value: unknown) => String(value || 'P')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.charAt(0).toUpperCase())
  .join('') || 'P';

const objectiveLines = (value: unknown): string[] => {
  const rows = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return rows
    .flatMap((row: any) => {
      const text = typeof row === 'string'
        ? row
        : row && typeof row === 'object'
          ? row.title || row.description || row.objective || ''
          : '';
      return String(text || '').split(/\r?\n/);
    })
    .map((line) => line.trim())
    .filter(Boolean);
};

const dateValue = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

export function PtsTherapeuticDashboard({
  scope,
  availableScopes,
  professionals,
  programs,
  loading = false,
  isDark = false,
  canCreateProgram = false,
  canEditScope = false,
  canManagePlans = false,
  onScopeChange,
  onAddProgram,
  onNewVersion,
  onManagePlans,
  renderProgramCard,
}: PtsTherapeuticDashboardProps) {
  const [tab, setTab] = useState<WorkspaceTab>('programs');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    reference: true,
    team: true,
    objectives: true,
    family: true,
    versions: true,
  });

  const pts = useMemo(() => hydratePtsClinicalPayloadFromPlan(scope), [scope]);
  const professionalById = useMemo(() => new Map(
    (Array.isArray(professionals) ? professionals : []).map((professional: any) => [String(professional.id), professional]),
  ), [professionals]);
  const participantIds = useMemo(() => Array.from(new Set([
    String(scope?.responsible_professional_id || ''),
    ...(Array.isArray(scope?.participant_professional_ids) ? scope.participant_professional_ids.map(String) : []),
  ].filter(Boolean))), [scope]);
  const responsible = professionalById.get(String(pts.caseManagerId || scope?.responsible_professional_id || ''))
    || professionalById.get(String(scope?.responsible_professional_id || ''))
    || null;

  const activePrograms = useMemo(() => programs.filter((program: any) => (
    ['teaching', 'maintenance'].includes(normalizeTherapeuticProgramStatus(program?.status))
  )), [programs]);
  const goalsInProgress = pts.goals.filter((goal) => ['pending', 'in_progress'].includes(goal.status)).length;
  const achievedGoals = pts.goals.filter((goal) => goal.status === 'achieved').length;
  const delayedGoals = pts.goals.filter((goal) => (
    Boolean(goal.dueDate)
    && !['achieved', 'cancelled'].includes(goal.status)
    && new Date(`${goal.dueDate}T23:59:59`).getTime() < Date.now()
  )).length;

  const visiblePrograms = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return programs.filter((program: any) => {
      const status = normalizeTherapeuticProgramStatus(program?.status);
      const tabMatch = tab === 'programs'
        || (tab === 'maintenance' && status === 'maintenance')
        || (tab === 'generalization' && Boolean(String(program?.advanced_settings?.generalization || '').trim()));
      const filterMatch = tab !== 'programs' || filter === 'all' || status === filter;
      const searchable = `${program?.name || ''} ${program?.objective || ''} ${(program?.targets || []).map((target: any) => target?.name || '').join(' ')}`
        .toLocaleLowerCase('pt-BR');
      return tabMatch && filterMatch && (!needle || searchable.includes(needle));
    });
  }, [filter, programs, query, tab]);

  const sharedObjectives = useMemo(() => {
    const fromGoals = pts.goals
      .filter((goal) => goal.status !== 'cancelled')
      .map((goal) => goal.title)
      .filter(Boolean);
    return fromGoals.length ? fromGoals : objectiveLines(scope?.common_objectives);
  }, [pts.goals, scope?.common_objectives]);

  const versionEvents = useMemo(() => {
    const reviews = [...pts.reviews]
      .sort((left, right) => dateValue(right.completedAt || right.scheduledFor) - dateValue(left.completedAt || left.scheduledFor))
      .slice(0, 2)
      .map((review) => ({
        id: review.id,
        version: null as number | null,
        date: review.completedAt || review.scheduledFor,
        label: review.summary || review.decisions || 'Reavaliação registrada',
      }));
    return [
      {
        id: `current-${scope?.id}`,
        version: Number(scope?.edit_version || 1) as number | null,
        date: scope?.updated_at || scope?.created_at,
        label: 'Versão atual',
      },
      ...reviews,
    ].slice(0, 3);
  }, [pts.reviews, scope]);

  const nextReviewOverdue = Boolean(
    pts.nextReviewDate
    && new Date(`${pts.nextReviewDate}T23:59:59`).getTime() < Date.now(),
  );

  const surface = isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const inset = isDark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-100 bg-slate-50/70';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const secondaryButton = `inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3.5 text-sm transition-colors ${
    isDark ? 'border-slate-700 text-slate-200 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
  }`;

  const section = (id: string, title: string, content: React.ReactNode) => {
    const open = openSections[id] !== false;
    return (
      <section className={`border-b py-4 last:border-b-0 ${isDark ? 'border-slate-700' : 'border-slate-100'}`}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setOpenSections((current) => ({ ...current, [id]: !open }))}
          aria-expanded={open}
        >
          <span className={`text-sm font-semibold ${text}`}>{title}</span>
          {open ? <ChevronUp size={16} className={muted} /> : <ChevronDown size={16} className={muted} />}
        </button>
        {open && <div className="mt-3">{content}</div>}
      </section>
    );
  };

  const emptyMessage = tab === 'maintenance'
    ? 'Nenhum programa está em manutenção neste PTS.'
    : tab === 'generalization'
      ? 'Nenhum programa possui estratégia de generalização registrada.'
      : query || filter !== 'all'
        ? 'Nenhum programa encontrado com estes filtros.'
        : 'Ainda não há programas individualizados vinculados a este PTS.';

  return (
    <div className="space-y-4" data-testid="pts-therapeutic-dashboard">
      <header className={`rounded-2xl border px-4 py-4 sm:px-5 ${surface}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`text-lg font-semibold ${text}`}>PTS - Plano Terapêutico Singular</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs ${scope?.status === 'active' ? isDark ? 'bg-emerald-500/15 text-emerald-200' : 'bg-emerald-50 text-emerald-700' : isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                {STATUS_LABELS[String(scope?.status || 'draft')] || 'Rascunho'}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                Versão {scope?.edit_version || 1}
              </span>
            </div>
            {availableScopes.length > 1 && (
              <label className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
                Plano em exibição
                <select
                  className={`rounded-lg border px-2 py-1.5 outline-none ${isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}
                  value={String(scope?.id || '')}
                  onChange={(event) => onScopeChange(event.target.value)}
                >
                  {availableScopes.map((item: any) => (
                    <option key={item.id} value={item.id}>PTS · versão {item.edit_version || 1}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:items-center">
            <div className="min-w-[150px]">
              <dt className={muted}>Responsável de referência</dt>
              <dd className={`mt-1 truncate text-sm ${text}`}>{responsible?.name || 'Não definido'}</dd>
            </div>
            <div className="min-w-[120px]">
              <dt className={muted}>Última atualização</dt>
              <dd className={`mt-1 text-sm ${text}`}>{formatTherapeuticPlanDate(scope?.updated_at || scope?.created_at)}</dd>
            </div>
            <div className="min-w-[130px]">
              <dt className={muted}>Próxima reavaliação</dt>
              <dd className={`mt-1 text-sm ${nextReviewOverdue ? 'text-rose-600' : text}`}>{pts.nextReviewDate ? formatTherapeuticPlanDate(pts.nextReviewDate) : 'Não definida'}</dd>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
              {canManagePlans && <button type="button" className={secondaryButton} onClick={onManagePlans}>Gerenciar planos</button>}
              {canEditScope && <button type="button" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700" onClick={onNewVersion}>Nova versão</button>}
            </div>
          </dl>
        </div>
      </header>

      <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border text-sm sm:grid-cols-4 ${isDark ? 'border-slate-700 bg-slate-700' : 'border-slate-100 bg-slate-100'}`}>
        {[
          ['programs', `${activePrograms.length} programas ativos`],
          ['progress', `${goalsInProgress} metas em andamento`],
          ['achieved', `${achievedGoals} metas atingidas`],
          ['delayed', `${delayedGoals} metas atrasadas`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`min-h-11 px-3 text-left transition-colors ${isDark ? 'bg-slate-900/80 hover:bg-slate-800' : 'bg-slate-50 hover:bg-white'} ${id === 'delayed' && delayedGoals > 0 ? 'text-rose-600' : text}`}
            onClick={() => {
              setTab('programs');
              if (id === 'programs') setFilter('all');
              if (id === 'achieved') setFilter('completed');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-[620px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={`self-start rounded-2xl border px-4 lg:sticky lg:top-4 ${surface}`} aria-label="Resumo executivo do PTS">
          <div className="flex items-center gap-2 border-b py-4">
            <ClipboardList size={18} className="text-violet-500" />
            <h3 className={`text-base font-semibold ${text}`}>Resumo executivo</h3>
          </div>

          {section('reference', 'Responsável de referência', (
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs ${isDark ? 'bg-violet-500/15 text-violet-200' : 'bg-violet-50 text-violet-700'}`}>{initials(responsible?.name)}</span>
              <div className="min-w-0">
                <p className={`truncate text-sm ${text}`}>{responsible?.name || 'Não definido'}</p>
                <p className={`mt-0.5 truncate text-xs ${muted}`}>{responsible?.specialty || 'Especialidade não informada'}</p>
              </div>
            </div>
          ))}

          {section('team', 'Equipe multidisciplinar', (
            <div className="space-y-2">
              {participantIds.map((professionalId) => {
                const professional = professionalById.get(professionalId);
                return (
                  <div key={professionalId} className="flex items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>{initials(professional?.name)}</span>
                    <div className="min-w-0">
                      <p className={`text-sm leading-5 ${text}`}>{professional?.name || 'Profissional da equipe'}</p>
                      <p className={`text-xs ${muted}`}>{professional?.specialty || 'Especialidade não informada'}</p>
                    </div>
                  </div>
                );
              })}
              {participantIds.length === 0 && <p className={`text-xs ${muted}`}>Equipe ainda não definida.</p>}
            </div>
          ))}

          {section('objectives', 'Objetivos compartilhados', (
            sharedObjectives.length > 0 ? (
              <ul className={`space-y-2 text-sm leading-5 ${text}`}>
                {sharedObjectives.slice(0, 5).map((objective, index) => (
                  <li key={`${objective}-${index}`} className="flex gap-2"><span className="text-violet-500">•</span><span>{objective}</span></li>
                ))}
              </ul>
            ) : <p className={`text-xs leading-5 ${muted}`}>Os objetivos compartilhados ainda não foram definidos.</p>
          ))}

          {section('family', 'Prioridades familiares', (
            <p className={`whitespace-pre-line text-sm leading-5 ${pts.familyVoice ? text : muted}`}>
              {pts.familyVoice || 'As prioridades da família ainda não foram registradas.'}
            </p>
          ))}

          {section('versions', 'Histórico de versões', (
            <div className="space-y-3">
              {versionEvents.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${event.id.startsWith('current-') ? 'bg-emerald-500' : isDark ? 'bg-slate-600' : 'bg-slate-300'}`} />
                  <div className="min-w-0">
                    <p className={`text-sm ${text}`}>{event.version ? `Versão ${event.version}` : 'Reavaliação'} · {formatTherapeuticPlanDate(event.date)}</p>
                    <p className={`mt-0.5 line-clamp-2 text-xs leading-4 ${muted}`}>{event.label}</p>
                  </div>
                </div>
              ))}
              <button type="button" className="text-xs text-violet-600 hover:underline" onClick={() => setTab('history')}>Ver histórico completo</button>
            </div>
          ))}
        </aside>

        <main className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${surface}`}>
          <nav className={`flex gap-1 overflow-x-auto border-b ${isDark ? 'border-slate-700' : 'border-slate-100'}`} aria-label="Áreas do PTS">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`shrink-0 border-b-2 px-3 py-3 text-sm transition-colors ${tab === item.id ? 'border-violet-600 text-violet-600' : `border-transparent ${muted} hover:text-violet-500`}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab !== 'history' ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <label className="relative w-full xl:max-w-sm">
                  <Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${muted}`} />
                  <input
                    className={`w-full rounded-xl border py-2.5 pl-10 pr-4 text-sm outline-none focus:border-violet-500 ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100 placeholder:text-slate-600' : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400'}`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar programa ou alvo"
                  />
                </label>
                {canCreateProgram && <button type="button" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700" onClick={onAddProgram}><Plus size={16} /> Adicionar programa</button>}
              </div>

              {tab === 'programs' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`mr-1 text-xs ${muted}`}>Filtros</span>
                  {FILTERS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${filter === value ? 'border-violet-300 bg-violet-50 text-violet-700' : isDark ? 'border-slate-700 text-slate-300 hover:border-violet-500' : 'border-slate-200 text-slate-600 hover:border-violet-300'}`}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {loading ? (
                <div className={`flex min-h-48 items-center justify-center rounded-2xl border border-dashed text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Carregando programas...</div>
              ) : visiblePrograms.length > 0 ? (
                <div className="space-y-3 lg:max-h-[520px] lg:overflow-y-auto lg:pr-2">{visiblePrograms.map(renderProgramCard)}</div>
              ) : (
                <div className={`flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
                  <Target size={28} className={isDark ? 'text-slate-600' : 'text-slate-300'} />
                  <p className={`mt-3 text-sm ${muted}`}>{emptyMessage}</p>
                  {canCreateProgram && tab === 'programs' && !query && filter === 'all' && <button type="button" className="mt-4 text-sm text-violet-600 hover:underline" onClick={onAddProgram}>Adicionar o primeiro programa</button>}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className={`rounded-2xl border p-4 ${inset}`}>
                <div className="flex items-start gap-3">
                  <History size={18} className="mt-0.5 text-violet-500" />
                  <div>
                    <p className={`text-sm font-semibold ${text}`}>Versão {scope?.edit_version || 1} · versão atual</p>
                    <p className={`mt-1 text-xs ${muted}`}>Atualizada em {formatTherapeuticPlanDate(scope?.updated_at || scope?.created_at)}</p>
                  </div>
                </div>
              </div>
              {pts.reviews.length > 0 ? pts.reviews
                .slice()
                .sort((left, right) => dateValue(right.completedAt || right.scheduledFor) - dateValue(left.completedAt || left.scheduledFor))
                .map((review) => (
                  <article key={review.id} className={`rounded-2xl border p-4 ${inset}`}>
                    <div className="flex items-start gap-3">
                      <CalendarClock size={18} className="mt-0.5 text-violet-500" />
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${text}`}>Reavaliação de {formatTherapeuticPlanDate(review.completedAt || review.scheduledFor)}</p>
                        {review.summary && <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${text}`}>{review.summary}</p>}
                        {review.decisions && <p className={`mt-2 whitespace-pre-line text-xs leading-5 ${muted}`}>Decisões: {review.decisions}</p>}
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhuma reavaliação registrada nesta versão.</div>
                )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
