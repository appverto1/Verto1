import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, ArrowRight, BadgeCheck, CalendarDays, Layers3, Target, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  clinicalOutcomeUnitLabel,
  formatClinicalValue,
  isClinicalOutcomeInterferingBehaviorSeries,
  type ClinicalOutcomeObservation,
  type ClinicalOutcomeSeriesSummary,
} from '../utils/clinicalOutcomeAnalytics';
import { buildClinicalProgramChangeOverview, type ClinicalTargetChange } from '../utils/clinicalProgramChangeAnalytics';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { PtsClusteredSpecialtyProgress } from './PtsClusteredSpecialtyProgress';
import { buildPtsClusteredSpecialtyMetrics, type PtsChartSpecialtyPlan } from '../utils/ptsClusteredSpecialtyProgress';
import type { ClinicalOutcomePlanScopeIndex } from '../utils/clinicalOutcomePlanScope';

type AnalyticsDomain = 'overview' | 'skills' | 'behaviors' | 'mastery' | 'maintenance' | 'changes';
export type AnalyticsAxis = 'date' | 'session';

export type ClinicalPlanShareDescriptor = {
  schemaVersion: 1;
  family: 'PLAN_PTS';
  domain: 'overview' | 'skills' | 'behaviors' | 'mastery' | 'maintenance';
  planIds?: string[];
  metricSignature: string;
  seriesKeys: string[];
  axis: AnalyticsAxis;
  comparePrevious: boolean;
  allowedDomains?: Array<'skills' | 'behaviors' | 'mastery' | 'maintenance'>;
};

type ClinicalPlanAnalyticsShellProps = {
  key?: React.Key;
  scopeLabel: string;
  series: ClinicalOutcomeSeriesSummary[];
  previousSeriesByKey: Map<string, ClinicalOutcomeSeriesSummary>;
  comparePrevious: boolean;
  axis: AnalyticsAxis;
  onAxisChange: (axis: AnalyticsAxis) => void;
  isDark?: boolean;
  onOpenSessionReport?: (sessionId: string) => void;
  onShareDescriptorChange?: (descriptor: ClinicalPlanShareDescriptor | null) => void;
  programs?: any[];
  ptsSpecialtyPlans?: PtsChartSpecialtyPlan[];
  ptsPlanScopeIndex?: ClinicalOutcomePlanScopeIndex;
  shareControl?: React.ReactNode;
};

type MetricOption = {
  signature: string;
  label: string;
  unitLabel: string;
  series: ClinicalOutcomeSeriesSummary[];
};

type ChartBucket = {
  key: string;
  label: string;
  detail: string;
  sortTime: number;
  period: 'current' | 'previous';
  sessionIds: string[];
};

const DOMAIN_TABS: Array<{ id: AnalyticsDomain; label: string }> = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'skills', label: 'Habilidades' },
  { id: 'behaviors', label: 'Comportamentos interferentes' },
  { id: 'mastery', label: 'Maestria' },
  { id: 'maintenance', label: 'Manutenção' },
  { id: 'changes', label: 'Mudanças por sessão' },
];

const DOMAIN_COLORS = {
  skills: ['#10B981', '#0D9488', '#34D399'],
  behaviors: ['#0EA5E9', '#0284C7', '#38BDF8'],
  mastery: ['#8B5CF6', '#7C3AED', '#A78BFA'],
  maintenance: ['#F59E0B', '#D97706', '#FBBF24'],
  alerts: ['#EF4444', '#DC2626', '#FB7185'],
} as const;

const OVERVIEW_BARS = [
  { key: 'skills', label: 'Habilidades', color: DOMAIN_COLORS.skills[0] },
  { key: 'behaviors', label: 'Comportamentos interferentes', color: DOMAIN_COLORS.behaviors[0] },
  { key: 'mastery', label: 'Maestria', color: DOMAIN_COLORS.mastery[0] },
  { key: 'maintenance', label: 'Manutenção', color: DOMAIN_COLORS.maintenance[0] },
  { key: 'alerts', label: 'Regressão/alertas', color: DOMAIN_COLORS.alerts[0] },
] as const;

type OverviewDomainKey = typeof OVERVIEW_BARS[number]['key'];

const OVERVIEW_Y_AXIS_MIN = 10;
const OVERVIEW_Y_AXIS_TOP = 8;
const OVERVIEW_Y_AXIS_BOTTOM = 62;

const niceCountAxis = (maxValue: number) => {
  const safeMax = Math.max(OVERVIEW_Y_AXIS_MIN, Math.ceil(Number(maxValue) || 0));
  const roughStep = safeMax / 4;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, roughStep)));
  const normalized = roughStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2.5 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, multiplier * magnitude);
  const max = Math.max(OVERVIEW_Y_AXIS_MIN, Math.ceil(safeMax / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return { max, ticks };
};

const overviewDomainLabel = (keys: OverviewDomainKey[]) => {
  const labels = OVERVIEW_BARS.filter((item) => keys.includes(item.key)).map((item) => item.label);
  if (labels.length === 0) return 'Todos os domínios';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
};

const DOMAIN_ACTIVE_TONE: Record<AnalyticsDomain, string> = {
  overview: 'border-violet-600 bg-violet-50 text-[#7a32fc] shadow-sm ring-1 ring-violet-100',
  skills: 'border-violet-600 bg-violet-50 text-[#7a32fc] shadow-sm ring-1 ring-violet-100',
  behaviors: 'border-violet-600 bg-violet-50 text-[#7a32fc] shadow-sm ring-1 ring-violet-100',
  mastery: 'border-violet-600 bg-violet-50 text-[#7a32fc] shadow-sm ring-1 ring-violet-100',
  maintenance: 'border-violet-600 bg-violet-50 text-[#7a32fc] shadow-sm ring-1 ring-violet-100',
  changes: 'border-violet-600 bg-violet-50 text-[#7a32fc] shadow-sm ring-1 ring-violet-100',
};

const DOMAIN_ACTIVE_TONE_DARK = 'border-violet-400 bg-violet-500/10 text-violet-200 shadow-sm ring-1 ring-violet-400/20';

const DOMAIN_SOFT_TONE: Record<Exclude<AnalyticsDomain, 'overview'>, string> = {
  skills: 'border-emerald-700 bg-emerald-600 text-white shadow-sm dark:border-emerald-400 dark:bg-emerald-500 dark:text-slate-950',
  behaviors: 'border-sky-700 bg-sky-600 text-white shadow-sm dark:border-sky-400 dark:bg-sky-500 dark:text-slate-950',
  mastery: 'border-violet-700 bg-violet-600 text-white shadow-sm dark:border-violet-400 dark:bg-violet-500 dark:text-white',
  maintenance: 'border-amber-700 bg-amber-500 text-slate-950 shadow-sm dark:border-amber-300 dark:bg-amber-400 dark:text-slate-950',
  changes: 'border-fuchsia-700 bg-fuchsia-600 text-white shadow-sm dark:border-fuchsia-400 dark:bg-fuchsia-500 dark:text-white',
};

const clean = (value: unknown) => String(value || '').trim();
const timestamp = (value: unknown) => {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};
const localDateKey = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const shortDate = (value: string) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const fullDate = (value: string) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const sessionDateTimeLabel = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const sessionDateTimeDetail = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const isRegressionAlertSeries = (series: ClinicalOutcomeSeriesSummary) => {
  const key = clean(series.metricKey).toUpperCase();
  const label = clean(series.metricLabel).toLocaleLowerCase('pt-BR');
  return key.includes('REGRESSION') || key.includes('ALERT') || key.includes('RISK') || label.includes('regress') || label.includes('alerta');
};

const analyticsDomainForSeries = (series: ClinicalOutcomeSeriesSummary): Exclude<AnalyticsDomain, 'overview' | 'changes'> => {
  const key = clean(series.metricKey).toUpperCase();
  const label = clean(series.metricLabel).toLocaleLowerCase('pt-BR');
  if (key.includes('MASTERY') || label.includes('maestria') || label.includes('domínio')) return 'mastery';
  if (key.includes('MAINTENANCE') || key.includes('REGRESSION') || label.includes('manutenção') || label.includes('regress')) return 'maintenance';
  if (isClinicalOutcomeInterferingBehaviorSeries(series)) return 'behaviors';
  return 'skills';
};

const metricPriority = (series: ClinicalOutcomeSeriesSummary) => {
  const key = clean(series.metricKey).toUpperCase();
  if (key.includes('PRIMARY_INDEPENDENCE')) return 0;
  if (key.includes('INDEPENDENCE')) return 1;
  if (key.includes('ACCURACY')) return 2;
  if (key.includes('FREQUENCY')) return 3;
  if (key.includes('DURATION_EPISODES')) return 4;
  if (key.includes('DURATION_TOTAL')) return 5;
  if (key.includes('DURATION_AVG')) return 6;
  if (key.includes('INTERVAL')) return 7;
  if (key.includes('TRIAL') || key.includes('ATTEMPT')) return 8;
  return 20;
};

const metricSignature = (series: ClinicalOutcomeSeriesSummary) => {
  const sample = series.observations[0];
  const instrumentId = clean(sample?.instrumentId);
  const instrumentVersion = instrumentId === 'ABA_V3_PHASE' ? '' : clean(sample?.instrumentVersion);
  return [
    clean(series.metricKey),
    clean(series.unit),
    clean(series.direction),
    instrumentId,
    instrumentVersion,
    String(Number(sample?.definitionVersion || 1)),
  ].join('::');
};

const numericRows = (series: ClinicalOutcomeSeriesSummary) => series.validObservations.filter((row) => row.value !== null && row.value !== undefined && Number.isFinite(Number(row.value)));
const supportsSessionChange = (series: ClinicalOutcomeSeriesSummary) => numericRows(series).length >= 2;

const metricOptionsForDomain = (seriesRows: ClinicalOutcomeSeriesSummary[], domain: AnalyticsDomain): MetricOption[] => {
  const eligible = seriesRows.filter((series) => {
    if (domain === 'changes') return supportsSessionChange(series);
    return analyticsDomainForSeries(series) === domain;
  });
  const grouped = new Map<string, ClinicalOutcomeSeriesSummary[]>();
  for (const series of eligible) {
    const signature = metricSignature(series);
    grouped.set(signature, [...(grouped.get(signature) || []), series]);
  }
  return Array.from(grouped.entries()).map(([signature, rows]) => ({
    signature,
    label: rows[0]?.metricLabel || rows[0]?.metricKey || 'Métrica clínica',
    unitLabel: clinicalOutcomeUnitLabel(rows[0]?.unit, rows[0]?.metricKey, rows.flatMap((item) => item.validObservations.map((row) => row.value))),
    series: rows.slice().sort((left, right) => metricPriority(left) - metricPriority(right) || clean(left.itemLabel).localeCompare(clean(right.itemLabel), 'pt-BR')),
  })).sort((left, right) => metricPriority(left.series[0]) - metricPriority(right.series[0]) || left.label.localeCompare(right.label, 'pt-BR'));
};

const bucketAggregation = (series: ClinicalOutcomeSeriesSummary, rows: ClinicalOutcomeObservation[]) => {
  const numeric = rows
    .map((row) => Number(row.value))
    .filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  const unit = clean(series.unit);
  const key = clean(series.metricKey).toUpperCase();
  const ratioTotals = () => {
    let numerator = 0;
    let denominator = 0;
    let hasRatio = false;
    for (const row of rows) {
      const rowNumerator = Number(row.numerator);
      const rowDenominator = Number(row.denominator);
      if (Number.isFinite(rowNumerator) && Number.isFinite(rowDenominator) && rowDenominator > 0) {
        numerator += rowNumerator;
        denominator += rowDenominator;
        hasRatio = true;
      }
    }
    return hasRatio && denominator > 0 ? { numerator, denominator } : null;
  };
  if (unit === '%') {
    const ratio = ratioTotals();
    if (ratio) return (ratio.numerator / ratio.denominator) * 100;
  }
  if (key.includes('RATE') || unit === 'eventos/h') {
    const ratio = ratioTotals();
    if (ratio) return (ratio.numerator * 3600) / ratio.denominator;
  }
  if (key.includes('DURATION_AVG')) {
    const ratio = ratioTotals();
    if (ratio) return ratio.numerator / ratio.denominator;
  }
  if (key.includes('_MAX')) return Math.max(...numeric);
  if (
    key.includes('TRIAL_COUNT')
    || key.includes('ATTEMPT')
    || key.includes('VALID_ATTEMPTS')
    || key.includes('DURATION_EPISODES')
    || key.includes('DURATION_TOTAL')
    || key.includes('FREQUENCY') && !key.includes('RATE')
    || key.includes('FAILURE')
    || key.endsWith('_COUNT')
  ) return numeric.reduce((sum, value) => sum + value, 0);
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const sessionIdentity = (observation: ClinicalOutcomeObservation) => clean(observation.sessionId) || `obs:${observation.id}`;
const sessionDisplayLabel = (observation: ClinicalOutcomeObservation) => sessionDateTimeLabel(observation.observedAt);
const abaSessionStartTimestamp = (sessionId: unknown) => {
  const match = clean(sessionId).match(/-(\d{13})$/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
};
const overviewSessionAnchorTimestamp = (observation: ClinicalOutcomeObservation) => (
  abaSessionStartTimestamp(observation.sessionId) || timestamp(observation.observedAt)
);
const overviewSessionMinuteTimestamp = (observation: ClinicalOutcomeObservation) => {
  const anchor = overviewSessionAnchorTimestamp(observation);
  return anchor > 0 ? Math.floor(anchor / 60_000) * 60_000 : 0;
};
const reportableAbaSessionId = (observation: ClinicalOutcomeObservation) => {
  const sessionId = clean(observation.sessionId);
  return abaSessionStartTimestamp(sessionId) > 0 ? sessionId : '';
};

const collectBuckets = (
  selectedSeries: ClinicalOutcomeSeriesSummary[],
  previousSeriesByKey: Map<string, ClinicalOutcomeSeriesSummary>,
  comparePrevious: boolean,
  axis: AnalyticsAxis,
) => {
  const rows: Array<{ observation: ClinicalOutcomeObservation; period: 'current' | 'previous' }> = [];
  for (const series of selectedSeries) {
    rows.push(...series.validObservations.map((observation) => ({ observation, period: 'current' as const })));
    if (comparePrevious) {
      const previous = previousSeriesByKey.get(series.key);
      if (previous) rows.push(...previous.validObservations.map((observation) => ({ observation, period: 'previous' as const })));
    }
  }
  rows.sort((left, right) => timestamp(left.observation.observedAt) - timestamp(right.observation.observedAt));

  const sessionOrder = new Map<string, { index: number; label: string; detail: string; sortTime: number }>();
  for (const row of rows) {
    const id = sessionIdentity(row.observation);
    if (sessionOrder.has(id)) continue;
    const index = sessionOrder.size;
    sessionOrder.set(id, {
      index,
      label: sessionDisplayLabel(row.observation),
      detail: sessionDateTimeDetail(row.observation.observedAt),
      sortTime: timestamp(row.observation.observedAt),
    });
  }

  const buckets = new Map<string, ChartBucket>();
  for (const row of rows) {
    const dateKey = localDateKey(row.observation.observedAt);
    const session = sessionOrder.get(sessionIdentity(row.observation));
    const baseKey = axis === 'session' ? sessionIdentity(row.observation) : dateKey;
    const key = `${row.period}::${baseKey}`;
    if (buckets.has(key)) continue;
    buckets.set(key, {
      key,
      label: axis === 'session' ? (session?.label || sessionDateTimeLabel(row.observation.observedAt)) : shortDate(dateKey),
      detail: axis === 'session' ? (session?.detail || sessionDateTimeDetail(row.observation.observedAt)) : fullDate(dateKey),
      sortTime: axis === 'session' ? (session?.sortTime || timestamp(row.observation.observedAt)) : timestamp(`${dateKey}T12:00:00`),
      period: row.period,
      sessionIds: [],
    });
  }
  for (const row of rows) {
    const dateKey = localDateKey(row.observation.observedAt);
    const baseKey = axis === 'session' ? sessionIdentity(row.observation) : dateKey;
    const bucket = buckets.get(`${row.period}::${baseKey}`);
    const sessionId = clean(row.observation.sessionId);
    if (bucket && sessionId && !bucket.sessionIds.includes(sessionId)) bucket.sessionIds.push(sessionId);
  }
  return Array.from(buckets.values()).sort((left, right) => left.sortTime - right.sortTime);
};

const chartRowsForSeries = (
  selectedSeries: ClinicalOutcomeSeriesSummary[],
  previousSeriesByKey: Map<string, ClinicalOutcomeSeriesSummary>,
  comparePrevious: boolean,
  axis: AnalyticsAxis,
  changesMode: boolean,
) => {
  const buckets = collectBuckets(selectedSeries, previousSeriesByKey, comparePrevious, axis);
  const rows = buckets.map((bucket) => ({
    x: bucket.label,
    xDetail: bucket.detail,
    period: bucket.period,
    sortTime: bucket.sortTime,
    sessionId: bucket.sessionIds.length === 1 ? bucket.sessionIds[0] : null,
  } as Record<string, any>));
  const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.key, index]));

  selectedSeries.forEach((series, seriesIndex) => {
    const currentKey = `current_${seriesIndex}`;
    const previousKey = `previous_${seriesIndex}`;
    const apply = (source: ClinicalOutcomeSeriesSummary | undefined, period: 'current' | 'previous', dataKey: string) => {
      if (!source) return;
      const grouped = new Map<string, ClinicalOutcomeObservation[]>();
      for (const observation of source.validObservations) {
        const baseKey = axis === 'session' ? sessionIdentity(observation) : localDateKey(observation.observedAt);
        const key = `${period}::${baseKey}`;
        grouped.set(key, [...(grouped.get(key) || []), observation]);
      }
      for (const [key, observations] of grouped.entries()) {
        const index = bucketIndex.get(key);
        if (index === undefined) continue;
        rows[index][dataKey] = bucketAggregation(source, observations);
      }
    };
    apply(series, 'current', currentKey);
    if (comparePrevious) apply(previousSeriesByKey.get(series.key), 'previous', previousKey);
  });

  if (changesMode) {
    selectedSeries.forEach((_, seriesIndex) => {
      for (const dataKey of [`current_${seriesIndex}`, `previous_${seriesIndex}`]) {
        let last: number | null = null;
        for (const row of rows) {
          const value = Number(row[dataKey]);
          if (!Number.isFinite(value)) continue;
          const next = last === null ? null : value - last;
          last = value;
          row[dataKey] = next;
        }
      }
    });
  }

  return rows;
};

const overviewRows = (
  currentSeries: ClinicalOutcomeSeriesSummary[],
  previousSeriesByKey: Map<string, ClinicalOutcomeSeriesSummary>,
  comparePrevious: boolean,
  axis: AnalyticsAxis,
) => {
  const previousSeries = comparePrevious
    ? currentSeries.map((series) => previousSeriesByKey.get(series.key)).filter((series): series is ClinicalOutcomeSeriesSummary => Boolean(series))
    : [];
  type OverviewRow = {
    x: string;
    xDetail: string;
    period: 'current' | 'previous';
    sortTime: number;
    sessionId: string | null;
    skills: number;
    behaviors: number;
    mastery: number;
    maintenance: number;
    alerts: number;
    _sessionIds: Set<string>;
    _reportSessionIds: Set<string>;
  };
  const rowsByKey = new Map<string, OverviewRow>();
  const seen = new Set<string>();

  const bucketDescriptor = (observation: ClinicalOutcomeObservation, period: 'current' | 'previous') => {
    if (axis === 'date') {
      const dateKey = localDateKey(observation.observedAt);
      return {
        key: `${period}::date:${dateKey}`,
        label: shortDate(dateKey),
        detail: fullDate(dateKey),
        sortTime: timestamp(`${dateKey}T12:00:00`),
      };
    }

    // CMV3 plan projections may use one UUID per measurement while ABA keeps one
    // durable session id. For the overview, both must land in the same clinical
    // session bar. ABA's trailing epoch is the authoritative session start; other
    // canonical observations fall back to their observed minute.
    const sessionMinute = overviewSessionMinuteTimestamp(observation);
    const safeMinute = sessionMinute || Math.floor(timestamp(observation.observedAt) / 60_000) * 60_000;
    const iso = safeMinute > 0 ? new Date(safeMinute).toISOString() : observation.observedAt;
    return {
      key: `${period}::session-minute:${safeMinute || clean(observation.observedAt)}`,
      label: sessionDateTimeLabel(iso),
      detail: sessionDateTimeDetail(iso),
      sortTime: safeMinute || timestamp(observation.observedAt),
    };
  };

  const countSeries = (series: ClinicalOutcomeSeriesSummary, period: 'current' | 'previous') => {
    for (const observation of series.validObservations) {
      const bucket = bucketDescriptor(observation, period);
      let row = rowsByKey.get(bucket.key);
      if (!row) {
        row = {
          x: bucket.label,
          xDetail: bucket.detail,
          period,
          sortTime: bucket.sortTime,
          sessionId: null,
          skills: 0,
          behaviors: 0,
          mastery: 0,
          maintenance: 0,
          alerts: 0,
          _sessionIds: new Set<string>(),
          _reportSessionIds: new Set<string>(),
        };
        rowsByKey.set(bucket.key, row);
      }

      const sessionId = clean(observation.sessionId);
      if (sessionId) row._sessionIds.add(sessionId);
      const reportSessionId = reportableAbaSessionId(observation);
      if (reportSessionId) row._reportSessionIds.add(reportSessionId);

      const domain = isRegressionAlertSeries(series) ? 'alerts' : analyticsDomainForSeries(series);
      const identity = `${bucket.key}::${domain}::${sessionIdentity(observation)}::${clean(observation.itemId || observation.goalId || observation.programId) || observation.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      row[domain] += 1;
    }
  };

  currentSeries.forEach((series) => countSeries(series, 'current'));
  previousSeries.forEach((series) => countSeries(series, 'previous'));

  return Array.from(rowsByKey.values())
    .sort((left, right) => left.sortTime - right.sortTime)
    .map((row) => {
      const reportSessionIds = Array.from(row._reportSessionIds);
      const sessionIds = Array.from(row._sessionIds);
      const sessionId = reportSessionIds.length === 1
        ? reportSessionIds[0]
        : reportSessionIds.length === 0 && sessionIds.length === 1
          ? sessionIds[0]
          : null;
      const { _sessionIds, _reportSessionIds, ...publicRow } = row;
      return { ...publicRow, sessionId };
    });
};


const movementValueText = (target: ClinicalTargetChange) => {
  if (target.firstValue === null || target.latestValue === null) return 'Sem comparação suficiente';
  return `${formatClinicalValue(target.firstValue, target.unit)} → ${formatClinicalValue(target.latestValue, target.unit)}`;
};

function ProgramChangesView({
  series,
  programs,
  isDark,
  onOpenSessionReport,
}: {
  series: ClinicalOutcomeSeriesSummary[];
  programs: any[];
  isDark: boolean;
  onOpenSessionReport?: (sessionId: string) => void;
}) {
  const overview = useMemo(() => buildClinicalProgramChangeOverview(series, programs), [programs, series]);
  const subtle = isDark ? 'text-slate-400' : 'text-slate-500';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const card = isDark ? 'border-slate-700 bg-slate-900/35' : 'border-slate-200 bg-slate-50/70';

  const openTargetSession = (target: ClinicalTargetChange) => {
    const sessionId = clean(target.latestSessionId);
    if (!sessionId.startsWith('session-') || !onOpenSessionReport) return;
    onOpenSessionReport(sessionId);
  };

  const HighlightCard = ({ target, tone }: { key?: React.Key; target: ClinicalTargetChange; tone: 'improving' | 'attention' }) => {
    const canOpen = clean(target.latestSessionId).startsWith('session-') && Boolean(onOpenSessionReport);
    const favorable = tone === 'improving';
    const sustained = target.movement === 'criterion_sustained';
    const movementTone = target.movement === 'criterion_sustained'
      ? 'text-sky-500'
      : target.movement === 'stagnant'
        ? 'text-amber-500'
        : target.movement === 'improving'
          ? 'text-emerald-500'
          : target.movement === 'attention'
            ? 'text-rose-500'
            : 'text-slate-400';
    const flatTone = sustained ? 'text-sky-500' : 'text-amber-500';
    const valueTone = target.valueTrend === 'flat'
      ? sustained ? 'text-sky-700 dark:text-sky-300' : 'text-amber-700 dark:text-amber-300'
      : sustained
        ? 'text-sky-700 dark:text-sky-300'
        : favorable
          ? 'text-emerald-700 dark:text-emerald-300'
          : 'text-rose-700 dark:text-rose-300';
    const trendIcon = target.valueTrend === 'down'
      ? <TrendingDown size={17} className={`shrink-0 ${movementTone}`} />
      : target.valueTrend === 'up'
        ? <TrendingUp size={17} className={`shrink-0 ${movementTone}`} />
        : target.valueTrend === 'flat'
          ? <ArrowRight size={17} className={`shrink-0 ${flatTone}`} />
          : null;
    const criterionCopy = target.criterionLabel
      ? `${target.criterionSource === 'target_mastery_criteria' || target.criterionSource === 'program_mastery_criteria' ? 'Critério de domínio' : 'Meta clínica configurada'}: ${target.criterionLabel}`
      : favorable
        ? 'Tendência clinicamente favorável'
        : 'Tendência clinicamente desfavorável';
    return (
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => canOpen && openTargetSession(target)}
        className={`w-full rounded-2xl border p-3 text-left transition ${card} ${canOpen ? 'hover:border-violet-300 hover:bg-violet-50/40 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/5' : 'cursor-default'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`truncate text-sm font-semibold ${text}`}>{target.label}</p>
            <p className={`mt-0.5 truncate text-[11px] ${subtle}`}>{target.programName || 'Sem programa vinculado'} · {target.metricLabel}</p>
          </div>
          {sustained ? <BadgeCheck size={17} className="shrink-0 text-sky-500" /> : trendIcon}
        </div>
        <p className={`mt-2 text-sm font-semibold ${valueTone}`}>{movementValueText(target)}</p>
        <p className={`mt-1 text-[11px] font-medium ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{criterionCopy}</p>
        <p className={`mt-1 text-[11px] ${subtle}`}>{target.pointCount} sessões comparáveis{canOpen ? ' · abrir sessão mais recente' : ''}</p>
      </button>
    );
  };

  return (
    <div className="space-y-4" data-testid="program-change-overview">
      <div className={`rounded-2xl border p-3 ${card}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${text}`}>Evolução dos programas</p>
            <p className={`mt-1 text-[11px] leading-5 ${subtle}`}>Cada alvo entra uma única vez, pela sua métrica clínica principal. Cor e estado seguem a intenção clínica da métrica e do critério persistido — nunca o sinal matemático isolado — sem criar score ou média entre unidades incompatíveis.</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>{overview.programs.length} programa(s)</span>
        </div>

        {overview.programs.length > 0 ? (
          <div className="mt-4 space-y-3">
            {overview.programs.map((program) => {
              const total = Math.max(program.targetCount, 1);
              const segments = [
                { key: 'improving', label: 'Evoluindo', value: program.improving, className: 'bg-emerald-500' },
                { key: 'criterion_sustained', label: 'Critério sustentado', value: program.criterionSustained, className: 'bg-sky-500' },
                { key: 'stagnant', label: 'Estagnado', value: program.stagnant, className: 'bg-amber-400' },
                { key: 'attention', label: 'Requer atenção', value: program.attention, className: 'bg-rose-500' },
                { key: 'insufficient', label: 'Evidência insuficiente', value: program.insufficient, className: isDark ? 'bg-slate-600' : 'bg-slate-300' },
              ];
              return (
                <div key={program.id} className={`rounded-xl border p-3 ${isDark ? 'border-slate-700/80 bg-slate-950/30' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-sm font-semibold ${text}`}>{program.name}</p>
                    <p className={`text-[11px] ${subtle}`}>{program.targetCount} alvo(s) com evidência</p>
                  </div>
                  <div className={`mt-2.5 flex h-3 overflow-hidden rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`} aria-label={`Composição clínica do programa ${program.name}`}>
                    {segments.filter((segment) => segment.value > 0).map((segment) => (
                      <span key={segment.key} className={segment.className} style={{ width: `${(segment.value / total) * 100}%` }} title={`${segment.label}: ${segment.value}`} />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    <span className="text-emerald-700 dark:text-emerald-300">↗ {program.improving} evoluindo</span>
                    <span className="text-sky-700 dark:text-sky-300">✓ {program.criterionSustained} critério sustentado</span>
                    <span className="text-amber-700 dark:text-amber-300">→ {program.stagnant} estagnado</span>
                    <span className="text-rose-700 dark:text-rose-300">! {program.attention} requer atenção</span>
                    <span className={subtle}>○ {program.insufficient} insuficiente</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-sm ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Ainda não há programas com evidência suficiente para compor esta leitura.</div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`rounded-2xl border p-3 ${card}`}>
          <div className="flex items-center gap-2">
            <TrendingUp size={17} className="text-emerald-500" />
            <div><p className={`text-sm font-semibold ${text}`}>Maiores evoluções</p><p className={`text-[11px] ${subtle}`}>Priorizadas por transição de estado semântico e aproximação do critério; unidades incompatíveis nunca são ranqueadas pela diferença bruta.</p></div>
          </div>
          <div className="mt-3 space-y-2">
            {overview.improvingTargets.length > 0
              ? overview.improvingTargets.map((target) => <HighlightCard key={target.key} target={target} tone="improving" />)
              : <p className={`rounded-xl border border-dashed p-4 text-center text-xs ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhum alvo com tendência favorável suficientemente sustentada neste período.</p>}
          </div>
        </section>

        <section className={`rounded-2xl border p-3 ${card}`}>
          <div className="flex items-center gap-2">
            <TrendingDown size={17} className="text-rose-500" />
            <div><p className={`text-sm font-semibold ${text}`}>Precisam de atenção</p><p className={`text-[11px] ${subtle}`}>Regressão clínica ou afastamento do critério com pelo menos 3 sessões comparáveis.</p></div>
          </div>
          <div className="mt-3 space-y-2">
            {overview.attentionTargets.length > 0
              ? overview.attentionTargets.map((target) => <HighlightCard key={target.key} target={target} tone="attention" />)
              : <p className={`rounded-xl border border-dashed p-4 text-center text-xs ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhum alvo com tendência desfavorável sustentada neste período.</p>}
          </div>
        </section>
      </div>

      <p className={`px-1 text-[11px] leading-5 ${subtle}`}>Os destaques obedecem à direcionalidade e ao critério clínico persistidos. Percentuais, segundos, frequências e outras unidades não são somados, comparados por delta bruto nem transformados em score clínico.</p>
    </div>
  );
}

function ChartTooltipPortal({ active, coordinate, chartRef, children }: any) {
  if (!active || !children || typeof document === 'undefined' || typeof window === 'undefined') return null;
  const rect = chartRef?.current?.getBoundingClientRect?.();
  if (!rect) return null;
  const coordinateX = Number(coordinate?.x);
  const coordinateY = Number(coordinate?.y);
  if (!Number.isFinite(coordinateX) || !Number.isFinite(coordinateY)) return null;
  const anchorX = rect.left + coordinateX;
  const anchorY = rect.top + coordinateY;
  const tooltipWidth = Math.max(160, Math.min(320, window.innerWidth - 24));
  const left = Math.max(12, Math.min(window.innerWidth - tooltipWidth - 12, anchorX + 12));
  const placeBelow = anchorY < 160;
  const top = Math.min(window.innerHeight - 12, Math.max(12, anchorY + (placeBelow ? 12 : -12)));
  return createPortal(
    <div
      className="pointer-events-none fixed z-[240]"
      style={{
        left,
        top,
        maxWidth: tooltipWidth,
        transform: placeBelow ? 'none' : 'translateY(-100%)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function PortalAnalyticsTooltip(props: any) {
  const content = <AnalyticsTooltip {...props} />;
  return <ChartTooltipPortal active={props.active} coordinate={props.coordinate} chartRef={props.chartRef}>{content}</ChartTooltipPortal>;
}

function PortalOverviewTooltip(props: any) {
  const content = <OverviewTooltip {...props} />;
  return <ChartTooltipPortal active={props.active} coordinate={props.coordinate} chartRef={props.chartRef}>{content}</ChartTooltipPortal>;
}

function OverviewYAxisPane({ max, ticks, isDark }: { max: number; ticks: number[]; isDark: boolean }) {
  const axisLine = isDark ? 'border-slate-500' : 'border-slate-400';
  const tickTone = isDark ? 'text-slate-400' : 'text-slate-500';
  return (
    <div
      className={`relative h-full w-[60px] shrink-0 border-r ${axisLine} ${isDark ? 'bg-[#101b2e]' : 'bg-white'} shadow-[5px_0_10px_-9px_rgba(15,23,42,0.65)]`}
      data-testid="overview-y-axis-pane"
      role="img"
      aria-label={`Eixo Y fixo. Escala de 0 a ${max} registros distintos.`}
    >
      <span className={`absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-[9px] ${tickTone}`}>Registros distintos</span>
      <div className="absolute left-[24px] right-0" style={{ top: OVERVIEW_Y_AXIS_TOP, bottom: OVERVIEW_Y_AXIS_BOTTOM }}>
        {ticks.map((tick) => {
          const top = max > 0 ? ((max - tick) / max) * 100 : 100;
          return (
            <div key={tick} className="absolute left-0 right-0" style={{ top: `${top}%`, transform: 'translateY(-50%)' }}>
              <span className={`absolute right-2 -translate-y-1/2 text-[10px] tabular-nums ${tickTone}`}>{tick}</span>
              <span className={`absolute right-0 top-0 w-1.5 border-t ${axisLine}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverviewGhostBarShape({ x, y, width, height, payload, isDark, onActivate }: any) {
  if (!payload?.__ghost || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  const numericX = Number(x);
  const numericY = Number(y);
  const numericWidth = Math.max(1, Number(width) || 1);
  const numericHeight = Math.max(1, Number(height) || 1);
  const centerX = numericX + numericWidth / 2;
  const baselineY = numericY + numericHeight;
  const hitWidth = Math.max(44, numericWidth);
  const message = String(payload.__ghostMessage || 'Sem registros para o filtro selecionado.');
  const activate = () => onActivate?.(message);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={message}
      onClick={activate}
      onFocus={activate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      }}
    >
      <title>{message}</title>
      <rect x={centerX - hitWidth / 2} y={baselineY - 44} width={hitWidth} height={44} fill="transparent" pointerEvents="all" />
      <line x1={centerX - 7} x2={centerX + 7} y1={baselineY - 1} y2={baselineY - 1} stroke={isDark ? '#64748B' : '#CBD5E1'} strokeWidth={2} strokeLinecap="round" pointerEvents="none" />
    </g>
  );
}

function AnalyticsTooltip({ active, payload, label, unit, selectedSeries, changesMode = false }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5 text-slate-500 dark:text-slate-400">{row.xDetail}{row.period === 'previous' ? ' · período anterior' : ''}</p>
      <div className="mt-2 space-y-1.5">
        {payload.filter((item: any) => item.value !== null && item.value !== undefined).map((item: any) => {
          const match = String(item.dataKey || '').match(/_(\d+)$/);
          const seriesIndex = match ? Number(match[1]) : -1;
          const series = selectedSeries?.[seriesIndex];
          return (
            <div key={`${item.dataKey}-${item.name}`} className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate">{series?.itemLabel || item.name}</span></span>
              <strong>{changesMode && Number(item.value) > 0 ? '+' : ''}{formatClinicalValue(item.value, unit)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverviewTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const ghost = payload.find((item: any) => item.dataKey === '__ghost' && Number(item.value) > 0);
  if (ghost) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
        <p className="font-semibold">{label}</p>
        <p className="mt-0.5 text-slate-500 dark:text-slate-400">{row.xDetail}{row.period === 'previous' ? ' · período anterior' : ''}</p>
        <p className="mt-2">{row.__ghostMessage || 'Sem registros para o filtro selecionado.'}</p>
      </div>
    );
  }
  const visibleItems = payload.filter((item: any) => !String(item.dataKey || '').startsWith('__') && Number(item.value) > 0);
  const total = visibleItems.reduce((sum: number, item: any) => sum + Number(item.value || 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5 text-slate-500 dark:text-slate-400">{row.xDetail}{row.period === 'previous' ? ' · período anterior' : ''}</p>
      <p className="mt-2 border-b border-slate-100 pb-1.5 font-medium dark:border-slate-800">Total: <strong>{total}</strong></p>
      <div className="mt-1.5 space-y-1">
        {visibleItems.map((item: any) => <p key={item.dataKey}>{item.name}: <strong>{item.value}</strong></p>)}
      </div>
    </div>
  );
}

export function ClinicalPlanAnalyticsShell({ scopeLabel, series, previousSeriesByKey, comparePrevious, axis, onAxisChange, isDark = false, onOpenSessionReport, onShareDescriptorChange, programs = [], ptsSpecialtyPlans, ptsPlanScopeIndex, shareControl }: ClinicalPlanAnalyticsShellProps) {
  const [activeDomain, setActiveDomain] = useState<AnalyticsDomain>('overview');
  const ptsGroupedOverview = activeDomain === 'overview' && Boolean(ptsSpecialtyPlans?.length && ptsPlanScopeIndex);
  const [ptsMetricId, setPtsMetricId] = useState('');
  const ptsMetrics = useMemo(() => ptsSpecialtyPlans && ptsPlanScopeIndex
    ? buildPtsClusteredSpecialtyMetrics(ptsSpecialtyPlans, series, ptsPlanScopeIndex)
    : [], [ptsSpecialtyPlans, ptsPlanScopeIndex, series]);
  const selectedPtsMetric = ptsMetrics.find((metric) => metric.id === ptsMetricId) || ptsMetrics[0] || null;
  const [metricSignatureValue, setMetricSignatureValue] = useState('');
  const [selectedSeriesKeys, setSelectedSeriesKeys] = useState<string[]>([]);
  const [overviewDomainKeys, setOverviewDomainKeys] = useState<OverviewDomainKey[]>([]);
  const [overviewEmptyHint, setOverviewEmptyHint] = useState('');
  const chartContentRef = useRef<HTMLDivElement>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  const availableDomainCounts = useMemo(() => {
    const counts = { skills: 0, behaviors: 0, mastery: 0, maintenance: 0, changes: 0 };
    for (const item of series) {
      counts[analyticsDomainForSeries(item)] += 1;
      if (supportsSessionChange(item)) counts.changes += 1;
    }
    return counts;
  }, [series]);

  const metricOptions = useMemo(() => (activeDomain === 'overview' || activeDomain === 'changes') ? [] : metricOptionsForDomain(series, activeDomain), [activeDomain, series]);
  const activeMetric = useMemo(() => metricOptions.find((option) => option.signature === metricSignatureValue) || metricOptions[0] || null, [metricOptions, metricSignatureValue]);

  useEffect(() => {
    if (activeDomain === 'overview' || activeDomain === 'changes') return;
    if (!metricOptions.length) {
      setActiveDomain('overview');
      setMetricSignatureValue('');
      setSelectedSeriesKeys([]);
      return;
    }
    if (!metricOptions.some((option) => option.signature === metricSignatureValue)) setMetricSignatureValue(metricOptions[0].signature);
  }, [activeDomain, metricOptions, metricSignatureValue]);

  useEffect(() => {
    if (!activeMetric) return;
    const valid = new Set(activeMetric.series.map((item) => item.key));
    setSelectedSeriesKeys((current) => {
      const kept = current.filter((key) => valid.has(key)).slice(0, 3);
      if (kept.length > 0) return kept;
      return activeMetric.series.slice(0, 3).map((item) => item.key);
    });
  }, [activeMetric]);

  useEffect(() => {
    if (activeDomain === 'changes' && axis !== 'session') onAxisChange('session');
  }, [activeDomain, axis, onAxisChange]);

  const selectedSeries = useMemo(() => activeMetric
    ? activeMetric.series.filter((item) => selectedSeriesKeys.includes(item.key)).slice(0, 3)
    : [], [activeMetric, selectedSeriesKeys]);

  const shareDescriptor = useMemo<ClinicalPlanShareDescriptor | null>(() => {
    if (activeDomain === 'overview') {
      if (!ptsGroupedOverview || !ptsSpecialtyPlans?.length || !selectedPtsMetric) return null;
      return {
        schemaVersion: 1,
        family: 'PLAN_PTS',
        domain: 'overview',
        planIds: ptsSpecialtyPlans.map((plan) => plan.id),
        metricSignature: selectedPtsMetric.id,
        seriesKeys: [],
        axis: 'date',
        comparePrevious: false,
      };
    }
    if (
      activeDomain === 'changes'
      || !activeMetric
      || selectedSeries.length === 0
    ) return null;
    return {
      schemaVersion: 1,
      family: 'PLAN_PTS',
      domain: activeDomain,
      metricSignature: activeMetric.signature,
      seriesKeys: selectedSeries.map((item) => item.key),
      axis,
      comparePrevious: Boolean(comparePrevious),
    };
  }, [activeDomain, activeMetric, axis, comparePrevious, selectedSeries, ptsGroupedOverview, ptsSpecialtyPlans, selectedPtsMetric]);

  useEffect(() => {
    onShareDescriptorChange?.(shareDescriptor);
  }, [onShareDescriptorChange, shareDescriptor]);

  const domainForColor = activeDomain === 'changes'
    ? analyticsDomainForSeries(selectedSeries[0] || series[0] || ({ metricKey: '' } as ClinicalOutcomeSeriesSummary))
    : activeDomain === 'overview'
      ? 'skills'
      : activeDomain;
  const lineColors = DOMAIN_COLORS[domainForColor as keyof typeof DOMAIN_COLORS] || DOMAIN_COLORS.skills;

  const rows = useMemo(() => activeDomain === 'overview'
    ? overviewRows(series, previousSeriesByKey, comparePrevious, axis)
    : activeDomain === 'changes'
      ? []
      : chartRowsForSeries(selectedSeries, previousSeriesByKey, comparePrevious, axis, false),
  [activeDomain, axis, comparePrevious, previousSeriesByKey, selectedSeries, series]);

  const overviewFilterActive = overviewDomainKeys.length > 0;
  const overviewVisibleBars = useMemo(
    () => overviewFilterActive ? OVERVIEW_BARS.filter((item) => overviewDomainKeys.includes(item.key)) : OVERVIEW_BARS,
    [overviewDomainKeys, overviewFilterActive],
  );
  const overviewChartRows = useMemo(() => {
    if (activeDomain !== 'overview') return rows;
    const selectedLabel = overviewDomainLabel(overviewDomainKeys);
    return rows.map((row: any) => {
      const visibleTotal = overviewVisibleBars.reduce((sum, item) => sum + Number(row[item.key] || 0), 0);
      const hasFilteredGap = overviewFilterActive && visibleTotal === 0;
      const bucketLabel = axis === 'session' ? 'nesta sessão' : 'nesta data';
      return {
        ...row,
        __ghost: hasFilteredGap ? 1 : 0,
        __ghostMessage: hasFilteredGap ? `Sem registros de ${selectedLabel} ${bucketLabel}.` : '',
        __filteredEmpty: hasFilteredGap,
      };
    });
  }, [activeDomain, axis, overviewDomainKeys, overviewFilterActive, overviewVisibleBars, rows]);
  const overviewYAxis = useMemo(() => {
    if (activeDomain !== 'overview') return niceCountAxis(OVERVIEW_Y_AXIS_MIN);
    const maxVisible = overviewChartRows.reduce((max, row: any) => {
      const total = overviewVisibleBars.reduce((sum, item) => sum + Number(row[item.key] || 0), 0);
      return Math.max(max, total);
    }, 0);
    return niceCountAxis(maxVisible);
  }, [activeDomain, overviewChartRows, overviewVisibleBars]);

  useEffect(() => {
    setOverviewEmptyHint('');
  }, [axis, overviewDomainKeys]);

  const firstCurrentX = rows.find((row) => row.period === 'current')?.x;
  const numericValues = selectedSeries.flatMap((item) => item.validObservations.map((row) => row.value)).filter((value): value is number => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
  const unitLabel = activeMetric?.unitLabel || 'Valor clínico';
  const unit = clean(selectedSeries[0]?.unit);
  const percentMode = activeDomain !== 'changes' && unitLabel === 'Percentual (%)';
  const ratioMode = activeDomain !== 'changes' && unitLabel === 'Pontuação (0–1)';
  const activeCount = rows.filter((row) => row.period === 'current').length;
  const previousCount = rows.filter((row) => row.period === 'previous').length;

  const tabAvailability = (tab: AnalyticsDomain) => {
    if (tab === 'overview') return series.length > 0;
    if (tab === 'changes') return availableDomainCounts.changes > 0;
    return availableDomainCounts[tab] > 0;
  };

  const toggleSeries = (key: string) => {
    setSelectedSeriesKeys((current) => {
      if (current.includes(key)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== key);
      }
      if (current.length >= 3) return current;
      return [...current, key];
    });
  };

  const toggleOverviewDomain = (key: OverviewDomainKey) => {
    setOverviewDomainKeys((current) => {
      if (current.length === 0) return [key];
      if (current.includes(key)) {
        if (current.length === 1) return [];
        return current.filter((item) => item !== key);
      }
      const next = [...current, key];
      return next.length === OVERVIEW_BARS.length ? [] : next;
    });
  };

  if (!series.length) return null;

  const panel = isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const subtle = isDark ? 'text-slate-400' : 'text-slate-500';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';
  const reportableSessionId = (sessionId: unknown) => {
    const normalized = clean(sessionId);
    return normalized.startsWith('session-') ? normalized : '';
  };
  const openSessionReport = (sessionId: unknown) => {
    const normalized = reportableSessionId(sessionId);
    if (!normalized || !onOpenSessionReport) return;
    onOpenSessionReport(normalized);
  };
  const clickableDot = (props: any) => {
    const { cx, cy, fill, stroke, strokeWidth, payload } = props || {};
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const canOpen = Boolean(reportableSessionId(payload?.sessionId) && onOpenSessionReport);
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fill}
        stroke={stroke || '#fff'}
        strokeWidth={strokeWidth || 1.5}
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : -1}
        aria-label={canOpen ? `Abrir relatório da sessão de ${payload?.x || ''}` : undefined}
        style={{ cursor: canOpen ? 'pointer' : 'default' }}
        onClick={() => canOpen && openSessionReport(payload.sessionId)}
        onKeyDown={(event) => {
          if (!canOpen || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          openSessionReport(payload.sessionId);
        }}
      />
    );
  };

  return (
    <section className={`overflow-hidden rounded-2xl border ${panel}`} data-testid="clinical-plan-analytics-shell">
      <div className={`border-b px-4 pt-4 sm:px-5 sm:pt-5 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={`text-[10px] font-medium uppercase tracking-[0.14em] ${isDark ? 'text-violet-300' : 'text-violet-600'}`}>Leitura clínica</p>
            <h2 className={`mt-1 text-lg font-semibold tracking-tight ${text}`}>{scopeLabel}</h2>
            <p className={`mt-1 text-xs ${subtle}`}>Escolha o domínio e a métrica. Séries incompatíveis continuam separadas.</p>
          </div>
          <div role="group" aria-label="Agrupamento do gráfico" style={{ display: ptsGroupedOverview ? 'none' : undefined }} className="flex items-center gap-1 self-start rounded-xl border p-1 dark:border-slate-700">
            <button type="button" aria-pressed={axis === 'date'} onClick={() => activeDomain !== 'changes' && onAxisChange('date')} disabled={activeDomain === 'changes'} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${axis === 'date' ? 'bg-violet-600 text-white shadow-sm' : `${subtle} hover:text-violet-600`} disabled:cursor-not-allowed disabled:opacity-40`}><CalendarDays size={14} /> Por data</button>
            <button type="button" aria-pressed={axis === 'session'} onClick={() => onAxisChange('session')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${axis === 'session' ? 'bg-violet-600 text-white shadow-sm' : `${subtle} hover:text-violet-600`}`}><Layers3 size={14} /> Por sessão</button>
          </div>
        </div>

        <nav className="mt-4 flex gap-1 overflow-x-auto pb-1" aria-label="Domínios dos gráficos do plano">
          {DOMAIN_TABS.map((tab) => {
            const available = tabAvailability(tab.id);
            return <button key={tab.id} type="button" disabled={!available} aria-pressed={activeDomain === tab.id} onClick={() => available && setActiveDomain(tab.id)} className={`min-h-10 shrink-0 border-b-[3px] px-3 text-sm font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${activeDomain === tab.id ? (isDark ? DOMAIN_ACTIVE_TONE_DARK : DOMAIN_ACTIVE_TONE[tab.id]) : `border-transparent ${isDark ? 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`} disabled:cursor-not-allowed disabled:opacity-35`}>{tab.label}</button>;
          })}
        </nav>
      </div>

      <div className="p-4 sm:px-5 sm:py-4">
        {activeDomain !== 'overview' && activeDomain !== 'changes' && activeMetric && (
          <div className="mb-4 space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Métricas clínicas">
              {metricOptions.map((option) => <button key={option.signature} type="button" aria-pressed={activeMetric.signature === option.signature} onClick={() => setMetricSignatureValue(option.signature)} className={`min-h-10 shrink-0 rounded-xl border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${activeMetric.signature === option.signature ? DOMAIN_SOFT_TONE[activeDomain as Exclude<AnalyticsDomain, 'overview'>] : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>{option.label}</button>)}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className={`text-[11px] font-medium uppercase tracking-wide ${subtle}`}>{activeDomain === 'behaviors' ? 'Comportamentos interferentes no gráfico · até 3' : 'Alvos no gráfico · até 3'}</p>
                {activeMetric.series.length > 3 && <p className={`text-[11px] ${subtle}`}>{selectedSeriesKeys.length}/3 selecionados</p>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={activeDomain === 'behaviors' ? 'Comportamentos interferentes exibidos' : 'Alvos exibidos'}>
                {activeMetric.series.map((item) => {
                  const selected = selectedSeriesKeys.includes(item.key);
                  const disabled = !selected && selectedSeriesKeys.length >= 3;
                  return <button key={item.key} type="button" disabled={disabled} aria-pressed={selected} onClick={() => toggleSeries(item.key)} className={`min-h-10 rounded-xl border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${selected ? DOMAIN_SOFT_TONE[activeDomain as Exclude<AnalyticsDomain, 'overview'>] : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'} disabled:cursor-not-allowed disabled:opacity-35`}>{item.itemLabel || item.metricLabel}</button>;
                })}
              </div>
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${text}`}>{activeDomain === 'overview' ? (ptsGroupedOverview ? 'Comparação por especialidade' : 'Registros clínicos por domínio') : activeDomain === 'changes' ? 'Andamento geral dos programas' : activeMetric?.label}</p>
            <p className={`mt-0.5 text-[11px] ${subtle}`}>{activeDomain === 'overview' ? (ptsGroupedOverview ? 'Barras lado a lado por semana, com uma cor para cada plano; escolha a métrica comparável.' : `Uma barra por ${axis === 'session' ? 'sessão' : 'dia'}, com os domínios empilhados; não é um score clínico.`) : activeDomain === 'changes' ? 'Leitura consolidada das mudanças entre sessões, preservando a direção e a unidade de cada métrica.' : `${activeCount} ponto(s) no período atual${comparePrevious ? ` · ${previousCount} no período anterior` : ''} · ${unitLabel}`}</p>
          </div>
          {comparePrevious && activeDomain !== 'changes' && <div role="group" aria-label="Legenda de período" className={`flex items-center gap-3 text-[11px] ${subtle}`}><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-6 bg-violet-600" /> Atual</span><span className="inline-flex items-center gap-1.5"><span className="h-0 w-6 border-t-2 border-dashed border-violet-400" /> Anterior</span></div>}
        </div>

        {activeDomain === 'overview' && !ptsGroupedOverview && (
          <div className="mb-2.5 space-y-2" data-testid="overview-domain-filters">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar domínios exibidos no gráfico">
              <span className={`mr-1 text-[11px] ${subtle}`}>Exibir:</span>
              <button
                type="button"
                aria-pressed={!overviewFilterActive}
                onClick={() => setOverviewDomainKeys([])}
                className={`min-h-10 rounded-lg border px-3 text-xs font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${!overviewFilterActive ? isDark ? 'border-violet-400 bg-slate-900 text-violet-200' : 'border-violet-500 bg-white text-violet-800' : isDark ? 'border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >Todos</button>
              {OVERVIEW_BARS.map((item) => {
                const selected = overviewDomainKeys.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleOverviewDomain(item.key)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${selected ? isDark ? 'border-violet-400 bg-slate-900 text-slate-100' : 'border-violet-500 bg-white text-slate-900' : isDark ? 'border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
            {overviewEmptyHint && <p role="status" aria-live="polite" className={`w-fit rounded-lg border px-2.5 py-1.5 text-[11px] ${isDark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{overviewEmptyHint}</p>}
          </div>
        )}

        {activeDomain === 'changes' ? (
          <ProgramChangesView series={series} programs={programs} isDark={isDark} onOpenSessionReport={onOpenSessionReport} />
        ) : ptsGroupedOverview && ptsSpecialtyPlans && ptsPlanScopeIndex ? (
          <PtsClusteredSpecialtyProgress plans={ptsSpecialtyPlans} metrics={ptsMetrics} isDark={isDark} selectedMetricId={selectedPtsMetric?.id || ''} onSelectedMetricIdChange={setPtsMetricId} />
        ) : activeDomain === 'overview' ? (
          <div className="flex h-[170px] min-w-0 sm:h-[180px]" data-testid="overview-chart-frame">
            <OverviewYAxisPane max={overviewYAxis.max} ticks={overviewYAxis.ticks} isDark={isDark} />
            <div className="min-w-0 flex-1 overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2" data-testid="overview-x-scroll-viewport" role="region" aria-label={`Gráfico geral por ${axis === 'session' ? 'sessão' : 'data'} com rolagem horizontal`} tabIndex={0}>
              <div ref={chartContentRef} className="h-full" style={{ minWidth: Math.max(620, overviewChartRows.length * 72) }}>
                <SafeResponsiveContainer width="100%" height="100%" minHeight={150}>
                  <BarChart data={overviewChartRows} margin={{ top: OVERVIEW_Y_AXIS_TOP, right: 24, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
                    <XAxis
                      dataKey="x"
                      height={38}
                      interval={0}
                      tick={(props: any) => {
                        const row = overviewChartRows[props.index];
                        const muted = Boolean(row?.__filteredEmpty);
                        return (
                          <g transform={`translate(${props.x},${props.y})`}>
                            <text x={0} y={0} dy={12} textAnchor="end" transform="rotate(-18)" fontSize={10} fill={muted ? (isDark ? '#64748B' : '#94A3B8') : (isDark ? '#94A3B8' : '#64748B')} opacity={muted ? 0.72 : 1}>
                              {props.payload?.value}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <YAxis hide width={0} allowDecimals={false} domain={[0, overviewYAxis.max]} ticks={overviewYAxis.ticks} />
                    <Tooltip content={<PortalOverviewTooltip chartRef={chartContentRef} />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.06)' : 'rgba(124,58,237,0.04)' }} />
                    {comparePrevious && firstCurrentX && <ReferenceLine x={firstCurrentX} stroke={isDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="4 4" label={{ value: 'Período atual', fontSize: 9, position: 'insideTopLeft' }} />}
                    {overviewVisibleBars.map((item) => <Bar key={item.key} dataKey={item.key} name={item.label} stackId="domains" fill={item.color} maxBarSize={52} isAnimationActive={!prefersReducedMotion} animationDuration={180} cursor={onOpenSessionReport ? 'pointer' : 'default'} onClick={(entry: any) => openSessionReport(entry?.sessionId || entry?.payload?.sessionId)} />)}
                    {overviewFilterActive && (
                      <Bar
                        dataKey="__ghost"
                        name="Sem registros no filtro"
                        stackId="domains"
                        fill="transparent"
                        isAnimationActive={false}
                        shape={(props: any) => <OverviewGhostBarShape {...props} isDark={isDark} onActivate={setOverviewEmptyHint} />}
                      />
                    )}
                  </BarChart>
                </SafeResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-[250px] min-w-0 overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 sm:h-[285px]" role="region" aria-label={`Gráfico de ${activeMetric?.label || 'métrica clínica'} com rolagem horizontal`} tabIndex={0}>
            <div ref={chartContentRef} className="h-full" style={{ minWidth: Math.max(620, rows.length * 72) }}>
              <SafeResponsiveContainer width="100%" height="100%" minHeight={230}>
                <LineChart data={rows} margin={{ top: 12, right: 18, left: 4, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
                  <XAxis dataKey="x" tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }} angle={-18} textAnchor="end" height={44} interval={0} />
                  <YAxis
                    tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }}
                    domain={percentMode ? [0, 100] : ratioMode ? [0, 1] : ['auto', 'auto']}
                    label={{ value: unitLabel, angle: -90, position: 'insideLeft', fontSize: 10 }}
                  />
                  <Tooltip content={<PortalAnalyticsTooltip chartRef={chartContentRef} unit={unit} selectedSeries={selectedSeries} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {comparePrevious && firstCurrentX && <ReferenceLine x={firstCurrentX} stroke={isDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="4 4" label={{ value: 'Período atual', fontSize: 9, position: 'insideTopLeft' }} />}
                  {selectedSeries.map((item, index) => {
                    const color = lineColors[index % lineColors.length];
                    const name = item.itemLabel || item.metricLabel;
                    return <React.Fragment key={item.key}>
                      {comparePrevious && <Line type="linear" dataKey={`previous_${index}`} name={`${name} · anterior`} stroke={color} strokeOpacity={0.42} strokeDasharray="6 5" strokeWidth={2} dot={clickableDot} activeDot={clickableDot} connectNulls={false} />}
                      <Line type="linear" dataKey={`current_${index}`} name={name} stroke={color} strokeWidth={2.7} dot={clickableDot} activeDot={clickableDot} connectNulls={false} />
                    </React.Fragment>;
                  })}
                </LineChart>
              </SafeResponsiveContainer>
            </div>
          </div>
        )}

        {activeDomain !== 'overview' && activeDomain !== 'changes' && selectedSeries.length === 0 && <div className="py-10 text-center"><Target className="mx-auto text-slate-300" size={26} /><p className={`mt-2 text-sm ${subtle}`}>{activeDomain === 'behaviors' ? 'Selecione ao menos um comportamento interferente para visualizar.' : 'Selecione ao menos um alvo para visualizar.'}</p></div>}
        {activeDomain === 'overview' && !ptsGroupedOverview && <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${isDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}><Activity size={15} className="mt-0.5 shrink-0 text-violet-500" /><span>A visão geral empilha, na mesma barra, a contagem de registros clínicos de cada domínio por dia ou sessão. Percentuais, duração, frequência e outras unidades não são somados entre si.</span></div>}
        {shareControl && <div className="mt-4" data-testid="clinical-chart-sharing-controls">{shareControl}</div>}
      </div>
    </section>
  );
}
