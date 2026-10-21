import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Database,
  History,
  Layers3,
  LineChart as LineChartIcon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dataService } from '../services/dataService';
import { invalidateClinicalAnalyticsPatient, useClinicalAnalyticsQuery } from '../services/clinicalAnalyticsQueryCache';
import {
  clinicalOutcomeBaselineValue,
  clinicalOutcomeContextLabel,
  clinicalOutcomeDirectionLabel,
  clinicalOutcomeEvidenceSampleLabel,
  clinicalOutcomeEvidenceLabel,
  clinicalOutcomeSourceLabel,
  clinicalOutcomeTargetReference,
  clinicalOutcomeUnitLabel,
  compareClinicalOutcomePeriods,
  formatClinicalValue,
  formatClinicalOutcomeValue,
  isClinicalOutcomeInterferingBehaviorSeries,
  summarizeClinicalOutcomePeriod,
  summarizeClinicalOutcomeSeries,
  type ClinicalOutcomeObservation,
  type ClinicalOutcomePeriodComparison,
  type ClinicalOutcomeSeriesSummary,
} from '../utils/clinicalOutcomeAnalytics';
import { hydratePtsClinicalPayloadFromPlan } from '../utils/ptsClinicalWorkspace';
import { buildClinicalOutcomePlanScopeIndex, clinicalOutcomeSeriesBelongsToPlanScope, unscopedBehaviorSeriesBelongsToSpecialty } from '../utils/clinicalOutcomePlanScope';
import { ClinicalPlanAnalyticsShell, type AnalyticsAxis, type ClinicalPlanShareDescriptor } from './ClinicalPlanAnalyticsShell';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type ClinicalOutcomesDashboardProps = {
  patientId: string;
  organizationId?: string | null;
  isPanelDark?: boolean;
  onOpenSessionReport?: (sessionId: string) => void;
  onShareDescriptorChange?: (descriptor: ClinicalPlanShareDescriptor | null) => void;
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
  const raw = String(value || '').trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? '-'
    : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const timeLabel = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const dateTime = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateFromKey = (value: string, endOfDay = false) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shiftDateKey = (value: string, days: number) => {
  const parsed = dateFromKey(value);
  if (!parsed) return '';
  parsed.setDate(parsed.getDate() + days);
  return localDateKey(parsed);
};

const inclusiveDaysBetween = (from: string, to: string) => {
  const start = dateFromKey(from);
  const end = dateFromKey(to);
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
};

const isObservationWithin = (observation: ClinicalOutcomeObservation, from: string, to: string) => {
  const observed = new Date(observation.observedAt);
  const start = dateFromKey(from);
  const end = dateFromKey(to, true);
  if (Number.isNaN(observed.getTime()) || !start || !end) return false;
  return observed >= start && observed <= end;
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

const trendMovement = (series: ClinicalOutcomeSeriesSummary) => {
  if (series.visualTrend === 'unknown' || series.visualTrend === 'stable') return series.visualTrend;
  if (series.direction === 'higher_is_better') return series.visualTrend === 'up' ? 'favorable' : 'unfavorable';
  if (series.direction === 'lower_is_better') return series.visualTrend === 'down' ? 'favorable' : 'unfavorable';
  return 'unknown';
};

const movementLabel = (comparison: ClinicalOutcomePeriodComparison | null) => {
  if (!comparison || comparison.delta === null) return 'Sem período anterior comparável';
  if (comparison.movement === 'favorable') return 'Movimento favorável no período';
  if (comparison.movement === 'unfavorable') return 'Movimento desfavorável no período';
  if (comparison.movement === 'stable') return 'Sem mudança relevante no período';
  return 'Variação sem julgamento clínico automático';
};

const phaseLabelForObservation = (observation: ClinicalOutcomeObservation | null | undefined) => {
  const label = clean(observation?.metadata?.phaseLabel || observation?.metadata?.phase_label);
  if (label) return label;
  const phaseType = clean(observation?.metadata?.phaseType || observation?.metadata?.phase_type || observation?.metadata?.targetPhase).toLowerCase();
  if (!phaseType) return '';
  const normalized = phaseType === 'teaching' ? 'intervention' : phaseType;
  return PHASE_LABELS[normalized] || phaseType;
};

const seriesDescription = (series: ClinicalOutcomeSeriesSummary) => {
  const targetDescription = clean(series.observations.find((row) => clean(row?.metadata?.targetDescription))?.metadata?.targetDescription);
  if (targetDescription) return targetDescription;
  const metric = clean(series.metricLabel || series.metricKey) || 'esta métrica clínica';
  return `Acompanha ${metric.toLocaleLowerCase('pt-BR')} ao longo das coletas comparáveis.`;
};

const formatSeriesAggregateValue = (series: ClinicalOutcomeSeriesSummary, value: number | null) => {
  if (value === null || !Number.isFinite(value)) return 'Sem dado comparável';
  return formatClinicalValue(value, series.unit);
};

const formatPtsGoalValue = (value: unknown, unit: unknown) => {
  const raw = clean(value);
  const normalizedUnit = clean(unit);
  if (!raw) return 'Não definida';
  if (!normalizedUnit || raw.toLocaleLowerCase('pt-BR').includes(normalizedUnit.toLocaleLowerCase('pt-BR'))) return raw;
  return `${raw} ${normalizedUnit}`;
};

const evidenceTone = (series: ClinicalOutcomeSeriesSummary, dark: boolean) => {
  if (series.stale) return dark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800';
  if (series.evidenceState === 'sufficient') return dark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (series.evidenceState === 'preliminary' || series.evidenceState === 'baseline_only') {
    return dark ? 'border-amber-400/35 bg-amber-400/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return dark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600';
};

type ClinicalTargetGroup = {
  key: string;
  title: string;
  description: string;
  phase: string;
  series: ClinicalOutcomeSeriesSummary[];
  clinicalSeries: ClinicalOutcomeSeriesSummary[];
  volumeSeries: ClinicalOutcomeSeriesSummary[];
  historicalSeries: ClinicalOutcomeSeriesSummary[];
  primarySeries: ClinicalOutcomeSeriesSummary;
};

const seriesTargetGroupKey = (series: ClinicalOutcomeSeriesSummary) => {
  const observation = series.observations[0];
  const semanticId = clean(observation?.metadata?.abaTargetId || observation?.metadata?.targetId)
    || clean(observation?.itemId)
    || clean(observation?.goalId)
    || clean(observation?.programId)
    || clean(series.itemLabel)
    || clean(series.metricLabel)
    || series.key;
  return `${seriesPlanId(series)}::${semanticId}`;
};

const isCollectionVolumeSeries = (series: ClinicalOutcomeSeriesSummary) => {
  const key = clean(series.metricKey).toUpperCase();
  const label = clean(series.metricLabel).toLocaleLowerCase('pt-BR');
  return key.includes('TRIAL_COUNT')
    || key.includes('OPPORTUNITY_COUNT')
    || key.includes('SESSION_COUNT')
    || key.includes('OBSERVATION_COUNT')
    || label.includes('tentativas registradas')
    || label === 'tentativas'
    || label === 'oportunidades'
    || label === 'sessões';
};

const isLegacyUnversionedSeries = (series: ClinicalOutcomeSeriesSummary) => series.observations.some((row) => clean(row?.metadata?.historyVersionStatus) === 'LEGACY_UNVERSIONED');

const isHistoricalOnlySeries = (series: ClinicalOutcomeSeriesSummary) => {
  const sourceLabel = clinicalOutcomeSourceLabel(series.source).toLocaleLowerCase('pt-BR');
  return sourceLabel.includes('histórico') && !sourceLabel.includes('v3 +');
};

const metricPriority = (series: ClinicalOutcomeSeriesSummary) => {
  const key = clean(series.metricKey).toUpperCase();
  const label = clean(series.metricLabel).toLocaleLowerCase('pt-BR');
  if (key.includes('PRIMARY_INDEPENDENCE') || label.includes('independência primária')) return 0;
  if (key.includes('INDEPENDENCE') || label === 'independência') return 1;
  if (key.includes('ACCURACY') || label.includes('acurácia')) return 2;
  if (key.includes('RATE')) return 3;
  if (key.includes('FREQUENCY')) return 4;
  if (key.includes('DURATION')) return 5;
  if (key.includes('LATENCY')) return 6;
  return 20;
};

const targetGroupDescription = (seriesRows: ClinicalOutcomeSeriesSummary[]) => {
  for (const series of seriesRows) {
    const description = clean(series.observations.find((row) => clean(row?.metadata?.targetDescription))?.metadata?.targetDescription);
    if (description) return description;
  }
  return '';
};

const buildClinicalTargetGroups = (seriesRows: ClinicalOutcomeSeriesSummary[]): ClinicalTargetGroup[] => {
  const grouped = new Map<string, ClinicalOutcomeSeriesSummary[]>();
  for (const series of seriesRows) {
    const key = seriesTargetGroupKey(series);
    grouped.set(key, [...(grouped.get(key) || []), series]);
  }
  return Array.from(grouped.entries()).map(([key, rows]) => {
    const ordered = rows.slice().sort((left, right) => {
      const evidenceWeight = (item: ClinicalOutcomeSeriesSummary) => item.evidenceState === 'sufficient' ? 0 : item.evidenceState === 'preliminary' ? 1 : 2;
      return Number(isHistoricalOnlySeries(left)) - Number(isHistoricalOnlySeries(right))
        || Number(isCollectionVolumeSeries(left)) - Number(isCollectionVolumeSeries(right))
        || evidenceWeight(left) - evidenceWeight(right)
        || metricPriority(left) - metricPriority(right)
        || clean(left.metricLabel).localeCompare(clean(right.metricLabel), 'pt-BR');
    });
    const nonHistoricalClinical = ordered.filter((series) => !isCollectionVolumeSeries(series) && !isHistoricalOnlySeries(series));
    const historicalSeries = ordered.filter(isHistoricalOnlySeries);
    const volumeSeries = ordered.filter(isCollectionVolumeSeries);
    const clinicalSeries = nonHistoricalClinical.length > 0
      ? nonHistoricalClinical
      : ordered.filter((series) => !isCollectionVolumeSeries(series));
    const primarySeries = clinicalSeries[0] || ordered[0];
    const latestSeries = ordered.slice().sort((left, right) => dateTime(right.latestObservation?.observedAt) - dateTime(left.latestObservation?.observedAt))[0] || primarySeries;
    const phase = phaseLabelForObservation(latestSeries?.latestObservation) || 'Fase não informada';
    const title = clean(primarySeries?.itemLabel) || clean(primarySeries?.metricLabel) || 'Alvo clínico';
    return {
      key,
      title,
      description: targetGroupDescription(ordered),
      phase,
      series: ordered,
      clinicalSeries,
      volumeSeries,
      historicalSeries,
      primarySeries,
    };
  }).sort((left, right) => {
    const leftDate = left.primarySeries.latestObservation?.observedAt || '';
    const rightDate = right.primarySeries.latestObservation?.observedAt || '';
    return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title, 'pt-BR');
  });
};

const periodResultLabel = (series: ClinicalOutcomeSeriesSummary) => {
  const stats = summarizeClinicalOutcomePeriod(series);
  return stats.meanValue === null ? formatClinicalOutcomeValue(series.latestObservation) : formatSeriesAggregateValue(series, stats.meanValue);
};

const periodEvidenceLabel = (series: ClinicalOutcomeSeriesSummary) => {
  const stats = summarizeClinicalOutcomePeriod(series);
  const countLabel = stats.sessionCount > 0
    ? `${stats.sessionCount} ${stats.sessionCount === 1 ? 'sessão' : 'sessões'}`
    : `${stats.observationCount} ${stats.observationCount === 1 ? 'registro' : 'registros'}`;
  if (stats.denominatorTotal !== null && stats.denominatorTotal > 0) {
    const denominator = Math.round(stats.denominatorTotal);
    const numerator = stats.numeratorTotal !== null ? Math.round(stats.numeratorTotal) : null;
    const opportunityLabel = `${denominator} ${denominator === 1 ? 'oportunidade' : 'oportunidades'}`;
    return numerator !== null ? `${numerator} de ${opportunityLabel} · ${countLabel}` : `${opportunityLabel} · ${countLabel}`;
  }
  return countLabel;
};

const comparisonTone = (comparison: ClinicalOutcomePeriodComparison | null, dark: boolean) => {
  if (!comparison || comparison.delta === null || comparison.movement === 'unknown') {
    return dark ? 'border-slate-700 bg-slate-900/60 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600';
  }
  if (comparison.movement === 'favorable') return dark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (comparison.movement === 'unfavorable') return dark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700';
  return dark ? 'border-slate-700 bg-slate-900/60 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600';
};

function SeriesChart({ series, isDark, axis, compact = false }: { series: ClinicalOutcomeSeriesSummary; isDark: boolean; axis: AnalyticsAxis; compact?: boolean }) {
  const categoricalLabels = Array.from(new Set(
    series.observations
      .filter((observation) => !observation.missingReason && (observation.value === null || observation.value === undefined || !Number.isFinite(Number(observation.value))))
      .map((observation) => clean(observation.valueText))
      .filter(Boolean),
  ));
  const categoricalMode = categoricalLabels.length > 0 && !series.observations.some((observation) => observation.value !== null && observation.value !== undefined && Number.isFinite(Number(observation.value)));
  const categoryIndex = new Map(categoricalLabels.map((label, index) => [label, index]));
  const numericValues = series.validObservations
    .map((observation) => observation.value)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  const yAxisTitle = categoricalMode ? 'Categoria' : clinicalOutcomeUnitLabel(series.unit, series.metricKey, numericValues);
  const percentMode = yAxisTitle === 'Percentual (%)';
  const ratioMode = yAxisTitle === 'Pontuação (0–1)';
  const reference = clinicalOutcomeTargetReference(series);
  const baselineValue = categoricalMode ? null : clinicalOutcomeBaselineValue(series);

  const orderedObservations = series.observations.slice().sort((left, right) => dateTime(left.observedAt) - dateTime(right.observedAt));
  const sessionOrder = new Map<string, { index: number; label: string }>();
  for (const observation of orderedObservations) {
    const identity = clean(observation.sessionId) || `obs:${observation.id}`;
    if (sessionOrder.has(identity)) continue;
    const index = sessionOrder.size;
    const explicitLabel = clean(observation.metadata?.sessionLabel || observation.metadata?.session_label);
    sessionOrder.set(identity, { index, label: explicitLabel || `Sessão ${index + 1}` });
  }
  const observationX = (observation: ClinicalOutcomeObservation) => {
    if (axis === 'date') return dateLabel(observation.observedAt);
    const identity = clean(observation.sessionId) || `obs:${observation.id}`;
    return sessionOrder.get(identity)?.label || `Sessão ${Math.max(1, sessionOrder.size)}`;
  };

  const rows = orderedObservations.flatMap((observation, index, observations) => {
    const categoricalValue = clean(observation.valueText);
    const x = observationX(observation);
    const row = {
      observedAt: observation.observedAt,
      x,
      date: dateLabel(observation.observedAt),
      value: observation.missingReason
        ? null
        : categoricalMode
          ? categoryIndex.get(categoricalValue) ?? null
          : observation.value,
      valueText: categoricalValue,
      display: formatClinicalOutcomeValue(observation),
      missingReason: observation.missingReason,
      isSegmentBoundary: false,
      observation,
    };
    if (index === 0) return [row];
    const previous = observations[index - 1];
    const previousPhase = clean(previous?.metadata?.phaseAssignmentId || previous?.metadata?.phaseType || (previous?.instrumentId === 'ABA_V3_PHASE' ? previous?.instrumentVersion : ''));
    const currentPhase = clean(observation?.metadata?.phaseAssignmentId || observation?.metadata?.phaseType || (observation?.instrumentId === 'ABA_V3_PHASE' ? observation?.instrumentVersion : ''));
    if (!previousPhase || !currentPhase || previousPhase === currentPhase) return [row];
    return [{
      observedAt: observation.observedAt,
      x,
      date: dateLabel(observation.observedAt),
      value: null,
      valueText: '',
      display: 'Mudança de fase',
      missingReason: null,
      isSegmentBoundary: true,
      observation: null,
    }, row];
  });

  const renderedPointCount = rows.filter((row) => row.value !== null && row.value !== undefined).length;
  const chartHeight = compact
    ? 112
    : renderedPointCount <= 3
      ? 138
      : renderedPointCount <= 6
        ? 152
        : 168;

  const phaseMarkers: Array<{ x: string; label: string }> = [];
  let previousPhaseKey = '';
  for (const observation of orderedObservations) {
    const phaseKey = clean(observation?.metadata?.phaseAssignmentId || observation?.metadata?.phaseType || (observation?.instrumentId === 'ABA_V3_PHASE' ? observation?.instrumentVersion : ''));
    const label = phaseLabelForObservation(observation);
    if (!phaseKey || !label || phaseKey === previousPhaseKey) continue;
    phaseMarkers.push({ x: observationX(observation), label });
    previousPhaseKey = phaseKey;
  }

  return (
    <div style={{ height: chartHeight }} data-axis={axis}>
      <SafeResponsiveContainer width="100%" height="100%" minHeight={chartHeight}>
        <LineChart data={rows} margin={{ top: compact ? 8 : 12, right: 10, left: compact ? -14 : 2, bottom: compact ? 4 : 6 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
          <XAxis
            dataKey="x"
            height={compact ? 22 : 28}
            tick={{ fontSize: compact ? 9 : 10 }}
            tickMargin={compact ? 4 : 6}
            minTickGap={18}
            stroke={isDark ? '#94A3B8' : '#64748B'}
          />
          <YAxis
            tick={{ fontSize: compact ? 9 : 10 }}
            width={categoricalMode ? (compact ? 64 : 86) : (compact ? 38 : 54)}
            stroke={isDark ? '#94A3B8' : '#64748B'}
            domain={categoricalMode
              ? [0, Math.max(0, categoricalLabels.length - 1)]
              : percentMode
                ? [0, 100]
                : ratioMode
                  ? [0, 1]
                  : undefined}
            ticks={categoricalMode ? categoricalLabels.map((_, index) => index) : undefined}
            tickFormatter={categoricalMode
              ? (value) => categoricalLabels[Number(value)] || ''
              : percentMode
                ? (value) => `${value}%`
                : undefined}
            label={compact ? undefined : { value: yAxisTitle, angle: -90, position: 'insideLeft', offset: 4, fontSize: 9 }}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row: any = payload?.[0]?.payload;
              const observation: ClinicalOutcomeObservation | null = row?.observation || null;
              if (!active || !row || row.isSegmentBoundary || !observation) return null;
              const phase = phaseLabelForObservation(observation);
              return (
                <div className={`max-w-sm rounded-xl border px-3 py-2.5 text-xs shadow-lg ${isDark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}>
                  <p className="font-semibold">{series.itemLabel || 'Métrica clínica'}</p>
                  <p className={`mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>{series.metricLabel}</p>
                  <div className="mt-2 space-y-1">
                    {axis === 'session' && <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Sessão:</span> {row.x}</p>}
                    <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Data:</span> {row.date}</p>
                    <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Resultado:</span> {row.missingReason ? 'Dado não coletado' : row.display}</p>
                    {observation.numerator !== null && observation.numerator !== undefined && observation.denominator !== null && observation.denominator !== undefined && Number(observation.denominator) > 0 && (
                      <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Base:</span> {observation.numerator} de {observation.denominator} oportunidades</p>
                    )}
                    {phase && <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Fase:</span> {phase}</p>}
                    {timeLabel(observation.observedAt) && <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Horário:</span> {timeLabel(observation.observedAt)}</p>}
                    {clean(observation.context) && <p><span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Contexto:</span> {clinicalOutcomeContextLabel(observation.context)}</p>}
                  </div>
                </div>
              );
            }}
          />
          {!categoricalMode && reference.targetMin !== null && reference.targetMax !== null && (
            <ReferenceArea y1={reference.targetMin} y2={reference.targetMax} label={{ value: 'Faixa-alvo', fontSize: 9 }} />
          )}
          {!categoricalMode && reference.targetValue !== null && (
            <ReferenceLine y={reference.targetValue} stroke={isDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="6 4" label={{ value: reference.criterionLabel || 'Meta', fontSize: 9, position: 'insideTopRight' }} />
          )}
          {!categoricalMode && baselineValue !== null && (
            <ReferenceLine y={baselineValue} stroke={isDark ? '#64748B' : '#94A3B8'} strokeDasharray="2 5" label={{ value: 'Linha de base', fontSize: 9, position: 'insideBottomRight' }} />
          )}
          {!compact && phaseMarkers.map((marker, index) => (
            <ReferenceLine
              key={`${marker.x}-${marker.label}-${index}`}
              x={marker.x}
              stroke={isDark ? '#64748B' : '#CBD5E1'}
              strokeDasharray="2 4"
              label={{ value: marker.label, fontSize: 8, position: 'insideTopLeft' }}
            />
          ))}
          <Line type="linear" dataKey="value" stroke={isDark ? '#A78BFA' : '#6D4AFF'} strokeWidth={2.25} dot={{ r: compact ? 2.25 : 3 }} activeDot={{ r: 4.5 }} connectNulls={false} />
        </LineChart>
      </SafeResponsiveContainer>
    </div>
  );
}

export function ClinicalOutcomesDashboard({ patientId, organizationId = null, isPanelDark = false, onOpenSessionReport, onShareDescriptorChange }: ClinicalOutcomesDashboardProps) {
  const today = useMemo(() => localDateKey(new Date()), []);
  const [periodPreset, setPeriodPreset] = useState('90');
  const [customDateFrom, setCustomDateFrom] = useState(() => shiftDateKey(today, -89));
  const [customDateTo, setCustomDateTo] = useState(today);
  const [comparePrevious, setComparePrevious] = useState(false);
  const [scopeId, setScopeId] = useState('pts');
  const [contextFilter, setContextFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [analyticsAxis, setAnalyticsAxis] = useState<AnalyticsAxis>('session');
  const [expandedTargetKeys, setExpandedTargetKeys] = useState<string[]>([]);
  const [activeSeriesKeys, setActiveSeriesKeys] = useState<Record<string, string>>({});
  const [evidenceDetailsOpen, setEvidenceDetailsOpen] = useState<Record<string, boolean>>({});

  const periodRange = useMemo(() => {
    const presetDays = periodPreset === 'custom' ? 0 : Number(periodPreset);
    const currentTo = periodPreset === 'custom' ? customDateTo : today;
    const currentFrom = periodPreset === 'custom'
      ? customDateFrom
      : shiftDateKey(currentTo, -(Math.max(1, presetDays) - 1));
    const currentDays = inclusiveDaysBetween(currentFrom, currentTo);
    const previousTo = currentDays > 0 ? shiftDateKey(currentFrom, -1) : '';
    const previousFrom = currentDays > 0 ? shiftDateKey(currentFrom, -currentDays) : '';
    const loadFrom = comparePrevious ? previousFrom : currentFrom;
    const totalDays = inclusiveDaysBetween(loadFrom, currentTo);
    return {
      currentFrom,
      currentTo,
      currentDays,
      previousFrom,
      previousTo,
      loadFrom,
      loadTo: currentTo,
      totalDays,
      valid: currentDays > 0 && totalDays > 0 && totalDays <= 730,
    };
  }, [comparePrevious, customDateFrom, customDateTo, periodPreset, today]);

  useEffect(() => {
    const handleClinicalOutcomeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ patientId?: string }>).detail;
      if (!detail?.patientId || String(detail.patientId) === String(patientId)) {
        invalidateClinicalAnalyticsPatient(patientId, 'all');
      }
    };
    window.addEventListener('verto:clinical-outcomes-changed', handleClinicalOutcomeChange as EventListener);
    return () => window.removeEventListener('verto:clinical-outcomes-changed', handleClinicalOutcomeChange as EventListener);
  }, [patientId]);

  const dashboardQuery = useClinicalAnalyticsQuery<any>({
    organizationId,
    patientId,
    family: 'clinical-outcomes-dashboard',
    params: {
      dateFrom: periodRange.loadFrom,
      dateTo: periodRange.loadTo,
      days: periodRange.totalDays,
    },
  }, async () => {
    const response = await dataService.getClinicalOutcomesDashboard(patientId, {
      dateFrom: periodRange.loadFrom,
      dateTo: periodRange.loadTo,
      days: periodRange.totalDays,
    });
    if (!response?.success) throw new Error(response?.message || response?.error || 'Não foi possível carregar os gráficos clínicos.');
    return response;
  }, { enabled: periodRange.valid, staleMs: 30_000, keepPreviousData: true });

  const [committedPeriodRange, setCommittedPeriodRange] = useState(periodRange);
  useEffect(() => {
    if (dashboardQuery.data && !dashboardQuery.isPreviousData) setCommittedPeriodRange(periodRange);
  }, [dashboardQuery.data, dashboardQuery.isPreviousData, periodRange]);
  const effectivePeriodRange = dashboardQuery.isPreviousData ? committedPeriodRange : periodRange;
  const data: DashboardData = dashboardQuery.data?.success
    ? { ...EMPTY_DATA, ...(dashboardQuery.data.data || {}) }
    : EMPTY_DATA;
  const loading = dashboardQuery.isLoading;
  const refreshing = dashboardQuery.isRefreshing || dashboardQuery.isPreviousData;
  const error = !periodRange.valid
    ? 'Escolha um período válido. Com comparação, a janela total não pode ultrapassar 730 dias.'
    : dashboardQuery.error;

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
  const currentObservations = useMemo(() => filteredObservations.filter((row) => (
    isObservationWithin(row, effectivePeriodRange.currentFrom, effectivePeriodRange.currentTo)
  )), [filteredObservations, effectivePeriodRange.currentFrom, effectivePeriodRange.currentTo]);
  const previousObservations = useMemo(() => comparePrevious
    ? filteredObservations.filter((row) => isObservationWithin(row, effectivePeriodRange.previousFrom, effectivePeriodRange.previousTo))
    : [], [comparePrevious, filteredObservations, effectivePeriodRange.previousFrom, effectivePeriodRange.previousTo]);
  const summaries = useMemo(() => summarizeClinicalOutcomeSeries(currentObservations), [currentObservations]);
  const previousSummaries = useMemo(() => summarizeClinicalOutcomeSeries(previousObservations), [previousObservations]);
  const previousSummaryByKey = useMemo(() => new Map(previousSummaries.map((series) => [series.key, series])), [previousSummaries]);
  const planScopeIndex = useMemo(() => buildClinicalOutcomePlanScopeIndex(data.programs || []), [data.programs]);
  const selectedPlan = specialtyPlans.find((plan) => String(plan.id) === scopeId) || null;
  const selectedPlanSeries = useMemo(() => selectedPlan
    ? summaries.filter((series) =>
      clinicalOutcomeSeriesBelongsToPlanScope(series, selectedPlan.id, planScopeIndex)
      || unscopedBehaviorSeriesBelongsToSpecialty(series, selectedPlan.specialty)
    )
    : [], [planScopeIndex, selectedPlan, summaries]);
  const ptsPlanSeries = useMemo(() => activePts
    ? summaries.filter((series) => clinicalOutcomeSeriesBelongsToPlanScope(series, activePts.id, planScopeIndex))
    : [], [activePts, planScopeIndex, summaries]);
  const allSelectedTargetGroups = useMemo(() => buildClinicalTargetGroups(selectedPlanSeries), [selectedPlanSeries]);
  const selectedTargetGroups = useMemo(() => allSelectedTargetGroups.filter((group) => group.clinicalSeries.length > 0), [allSelectedTargetGroups]);
  const volumeOnlyTargetGroups = useMemo(() => allSelectedTargetGroups.filter((group) => group.clinicalSeries.length === 0 && group.volumeSeries.length > 0), [allSelectedTargetGroups]);
  useEffect(() => {
    const validKeys = new Set(selectedTargetGroups.map((group) => group.key));
    setExpandedTargetKeys((current) => current.filter((key) => validKeys.has(key)).slice(-2));
    setActiveSeriesKeys((current) => {
      const next: Record<string, string> = {};
      for (const group of selectedTargetGroups) {
        const currentSeriesKey = current[group.key];
        next[group.key] = group.clinicalSeries.some((series) => series.key === currentSeriesKey)
          ? currentSeriesKey
          : group.primarySeries.key;
      }
      return next;
    });
    setEvidenceDetailsOpen((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => validKeys.has(key)),
    ));
  }, [selectedTargetGroups]);

  const toggleTarget = (group: ClinicalTargetGroup) => {
    setExpandedTargetKeys((current) => {
      if (current.includes(group.key)) return current.filter((key) => key !== group.key);
      return [...current, group.key].slice(-2);
    });
    setActiveSeriesKeys((current) => ({
      ...current,
      [group.key]: current[group.key] || group.primarySeries.key,
    }));
    setEvidenceDetailsOpen((current) => ({ ...current, [group.key]: false }));
  };

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

  const ptsAnalyticsSeries = useMemo(() => {
    const unique = new Map<string, ClinicalOutcomeSeriesSummary>();
    // The canonical read model is the evidence authority. Structured PTS goals and
    // contribution links organize that evidence when present, but never gate visibility.
    for (const series of ptsPlanSeries) {
      if (!isHistoricalOnlySeries(series)) unique.set(series.key, series);
    }
    for (const row of ptsGoalRows) {
      for (const contribution of row.contributions) {
        for (const series of contribution.series) {
          if (!isHistoricalOnlySeries(series)) unique.set(series.key, series);
        }
      }
    }
    // A PTS goal may explicitly link a specialty plan even when historical
    // observations reference only that plan (without the PTS goal id).
    // Reuse the already authorized canonical series; never infer links from
    // a matching specialty name or read another patient's/clinic's data.
    const linkedPlanIds = new Set(ptsGoalRows.flatMap((row) => row.contributions
      .filter((contribution) => Boolean(contribution.link && contribution.specialtyPlan?.id))
      .map((contribution) => String(contribution.specialtyPlan.id))));
    if (linkedPlanIds.size > 0) {
      for (const series of summaries) {
        if (isHistoricalOnlySeries(series)) continue;
        if (Array.from(linkedPlanIds).some((id) => clinicalOutcomeSeriesBelongsToPlanScope(series, id, planScopeIndex))) {
          unique.set(series.key, series);
        }
      }
    }
    // Comportamentos interferentes são evidência longitudinal do paciente e não
    // pertencem semanticamente a uma especialidade. Na visão multidisciplinar do PTS,
    // preserve-os mesmo quando o legado ainda não carrega planId/goalId/programId.
    // A autoridade/origem permanece explícita na própria série; não inferimos vínculo.
    for (const series of summaries) {
      if (isClinicalOutcomeInterferingBehaviorSeries(series)) unique.set(series.key, series);
    }
    return Array.from(unique.values());
  }, [planScopeIndex, ptsGoalRows, ptsPlanSeries, summaries]);
  const ptsUnstructuredTargetGroups = useMemo(() => (
    buildClinicalTargetGroups(ptsAnalyticsSeries).filter((group) => group.clinicalSeries.length > 0)
  ), [ptsAnalyticsSeries]);
  const analyticsSeries = scopeId === 'pts'
    ? ptsAnalyticsSeries
    : selectedPlanSeries.filter((series) => !isHistoricalOnlySeries(series));
  const analyticsScopeLabel = scopeId === 'pts'
    ? 'PTS · visão multidisciplinar'
    : `${clean(selectedPlan?.specialty) || 'Plano da especialidade'} · v${selectedPlan?.edit_version || 1}`;

  const panel = isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const inset = isPanelDark ? 'border-slate-700 bg-slate-950/40' : 'border-slate-200 bg-slate-50/70';
  const brandPanel = isPanelDark
    ? 'border-violet-500/25 bg-gradient-to-br from-violet-500/10 via-[#101b2e] to-cyan-500/5'
    : 'border-violet-200/80 bg-gradient-to-br from-violet-50/90 via-white to-cyan-50/55';
  const structuralAccent = isPanelDark ? 'bg-violet-400/80' : 'bg-violet-600';
  const text = isPanelDark ? 'text-slate-100' : 'text-slate-900';
  const muted = isPanelDark ? 'text-slate-400' : 'text-slate-500';
  const activeFilterCount = Number(contextFilter !== 'all') + Number(sourceFilter !== 'all');

  if (loading) {
    return <div className={`flex min-h-[420px] items-center justify-center rounded-3xl border ${panel}`}><RefreshCw className="animate-spin text-violet-500" size={26} /></div>;
  }

  return (
    <section className="space-y-4" data-testid="clinical-outcomes-dashboard" data-query-refreshing={refreshing ? 'true' : 'false'}>
      <header className={`relative overflow-hidden rounded-2xl border p-3 sm:p-4 ${brandPanel}`}>
        <div aria-hidden="true" className={`absolute inset-x-0 top-0 h-0.5 ${structuralAccent}`} />
        <div className="relative flex flex-col gap-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 flex-1">
              <p className={`text-[10px] font-medium uppercase tracking-[0.14em] ${isPanelDark ? 'text-violet-300' : 'text-violet-600'}`}>Evidências clínicas</p>
              {refreshing && <p className={`mt-1 text-[10px] ${muted}`}>Atualizando em segundo plano sem remover a evidência já carregada…</p>}
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <label className="min-w-0 flex-1 sm:max-w-sm">
                  <span className="sr-only">Visão clínica</span>
                  <select
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    className={`h-11 w-full rounded-xl border px-3 text-sm font-semibold sm:h-10 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}
                  >
                    {activePts && <option value="pts">Visão do PTS</option>}
                    {specialtyPlans.map((plan) => <option key={plan.id} value={String(plan.id)}>{clean(plan.specialty) || 'Plano da especialidade'} · v{plan.edit_version || 1}</option>)}
                  </select>
                </label>
                <p className={`hidden max-w-2xl text-xs xl:block ${muted}`}>
                  {selectedPlan
                    ? 'Evolução por alvo, mantendo resultado, tamanho da evidência e tempo no mesmo contexto.'
                    : 'Contribuições multidisciplinares explicáveis, sem calcular média entre métricas incompatíveis.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end" aria-label="Controles da visão clínica">
              <label className="sm:hidden">
                <span className="sr-only">Período clínico</span>
                <select
                  value={periodPreset}
                  onChange={(event) => setPeriodPreset(event.target.value)}
                  className={`h-11 min-w-[84px] rounded-xl border px-3 text-sm font-medium ${periodPreset !== 'custom'
                    ? isPanelDark ? 'border-violet-400/60 bg-violet-500/10 text-violet-200' : 'border-teal-300 bg-teal-50 text-teal-800'
                    : isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  <option value="7">7d</option>
                  <option value="30">30d</option>
                  <option value="90">90d</option>
                  <option value="180">6m</option>
                  <option value="365">1a</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>

              <div className="hidden flex-wrap items-center gap-1.5 sm:flex" aria-label="Período clínico">
                {[
                  ['7', '7d'],
                  ['30', '30d'],
                  ['90', '90d'],
                  ['180', '6m'],
                  ['365', '1a'],
                  ['custom', 'Personalizado'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={periodPreset === value}
                    onClick={() => setPeriodPreset(value)}
                    className={`min-h-10 rounded-xl border px-3 text-xs font-medium transition ${periodPreset === value
                      ? isPanelDark ? 'border-violet-400/60 bg-violet-500/12 text-violet-200' : 'border-teal-300 bg-teal-50 text-teal-800'
                      : isPanelDark
                        ? 'border-slate-700 bg-slate-900 text-slate-300 hover:border-violet-500/60'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                aria-pressed={comparePrevious}
                onClick={() => setComparePrevious((current) => !current)}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-medium transition sm:min-h-10 ${comparePrevious
                  ? 'border-violet-500 bg-violet-600 text-white shadow-sm'
                  : isPanelDark
                    ? 'border-slate-700 bg-slate-900 text-slate-300'
                    : 'border-slate-200 bg-white text-slate-700'}`}
              >
                <span className="sm:hidden">{comparePrevious ? '✓ Comparando' : 'Comparar'}</span>
                <span className="hidden sm:inline">{comparePrevious ? '✓ Comparando período anterior' : 'Comparar período anterior'}</span>
              </button>

              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((current) => !current)}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition sm:min-h-10 ${filtersOpen || activeFilterCount > 0
                  ? isPanelDark ? 'border-violet-500/45 bg-violet-500/10 text-violet-200' : 'border-violet-200 bg-violet-50 text-violet-800'
                  : isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-700'}`}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                Filtros{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
              </button>
            </div>
          </div>

          {periodPreset === 'custom' && (
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
              <label className={`text-xs ${muted}`}>Data inicial<input type="date" value={customDateFrom} max={customDateTo || today} onChange={(event) => setCustomDateFrom(event.target.value)} className={`mt-1.5 h-11 w-full rounded-xl border px-3 text-sm sm:h-10 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`} /></label>
              <label className={`text-xs ${muted}`}>Data final<input type="date" value={customDateTo} min={customDateFrom} max={today} onChange={(event) => setCustomDateTo(event.target.value)} className={`mt-1.5 h-11 w-full rounded-xl border px-3 text-sm sm:h-10 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`} /></label>
            </div>
          )}

          {(contextFilter !== 'all' || sourceFilter !== 'all') && (
            <div className="flex flex-wrap gap-2" aria-label="Filtros clínicos ativos">
              {contextFilter !== 'all' && (
                <button type="button" onClick={() => setFiltersOpen(true)} className={`inline-flex min-h-10 items-center rounded-xl border px-3 text-xs ${inset}`}>
                  Contexto: {clinicalOutcomeContextLabel(contextFilter)}
                </button>
              )}
              {sourceFilter !== 'all' && (
                <button type="button" onClick={() => setFiltersOpen(true)} className={`inline-flex min-h-10 items-center rounded-xl border px-3 text-xs ${inset}`}>
                  Origem: {clinicalOutcomeSourceLabel(sourceFilter)}
                </button>
              )}
            </div>
          )}

          <p className={`text-[11px] ${muted}`}>Período atual: {dateLabel(periodRange.currentFrom)} a {dateLabel(periodRange.currentTo)}{comparePrevious ? ` · período anterior: ${dateLabel(periodRange.previousFrom)} a ${dateLabel(periodRange.previousTo)}` : ''}</p>
        </div>
      </header>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!data.schemaAvailable && (
        <div className={`flex items-start gap-3 rounded-2xl border p-4 ${isPanelDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <Database size={20} className="mt-0.5 shrink-0" />
          <div><p className="text-sm font-medium">Estrutura de resultados multidisciplinares ainda não disponível</p><p className="mt-1 text-xs leading-5">Os registros históricos continuam preservados. As séries por especialidade aparecem quando existe uma fonte clínica estruturada e autorizada para o plano.</p></div>
        </div>
      )}

      {filtersOpen && (
        <section className={`rounded-2xl border p-4 ${isPanelDark ? 'border-violet-500/20 bg-violet-500/5' : 'border-violet-100 bg-violet-50/55'}`} aria-label="Filtros avançados">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
            <label className={`text-xs ${muted}`}>Contexto<select value={contextFilter} onChange={(event) => setContextFilter(event.target.value)} className={`mt-1.5 h-11 w-full rounded-xl border px-3 text-sm sm:h-10 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}><option value="all">Todos os contextos</option>{contexts.map((item) => <option key={item} value={item}>{clinicalOutcomeContextLabel(item)}</option>)}</select></label>
            <label className={`text-xs ${muted}`}>Origem da evidência<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className={`mt-1.5 h-11 w-full rounded-xl border px-3 text-sm sm:h-10 ${isPanelDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800'}`}><option value="all">Todas as origens</option>{sources.map((item) => <option key={item} value={item}>{clinicalOutcomeSourceLabel(item)}</option>)}</select></label>
            <div className={`flex min-h-11 items-center gap-2 self-end rounded-xl border px-3 text-xs sm:min-h-10 ${inset}`}><ShieldCheck size={16} className="text-emerald-500" /> Ausência de dados nunca vira zero</div>
            {selectedPlan && volumeOnlyTargetGroups.length > 0 && (
              <div className={`sm:col-span-2 lg:col-span-3 rounded-xl border px-3 py-2.5 text-xs ${inset}`}>
                {volumeOnlyTargetGroups.length} alvo(s) possuem apenas volume de coleta neste período. Tentativas e oportunidades ficam preservadas, mas não são apresentadas como resultado clínico.
              </div>
            )}
          </div>
        </section>
      )}

      {analyticsSeries.length > 0 && (
        <ClinicalPlanAnalyticsShell
          key={`${patientId}:${scopeId}`}
          scopeLabel={analyticsScopeLabel}
          series={analyticsSeries}
          previousSeriesByKey={previousSummaryByKey}
          comparePrevious={comparePrevious}
          axis={analyticsAxis}
          onAxisChange={setAnalyticsAxis}
          isDark={isPanelDark}
          onOpenSessionReport={onOpenSessionReport}
          onShareDescriptorChange={onShareDescriptorChange}
          programs={data.programs || []}
        />
      )}

      {scopeId === 'pts' ? (
        <div className="space-y-4">
          {!activePts ? (
            <div className={`rounded-3xl border p-8 text-center ${panel}`}><Layers3 className="mx-auto text-slate-300" /><p className={`mt-3 text-sm ${muted}`}>Nenhum PTS visível para este paciente.</p></div>
          ) : ptsGoalRows.length === 0 ? (
            ptsUnstructuredTargetGroups.length > 0 ? (
              <section className={`rounded-3xl border p-5 ${panel}`} data-testid="pts-canonical-unstructured-evidence">
                <div className="flex items-start gap-3">
                  <Target className="mt-0.5 shrink-0 text-violet-500" size={20} />
                  <div>
                    <p className={`text-sm font-semibold ${text}`}>Evidências clínicas do PTS</p>
                    <p className={`mt-1 text-xs leading-5 ${muted}`}>O PTS ainda não possui objetivos compartilhados estruturados. As evidências canônicas continuam visíveis por alvo e métrica, sem inferir automaticamente uma especialidade.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 lg:grid-cols-2" data-testid="pts-canonical-target-list">
                  {ptsUnstructuredTargetGroups.map((group) => {
                    const series = group.primarySeries;
                    return (
                      <div key={group.key} className={`rounded-2xl border p-3 ${inset}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`truncate text-sm font-semibold ${text}`}>{group.title}</p>
                            <p className={`mt-1 text-[11px] ${muted}`}>{series.metricLabel} · {clinicalOutcomeEvidenceSampleLabel(series)} · {group.phase}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${evidenceTone(series, isPanelDark)}`}>{series.stale ? 'Sem evidência recente' : clinicalOutcomeEvidenceLabel(series.evidenceState)}</span>
                        </div>
                        <p className={`mt-2 text-xs ${muted}`}>Atual: <span className={text}>{formatClinicalOutcomeValue(series.latestObservation)}</span></p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className={`rounded-3xl border p-8 text-center ${panel}`}><Target className="mx-auto text-slate-300" /><p className={`mt-3 text-sm ${muted}`}>O PTS ainda não possui objetivos compartilhados estruturados nem evidência clínica canônica neste período.</p></div>
            )
          ) : ptsGoalRows.map(({ goal, contributions }) => {
            const evidenceCount = contributions.reduce((sum, contribution) => sum + contribution.series.length, 0);
            const evidenceSpecialties = contributions.filter((contribution) => contribution.series.length > 0).length;
            const favorableSpecialties = contributions.filter((contribution) => {
              const movements = contribution.series
                .filter((series) => series.evidenceState === 'sufficient')
                .map(trendMovement)
                .filter((movement) => movement === 'favorable' || movement === 'unfavorable');
              return movements.length > 0 && movements.includes('favorable') && !movements.includes('unfavorable');
            }).length;
            const comparableSpecialties = contributions.filter((contribution) => contribution.series.some((series) => series.evidenceState === 'sufficient' && ['favorable', 'unfavorable'].includes(String(trendMovement(series))))).length;
            const stale = contributions.some((contribution) => contribution.series.some((series) => series.stale));
            return (
              <article key={goal.id} className={`rounded-3xl border p-5 ${panel}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-lg font-semibold ${text}`}>{goal.title}</h3><span className={`rounded-full border px-2.5 py-1 text-xs ${inset}`}>{GOAL_STATUS_LABELS[goal.status] || goal.status}</span>{stale && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">Evidência desatualizada</span>}</div>{goal.description && <p className={`mt-2 text-sm leading-6 ${muted}`}>{goal.description}</p>}<p className={`mt-2 text-xs ${muted}`}>{evidenceSpecialties} de {contributions.length} especialidade(s) com evidência estruturada{comparableSpecialties > 0 ? ` · ${favorableSpecialties} de ${comparableSpecialties} com tendência favorável entre as comparáveis` : ''}. Nenhuma média global é calculada.</p></div>
                  <div className={`grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 rounded-2xl border px-4 py-3 text-xs ${inset}`}><span className={muted}>Linha de base</span><span className={text}>{formatPtsGoalValue(goal.baseline, goal.unit)}</span><span className={muted}>Meta do PTS</span><span className={text}>{formatPtsGoalValue(goal.target, goal.unit)}</span><span className={muted}>Prazo</span><span className={text}>{goal.dueDate ? dateLabel(goal.dueDate) : 'Não definido'}</span><span className={muted}>Séries clínicas</span><span className={text}>{evidenceCount}</span></div>
                </div>
                <div className="mt-5 grid gap-3 xl:grid-cols-2">
                  {contributions.length === 0 ? (
                    <div className={`rounded-2xl border border-dashed p-4 ${inset}`}><p className={`text-sm ${text}`}>Nenhuma contribuição por especialidade foi vinculada.</p><p className={`mt-1 text-xs leading-5 ${muted}`}>O sistema não cria uma média nem associa métricas por semelhança de texto. Vincule explicitamente as metas dos planos individuais ao objetivo compartilhado.</p></div>
                  ) : contributions.map((contribution) => (
                    <div key={`${goal.id}-${contribution.specialty}`} className={`rounded-2xl border p-4 ${inset}`}>
                      <div className="flex items-start justify-between gap-3"><div><p className={`text-sm font-semibold ${text}`}>{contribution.specialty}</p><p className={`mt-1 text-xs ${muted}`}>{contribution.link ? 'Contribuição vinculada ao PTS' : 'Contribuição esperada, ainda sem vínculo explícito'}</p></div>{contribution.link?.contribution_type === 'required' && <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700">Obrigatória</span>}</div>
                      {contribution.series.length > 0 ? contribution.series.map((series) => {
                        const comparison = comparePrevious ? compareClinicalOutcomePeriods(series, previousSummaryByKey.get(series.key)) : null;
                        return (
                          <div key={series.key} className="mt-3 rounded-xl border border-slate-200/70 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-950/30">
                            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className={`truncate text-xs font-semibold ${text}`}>{series.itemLabel || series.metricLabel}</p>{series.itemLabel && series.itemLabel !== series.metricLabel && <p className={`mt-0.5 text-[11px] ${muted}`}>{series.metricLabel} · {clinicalOutcomeUnitLabel(series.unit, series.metricKey, series.validObservations.map((row) => row.value))}</p>}<p className={`mt-1 text-[11px] ${muted}`}>{clinicalOutcomeEvidenceSampleLabel(series)}</p></div><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${evidenceTone(series, isPanelDark)}`}>{series.stale ? 'Sem evidência recente' : clinicalOutcomeEvidenceLabel(series.evidenceState)}</span></div>
                            <div className={`mt-3 grid gap-1 text-xs ${muted}`}><p>Atual: <span className={text}>{formatClinicalOutcomeValue(series.latestObservation)}</span></p><p>Leitura comparativa disponível no gráfico acima.</p>{comparison && <p>Comparação: <span className={text}>{comparison.deltaLabel}</span> · {movementLabel(comparison)}</p>}</div>
                          </div>
                        );
                      }) : <div className={`mt-3 rounded-xl border border-dashed p-4 text-xs leading-5 ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Sem evidência estruturada vinculada a esta contribuição. Isso não significa ausência de progresso.</div>}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : selectedPlan ? (
        <div className="space-y-4">
          {selectedTargetGroups.length === 0 ? (
            <div className={`rounded-3xl border p-8 text-center ${panel}`}>
              <LineChartIcon className="mx-auto text-slate-300" size={30} />
              <p className={`mt-3 text-sm ${text}`}>Ainda não há alvos clínicos com evidência neste período.</p>
              <p className={`mx-auto mt-2 max-w-xl text-xs leading-5 ${muted}`}>As evidências permanecem separadas por métrica e unidade. Registros de outras especialidades não são misturados.</p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="clinical-target-list">
              {selectedTargetGroups.map((group) => {
                const isExpanded = expandedTargetKeys.includes(group.key);
                const activeSeriesKey = activeSeriesKeys[group.key];
                const series = isExpanded
                  ? group.clinicalSeries.find((item) => item.key === activeSeriesKey) || group.primarySeries
                  : group.primarySeries;
                const comparison = comparePrevious ? compareClinicalOutcomePeriods(series, previousSummaryByKey.get(series.key)) : null;
                const reference = isExpanded ? clinicalOutcomeTargetReference(series) : null;
                const baseline = isExpanded ? clinicalOutcomeBaselineValue(series) : null;
                const yAxisTitle = isExpanded
                  ? clinicalOutcomeUnitLabel(series.unit, series.metricKey, series.validObservations.map((row) => row.value))
                  : '';
                const currentStats = isExpanded ? summarizeClinicalOutcomePeriod(series) : null;
                const previousStats = comparison?.previous || null;
                const legacyRows = isExpanded && group.series.some((item) => !isHistoricalOnlySeries(item) && !isCollectionVolumeSeries(item))
                  ? group.historicalSeries
                  : [];
                const detailsOpen = evidenceDetailsOpen[group.key] === true;

                return (
                  <article
                    key={group.key}
                    className={`relative overflow-hidden rounded-2xl border transition ${isExpanded
                      ? isPanelDark
                        ? 'border-violet-400/55 bg-gradient-to-br from-violet-500/8 via-slate-900/80 to-cyan-500/5 ring-1 ring-violet-500/20'
                        : 'border-violet-200 bg-gradient-to-br from-violet-50/55 via-white to-cyan-50/35 ring-1 ring-violet-100'
                      : isPanelDark
                        ? 'border-slate-700 bg-slate-900/85 hover:border-violet-500/45'
                        : 'border-slate-200 bg-white hover:border-violet-200 hover:shadow-sm'}`}
                    data-testid="clinical-target-card"
                  >
                    <div aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${series.evidenceState === 'sufficient' ? 'bg-emerald-400' : series.evidenceState === 'preliminary' || series.evidenceState === 'baseline_only' ? 'bg-amber-400' : 'bg-violet-400'}`} />

                    <button
                      type="button"
                      onClick={() => toggleTarget(group)}
                      aria-expanded={isExpanded}
                      aria-controls={`clinical-target-detail-${group.key}`}
                      className="flex min-h-14 w-full items-start justify-between gap-3 px-3 py-3 pl-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500/40 sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={`text-base font-semibold ${text}`}>{group.title}</h3>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${evidenceTone(series, isPanelDark)}`}>
                            {series.stale ? 'Sem evidência recente' : clinicalOutcomeEvidenceLabel(series.evidenceState)}
                          </span>
                          {isLegacyUnversionedSeries(series) && <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500">Histórico sem versão</span>}
                          {group.historicalSeries.length > 0 && group.series.some((item) => !isHistoricalOnlySeries(item) && !isCollectionVolumeSeries(item)) && (
                            <span title="Histórico anterior disponível" className={`inline-flex items-center gap-1 text-[10px] ${isPanelDark ? 'text-slate-500' : 'text-slate-400'}`}>
                              <History size={11} /> Histórico
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={`text-[11px] ${muted}`}>{series.metricLabel}</span>
                          <span className={`text-[11px] ${muted}`}>· {periodEvidenceLabel(series)}</span>
                          <span className={`text-[11px] ${muted}`}>· {group.phase}</span>
                          <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${isPanelDark ? 'text-violet-300' : 'text-violet-700'}`}>
                            · {isExpanded ? <>Recolher <ChevronUp size={13} /></> : <>Ver evidência <ChevronDown size={13} /></>}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`text-2xl font-semibold tracking-tight ${text}`}>{periodResultLabel(series)}</span>
                        {comparison && comparison.delta !== null && (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${comparisonTone(comparison, isPanelDark)}`}>{comparison.deltaLabel}</span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div
                        id={`clinical-target-detail-${group.key}`}
                        data-testid="clinical-target-detail"
                        className={`border-t px-3 pb-3 pt-2.5 sm:px-4 ${isPanelDark ? 'border-slate-800' : 'border-slate-100'}`}
                      >
                        <span className="sr-only">Evidência aberta</span>
                        {group.description && <p className={`mb-2 text-xs leading-4 ${muted}`}>{group.description}</p>}

                        {group.clinicalSeries.length > 1 && (
                          <div className={`mb-2 border-b ${isPanelDark ? 'border-slate-800' : 'border-slate-200'}`}>
                            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Métricas clínicas do alvo">
                              {group.clinicalSeries.map((item) => (
                                <button
                                  key={item.key}
                                  type="button"
                                  role="tab"
                                  aria-selected={item.key === series.key}
                                  onClick={() => {
                                    setActiveSeriesKeys((current) => ({ ...current, [group.key]: item.key }));
                                    setEvidenceDetailsOpen((current) => ({ ...current, [group.key]: false }));
                                  }}
                                  className={`min-h-9 border-b-2 px-2.5 py-1.5 text-xs font-medium transition ${item.key === series.key
                                    ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                                    : `border-transparent ${muted} hover:text-violet-600`}`}
                                >
                                  {item.metricLabel}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {comparison && (
                          <div className={`mb-2 grid grid-cols-3 divide-x rounded-xl border ${isPanelDark ? 'divide-slate-700 border-violet-500/20 bg-violet-500/5' : 'divide-violet-100 border-violet-100 bg-gradient-to-r from-violet-50/60 via-white to-cyan-50/45'}`}>
                            <div className="min-w-0 px-2 py-2 sm:px-3"><p className={`text-[10px] ${muted}`}>Atual</p><p className={`mt-0.5 truncate text-sm font-semibold ${text}`}>{formatSeriesAggregateValue(series, comparison.current.meanValue)}</p></div>
                            <div className="min-w-0 px-2 py-2 sm:px-3"><p className={`text-[10px] ${muted}`}>Anterior</p><p className={`mt-0.5 truncate text-sm font-semibold ${text}`}>{formatSeriesAggregateValue(series, comparison.previous.meanValue)}</p></div>
                            <div className="min-w-0 px-2 py-2 sm:px-3"><p className={`text-[10px] ${muted}`}>Variação</p><p className={`mt-0.5 truncate text-sm font-semibold ${comparison.movement === 'favorable' ? 'text-emerald-600 dark:text-emerald-300' : comparison.movement === 'unfavorable' ? 'text-rose-600 dark:text-rose-300' : text}`}>{comparison.deltaLabel}</p></div>
                          </div>
                        )}

                        <SeriesChart series={series} isDark={isPanelDark} axis={analyticsAxis} />

                        {reference && (baseline !== null || reference.targetValue !== null || reference.targetMin !== null || reference.targetMax !== null) && (
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                            {baseline !== null && <span className={`rounded-lg border px-2.5 py-1.5 ${isPanelDark ? 'border-slate-600 bg-slate-800/70 text-slate-200' : 'border-slate-200 bg-slate-100/80 text-slate-700'}`}>Linha de base <strong className={text}>{formatSeriesAggregateValue(series, baseline)}</strong></span>}
                            {reference.targetValue !== null && <span className={`rounded-lg border px-2.5 py-1.5 ${isPanelDark ? 'border-violet-500/35 bg-violet-500/10 text-violet-200' : 'border-violet-200 bg-violet-50 text-violet-800'}`}>Meta <strong className={text}>{reference.criterionLabel || formatSeriesAggregateValue(series, reference.targetValue)}</strong></span>}
                            {reference.targetValue === null && reference.targetMin !== null && reference.targetMax !== null && <span className={`rounded-lg border px-2.5 py-1.5 ${isPanelDark ? 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200' : 'border-cyan-200 bg-cyan-50 text-cyan-800'}`}>Faixa-alvo <strong className={text}>{formatSeriesAggregateValue(series, reference.targetMin)} a {formatSeriesAggregateValue(series, reference.targetMax)}</strong></span>}
                          </div>
                        )}

                        {currentStats && (
                          <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border px-3 py-2 text-[11px] ${inset}`} data-testid="clinical-evidence-compact-meta">
                            <span className={muted}>Unidade <strong className={text}>{yAxisTitle}</strong></span>
                            <span className={muted}>Direção <strong className={text}>{clinicalOutcomeDirectionLabel(series.direction)}</strong></span>
                            <span className={muted}>Comparáveis <strong className={text}>{currentStats.observationCount}</strong></span>
                            <span className={muted}>Ausências <strong className={text}>{series.missingCount}</strong></span>
                            {group.volumeSeries.map((item) => (
                              <span key={item.key} className={`rounded-lg border px-2 py-1 ${panel}`}>
                                {item.metricLabel}: <strong>{periodResultLabel(item)}</strong> · {periodEvidenceLabel(item)}
                              </span>
                            ))}
                            {series.evidenceState !== 'sufficient' && (
                              <button
                                type="button"
                                aria-expanded={detailsOpen}
                                onClick={() => setEvidenceDetailsOpen((current) => ({ ...current, [group.key]: !detailsOpen }))}
                                className={`inline-flex items-center gap-1 font-medium ${isPanelDark ? 'text-amber-200' : 'text-amber-800'}`}
                              >
                                <CircleHelp size={13} /> {detailsOpen ? 'Ocultar contexto' : 'Qualidade da evidência'}
                              </button>
                            )}
                          </div>
                        )}

                        {detailsOpen && series.evidenceState !== 'sufficient' && (
                          <div className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${isPanelDark ? 'border-amber-400/20 bg-amber-400/5 text-amber-100' : 'border-amber-200 bg-amber-50/60 text-amber-900'}`}>
                            <CircleHelp size={14} className="mt-0.5 shrink-0" />
                            <span><strong>Qualidade da evidência:</strong> ainda há poucas observações comparáveis para interpretar tendência com segurança. O resultado permanece disponível para acompanhamento clínico.</span>
                          </div>
                        )}

                        {legacyRows.length > 0 && (
                          <details className={`mt-2 rounded-xl border ${inset}`}>
                            <summary className={`flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs ${text}`}>
                              <span className="flex items-center gap-2"><History size={14} className="text-slate-400" /> Histórico anterior disponível <span className={muted}>· {legacyRows.length} série(s)</span></span>
                              <ChevronDown size={16} className="transition [details[open]_&]:rotate-180" />
                            </summary>
                            <div className={`border-t p-3 ${isPanelDark ? 'border-slate-700' : 'border-slate-200'}`}>
                              <p className={`text-xs leading-5 ${muted}`}>Esses registros foram coletados pelo modelo anterior de mensuração. Eles são preservados para contexto histórico e não são combinados matematicamente com a evidência atual.</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {legacyRows.map((item) => (
                                  <span key={item.key} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${panel}`}><strong className={text}>{item.metricLabel}</strong> · <span className={muted}>{periodResultLabel(item)} · {periodEvidenceLabel(item)}</span></span>
                                ))}
                              </div>
                            </div>
                          </details>
                        )}

                        {comparePrevious && comparison && previousStats && comparison.delta === null && (
                          <p className={`mt-3 text-xs ${muted}`}>Não há período anterior comparável para esta métrica.</p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className={`rounded-3xl border p-8 text-center ${panel}`}><AlertTriangle className="mx-auto text-amber-500" /><p className={`mt-3 text-sm ${muted}`}>Selecione um plano disponível.</p></div>
      )}
    </section>
  );
}
