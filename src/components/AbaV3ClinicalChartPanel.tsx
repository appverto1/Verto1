import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, CalendarDays, Layers3, ShieldCheck, Target } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dataService } from '../services/dataService';
import { useClinicalAnalyticsQuery } from '../services/clinicalAnalyticsQueryCache';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type Props = {
  patientId: string;
  organizationId?: string | null;
  isPanelDark?: boolean;
  onShareDescriptorChange?: (descriptor: AbaV3ShareDescriptor | null) => void;
};

type AnalyticsDomain = 'overview' | 'skills' | 'behaviors' | 'mastery' | 'maintenance' | 'changes';
type AnalyticsAxis = 'date' | 'session';
export type AbaV3ShareSeriesRef = {
  targetId: string;
  measurementModelVersion: string;
  phaseAssignmentId: string;
  metricKey: string;
  seriesKey: string;
};

export type AbaV3ShareDescriptor = {
  schemaVersion: 1;
  family: 'ABA_V3';
  domain: 'skills' | 'behaviors' | 'maintenance';
  metricSignature: string;
  seriesRefs: AbaV3ShareSeriesRef[];
  axis: AnalyticsAxis;
  comparePrevious: boolean;
};

type PeriodKind = 'current' | 'previous';

type AbaChartPoint = {
  source_id?: string;
  session_id?: string;
  occurred_at?: string;
  value?: number | string | null;
  numerator?: number | string | null;
  denominator?: number | string | null;
  requires_review?: boolean;
};

type AbaChartSegment = {
  target_id?: string;
  target_name?: string;
  measurement_model_version?: string;
  phase_assignment_id?: string;
  phase_type?: string;
  phase_label?: string;
  metric_key?: string;
  metric_label?: string;
  unit?: string;
  series_key?: string;
  series_label?: string;
  source_family?: string;
  points?: AbaChartPoint[];
};

type AbaTargetCatalogRow = {
  target_id?: string;
  target_name?: string;
  target_type?: string;
  metric_count?: number;
  point_count?: number;
};

type AbaTargetState = {
  target_id?: string;
  target_name?: string;
  target_type?: string;
  program_name?: string;
  state?: string;
  state_version?: number;
  auto_mastery_enabled?: boolean;
  mastery_min_eligible_trials?: number | null;
  mastery_threshold_percent?: number | null;
  mastery_consecutive_sessions?: number | null;
  maintenance_enabled?: boolean;
  last_reason?: string | null;
};

type MetricOption = {
  signature: string;
  key: string;
  label: string;
  unit: string;
  segments: AbaChartSegment[];
};

type BucketMeta = {
  numerator: number | null;
  denominator: number | null;
  requiresReview: boolean;
  sessionIds: string[];
};

const DOMAIN_TABS: Array<{ id: AnalyticsDomain; label: string }> = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'skills', label: 'Habilidades' },
  { id: 'behaviors', label: 'Comportamentos' },
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

const DOMAIN_ACTIVE_TONE: Record<AnalyticsDomain, string> = {
  overview: 'border-violet-600 text-violet-700 dark:text-violet-300',
  skills: 'border-emerald-500 text-emerald-700 dark:text-emerald-300',
  behaviors: 'border-sky-500 text-sky-700 dark:text-sky-300',
  mastery: 'border-violet-500 text-violet-700 dark:text-violet-300',
  maintenance: 'border-amber-500 text-amber-700 dark:text-amber-300',
  changes: 'border-fuchsia-500 text-fuchsia-700 dark:text-fuchsia-300',
};

const DOMAIN_SOFT_TONE: Record<Exclude<AnalyticsDomain, 'overview'>, string> = {
  skills: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200',
  behaviors: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/35 dark:bg-sky-500/10 dark:text-sky-200',
  mastery: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/35 dark:bg-violet-500/10 dark:text-violet-200',
  maintenance: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200',
  changes: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-500/35 dark:bg-fuchsia-500/10 dark:text-fuchsia-200',
};

const clean = (value: unknown) => String(value || '').trim();
const numeric = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
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
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const fullDate = (value: string) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const unitSymbol = (unit?: string) => {
  const normalized = clean(unit).toLowerCase();
  if (normalized === 'percent' || normalized === '%') return '%';
  if (normalized === 'seconds' || normalized === 's') return 's';
  if (normalized === 'rate_per_hour' || normalized === 'eventos/h') return '/h';
  return '';
};

const unitAxisLabel = (unit?: string, metricKey?: string) => {
  const normalized = clean(unit).toLowerCase();
  const key = clean(metricKey).toUpperCase();
  if (normalized === 'percent' || normalized === '%') return 'Percentual (%)';
  if (normalized === 'seconds' || normalized === 's') return 'Tempo (s)';
  if (normalized === 'rate_per_hour' || normalized === 'eventos/h') return 'Taxa (eventos/h)';
  if (normalized === 'count' || key.includes('COUNT') || key.includes('TRIAL')) return 'Contagem';
  return clean(unit) || 'Valor clínico';
};

const displayValue = (value: unknown, unit?: string) => {
  const parsed = numeric(value);
  if (parsed === null) return '—';
  const rounded = Math.round(parsed * 10) / 10;
  const symbol = unitSymbol(unit);
  return symbol === '%' ? `${rounded}%` : symbol ? `${rounded} ${symbol}` : String(rounded);
};

const metricPriority = (key: unknown) => {
  const metric = clean(key).toUpperCase();
  if (metric === 'PRIMARY_INDEPENDENCE_PERCENT') return 10;
  if (metric === 'FINAL_COMPLETION_ACCURACY_PERCENT') return 20;
  if (metric === 'EFFECTIVE_TRIAL_COUNT') return 30;
  if (metric === 'TASK_INDEPENDENT_STEPS_PERCENT') return 40;
  if (metric === 'BEHAVIOR_FREQUENCY_COUNT') return 50;
  if (metric === 'BEHAVIOR_RATE_PER_HOUR') return 60;
  if (metric === 'BEHAVIOR_DURATION_EPISODES') return 70;
  if (metric === 'BEHAVIOR_DURATION_SECONDS') return 80;
  if (metric === 'BEHAVIOR_DURATION_AVG') return 90;
  if (metric.startsWith('INTERVAL_OCCURRENCE_PERCENT_')) return 95;
  if (metric === 'MAINTENANCE_PRIMARY_INDEPENDENCE_PERCENT') return 100;
  return 200;
};

const domainForSegment = (segment: AbaChartSegment): Exclude<AnalyticsDomain, 'overview' | 'mastery' | 'changes'> => {
  const family = clean(segment.source_family).toUpperCase();
  const key = clean(segment.metric_key).toUpperCase();
  if (family === 'MAINTENANCE_PROBE' || key.includes('MAINTENANCE')) return 'maintenance';
  if (family === 'BEHAVIOR' || family === 'INTERVAL' || key.includes('BEHAVIOR') || key.includes('INTERVAL')) return 'behaviors';
  return 'skills';
};

const metricOptionsForDomain = (segments: AbaChartSegment[], domain: AnalyticsDomain): MetricOption[] => {
  if (domain === 'overview' || domain === 'mastery') return [];
  const eligible = segments.filter((segment) => {
    const pointCount = Array.isArray(segment.points) ? segment.points.filter((point) => numeric(point.value) !== null).length : 0;
    if (domain === 'changes') return pointCount >= 2;
    return domainForSegment(segment) === domain;
  });
  const grouped = new Map<string, AbaChartSegment[]>();
  for (const segment of eligible) {
    const signature = `${clean(segment.metric_key)}::${clean(segment.unit)}`;
    grouped.set(signature, [...(grouped.get(signature) || []), segment]);
  }
  return Array.from(grouped.entries()).map(([signature, rows]) => ({
    signature,
    key: clean(rows[0]?.metric_key),
    label: clean(rows[0]?.metric_label) || clean(rows[0]?.metric_key) || 'Métrica clínica',
    unit: clean(rows[0]?.unit),
    segments: rows,
  })).sort((left, right) => metricPriority(left.key) - metricPriority(right.key) || left.label.localeCompare(right.label, 'pt-BR'));
};

const aggregatePoints = (segment: AbaChartSegment, points: AbaChartPoint[]) => {
  const values = points.map((point) => numeric(point.value)).filter((value): value is number => value !== null);
  if (!values.length) return { value: null, meta: null as BucketMeta | null };
  const key = clean(segment.metric_key).toUpperCase();
  const unit = clean(segment.unit).toLowerCase();
  let numeratorTotal = 0;
  let denominatorTotal = 0;
  let hasNumerator = false;
  let hasDenominator = false;
  for (const point of points) {
    const pointNumerator = numeric(point.numerator);
    const pointDenominator = numeric(point.denominator);
    if (pointNumerator !== null) {
      numeratorTotal += pointNumerator;
      hasNumerator = true;
    }
    if (pointDenominator !== null && pointDenominator > 0) {
      denominatorTotal += pointDenominator;
      hasDenominator = true;
    }
  }

  let value: number;
  if ((unit === 'percent' || unit === '%') && hasNumerator && hasDenominator && denominatorTotal > 0) {
    value = (numeratorTotal / denominatorTotal) * 100;
  } else if ((key.includes('RATE') || unit === 'rate_per_hour' || unit === 'eventos/h') && hasNumerator && hasDenominator && denominatorTotal > 0) {
    value = (numeratorTotal * 3600) / denominatorTotal;
  } else if (key.includes('DURATION_AVG') && hasNumerator && hasDenominator && denominatorTotal > 0) {
    value = numeratorTotal / denominatorTotal;
  } else if (
    key.includes('COUNT')
    || key.includes('TRIAL')
    || key.includes('DURATION_EPISODES')
    || key.includes('DURATION_SECONDS')
  ) {
    value = values.reduce((sum, item) => sum + item, 0);
  } else {
    value = values.reduce((sum, item) => sum + item, 0) / values.length;
  }

  return {
    value,
    meta: {
      numerator: hasNumerator ? numeratorTotal : null,
      denominator: hasDenominator ? denominatorTotal : null,
      requiresReview: points.some((point) => point.requires_review === true),
      sessionIds: Array.from(new Set(points.map((point) => clean(point.session_id)).filter(Boolean))),
    },
  };
};

const stateLabel = (state: unknown) => ({
  ACQUISITION: 'Aquisição',
  MASTERY_CRITERIA_MET: 'Critério de maestria atingido',
  MASTERED: 'Maestria confirmada',
  MAINTENANCE: 'Manutenção',
  MAINTENANCE_ALERT: 'Atenção na manutenção',
  REACQUISITION: 'Reaquisição',
  PAUSED: 'Pausado',
  DISCONTINUED: 'Descontinuado',
}[clean(state).toUpperCase()] || clean(state) || 'Estado não informado');

const stateTone = (state: unknown) => {
  const normalized = clean(state).toUpperCase();
  if (normalized === 'MASTERY_CRITERIA_MET' || normalized === 'MASTERED') return 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/35 dark:bg-violet-500/10 dark:text-violet-200';
  if (normalized === 'MAINTENANCE') return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200';
  if (normalized === 'MAINTENANCE_ALERT' || normalized === 'REACQUISITION') return 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200';
};

const periodForDate = (point: AbaChartPoint, anchorMs: number, days: number): PeriodKind | null => {
  const occurred = timestamp(point.occurred_at);
  if (!occurred) return null;
  const currentStart = anchorMs - days * 86_400_000;
  const previousStart = anchorMs - days * 2 * 86_400_000;
  if (occurred >= currentStart && occurred <= anchorMs + 86_400_000) return 'current';
  if (occurred >= previousStart && occurred < currentStart) return 'previous';
  return null;
};

const buildSessionPeriodMap = (points: AbaChartPoint[], sessionCount: number) => {
  const sessions = new Map<string, { id: string; time: number }>();
  for (const point of points) {
    const id = clean(point.session_id) || clean(point.source_id);
    const time = timestamp(point.occurred_at);
    if (!id || !time) continue;
    const current = sessions.get(id);
    if (!current || time < current.time) sessions.set(id, { id, time });
  }
  const ordered = Array.from(sessions.values()).sort((left, right) => left.time - right.time);
  const current = ordered.slice(-sessionCount);
  const previous = ordered.slice(Math.max(0, ordered.length - sessionCount * 2), Math.max(0, ordered.length - sessionCount));
  const map = new Map<string, { period: PeriodKind; displayIndex: number; time: number }>();
  [...previous, ...current].forEach((session, index) => {
    map.set(session.id, {
      period: index < previous.length ? 'previous' : 'current',
      displayIndex: index + 1,
      time: session.time,
    });
  });
  return map;
};

const buildChartRows = (
  segments: AbaChartSegment[],
  axis: AnalyticsAxis,
  comparePrevious: boolean,
  days: number,
  sessionCount: number,
  anchorMs: number,
  changesMode: boolean,
) => {
  const allPoints = segments.flatMap((segment) => Array.isArray(segment.points) ? segment.points : []);
  const sessionMap = axis === 'session' ? buildSessionPeriodMap(allPoints, sessionCount) : new Map<string, { period: PeriodKind; displayIndex: number; time: number }>();
  const buckets = new Map<string, Record<string, any>>();

  const pointPeriod = (point: AbaChartPoint): PeriodKind | null => {
    if (axis === 'date') return periodForDate(point, anchorMs, days);
    const id = clean(point.session_id) || clean(point.source_id);
    return sessionMap.get(id)?.period || null;
  };
  const pointBaseKey = (point: AbaChartPoint) => {
    if (axis === 'date') return localDateKey(clean(point.occurred_at));
    return clean(point.session_id) || clean(point.source_id);
  };
  const ensureBucket = (point: AbaChartPoint, period: PeriodKind) => {
    const baseKey = pointBaseKey(point);
    if (!baseKey) return null;
    const key = `${period}::${baseKey}`;
    if (buckets.has(key)) return buckets.get(key)!;
    const sessionInfo = axis === 'session' ? sessionMap.get(baseKey) : null;
    const row: Record<string, any> = {
      bucketKey: key,
      period,
      sortTime: axis === 'session' ? (sessionInfo?.time || timestamp(point.occurred_at)) : timestamp(`${baseKey}T12:00:00`),
      x: axis === 'session' ? `Sessão ${sessionInfo?.displayIndex || buckets.size + 1}` : shortDate(baseKey),
      xDetail: axis === 'session' ? `${fullDate(clean(point.occurred_at))} · ${baseKey}` : fullDate(baseKey),
    };
    buckets.set(key, row);
    return row;
  };

  segments.forEach((segment, segmentIndex) => {
    const grouped = new Map<string, AbaChartPoint[]>();
    for (const point of segment.points || []) {
      const period = pointPeriod(point);
      if (!period || (!comparePrevious && period === 'previous')) continue;
      const baseKey = pointBaseKey(point);
      if (!baseKey) continue;
      ensureBucket(point, period);
      const key = `${period}::${baseKey}`;
      grouped.set(key, [...(grouped.get(key) || []), point]);
    }
    for (const [bucketKey, points] of grouped.entries()) {
      const row = buckets.get(bucketKey);
      if (!row) continue;
      const period = row.period as PeriodKind;
      const dataKey = `${period}_${segmentIndex}`;
      const aggregate = aggregatePoints(segment, points);
      row[dataKey] = aggregate.value;
      row[`meta_${dataKey}`] = aggregate.meta;
    }
  });

  const rows = Array.from(buckets.values()).sort((left, right) => Number(left.sortTime) - Number(right.sortTime));
  if (changesMode) {
    segments.forEach((_, segmentIndex) => {
      for (const period of ['previous', 'current'] as const) {
        let last: number | null = null;
        for (const row of rows.filter((item) => item.period === period)) {
          const dataKey = `${period}_${segmentIndex}`;
          const value = numeric(row[dataKey]);
          if (value === null) continue;
          const delta = last === null ? null : value - last;
          last = value;
          row[dataKey] = delta;
        }
      }
    });
  }
  return rows;
};

const buildOverviewRows = (
  segments: AbaChartSegment[],
  axis: AnalyticsAxis,
  comparePrevious: boolean,
  days: number,
  sessionCount: number,
  anchorMs: number,
) => {
  const allPoints = segments.flatMap((segment) => Array.isArray(segment.points) ? segment.points : []);
  const sessionMap = axis === 'session' ? buildSessionPeriodMap(allPoints, sessionCount) : new Map<string, { period: PeriodKind; displayIndex: number; time: number }>();
  const rows = new Map<string, Record<string, any>>();
  const seen = new Set<string>();

  for (const segment of segments) {
    const domain = domainForSegment(segment);
    for (const point of segment.points || []) {
      const id = clean(point.session_id) || clean(point.source_id);
      const period = axis === 'date' ? periodForDate(point, anchorMs, days) : sessionMap.get(id)?.period || null;
      if (!period || (!comparePrevious && period === 'previous')) continue;
      const baseKey = axis === 'date' ? localDateKey(clean(point.occurred_at)) : id;
      if (!baseKey) continue;
      const bucketKey = `${period}::${baseKey}`;
      if (!rows.has(bucketKey)) {
        const sessionInfo = axis === 'session' ? sessionMap.get(baseKey) : null;
        rows.set(bucketKey, {
          bucketKey,
          period,
          sortTime: axis === 'session' ? (sessionInfo?.time || timestamp(point.occurred_at)) : timestamp(`${baseKey}T12:00:00`),
          x: axis === 'session' ? `Sessão ${sessionInfo?.displayIndex || rows.size + 1}` : shortDate(baseKey),
          xDetail: axis === 'session' ? `${fullDate(clean(point.occurred_at))} · ${baseKey}` : fullDate(baseKey),
          skills: 0,
          behaviors: 0,
          maintenance: 0,
        });
      }
      const identity = `${bucketKey}::${domain}::${clean(segment.target_id)}::${clean(point.source_id) || id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.get(bucketKey)![domain] += 1;
    }
  }
  return Array.from(rows.values()).sort((left, right) => Number(left.sortTime) - Number(right.sortTime));
};

function AbaAnalyticsTooltip({ active, payload, label, segmentByKey, unit, changesMode }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5 break-all text-slate-500 dark:text-slate-400">{row.xDetail}{row.period === 'previous' ? ' · período anterior' : ''}</p>
      <div className="mt-2 space-y-2">
        {payload.filter((item: any) => item.value !== null && item.value !== undefined).map((item: any) => {
          const segment = segmentByKey.get(String(item.dataKey || '')) as AbaChartSegment | undefined;
          const meta = row[`meta_${item.dataKey}`] as BucketMeta | undefined;
          return (
            <div key={`${item.dataKey}-${item.name}`} className="border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0 dark:border-slate-800">
              <div className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate">{clean(segment?.series_label) || clean(segment?.target_name) || item.name}</span></span>
                <strong>{changesMode && Number(item.value) > 0 ? '+' : ''}{displayValue(item.value, unit)}</strong>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{clean(segment?.phase_label) || clean(segment?.phase_type) || 'Fase clínica'}{meta?.denominator ? ` · ${Math.round(meta.numerator || 0)}/${Math.round(meta.denominator)} elegíveis` : ''}</p>
              {meta?.requiresReview && <p className="mt-0.5 text-[10px] font-medium text-red-600 dark:text-red-300">Revisão recomendada</p>}
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
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      <p className="font-semibold">{label}</p>
      <p className="mt-0.5 break-all text-slate-500 dark:text-slate-400">{row.xDetail}{row.period === 'previous' ? ' · período anterior' : ''}</p>
      <div className="mt-2 space-y-1">
        {payload.filter((item: any) => Number(item.value) > 0).map((item: any) => <p key={item.dataKey}>{item.name}: <strong>{item.value}</strong></p>)}
      </div>
    </div>
  );
}

export function AbaV3ClinicalChartPanel({ patientId, organizationId = null, isPanelDark = false, onShareDescriptorChange }: Props) {
  const anchorNowRef = useRef(Date.now());
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [activeDomain, setActiveDomain] = useState<AnalyticsDomain>('overview');
  const [axis, setAxis] = useState<AnalyticsAxis>('session');
  const [days, setDays] = useState(90);
  const [sessionCount, setSessionCount] = useState(10);
  const [comparePrevious, setComparePrevious] = useState(true);
  const [metricSignature, setMetricSignature] = useState('');

  const catalogQuery = useClinicalAnalyticsQuery<any>({
    organizationId,
    patientId,
    family: 'aba-v3-catalog-overview',
  }, async () => {
    const [catalogResult, overviewResult] = await Promise.all([
      dataService.getAbaV3ChartCatalog(patientId),
      dataService.getAbaV3PatientOverview(patientId),
    ]);
    if (catalogResult?.success === false && overviewResult?.success === false) {
      throw new Error(catalogResult?.error || overviewResult?.error || 'Não foi possível carregar os dados ABA V3.');
    }
    return { catalogResult, overviewResult };
  }, { staleMs: 30_000, keepPreviousData: true });

  const targets: AbaTargetCatalogRow[] = catalogQuery.data?.catalogResult?.success === false
    ? []
    : Array.isArray(catalogQuery.data?.catalogResult?.data?.targets)
      ? catalogQuery.data.catalogResult.data.targets
      : [];
  const overview = catalogQuery.data?.overviewResult?.success === false
    ? { targets: [], review_counts: { maintenance_probes: 0, ioa: 0 } }
    : catalogQuery.data?.overviewResult?.data || { targets: [], review_counts: { maintenance_probes: 0, ioa: 0 } };

  useEffect(() => {
    anchorNowRef.current = Date.now();
    setSelectedTargetIds((current) => {
      const allowed = new Set(targets.map((target: any) => clean(target.target_id)).filter(Boolean));
      const kept = current.filter((id) => allowed.has(id)).slice(0, 3);
      if (kept.length) return kept;
      const first = clean(targets[0]?.target_id);
      return first ? [first] : [];
    });
  }, [patientId, targets.map((target) => clean(target.target_id)).join('|')]);

  const fetchDays = axis === 'date' ? Math.min(365, days * 2) : 365;
  const bundleQuery = useClinicalAnalyticsQuery<any>({
    organizationId,
    patientId,
    family: 'aba-v3-series-bundle',
    params: { targetIds: selectedTargetIds.slice().sort(), days: fetchDays, limit: 180 },
  }, async () => {
    const result = await dataService.getAbaV3ChartSeriesBundle(patientId, selectedTargetIds, { days: fetchDays, limit: 180 });
    if (result?.success === false) throw new Error(result?.error || 'Não foi possível carregar a comparação ABA V3.');
    return result;
  }, { enabled: selectedTargetIds.length > 0, staleMs: 30_000, keepPreviousData: true });
  const bundle = bundleQuery.data?.data || { segments: [], available_metrics: [] };
  const loadingCatalog = catalogQuery.isLoading;
  const loadingBundle = bundleQuery.isLoading || bundleQuery.isRefreshing || bundleQuery.isPreviousData;
  const error = catalogQuery.error || bundleQuery.error;

  const segments: AbaChartSegment[] = Array.isArray(bundle?.segments) ? bundle.segments : [];
  const overviewTargets: AbaTargetState[] = Array.isArray(overview?.targets) ? overview.targets : [];
  const selectedOverviewTargets = useMemo(() => overviewTargets.filter((target) => selectedTargetIds.includes(clean(target.target_id))), [overviewTargets, selectedTargetIds]);
  const metricOptions = useMemo(() => metricOptionsForDomain(segments, activeDomain), [segments, activeDomain]);
  const activeMetric = useMemo(() => metricOptions.find((option) => option.signature === metricSignature) || metricOptions[0] || null, [metricOptions, metricSignature]);

  useEffect(() => {
    if (activeDomain === 'overview' || activeDomain === 'mastery') return;
    if (!metricOptions.length) {
      setActiveDomain('overview');
      setMetricSignature('');
      return;
    }
    if (!metricOptions.some((option) => option.signature === metricSignature)) setMetricSignature(metricOptions[0].signature);
  }, [activeDomain, metricOptions, metricSignature]);

  useEffect(() => {
    if (activeDomain === 'changes') setAxis('session');
  }, [activeDomain]);

  const selectedMetricSegments = activeMetric?.segments || [];
  const shareDescriptor = useMemo<AbaV3ShareDescriptor | null>(() => {
    if (
      activeDomain === 'overview'
      || activeDomain === 'mastery'
      || activeDomain === 'changes'
      || !activeMetric
      || selectedMetricSegments.length === 0
    ) return null;

    const seriesRefs = selectedMetricSegments.map((segment) => ({
      targetId: clean(segment.target_id),
      measurementModelVersion: clean(segment.measurement_model_version),
      phaseAssignmentId: clean(segment.phase_assignment_id),
      metricKey: clean(segment.metric_key),
      seriesKey: clean(segment.series_key),
    }));
    if (seriesRefs.some((ref) => !ref.targetId || !ref.measurementModelVersion || !ref.phaseAssignmentId || !ref.metricKey || !ref.seriesKey)) return null;

    seriesRefs.sort((left, right) =>
      `${left.targetId}:${left.measurementModelVersion}:${left.phaseAssignmentId}:${left.metricKey}:${left.seriesKey}`
        .localeCompare(`${right.targetId}:${right.measurementModelVersion}:${right.phaseAssignmentId}:${right.metricKey}:${right.seriesKey}`));

    return {
      schemaVersion: 1,
      family: 'ABA_V3',
      domain: activeDomain,
      metricSignature: activeMetric.signature,
      seriesRefs,
      axis,
      comparePrevious: Boolean(comparePrevious),
    };
  }, [activeDomain, activeMetric, axis, comparePrevious, selectedMetricSegments]);

  useEffect(() => {
    onShareDescriptorChange?.(shareDescriptor);
  }, [onShareDescriptorChange, shareDescriptor]);

  const rows = useMemo(() => activeDomain === 'overview'
    ? buildOverviewRows(segments, axis, comparePrevious, days, sessionCount, anchorNowRef.current)
    : activeDomain === 'mastery'
      ? []
      : buildChartRows(selectedMetricSegments, activeDomain === 'changes' ? 'session' : axis, comparePrevious, days, sessionCount, anchorNowRef.current, activeDomain === 'changes'),
  [activeDomain, axis, comparePrevious, days, sessionCount, segments, selectedMetricSegments]);

  const availableDomainCounts = useMemo(() => {
    const counts = { skills: 0, behaviors: 0, maintenance: 0, changes: 0 };
    for (const segment of segments) {
      counts[domainForSegment(segment)] += 1;
      if ((segment.points || []).filter((point) => numeric(point.value) !== null).length >= 2) counts.changes += 1;
    }
    return counts;
  }, [segments]);

  const toggleTarget = (targetId: string) => {
    setSelectedTargetIds((current) => {
      if (current.includes(targetId)) {
        if (current.length === 1) return current;
        return current.filter((id) => id !== targetId);
      }
      if (current.length >= 3) return current;
      return [...current, targetId];
    });
  };

  const tabAvailable = (domain: AnalyticsDomain) => {
    if (domain === 'overview') return segments.length > 0 || selectedOverviewTargets.length > 0;
    if (domain === 'mastery') return selectedOverviewTargets.length > 0;
    if (domain === 'changes') return availableDomainCounts.changes > 0;
    return availableDomainCounts[domain] > 0;
  };

  const activeColorDomain = activeDomain === 'changes'
    ? domainForSegment(selectedMetricSegments[0] || ({ source_family: 'DTT_NET_PROBE' } as AbaChartSegment))
    : activeDomain === 'overview' || activeDomain === 'mastery'
      ? 'skills'
      : activeDomain;
  const colorPalette = DOMAIN_COLORS[activeColorDomain as 'skills' | 'behaviors' | 'maintenance'] || DOMAIN_COLORS.skills;
  const targetColor = new Map(selectedTargetIds.map((id, index) => [id, colorPalette[index % colorPalette.length]]));
  const segmentByDataKey = new Map<string, AbaChartSegment>();
  selectedMetricSegments.forEach((segment, index) => {
    segmentByDataKey.set(`current_${index}`, segment);
    segmentByDataKey.set(`previous_${index}`, segment);
  });

  const currentRows = rows.filter((row) => row.period === 'current');
  const previousRows = rows.filter((row) => row.period === 'previous');
  const firstCurrentX = currentRows[0]?.x;
  const unit = activeMetric?.unit || '';
  const yLabel = activeDomain === 'changes' ? `Variação · ${unitAxisLabel(unit, activeMetric?.key)}` : unitAxisLabel(unit, activeMetric?.key);
  const percentMode = activeDomain !== 'changes' && unitSymbol(unit) === '%';
  const visibleReview = selectedMetricSegments.some((segment) => (segment.points || []).some((point) => point.requires_review));
  const selectedNames = selectedTargetIds.map((id) => clean(targets.find((target) => clean(target.target_id) === id)?.target_name) || id);

  const skillTargetCount = new Set(segments.filter((segment) => domainForSegment(segment) === 'skills').map((segment) => clean(segment.target_id)).filter(Boolean)).size;
  const behaviorTargetCount = new Set(segments.filter((segment) => domainForSegment(segment) === 'behaviors').map((segment) => clean(segment.target_id)).filter(Boolean)).size;
  const masteredTargetCount = selectedOverviewTargets.filter((target) => ['MASTERY_CRITERIA_MET', 'MASTERED'].includes(clean(target.state).toUpperCase())).length;
  const maintenanceTargetCount = selectedOverviewTargets.filter((target) => clean(target.state).toUpperCase() === 'MAINTENANCE').length;
  const attentionCount = selectedOverviewTargets.filter((target) => ['MAINTENANCE_ALERT', 'REACQUISITION'].includes(clean(target.state).toUpperCase())).length;
  const globalMaintenanceReviewCount = Number(overview?.review_counts?.maintenance_probes || 0);
  const globalIoaReviewCount = Number(overview?.review_counts?.ioa || 0);

  const panel = isPanelDark ? 'border-slate-700 bg-[#101b2e] text-slate-100' : 'border-slate-200 bg-white text-slate-900';
  const subtle = isPanelDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <section className={`overflow-hidden rounded-2xl border ${panel}`} data-testid="aba-v3-segmented-chart-panel">
      <div className={`border-b px-3 pt-3 sm:px-4 sm:pt-4 ${isPanelDark ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className={`text-[10px] font-medium uppercase tracking-[0.14em] ${isPanelDark ? 'text-violet-300' : 'text-violet-600'}`}>ABA V3</p>
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">Fases separadas</span>
            </div>
            <h2 className="mt-1 text-base font-semibold">Evolução clínica</h2>
            <p className={`mt-1 max-w-3xl text-xs ${subtle}`}>Escolha o domínio, a métrica e até 3 alvos. O gráfico preserva denominadores, fases clínicas e a separação entre ABA V3 e histórico Legacy.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-300"><ShieldCheck size={15} /> Leitura canônica</div>
        </div>

        {targets.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <p className={`text-[11px] font-medium uppercase tracking-wide ${subtle}`}>Alvos no gráfico · até 3</p>
              <p className={`text-[11px] ${subtle}`}>{selectedTargetIds.length}/3 selecionados</p>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {targets.map((target) => {
                const id = clean(target.target_id);
                const selected = selectedTargetIds.includes(id);
                const disabled = !selected && selectedTargetIds.length >= 3;
                return <button key={id} type="button" disabled={disabled} aria-pressed={selected} onClick={() => toggleTarget(id)} className={`min-h-10 shrink-0 rounded-xl border px-3 text-xs font-medium ${selected ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200' : isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'} disabled:cursor-not-allowed disabled:opacity-35`}>{clean(target.target_name) || id}</button>;
              })}
            </div>
          </div>
        )}

        <nav className="mt-3 flex gap-1 overflow-x-auto" aria-label="Domínios ABA V3">
          {DOMAIN_TABS.map((tab) => {
            const available = tabAvailable(tab.id);
            return <button key={tab.id} type="button" disabled={!available} aria-pressed={activeDomain === tab.id} onClick={() => available && setActiveDomain(tab.id)} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition ${activeDomain === tab.id ? DOMAIN_ACTIVE_TONE[tab.id] : `border-transparent ${subtle} hover:text-violet-600`} disabled:cursor-not-allowed disabled:opacity-35`}>{tab.label}</button>;
          })}
        </nav>
      </div>

      <div className="p-3 sm:p-4">
        {error && <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"><AlertCircle className="mt-0.5 shrink-0" size={17} /><span>{error}</span></div>}

        {activeDomain !== 'mastery' && (
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-1 rounded-xl border p-1 dark:border-slate-700">
              <button type="button" disabled={activeDomain === 'changes'} aria-pressed={axis === 'date'} onClick={() => activeDomain !== 'changes' && setAxis('date')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium ${axis === 'date' ? 'bg-violet-600 text-white' : `${subtle} hover:text-violet-600`} disabled:cursor-not-allowed disabled:opacity-35`}><CalendarDays size={14} /> Por data</button>
              <button type="button" aria-pressed={axis === 'session'} onClick={() => setAxis('session')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium ${axis === 'session' ? 'bg-violet-600 text-white' : `${subtle} hover:text-violet-600`}`}><Layers3 size={14} /> Por sessão</button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {axis === 'date' && activeDomain !== 'changes' ? [30, 90, 180].map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)} className={`min-h-10 rounded-xl border px-3 text-xs font-medium ${days === value ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200' : isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>{value}d</button>) : [5, 10, 20].map((value) => <button key={value} type="button" aria-pressed={sessionCount === value} onClick={() => setSessionCount(value)} className={`min-h-10 rounded-xl border px-3 text-xs font-medium ${sessionCount === value ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200' : isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>{value} sessões</button>)}
              <button type="button" aria-pressed={comparePrevious} onClick={() => setComparePrevious((value) => !value)} className={`min-h-10 rounded-xl border px-3 text-xs font-medium ${comparePrevious ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200' : isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>Comparar anteriores</button>
            </div>
          </div>
        )}

        {activeDomain !== 'overview' && activeDomain !== 'mastery' && activeMetric && (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Métricas ABA V3">
            {metricOptions.map((option) => <button key={option.signature} type="button" aria-pressed={activeMetric.signature === option.signature} onClick={() => setMetricSignature(option.signature)} className={`min-h-10 shrink-0 rounded-xl border px-3 text-xs font-medium ${activeMetric.signature === option.signature ? DOMAIN_SOFT_TONE[activeDomain as Exclude<AnalyticsDomain, 'overview'>] : isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>{option.label}</button>)}
          </div>
        )}

        {loadingCatalog && targets.length === 0 ? (
          <div className={`h-[300px] animate-pulse rounded-2xl ${isPanelDark ? 'bg-slate-800' : 'bg-slate-100'}`} />
        ) : activeDomain === 'mastery' ? (
          <div data-testid="aba-v3-mastery-state-panel">
            <div className="mb-3">
              <p className="text-sm font-semibold">Estado de maestria por alvo</p>
              <p className={`mt-0.5 text-xs ${subtle}`}>O estado abaixo vem do FSM clínico V3. A interface não recalcula maestria nem reaquisição.</p>
            </div>
            {selectedOverviewTargets.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {selectedOverviewTargets.map((target) => {
                  const automatic = target.auto_mastery_enabled === true;
                  const threshold = numeric(target.mastery_threshold_percent);
                  const minTrials = numeric(target.mastery_min_eligible_trials);
                  const consecutive = numeric(target.mastery_consecutive_sessions);
                  return (
                    <article key={clean(target.target_id)} className={`rounded-2xl border p-3 ${isPanelDark ? 'border-slate-700 bg-slate-900/45' : 'border-slate-200 bg-slate-50/70'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{clean(target.target_name) || clean(target.target_id)}</p>
                          {clean(target.program_name) && <p className={`mt-0.5 truncate text-[11px] ${subtle}`}>{clean(target.program_name)}</p>}
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${stateTone(target.state)}`}>{stateLabel(target.state)}</span>
                      </div>
                      <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${isPanelDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>
                        {automatic && threshold !== null && minTrials !== null && consecutive !== null
                          ? <>Critério: ≥ <strong>{threshold}%</strong> · ≥ <strong>{minTrials}</strong> oportunidades · <strong>{consecutive}</strong> sessões consecutivas.</>
                          : automatic
                            ? 'Critério automático configurado parcialmente; consulte a configuração do alvo.'
                            : 'Maestria automática desativada para este alvo.'}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Nenhum estado de maestria V3 disponível para os alvos selecionados.</div>}
          </div>
        ) : activeDomain === 'overview' ? (
          <div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {[
                { label: 'Habilidades', value: skillTargetCount, tone: 'text-emerald-700 dark:text-emerald-300' },
                { label: 'Comportamentos', value: behaviorTargetCount, tone: 'text-sky-700 dark:text-sky-300' },
                { label: 'Maestria', value: masteredTargetCount, tone: 'text-violet-700 dark:text-violet-300' },
                { label: 'Manutenção', value: maintenanceTargetCount, tone: 'text-amber-700 dark:text-amber-300' },
                { label: 'Atenções', value: attentionCount, tone: 'text-red-700 dark:text-red-300' },
              ].map((card) => <div key={card.label} className={`rounded-xl border px-3 py-2.5 ${isPanelDark ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}><p className={`text-lg font-semibold ${card.tone}`}>{card.value}</p><p className={`mt-0.5 text-[11px] ${subtle}`}>{card.label}</p></div>)}
            </div>

            {(globalMaintenanceReviewCount > 0 || globalIoaReviewCount > 0) && <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>Revisões V3 pendentes no paciente: manutenção <strong>{globalMaintenanceReviewCount}</strong> · IOA <strong>{globalIoaReviewCount}</strong>. Este aviso é global do paciente e não altera os valores dos alvos selecionados.</span></div>}

            <div className="mt-4 mb-3">
              <p className="text-sm font-semibold">Atividade clínica por domínio</p>
              <p className={`mt-0.5 text-xs ${subtle}`}>Contagem de registros distintos nos alvos selecionados. Não é score e não soma unidades incompatíveis.</p>
            </div>
            {rows.length > 0 ? <div className="h-[330px] min-w-0 overflow-x-auto sm:h-[380px]"><div className="h-full" style={{ minWidth: Math.max(620, rows.length * 72) }}><SafeResponsiveContainer width="100%" height="100%" minHeight={300}><BarChart data={rows} margin={{ top: 18, right: 22, left: 8, bottom: 44 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isPanelDark ? '#334155' : '#E2E8F0'} /><XAxis dataKey="x" tick={{ fontSize: 10, fill: isPanelDark ? '#94A3B8' : '#64748B' }} angle={-18} textAnchor="end" height={58} interval={0} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: isPanelDark ? '#94A3B8' : '#64748B' }} label={{ value: 'Registros distintos', angle: -90, position: 'insideLeft', fontSize: 10 }} /><Tooltip content={<OverviewTooltip />} />{comparePrevious && firstCurrentX && <ReferenceLine x={firstCurrentX} stroke={isPanelDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="4 4" label={{ value: 'Período atual', fontSize: 9, position: 'insideTopLeft' }} />}<Bar dataKey="skills" name="Habilidades" stackId="domains" fill={DOMAIN_COLORS.skills[0]} maxBarSize={52} /><Bar dataKey="behaviors" name="Comportamentos" stackId="domains" fill={DOMAIN_COLORS.behaviors[0]} maxBarSize={52} /><Bar dataKey="maintenance" name="Manutenção" stackId="domains" fill={DOMAIN_COLORS.maintenance[0]} maxBarSize={52} /></BarChart></SafeResponsiveContainer></div></div> : <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}>Ainda não há atividade V3 comparável no período selecionado.</div>}
          </div>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{activeDomain === 'changes' ? 'Mudanças entre sessões' : activeMetric?.label || 'Métrica clínica'}</p>
                <p className={`mt-0.5 text-[11px] ${subtle}`}>{currentRows.length} ponto(s) no período atual{comparePrevious ? ` · ${previousRows.length} no anterior` : ''} · {yLabel}</p>
              </div>
              <div className={`flex flex-wrap items-center gap-3 text-[11px] ${subtle}`}>
                {selectedNames.map((name, index) => <span key={name} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorPalette[index % colorPalette.length] }} />{name}</span>)}
                {comparePrevious && <><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-6 bg-violet-600" /> Atual</span><span className="inline-flex items-center gap-1.5"><span className="h-0 w-6 border-t-2 border-dashed border-violet-400" /> Anterior</span></>}
              </div>
            </div>

            {visibleReview && <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><AlertCircle size={14} className="mt-0.5 shrink-0" />Há ponto(s) com revisão recomendada. Eles permanecem visíveis e identificados no tooltip; não são descartados silenciosamente.</div>}

            {rows.length > 0 && selectedMetricSegments.length > 0 ? (
              <div className="h-[350px] min-w-0 overflow-x-auto sm:h-[400px]">
                <div className="h-full" style={{ minWidth: Math.max(640, rows.length * 78) }}>
                  <SafeResponsiveContainer width="100%" height="100%" minHeight={320}>
                    <LineChart data={rows} margin={{ top: 18, right: 22, left: 10, bottom: 44 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isPanelDark ? '#334155' : '#E2E8F0'} />
                      <XAxis dataKey="x" tick={{ fontSize: 10, fill: isPanelDark ? '#94A3B8' : '#64748B' }} angle={-18} textAnchor="end" height={58} interval={0} />
                      <YAxis tick={{ fontSize: 10, fill: isPanelDark ? '#94A3B8' : '#64748B' }} domain={percentMode ? [0, 100] : ['auto', 'auto']} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 10 }} />
                      <Tooltip content={<AbaAnalyticsTooltip segmentByKey={segmentByDataKey} unit={unit} changesMode={activeDomain === 'changes'} />} />
                      {activeDomain === 'changes' && <ReferenceLine y={0} stroke={isPanelDark ? '#64748B' : '#94A3B8'} strokeDasharray="3 3" />}
                      {comparePrevious && firstCurrentX && <ReferenceLine x={firstCurrentX} stroke={isPanelDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="4 4" label={{ value: 'Período atual', fontSize: 9, position: 'insideTopLeft' }} />}
                      {selectedMetricSegments.map((segment, index) => {
                        const color = targetColor.get(clean(segment.target_id)) || colorPalette[index % colorPalette.length];
                        const name = clean(segment.series_label) || clean(segment.target_name) || clean(segment.metric_label);
                        return <React.Fragment key={`${clean(segment.target_id)}:${clean(segment.phase_assignment_id)}:${clean(segment.series_key)}:${clean(segment.metric_key)}`}>
                          {comparePrevious && <Line type="linear" dataKey={`previous_${index}`} name={`${name} · anterior`} stroke={color} strokeOpacity={0.42} strokeDasharray="6 5" strokeWidth={2} dot={{ r: 2.5, fill: color, fillOpacity: 0.42 }} activeDot={{ r: 5 }} connectNulls={false} />}
                          <Line type="linear" dataKey={`current_${index}`} name={name} stroke={color} strokeWidth={2.7} dot={{ r: 3.5, fill: color, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 6 }} connectNulls={false} />
                        </React.Fragment>;
                      })}
                    </LineChart>
                  </SafeResponsiveContainer>
                </div>
              </div>
            ) : <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${isPanelDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'}`}><Target className="mx-auto mb-2" size={24} />Ainda não há pontos comparáveis para esta métrica e período.</div>}
          </div>
        )}

        {loadingBundle && segments.length > 0 && <p className={`mt-3 text-[11px] ${subtle}`}>Atualizando comparação sem remover os dados já exibidos…</p>}

        <div className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${isPanelDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          <Activity size={15} className="mt-0.5 shrink-0 text-violet-500" />
          <span>Fases clínicas são séries independentes e nunca são conectadas entre si. O histórico Legacy V2 permanece separado. Independência, acurácia, tentativas, frequência, duração e intervalos mantêm suas unidades e denominadores canônicos.</span>
        </div>
      </div>
    </section>
  );
}
