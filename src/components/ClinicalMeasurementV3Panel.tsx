import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CalendarDays, GitBranch, Info, Layers3, ShieldCheck } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dataService } from '../services/dataService';

type Props = {
  patientId: string;
  isPanelDark?: boolean;
};

type CatalogDefinition = {
  definition_id: string;
  definition_key: string;
  semantic_family: string;
};

type CatalogTarget = {
  target_id: string;
  target_name: string;
  specialty?: string | null;
  definitions: CatalogDefinition[];
};

type ObservedPoint = {
  type: 'OBSERVED';
  id: string;
  session_id: string;
  occurred_at: string;
  clinical_date?: string;
  phase_epoch_id?: string | null;
  measurement: Record<string, any>;
  quality?: Array<Record<string, any>>;
  reliability?: Record<string, any>;
};

type SemanticPoint = ObservedPoint | {
  type: string;
  id: string;
  session_id: string;
  occurred_at: string;
  clinical_date?: string;
  phase_epoch_id?: string | null;
  reason?: string;
};

const lineColors = ['#7C3AED', '#0EA5E9', '#10B981', '#F97316', '#EC4899', '#6366F1', '#14B8A6'];

const familyLabels: Record<string, string> = {
  COUNT: 'Contagem',
  RATE: 'Taxa',
  PROPORTION: 'Proporção',
  DURATION: 'Duração',
  LATENCY: 'Latência',
  IRT: 'IRT',
  CONTINUOUS: 'Contínua',
  INTERVAL: 'Intervalos',
  ORDINAL: 'Escala ordinal',
  CATEGORICAL: 'Categórica',
  TASK_ANALYSIS: 'Análise de tarefas',
};

const directionLabels: Record<string, string> = {
  INCREASE_IS_BETTER: 'Valores maiores são favoráveis',
  DECREASE_IS_BETTER: 'Valores menores são favoráveis',
  TARGET_RANGE_IS_BETTER: 'Faixa-alvo é favorável',
  NO_DIRECTIONAL_JUDGMENT: 'Sem julgamento direcional automático',
};

const stateLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  MASTERED: 'Dominado',
  NOT_EVALUATED: 'Não avaliado',
  SUFFICIENT: 'Suporte suficiente',
  INSUFFICIENT: 'Suporte insuficiente',
  CHANGED_SINCE_DECISION: 'Evidência alterada',
  INVALIDATED: 'Evidência invalidada',
  NONE: 'Sem pendência',
  REVIEW_REQUIRED: 'Revisão necessária',
};

const safeText = (value: any, fallback = '—') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const formatDay = (value: any) => {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatClinicalDate = (value: any) => {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[3]}/${match[2]}` : text;
};

const formatDateTime = (value: any) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const observedPoints = (payload: any): ObservedPoint[] => {
  const segments = Array.isArray(payload?.data?.primary_representation?.segments)
    ? payload.data.primary_representation.segments
    : [];
  return segments.flatMap((segment: any) => Array.isArray(segment?.points) ? segment.points : [])
    .filter((point: SemanticPoint): point is ObservedPoint => point?.type === 'OBSERVED');
};

const scalarValue = (point: ObservedPoint): number | null => {
  const measurement = point?.measurement || {};
  switch (measurement.kind) {
    case 'COUNT': return Number.isFinite(Number(measurement.count)) ? Number(measurement.count) : null;
    case 'RATE': return Number.isFinite(Number(measurement?.normalized_rate?.value)) ? Number(measurement.normalized_rate.value) : null;
    case 'PROPORTION': return Number.isFinite(Number(measurement.proportion)) ? Number(measurement.proportion) : null;
    case 'DURATION':
    case 'LATENCY':
    case 'IRT': return Number.isFinite(Number(measurement.mean_duration_ms)) ? Number(measurement.mean_duration_ms) : null;
    case 'CONTINUOUS': return Number.isFinite(Number(measurement.latest_value)) ? Number(measurement.latest_value) : null;
    default: return null;
  }
};

const scalarSuffix = (payload: any) => {
  const family = String(payload?.identity?.semantic_family || '');
  if (family === 'RATE') return '/h';
  if (family === 'PROPORTION') return '%';
  if (['DURATION', 'LATENCY', 'IRT'].includes(family)) return ' ms';
  return payload?.identity?.unit_label ? ` ${payload.identity.unit_label}` : '';
};

function ScalarTimeSeries({ payload, isPanelDark }: { payload: any; isPanelDark: boolean }) {
  const segments = Array.isArray(payload?.data?.primary_representation?.segments) ? payload.data.primary_representation.segments : [];
  const phaseMap = new Map((Array.isArray(payload?.phase_epochs) ? payload.phase_epochs : []).map((phase: any) => [String(phase.id), phase]));
  const rows = useMemo(() => {
    const output: any[] = [];
    segments.forEach((segment: any, segmentIndex: number) => {
      (Array.isArray(segment?.points) ? segment.points : []).forEach((point: SemanticPoint) => {
        const x = new Date(String(point.occurred_at || '')).getTime();
        if (!Number.isFinite(x)) return;
        const value = point?.type === 'OBSERVED' ? scalarValue(point as ObservedPoint) : null;
        output.push({
          x,
          clinicalDate: point.clinical_date || '',
          sessionId: point.session_id,
          [`segment_${segmentIndex}`]: value,
          point,
        });
      });
    });
    return output.sort((a, b) => a.x - b.x);
  }, [segments]);

  const clinicalDateByX = useMemo(() => {
    const map = new Map<number, string>();
    rows.forEach((row) => { if (row.clinicalDate) map.set(Number(row.x), String(row.clinicalDate)); });
    return map;
  }, [rows]);
  const criteria = Array.isArray(payload?.clinical_decision_rules) ? payload.clinical_decision_rules : [];
  const scopeStart = new Date(String(payload?.scope?.period_start || '')).getTime();
  const scopeEnd = new Date(String(payload?.scope?.period_end || '')).getTime();
  const onlyCriterion = criteria.length === 1 ? criteria[0] : null;
  const criterionStart = onlyCriterion ? new Date(String(onlyCriterion.effective_from || '')).getTime() : Number.NaN;
  const criterionEnd = onlyCriterion?.effective_until ? new Date(String(onlyCriterion.effective_until)).getTime() : Number.POSITIVE_INFINITY;
  const thresholdCandidate = onlyCriterion ? Number(onlyCriterion?.rule?.threshold ?? onlyCriterion?.definition?.threshold) : Number.NaN;
  const threshold = Number.isFinite(thresholdCandidate)
    && Number.isFinite(scopeStart)
    && Number.isFinite(scopeEnd)
    && Number.isFinite(criterionStart)
    && criterionStart <= scopeStart
    && criterionEnd >= scopeEnd
      ? thresholdCandidate
      : null;
  const suffix = scalarSuffix(payload);

  if (!rows.length) return null;
  return (
    <div className="h-[390px] min-w-0" data-testid="cmv3-time-series">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 22, right: 24, left: 4, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isPanelDark ? '#334155' : '#E2E8F0'} />
          <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => formatClinicalDate(clinicalDateByX.get(Number(value))) || formatDay(value)} tick={{ fontSize: 12 }} />
          <YAxis unit={suffix} tick={{ fontSize: 12 }} />
          <Tooltip
            labelFormatter={(value) => formatDateTime(value)}
            formatter={(value: any, name: any) => [`${Number(value).toLocaleString('pt-BR')}${suffix}`, name]}
          />
          <Legend />
          {threshold !== null && (
            <ReferenceLine y={threshold} strokeDasharray="6 5" label={{ value: 'Critério', position: 'insideTopRight', fontSize: 11 }} />
          )}
          {segments.map((segment: any, index: number) => {
            const phase: any = phaseMap.get(String(segment?.phase_epoch_id || ''));
            return (
              <Line
                key={String(segment?.segment_id || index)}
                type="linear"
                dataKey={`segment_${index}`}
                name={safeText(phase?.label || phase?.phase_type, `Segmento ${index + 1}`)}
                stroke={lineColors[index % lineColors.length]}
                strokeWidth={2.5}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CompositionChart({ payload, isPanelDark }: { payload: any; isPanelDark: boolean }) {
  const points = observedPoints(payload);
  const rows = points.map((point) => {
    const categories = Array.isArray(point?.measurement?.categories) ? point.measurement.categories : [];
    const row: Record<string, any> = { id: point.id, label: point.clinical_date || formatDay(new Date(point.occurred_at).getTime()) };
    categories.forEach((item: any) => {
      const key = safeText(item.category_key || item.response_key, 'Outro');
      row[key] = Number(item.occurrence_count || 0);
    });
    return row;
  });
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !['id', 'label'].includes(key)))));
  if (!rows.length || !keys.length) return null;
  return (
    <div className="h-[340px] min-w-0" data-testid="cmv3-composition-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 18, right: 18, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isPanelDark ? '#334155' : '#E2E8F0'} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          {keys.map((key) => <Bar key={key} dataKey={key} stackId="composition" />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PromptComposition({ payload, isPanelDark }: { payload: any; isPanelDark: boolean }) {
  const items = (Array.isArray(payload?.data?.supplementary_representations) ? payload.data.supplementary_representations : [])
    .find((item: any) => item?.kind === 'PROMPT_COMPOSITION')?.items;
  if (!Array.isArray(items) || !items.length) return null;
  const pointById = new Map(observedPoints(payload).map((point) => [String(point.id), point]));
  const rowMap = new Map<string, Record<string, any>>();
  for (const item of items) {
    const expectationId = String(item.expectation_id || '');
    const point = pointById.get(expectationId);
    const row = rowMap.get(expectationId) || { id: expectationId, label: point?.clinical_date || formatDay(new Date(point?.occurred_at || 0).getTime()) };
    row[`Prompt ${String(item.prompt_level_id || '').slice(0, 6)}`] = Number(item.occurrence_count || 0);
    rowMap.set(expectationId, row);
  }
  const rows = Array.from(rowMap.values());
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !['id', 'label'].includes(key)))));
  if (!rows.length || !keys.length) return null;
  return (
    <div className={`mt-5 rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/50'}`}>
      <h4 className="text-sm font-semibold">Distribuição de prompts</h4>
      <p className={`mt-1 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>Contagens categóricas por sessão; nenhum prompt é convertido em score.</p>
      <div className="mt-3 h-[290px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 16, right: 14, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isPanelDark ? '#334155' : '#E2E8F0'} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {keys.map((key) => <Bar key={key} dataKey={key} stackId="prompt" />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OrdinalTimeline({ payload, isPanelDark }: { payload: any; isPanelDark: boolean }) {
  const points = observedPoints(payload).filter((point) => point?.measurement?.kind === 'ORDINAL');
  if (!points.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="cmv3-ordinal-series">
      {points.map((point) => (
        <div key={point.id} className={`rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/60'}`}>
          <p className={`text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>{point.clinical_date || formatDateTime(point.occurred_at)}</p>
          <p className="mt-2 text-sm">{safeText(point.measurement?.display_label || point.measurement?.level_key)}</p>
        </div>
      ))}
    </div>
  );
}

function TaskAnalysisMatrix({ payload, isPanelDark }: { payload: any; isPanelDark: boolean }) {
  const points = observedPoints(payload).filter((point) => point?.measurement?.kind === 'TASK_ANALYSIS');
  if (!points.length) return null;
  const stepNumbers = Array.from(new Set(points.flatMap((point) => (Array.isArray(point.measurement?.steps) ? point.measurement.steps : []).map((step: any) => Number(step.sequence_no || 0)).filter(Boolean)))).sort((a, b) => a - b);
  return (
    <div className="overflow-x-auto" data-testid="cmv3-task-analysis-matrix">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className={`sticky left-0 z-10 border-b p-3 text-left ${isPanelDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>Etapa</th>
            {points.map((point) => <th key={point.id} className={`border-b p-3 text-center ${isPanelDark ? 'border-slate-700' : 'border-slate-200'}`}>{point.clinical_date || formatDay(new Date(point.occurred_at).getTime())}</th>)}
          </tr>
        </thead>
        <tbody>
          {stepNumbers.map((sequence) => (
            <tr key={sequence}>
              <td className={`sticky left-0 border-b p-3 ${isPanelDark ? 'border-slate-800 bg-slate-900' : 'border-slate-100 bg-white'}`}>Etapa {sequence}</td>
              {points.map((point) => {
                const step = (Array.isArray(point.measurement?.steps) ? point.measurement.steps : []).find((item: any) => Number(item.sequence_no) === sequence);
                if (!step) return <td key={point.id} className={`border-b p-3 text-center ${isPanelDark ? 'border-slate-800 text-slate-500' : 'border-slate-100 text-slate-400'}`}>—</td>;
                return (
                  <td key={point.id} className={`border-b p-3 text-center ${isPanelDark ? 'border-slate-800' : 'border-slate-100'}`}>
                    <span className="whitespace-nowrap">A {Number(step.acquisition_independent_count || 0)}/{Number(step.acquisition_observation_count || 0)} · M {Number(step.maintenance_independent_count || 0)}/{Number(step.maintenance_observation_count || 0)} · P {Number(step.prompted_count || 0)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`mt-3 text-xs ${isPanelDark ? 'text-slate-400' : 'text-slate-500'}`}>A = aquisição independente/observada · M = manutenção independente/observada · P = respostas com prompt. A elegibilidade já vem resolvida pelo servidor.</p>
    </div>
  );
}

export function ClinicalMeasurementV3Panel({ patientId, isPanelDark = false }: Props) {
  const [targets, setTargets] = useState<CatalogTarget[]>([]);
  const [targetId, setTargetId] = useState('');
  const [definitionId, setDefinitionId] = useState('');
  const [days, setDays] = useState(90);
  const [payload, setPayload] = useState<any>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingView, setLoadingView] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingCatalog(true);
    setError('');
    void dataService.getClinicalMeasurementV3Catalog(patientId).then((result: any) => {
      if (cancelled) return;
      const nextTargets = Array.isArray(result?.data?.targets) ? result.data.targets : [];
      setTargets(nextTargets);
      const nextTarget = String(nextTargets[0]?.target_id || '');
      const nextDefinition = String(nextTargets[0]?.definitions?.[0]?.definition_id || '');
      setTargetId(nextTarget);
      setDefinitionId(nextDefinition);
      if (result?.success === false && result?.code !== 'feature_disabled') setError(result?.error || 'Não foi possível carregar as métricas clínicas V3.');
      setLoadingCatalog(false);
    });
    return () => { cancelled = true; };
  }, [patientId]);

  const selectedTarget = targets.find((target) => target.target_id === targetId) || null;
  const definitions = selectedTarget?.definitions || [];

  useEffect(() => {
    if (!targetId) return;
    if (!definitions.some((definition) => definition.definition_id === definitionId)) {
      setDefinitionId(String(definitions[0]?.definition_id || ''));
    }
  }, [targetId, definitionId, definitions]);

  useEffect(() => {
    if (!patientId || !targetId || !definitionId) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoadingView(true);
    setError('');
    void dataService.getClinicalMeasurementV3View(patientId, targetId, { definitionId, days }).then((result: any) => {
      if (cancelled) return;
      if (result?.success === false) {
        setPayload(null);
        setError(result?.error || 'Não foi possível carregar a visão clínica V3.');
      } else {
        setPayload(result?.data || null);
      }
      setLoadingView(false);
    });
    return () => { cancelled = true; };
  }, [patientId, targetId, definitionId, days]);

  const family = String(payload?.identity?.semantic_family || definitions.find((definition) => definition.definition_id === definitionId)?.semantic_family || '');
  const isScalar = ['COUNT', 'RATE', 'PROPORTION', 'DURATION', 'LATENCY', 'IRT', 'CONTINUOUS'].includes(family);
  const isComposition = ['INTERVAL', 'CATEGORICAL'].includes(family);
  const panel = isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900';
  const muted = isPanelDark ? 'text-slate-400' : 'text-slate-500';
  const states = payload?.states || {};
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const auditEvents = Array.isArray(payload?.audit_events) ? payload.audit_events : [];
  const direction = String(payload?.semantics?.interpretation?.directionality || 'NO_DIRECTIONAL_JUDGMENT');

  return (
    <section className={`rounded-3xl border p-4 sm:p-6 ${panel}`} data-testid="clinical-measurement-v3-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">Evolução clínica V3</h3>
            {payload?.authority?.level && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-700">{payload.authority.level}</span>}
            {payload?.provenance?.is_stale && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">Atualizando</span>}
          </div>
          <p className={`mt-1 max-w-3xl text-sm ${muted}`}>A linha respeita fases e famílias matemáticas. A interface não calcula média, maestria, elegibilidade, IOA ou agregação clínica.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-violet-600"><ShieldCheck size={15} /> Contrato semântico 3.2</div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr_160px]">
        <label className="text-sm">
          <span className={`mb-1 block ${muted}`}>Alvo</span>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className={`w-full rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
            {!targets.length && <option value="">Nenhum alvo V3 disponível</option>}
            {targets.map((target) => <option key={target.target_id} value={target.target_id}>{target.target_name}{target.specialty ? ` · ${target.specialty}` : ''}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className={`mb-1 block ${muted}`}>Mensuração</span>
          <select value={definitionId} onChange={(event) => setDefinitionId(event.target.value)} className={`w-full rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
            {definitions.map((definition) => <option key={definition.definition_id} value={definition.definition_id}>{definition.definition_key} · {familyLabels[definition.semantic_family] || definition.semantic_family}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className={`mb-1 block ${muted}`}>Período</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={`w-full rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-950' : 'border-slate-200 bg-white'}`}>
            <option value={30}>30 dias</option><option value={90}>90 dias</option><option value={180}>180 dias</option><option value={365}>365 dias</option>
          </select>
        </label>
      </div>

      {payload && (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className={`rounded-2xl border p-3 ${isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/70'}`}><p className={`text-xs ${muted}`}>Estado clínico</p><p className="mt-1 text-sm">{stateLabels[states.clinical_state] || safeText(states.clinical_state)}</p></div>
          <div className={`rounded-2xl border p-3 ${isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/70'}`}><p className={`text-xs ${muted}`}>Suporte da evidência</p><p className="mt-1 text-sm">{stateLabels[states.evidence_support_state] || safeText(states.evidence_support_state)}</p></div>
          <div className={`rounded-2xl border p-3 ${isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/70'}`}><p className={`text-xs ${muted}`}>Fluxo de trabalho</p><p className="mt-1 text-sm">{stateLabels[states.workflow_attention_state] || safeText(states.workflow_attention_state)}</p></div>
        </div>
      )}

      {error ? (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={18} /><span>{error}</span></div>
      ) : loadingCatalog || loadingView ? (
        <div className={`mt-5 h-[360px] animate-pulse rounded-2xl ${isPanelDark ? 'bg-slate-800' : 'bg-slate-100'}`} />
      ) : !payload ? (
        <div className={`mt-5 flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center ${isPanelDark ? 'border-slate-700' : 'border-slate-200'}`}>
          <Activity size={28} className={muted} /><p className="mt-3 text-sm">Ainda não há mensurações V3 disponíveis para este paciente.</p>
        </div>
      ) : (
        <div className="mt-5">
          <div className={`mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${muted}`}>
            <span className="inline-flex items-center gap-1.5"><Layers3 size={14} /> {familyLabels[family] || family}</span>
            <span className="inline-flex items-center gap-1.5"><GitBranch size={14} /> {directionLabels[direction] || direction}</span>
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} /> Ponto = sessão clínica</span>
          </div>

          {warnings.length > 0 && <div className="mb-4 space-y-2">{warnings.map((warning: any, index: number) => <div key={`${warning.code}-${index}`} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle size={15} className="mt-0.5" />{safeText(warning.message, warning.code)}</div>)}</div>}

          {isScalar && <ScalarTimeSeries payload={payload} isPanelDark={isPanelDark} />}
          {isComposition && <CompositionChart payload={payload} isPanelDark={isPanelDark} />}
          {family === 'ORDINAL' && <OrdinalTimeline payload={payload} isPanelDark={isPanelDark} />}
          {family === 'TASK_ANALYSIS' && <TaskAnalysisMatrix payload={payload} isPanelDark={isPanelDark} />}
          <PromptComposition payload={payload} isPanelDark={isPanelDark} />

          {auditEvents.length > 0 && (
            <div className={`mt-5 rounded-2xl border p-4 ${isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/60'}`}>
              <h4 className="text-sm font-semibold">Alterações conhecidas na evidência</h4>
              <div className="mt-3 space-y-2">
                {auditEvents.slice(0, 8).map((event: any) => <div key={event.id} className={`flex items-start gap-2 text-xs ${muted}`}><Info size={14} className="mt-0.5 shrink-0" /><span>{safeText(event.type)} · revisão {safeText(event.revision_number)} · {formatDateTime(event.recorded_at)}</span></div>)}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
