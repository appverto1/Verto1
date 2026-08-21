import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CircleHelp,
  Database,
  Filter,
  Layers3,
  LineChart as LineChartIcon,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dataService } from '../services/dataService';
import {
  clinicalOutcomeDirectionLabel,
  clinicalOutcomeEvidenceLabel,
  formatClinicalOutcomeValue,
  summarizeClinicalOutcomeSeries,
  type ClinicalOutcomeObservation,
  type ClinicalOutcomeSeriesSummary,
} from '../utils/clinicalOutcomeAnalytics';
import { hydratePtsClinicalPayloadFromPlan } from '../utils/ptsClinicalWorkspace';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type ClinicalOutcomesDashboardProps = {
  patientId: string;
  isPanelDark?: boolean;
};

type DashboardData = {
  plans: any[];
  programs: any[];
  observations: ClinicalOutcomeObservation[];
  contributions: any[];
  phases: any[];
  specialties: string[];
  schemaAvailable: boolean;
  v3Available: boolean;
  v3ObservationCount: number;
  legacyObservationCount: number;
};

const EMPTY_DATA: DashboardData = {
  plans: [],
  programs: [],
  observations: [],
  contributions: [],
  phases: [],
  specialties: [],
  schemaAvailable: false,
  v3Available: false,
  v3ObservationCount: 0,
  legacyObservationCount: 0,
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  archived: 'Arquivado',
};

const GOAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Não iniciado',
  in_progress: 'Em andamento',
  achieved: 'Atingido',
  paused: 'Pausado',
  cancelled: 'Encerrado',
};

const PHASE_LABELS: Record<string, string> = {
  baseline: 'Linha de base',
  intervention: 'Intervenção',
  procedure_change: 'Troca de procedimento',
  maintenance: 'Manutenção',
  generalization: 'Generalização',
  pause: 'Pausa',
  goal_change: 'Mudança de meta',
  instrument_change: 'Mudança de instrumento',
  context_event: 'Evento contextual',
};

const dateLabel = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime())
    ? '-'
    : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const dateTime = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const clean = (value: unknown) => String(value || '').trim();

const latestPlanFirst = (left: any, right: any) => (
  dateTime(right?.updated_at || right?.created_at) - dateTime(left?.updated_at || left?.created_at)
);

const seriesPlanId = (series: ClinicalOutcomeSeriesSummary) => clean(series.observations[0]?.planId);
const seriesGoalId = (series: ClinicalOutcomeSeriesSummary) => clean(series.observations[0]?.goalId);

const trendLabel = (series: ClinicalOutcomeSeriesSummary) => {
  if (series.visualTrend === 'unknown') return 'Sem interpretação de tendência';
  if (series.visualTrend === 'stable') return 'Tendência visual estável';
  if (series.visualTrend === 'up') return 'Tendência visual de alta';
  return 'Tendência visual de queda';
};

const evidenceTone = (series: ClinicalOutcomeSeriesSummary, dark: boolean) => {
  if (series.stale) return dark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800';
  if (series.evidenceState === 'sufficient') return dark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return dark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600';
};

function SeriesChart({ series, isDark, compact = false }: { series: ClinicalOutcomeSeriesSummary; isDark: boolean; compact?: boolean }) {
  const categoricalLabels = Array.from(new Set(
    series.observations
      .filter((observation) => !observation.missingReason && (observation.value === null || observation.value === undefined || !Number.isFinite(Number(observation.value))))
      .map((observation) => clean(observation.valueText))
      .filter(Boolean),
  ));
  const categoricalMode = categoricalLabels.length > 0 && !series.observations.some((observation) => observation.value !== null && observation.value !== undefined && Number.isFinite(Number(observation.value)));
  const categoryIndex = new Map(categoricalLabels.map((label, index) => [label, index]));
  const rows = series.observations.map((observation) => {
    const categoricalValue = clean(observation.valueText);
    return {
      observedAt: observation.observedAt,
      date: dateLabel(observation.observedAt),
      value: observation.missingReason
        ? null
        : categoricalMode
          ? categoryIndex.get(categoricalValue) ?? null
          : observation.value,
      valueText: categoricalValue,
      display: formatClinicalOutcomeValue(observation),
      missingReason: observation.missingReason,
    };
  });
  const target = categoricalMode ? Number.NaN : Number(series.observations.find((row: any) => Number.isFinite(Number(row?.metadata?.targetValue)))?.metadata?.targetValue);
  return (
    <div className={compact ? 'h-28' : 'h-52'}>
      <SafeResponsiveContainer
        width="100%"
        height="100%"
        minHeight={compact ? 112 : 208}
      >
        <LineChart data={rows} margin={{ top: 12, right: 10, left: compact ? -24 : -8, bottom: compact ? 8 : 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
          <XAxis
            dataKey="date"
            height={compact ? 24 : 30}
            tick={{ fontSize: compact ? 9 : 11 }}
            tickMargin={compact ? 6 : 8}
            minTickGap={20}
            stroke={isDark ? '#94A3B8' : '#64748B'}
          />
          <YAxis
            tick={{ fontSize: compact ? 9 : 11 }}
            width={categoricalMode ? (compact ? 68 : 92) : (compact ? 32 : 48)}
            stroke={isDark ? '#94A3B8' : '#64748B'}
            domain={categoricalMode ? [0, Math.max(0, categoricalLabels.length - 1)] : undefined}
            ticks={categoricalMode ? categoricalLabels.map((_, index) => index) : undefined}
            tickFormatter={categoricalMode ? (value) => categoricalLabels[Number(value)] || '' : undefined}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row: any = payload?.[0]?.payload;
              if (!active || !row) return null;
              return (
                <div className={`max-w-xs rounded-xl border px-3 py-2 text-xs shadow-lg ${isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}>
                  <p>{row.date}</p>
                  <p className="mt-1">{row.missingReason ? 'Dado não coletado' : row.display}</p>
                </div>
              );
            }}
          />
          {!categoricalMode && Number.isFinite(target) && <ReferenceLine y={target} strokeDasharray="5 4" label={{ value: 'Alvo', fontSize: 10 }} />}
          <Line type="linear" dataKey="value" strokeWidth={2.5} dot={{ r: compact ? 2.5 : 3.5 }} activeDot={{ r: 5 }} connectNulls={false} />
        </LineChart>
      </SafeResponsiveContainer>
    </div>
  );
}

export function ClinicalOutcomesDashboard({ patientId, isPanelDark = false }: ClinicalOutcomesDashboardProps) {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scopeId, setScopeId] = useState('pts');
  const [contextFilter, setContextFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [refreshRevision, setRefreshRevision] = useState(0);


  useEffect(() => {
    const handleClinicalOutcomeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ patientId?: string }>).detail;
      if (!detail?.patientId || String(detail.patientId) === String(patientId)) {
        setRefreshRevision((current) => current + 1);
      }
    };
    window.addEventListener('verto:clinical-outcomes-changed', handleClinicalOutcomeChange as EventListener);
    return () => window.removeEventListener('verto:clinical-outcomes-changed', handleClinicalOutcomeChange as EventListener);
  }, [patientId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      const response = await dataService.getClinicalOutcomesDashboard(patientId, { days });
      if (!active) return;
      if (!response?.success) {
        setData(EMPTY_DATA);
        setError(response?.message || response?.error || 'Não foi possível carregar os gráficos clínicos.');
      } else {
        setData({ ...EMPTY_DATA, ...(response.data || {}) });
      }
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [days, patientId, refreshRevision]);

  const plans = useMemo(() => (Array.isArray(data.plans) ? data.plans.slice().sort(latestPlanFirst) : []), [data.plans]);
  const ptsPlans = useMemo(() => plans.filter((plan) => plan.mode === 'interdisciplinary'), [plans]);
  const specialtyPlans = useMemo(() => plans.filter((plan) => plan.mode === 'specialty'), [plans]);
  const activePts = ptsPlans.find((plan) => ['active', 'draft', 'paused'].includes(clean(plan.status))) || ptsPlans[0] || null;

  useEffect(() => {
    if (scopeId === 'pts' && activePts) return;
    if (scopeId !== 'pts' && specialtyPlans.some((plan) => String(plan.id) === scopeId)) return;
    setScopeId(activePts ? 'pts' : specialtyPlans[0] ? String(specialtyPlans[0].id) : 'pts');
  }, [activePts, scopeId, specialtyPlans]);

  const contexts = useMemo(() => Array.from(new Set((data.observations || []).map((row) => clean(row.context)).filter(Boolean))).sort(), [data.observations]);
  const sources = useMemo(() => Array.from(new Set((data.observations || []).map((row) => clean(row.source)).filter(Boolean))).sort(), [data.observations]);
  const filteredObservations = useMemo(() => (data.observations || []).filter((row) => (
    (contextFilter === 'all' || clean(row.context) === contextFilter)
    && (sourceFilter === 'all' || clean(row.source) === sourceFilter)
  )), [contextFilter, data.observations, sourceFilter]);
  const summaries = useMemo(() => summarizeClinicalOutcomeSeries(filteredObservations), [filteredObservations]);
  const selectedPlan = specialtyPlans.find((plan) => String(plan.id) === scopeId) || null;
  const selectedPlanSeries = useMemo(() => selectedPlan
    ? summaries.filter((series) => seriesPlanId(series) === String(selectedPlan.id))
    : [], [selectedPlan, summaries]);
  const selectedPlanPhases = useMemo(() => selectedPlan
    ? (data.phases || []).filter((phase: any) => String(phase.plan_id || phase.planId) === String(selectedPlan.id))
    : [], [data.phases, selectedPlan]);

  const ptsPayload = useMemo(() => activePts ? hydratePtsClinicalPayloadFromPlan(activePts) : null, [activePts]);
  const ptsGoalRows = useMemo(() => {
    if (!activePts || !ptsPayload) return [];
    return ptsPayload.goals.map((goal) => {
      const explicit = (data.contributions || []).filter((item: any) => (
        String(item.pts_plan_id || item.ptsPlanId) === String(activePts.id)
        && String(item.pts_goal_id || item.ptsGoalId) === String(goal.id)
      ));
      const expectedSpecialties = Array.from(new Set([
        ...goal.specialties,
        ...explicit.map((item: any) => clean(item.specialty)).filter(Boolean),
      ]));
      const contributionRows = expectedSpecialties.map((specialty) => {
        const link = explicit.find((item: any) => clean(item.specialty) === specialty) || null;
        const specialtyPlan = link
          ? specialtyPlans.find((plan) => String(plan.id) === String(link.specialty_plan_id || link.specialtyPlanId))
          : specialtyPlans.find((plan) => clean(plan.specialty) === specialty);
        const linkedGoalId = clean(link?.specialty_goal_id || link?.specialtyGoalId);
        const goalSeries = summaries.filter((series) => {
          if (link && specialtyPlan && seriesPlanId(series) !== String(specialtyPlan.id)) return false;
          if (linkedGoalId) return seriesGoalId(series) === linkedGoalId;
          return seriesGoalId(series) === goal.id && clean(series.specialty) === specialty;
        });
        return { specialty, link, specialtyPlan, series: goalSeries };
      });
      return { goal, contributions: contributionRows };
    });
  }, [activePts, data.contributions, ptsPayload, specialtyPlans, summaries]);

  const panel = isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const inset = isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/70';
  const text = isPanelDark ? 'text-slate-100' : 'text-slate-900';
  const muted = isPanelDark ? 'text-slate-400' : 'text-slate-500';

  if (loading) {
    return <div className={`flex min-h-[420px] items-center justify-center rounded-3xl border ${panel}`}><RefreshCw className="animate-spin text-violet-500" size={26} /></div>;
  }

  return (
    <section className="space-y-4" data-testid="clinical-outcomes-dashboard">
      <header className={`rounded-3xl border p-5 ${panel}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-violet-600">Evolução clínica por planos</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className={`text-xl font-semibold ${text}`}>PTS e planos por especialidade</h2>
              {data.v3Available && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">V3 canônico</span>}
            </div>
            <p className={`mt-2 max-w-3xl text-sm leading-6 ${muted}`}>Cada especialidade preserva sua unidade e sua série técnica. A visão do PTS reúne contribuições explicáveis, sem calcular média entre métricas incompatíveis.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={`text-xs ${muted}`}>
              Escopo
              <select value={scopeId} onChange={(event) => setScopeId(event.target.value)} className={`mt-1.5 h-11 w-full min-w-[220px] rounded-xl border px-3 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}>
                {activePts && <option value="pts">Visão do PTS</option>}
                {specialtyPlans.map((plan) => <option key={plan.id} value={String(plan.id)}>{clean(plan.specialty) || 'Plano da especialidade'} · v{plan.edit_version || 1}</option>)}
              </select>
            </label>
            <label className={`text-xs ${muted}`}>
              Período
              <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={`mt-1.5 h-11 w-full rounded-xl border px-3 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}>
                <option value={30}>30 dias</option><option value={90}>90 dias</option><option value={180}>180 dias</option><option value={365}>12 meses</option>
              </select>
            </label>
            <div className={`rounded-xl border px-3 py-2.5 text-xs ${inset}`}>
              <p className={muted}>Séries visíveis</p>
              <p className={`mt-1 text-base ${text}`}>{scopeId === 'pts' ? ptsGoalRows.length : selectedPlanSeries.length}</p>
            </div>
          </div>
        </div>
      </header>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!data.schemaAvailable && (
        <div className={`flex items-start gap-3 rounded-2xl border p-4 ${isPanelDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <Database size={20} className="mt-0.5 shrink-0" />
          <div><p className="text-sm font-medium">Estrutura de resultados multidisciplinares ainda não disponível</p><p className="mt-1 text-xs leading-5">Os registros históricos continuam preservados. As séries por especialidade aparecem quando existe uma fonte clínica estruturada e autorizada para o plano.</p></div>
        </div>
      )}

      <div className={`flex flex-wrap items-end gap-3 rounded-2xl border p-4 ${panel}`}>
        <Filter size={18} className="mb-3 text-violet-500" />
        <label className={`min-w-[180px] flex-1 text-xs ${muted}`}>Contexto<select value={contextFilter} onChange={(event) => setContextFilter(event.target.value)} className={`mt-1.5 h-10 w-full rounded-xl border px-3 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}><option value="all">Todos os contextos</option>{contexts.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className={`min-w-[220px] flex-1 text-xs ${muted}`}>Fonte<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className={`mt-1.5 h-10 w-full rounded-xl border px-3 text-sm ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}><option value="all">Todas as fontes</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <div className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs ${inset}`}><ShieldCheck size={16} className="text-emerald-500" /> Ausência de dados não é tratada como zero</div>
        {data.v3Available && <div className={`flex min-h-10 items-center rounded-xl border px-3 text-xs ${inset}`}>{data.v3ObservationCount} ponto(s) V3 · {data.legacyObservationCount} histórico(s)</div>}
      </div>

      {scopeId === 'pts' ? (
        <div className="space-y-4">
          {!activePts ? (
            <div className={`rounded-3xl border p-8 text-center ${panel}`}><Layers3 className="mx-auto text-slate-300" /><p className={`mt-3 text-sm ${muted}`}>Nenhum PTS visível para este paciente.</p></div>
          ) : ptsGoalRows.length === 0 ? (
            <div className={`rounded-3xl border p-8 text-center ${panel}`}><Target className="mx-auto text-slate-300" /><p className={`mt-3 text-sm ${muted}`}>O PTS ainda não possui objetivos compartilhados estruturados.</p></div>
          ) : ptsGoalRows.map(({ goal, contributions }) => {
            const evidenceCount = contributions.reduce((sum, contribution) => sum + contribution.series.length, 0);
            const stale = contributions.some((contribution) => contribution.series.some((series) => series.stale));
            return (
              <article key={goal.id} className={`rounded-3xl border p-5 ${panel}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-lg font-semibold ${text}`}>{goal.title}</h3><span className={`rounded-full border px-2.5 py-1 text-xs ${inset}`}>{GOAL_STATUS_LABELS[goal.status] || goal.status}</span>{stale && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">Evidência desatualizada</span>}</div>{goal.description && <p className={`mt-2 text-sm leading-6 ${muted}`}>{goal.description}</p>}</div>
                  <div className={`grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 rounded-2xl border px-4 py-3 text-xs ${inset}`}><span className={muted}>Prazo</span><span className={text}>{goal.dueDate ? dateLabel(goal.dueDate) : 'Não definido'}</span><span className={muted}>Contribuições com série</span><span className={text}>{evidenceCount}</span></div>
                </div>
                <div className="mt-5 grid gap-3 xl:grid-cols-2">
                  {contributions.length === 0 ? (
                    <div className={`rounded-2xl border border-dashed p-4 ${inset}`}><p className={`text-sm ${text}`}>Nenhuma contribuição por especialidade foi vinculada.</p><p className={`mt-1 text-xs leading-5 ${muted}`}>O sistema não cria uma média nem associa métricas por semelhança de texto. Vincule explicitamente as metas dos planos individuais ao objetivo compartilhado.</p></div>
                  ) : contributions.map((contribution) => (
                    <div key={`${goal.id}-${contribution.specialty}`} className={`rounded-2xl border p-4 ${inset}`}>
                      <div className="flex items-start justify-between gap-3"><div><p className={`text-sm font-semibold ${text}`}>{contribution.specialty}</p><p className={`mt-1 text-xs ${muted}`}>{contribution.link ? 'Contribuição vinculada ao PTS' : 'Contribuição esperada, ainda sem vínculo explícito'}</p></div>{contribution.link?.contribution_type === 'required' && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">Obrigatória</span>}</div>
                      {contribution.series.length > 0 ? contribution.series.slice(0, 2).map((series) => (
                        <div key={series.key} className="mt-3 rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-950/30"><div className="flex items-center justify-between gap-2"><p className={`truncate text-xs ${text}`}>{series.metricLabel}</p><span className={`rounded-full border px-2 py-1 text-[10px] ${evidenceTone(series, isPanelDark)}`}>{series.stale ? 'Sem evidência recente' : clinicalOutcomeEvidenceLabel(series.evidenceState)}</span></div><SeriesChart series={series} isDark={isPanelDark} compact /><p className={`mt-1 text-xs ${muted}`}>{formatClinicalOutcomeValue(series.latestObservation)}</p></div>
                      )) : <div className={`mt-3 rounded-xl border border-dashed p-4 text-xs leading-5 ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Sem evidência estruturada vinculada a esta contribuição. Isso não significa ausência de progresso.</div>}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : selectedPlan ? (
        <div className="space-y-4">
          <div className={`rounded-3xl border p-5 ${panel}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs uppercase tracking-[0.16em] text-violet-600">Plano por especialidade</p><h3 className={`mt-1 text-lg font-semibold ${text}`}>{selectedPlan.specialty || 'Especialidade não informada'}</h3><p className={`mt-1 text-xs ${muted}`}>{PLAN_STATUS_LABELS[selectedPlan.status] || selectedPlan.status} · versão {selectedPlan.edit_version || 1}</p></div><div className={`rounded-2xl border px-4 py-3 text-xs ${inset}`}><p className={muted}>Regra de leitura</p><p className={`mt-1 ${text}`}>Pontos reais, sem suavização automática e sem média com outras especialidades.</p></div></div>
            {selectedPlanPhases.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{selectedPlanPhases.map((phase: any) => <span key={phase.id} title={phase.reason || ''} className={`rounded-full border px-3 py-1.5 text-xs ${inset}`}>{PHASE_LABELS[phase.phase_type] || phase.label} · {dateLabel(phase.started_at)}</span>)}</div>}
          </div>

          {selectedPlanSeries.length === 0 ? (
            <div className={`rounded-3xl border p-8 text-center ${panel}`}><LineChartIcon className="mx-auto text-slate-300" size={30} /><p className={`mt-3 text-sm ${text}`}>Ainda não há séries clínicas vinculadas a este plano.</p><p className={`mx-auto mt-2 max-w-xl text-xs leading-5 ${muted}`}>Os gráficos serão formados por observações comparáveis da mesma métrica, unidade, direção e versão de instrumento. Registros de outras especialidades não serão misturados.</p></div>
          ) : selectedPlanSeries.map((series) => (
            <article key={series.key} className={`rounded-3xl border p-5 ${panel}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><h3 className={`text-base font-semibold ${text}`}>{series.metricLabel}</h3><span className={`rounded-full border px-2.5 py-1 text-xs ${evidenceTone(series, isPanelDark)}`}>{series.stale ? 'Sem evidência recente' : clinicalOutcomeEvidenceLabel(series.evidenceState)}</span></div><p className={`mt-2 text-xs ${muted}`}>{series.context} · {series.source} · {clinicalOutcomeDirectionLabel(series.direction)}</p></div>
                <div className={`rounded-2xl border px-4 py-3 text-xs ${inset}`}><p className={muted}>Última evidência</p><p className={`mt-1 text-sm ${text}`}>{formatClinicalOutcomeValue(series.latestObservation)}</p><p className={`mt-1 ${muted}`}>{series.latestObservation ? dateLabel(series.latestObservation.observedAt) : '-'}</p></div>
              </div>
              <div className="mt-4"><SeriesChart series={series} isDark={isPanelDark} /></div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className={`rounded-xl border p-3 text-xs ${inset}`}><p className={muted}>Registros válidos</p><p className={`mt-1 ${text}`}>{series.validObservations.length}</p></div><div className={`rounded-xl border p-3 text-xs ${inset}`}><p className={muted}>Ausências registradas</p><p className={`mt-1 ${text}`}>{series.missingCount}</p></div><div className={`rounded-xl border p-3 text-xs ${inset}`}><p className={muted}>Leitura visual</p><p className={`mt-1 ${text}`}>{trendLabel(series)}</p></div></div>
              {series.evidenceState !== 'sufficient' && <div className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}><CircleHelp size={16} className="mt-0.5 shrink-0" /> Dados ainda insuficientes para interpretar tendência. A decisão clínica permanece humana.</div>}
            </article>
          ))}
        </div>
      ) : (
        <div className={`rounded-3xl border p-8 text-center ${panel}`}><AlertTriangle className="mx-auto text-amber-500" /><p className={`mt-3 text-sm ${muted}`}>Selecione um plano disponível.</p></div>
      )}
    </section>
  );
}
