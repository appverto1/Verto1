import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, Layers3, Target } from 'lucide-react';
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
  type ClinicalOutcomeObservation,
  type ClinicalOutcomeSeriesSummary,
} from '../utils/clinicalOutcomeAnalytics';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';

type AnalyticsDomain = 'overview' | 'skills' | 'behaviors' | 'mastery' | 'maintenance' | 'changes';
type AnalyticsAxis = 'date' | 'session';

type ClinicalPlanAnalyticsShellProps = {
  scopeLabel: string;
  series: ClinicalOutcomeSeriesSummary[];
  previousSeriesByKey: Map<string, ClinicalOutcomeSeriesSummary>;
  comparePrevious: boolean;
  isDark?: boolean;
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

const OVERVIEW_BARS = [
  { key: 'skills', label: 'Habilidades', color: DOMAIN_COLORS.skills[0] },
  { key: 'behaviors', label: 'Comportamentos', color: DOMAIN_COLORS.behaviors[0] },
  { key: 'mastery', label: 'Maestria', color: DOMAIN_COLORS.mastery[0] },
  { key: 'maintenance', label: 'Manutenção', color: DOMAIN_COLORS.maintenance[0] },
  { key: 'alerts', label: 'Regressão/alertas', color: DOMAIN_COLORS.alerts[0] },
] as const;

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

const isRegressionAlertSeries = (series: ClinicalOutcomeSeriesSummary) => {
  const key = clean(series.metricKey).toUpperCase();
  const label = clean(series.metricLabel).toLocaleLowerCase('pt-BR');
  return key.includes('REGRESSION') || key.includes('ALERT') || key.includes('RISK') || label.includes('regress') || label.includes('alerta');
};

const analyticsDomainForSeries = (series: ClinicalOutcomeSeriesSummary): Exclude<AnalyticsDomain, 'overview' | 'changes'> => {
  const key = clean(series.metricKey).toUpperCase();
  const label = clean(series.metricLabel).toLocaleLowerCase('pt-BR');
  if (key.includes('BEHAVIOR') || label.includes('comportamento') || label.includes('frequência') || label.includes('duração')) return 'behaviors';
  if (key.includes('MASTERY') || label.includes('maestria') || label.includes('domínio')) return 'mastery';
  if (key.includes('MAINTENANCE') || key.includes('REGRESSION') || label.includes('manutenção') || label.includes('regress')) return 'maintenance';
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

const displayValue = (value: unknown, unit: string) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const rounded = Math.round(numeric * 10) / 10;
  if (unit === '%') return `${rounded}%`;
  if (!unit) return String(rounded);
  return `${rounded} ${unit}`;
};

const sessionIdentity = (observation: ClinicalOutcomeObservation) => clean(observation.sessionId) || `obs:${observation.id}`;
const sessionDisplayLabel = (observation: ClinicalOutcomeObservation, index: number) => clean(observation.metadata?.sessionLabel || observation.metadata?.session_label) || `Sessão ${index + 1}`;

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
      label: sessionDisplayLabel(row.observation, index),
      detail: `${fullDate(row.observation.observedAt)}${clean(row.observation.metadata?.sessionLabel || row.observation.metadata?.session_label) ? ` · ${clean(row.observation.metadata?.sessionLabel || row.observation.metadata?.session_label)}` : ''}`,
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
      label: axis === 'session' ? (session?.label || `Sessão ${buckets.size + 1}`) : shortDate(dateKey),
      detail: axis === 'session' ? (session?.detail || fullDate(row.observation.observedAt)) : fullDate(dateKey),
      sortTime: axis === 'session' ? (session?.sortTime || timestamp(row.observation.observedAt)) : timestamp(`${dateKey}T12:00:00`),
      period: row.period,
    });
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
  const allSeries = [...currentSeries, ...previousSeries];
  const buckets = collectBuckets(currentSeries, previousSeriesByKey, comparePrevious, axis);
  const rows = buckets.map((bucket) => ({ x: bucket.label, xDetail: bucket.detail, period: bucket.period, sortTime: bucket.sortTime, skills: 0, behaviors: 0, mastery: 0, maintenance: 0, alerts: 0 }));
  const index = new Map(buckets.map((bucket, rowIndex) => [bucket.key, rowIndex]));
  const seen = new Set<string>();

  const countSeries = (series: ClinicalOutcomeSeriesSummary, period: 'current' | 'previous') => {
    for (const observation of series.validObservations) {
      const baseKey = axis === 'session' ? sessionIdentity(observation) : localDateKey(observation.observedAt);
      const bucketKey = `${period}::${baseKey}`;
      const rowIndex = index.get(bucketKey);
      if (rowIndex === undefined) continue;
      const domain = isRegressionAlertSeries(series) ? 'alerts' : analyticsDomainForSeries(series);
      const identity = `${bucketKey}::${domain}::${sessionIdentity(observation)}::${clean(observation.itemId || observation.goalId || observation.programId) || observation.id}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows[rowIndex][domain] += 1;
    }
  };

  currentSeries.forEach((series) => countSeries(series, 'current'));
  previousSeries.forEach((series) => countSeries(series, 'previous'));
  return rows;
};

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
              <strong>{changesMode && Number(item.value) > 0 ? '+' : ''}{displayValue(item.value, unit)}</strong>
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
      <p className="mt-0.5 text-slate-500 dark:text-slate-400">{row.xDetail}{row.period === 'previous' ? ' · período anterior' : ''}</p>
      <div className="mt-2 space-y-1">
        {payload.filter((item: any) => Number(item.value) > 0).map((item: any) => <p key={item.dataKey}>{item.name}: <strong>{item.value}</strong></p>)}
      </div>
    </div>
  );
}

export function ClinicalPlanAnalyticsShell({ scopeLabel, series, previousSeriesByKey, comparePrevious, isDark = false }: ClinicalPlanAnalyticsShellProps) {
  const [activeDomain, setActiveDomain] = useState<AnalyticsDomain>('overview');
  const [axis, setAxis] = useState<AnalyticsAxis>('session');
  const [metricSignatureValue, setMetricSignatureValue] = useState('');
  const [selectedSeriesKeys, setSelectedSeriesKeys] = useState<string[]>([]);

  const availableDomainCounts = useMemo(() => {
    const counts = { skills: 0, behaviors: 0, mastery: 0, maintenance: 0, changes: 0 };
    for (const item of series) {
      counts[analyticsDomainForSeries(item)] += 1;
      if (supportsSessionChange(item)) counts.changes += 1;
    }
    return counts;
  }, [series]);

  const metricOptions = useMemo(() => activeDomain === 'overview' ? [] : metricOptionsForDomain(series, activeDomain), [activeDomain, series]);
  const activeMetric = useMemo(() => metricOptions.find((option) => option.signature === metricSignatureValue) || metricOptions[0] || null, [metricOptions, metricSignatureValue]);

  useEffect(() => {
    if (activeDomain === 'overview') return;
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
    if (activeDomain === 'changes') setAxis('session');
  }, [activeDomain]);

  const selectedSeries = useMemo(() => activeMetric
    ? activeMetric.series.filter((item) => selectedSeriesKeys.includes(item.key)).slice(0, 3)
    : [], [activeMetric, selectedSeriesKeys]);

  const domainForColor = activeDomain === 'changes'
    ? analyticsDomainForSeries(selectedSeries[0] || series[0] || ({ metricKey: '' } as ClinicalOutcomeSeriesSummary))
    : activeDomain === 'overview'
      ? 'skills'
      : activeDomain;
  const lineColors = DOMAIN_COLORS[domainForColor as keyof typeof DOMAIN_COLORS] || DOMAIN_COLORS.skills;

  const rows = useMemo(() => activeDomain === 'overview'
    ? overviewRows(series, previousSeriesByKey, comparePrevious, axis)
    : chartRowsForSeries(selectedSeries, previousSeriesByKey, comparePrevious, activeDomain === 'changes' ? 'session' : axis, activeDomain === 'changes'),
  [activeDomain, axis, comparePrevious, previousSeriesByKey, selectedSeries, series]);

  const firstCurrentX = rows.find((row) => row.period === 'current')?.x;
  const numericValues = selectedSeries.flatMap((item) => item.validObservations.map((row) => row.value)).filter((value): value is number => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
  const unitLabel = activeDomain === 'changes'
    ? `Variação · ${activeMetric?.unitLabel || 'valor clínico'}`
    : activeMetric?.unitLabel || 'Valor clínico';
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

  if (!series.length) return null;

  const panel = isDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-200 bg-white';
  const subtle = isDark ? 'text-slate-400' : 'text-slate-500';
  const text = isDark ? 'text-slate-100' : 'text-slate-900';

  return (
    <section className={`overflow-hidden rounded-2xl border ${panel}`} data-testid="clinical-plan-analytics-shell">
      <div className={`border-b px-3 pt-3 sm:px-4 sm:pt-4 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={`text-[10px] font-medium uppercase tracking-[0.14em] ${isDark ? 'text-violet-300' : 'text-violet-600'}`}>Leitura clínica</p>
            <h2 className={`mt-1 text-base font-semibold ${text}`}>{scopeLabel}</h2>
            <p className={`mt-1 text-xs ${subtle}`}>Escolha o domínio e a métrica. Séries incompatíveis continuam separadas.</p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border p-1 dark:border-slate-700">
            <button type="button" aria-pressed={axis === 'date'} onClick={() => activeDomain !== 'changes' && setAxis('date')} disabled={activeDomain === 'changes'} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium ${axis === 'date' ? 'bg-violet-600 text-white' : `${subtle} hover:text-violet-600`} disabled:cursor-not-allowed disabled:opacity-40`}><CalendarDays size={14} /> Por data</button>
            <button type="button" aria-pressed={axis === 'session'} onClick={() => setAxis('session')} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium ${axis === 'session' ? 'bg-violet-600 text-white' : `${subtle} hover:text-violet-600`}`}><Layers3 size={14} /> Por sessão</button>
          </div>
        </div>

        <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Domínios dos gráficos do plano">
          {DOMAIN_TABS.map((tab) => {
            const available = tabAvailability(tab.id);
            return <button key={tab.id} type="button" disabled={!available} aria-pressed={activeDomain === tab.id} onClick={() => available && setActiveDomain(tab.id)} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition ${activeDomain === tab.id ? DOMAIN_ACTIVE_TONE[tab.id] : `border-transparent ${subtle} hover:text-violet-600`} disabled:cursor-not-allowed disabled:opacity-35`}>{tab.label}</button>;
          })}
        </nav>
      </div>

      <div className="p-3 sm:p-4">
        {activeDomain !== 'overview' && activeMetric && (
          <div className="mb-4 space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Métricas clínicas">
              {metricOptions.map((option) => <button key={option.signature} type="button" aria-pressed={activeMetric.signature === option.signature} onClick={() => setMetricSignatureValue(option.signature)} className={`min-h-10 shrink-0 rounded-xl border px-3 text-xs font-medium ${activeMetric.signature === option.signature ? DOMAIN_SOFT_TONE[activeDomain as Exclude<AnalyticsDomain, 'overview'>] : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'}`}>{option.label}</button>)}
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <p className={`text-[11px] font-medium uppercase tracking-wide ${subtle}`}>Alvos no gráfico · até 3</p>
                {activeMetric.series.length > 3 && <p className={`text-[11px] ${subtle}`}>{selectedSeriesKeys.length}/3 selecionados</p>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeMetric.series.map((item) => {
                  const selected = selectedSeriesKeys.includes(item.key);
                  const disabled = !selected && selectedSeriesKeys.length >= 3;
                  return <button key={item.key} type="button" disabled={disabled} aria-pressed={selected} onClick={() => toggleSeries(item.key)} className={`min-h-10 rounded-xl border px-3 text-xs ${selected ? DOMAIN_SOFT_TONE[activeDomain as Exclude<AnalyticsDomain, 'overview'>] : isDark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'} disabled:cursor-not-allowed disabled:opacity-35`}>{item.itemLabel || item.metricLabel}</button>;
                })}
              </div>
            </div>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${text}`}>{activeDomain === 'overview' ? 'Registros clínicos por domínio' : activeDomain === 'changes' ? 'Mudanças entre sessões' : activeMetric?.label}</p>
            <p className={`mt-0.5 text-[11px] ${subtle}`}>{activeDomain === 'overview' ? 'Contagem de registros distintos; não é um score clínico.' : `${activeCount} ponto(s) no período atual${comparePrevious ? ` · ${previousCount} no período anterior` : ''} · ${unitLabel}`}</p>
          </div>
          {comparePrevious && <div className={`flex items-center gap-3 text-[11px] ${subtle}`}><span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-6 bg-violet-600" /> Atual</span><span className="inline-flex items-center gap-1.5"><span className="h-0 w-6 border-t-2 border-dashed border-violet-400" /> Anterior</span></div>}
        </div>

        <div className="h-[330px] min-w-0 overflow-x-auto sm:h-[380px]">
          <div className="h-full" style={{ minWidth: Math.max(620, rows.length * 72) }}>
            <SafeResponsiveContainer width="100%" height="100%" minHeight={300}>
              {activeDomain === 'overview' ? (
                <BarChart data={rows} margin={{ top: 18, right: 22, left: 8, bottom: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
                  <XAxis dataKey="x" tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }} angle={-18} textAnchor="end" height={58} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }} label={{ value: 'Registros distintos', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip content={<OverviewTooltip />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.06)' : 'rgba(124,58,237,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {comparePrevious && firstCurrentX && <ReferenceLine x={firstCurrentX} stroke={isDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="4 4" label={{ value: 'Período atual', fontSize: 9, position: 'insideTopLeft' }} />}
                  {OVERVIEW_BARS.map((item) => <Bar key={item.key} dataKey={item.key} name={item.label} stackId="domains" fill={item.color} maxBarSize={52} />)}
                </BarChart>
              ) : (
                <LineChart data={rows} margin={{ top: 18, right: 22, left: 8, bottom: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#E2E8F0'} />
                  <XAxis dataKey="x" tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }} angle={-18} textAnchor="end" height={58} interval={0} />
                  <YAxis
                    tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }}
                    domain={percentMode ? [0, 100] : ratioMode ? [0, 1] : ['auto', 'auto']}
                    label={{ value: unitLabel, angle: -90, position: 'insideLeft', fontSize: 10 }}
                  />
                  <Tooltip content={<AnalyticsTooltip unit={unit} selectedSeries={selectedSeries} changesMode={activeDomain === 'changes'} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {activeDomain === 'changes' && <ReferenceLine y={0} stroke={isDark ? '#64748B' : '#94A3B8'} strokeDasharray="3 3" />}
                  {comparePrevious && firstCurrentX && <ReferenceLine x={firstCurrentX} stroke={isDark ? '#A78BFA' : '#7C3AED'} strokeDasharray="4 4" label={{ value: 'Período atual', fontSize: 9, position: 'insideTopLeft' }} />}
                  {selectedSeries.map((item, index) => {
                    const color = lineColors[index % lineColors.length];
                    const name = item.itemLabel || item.metricLabel;
                    return <React.Fragment key={item.key}>
                      {comparePrevious && <Line type="linear" dataKey={`previous_${index}`} name={`${name} · anterior`} stroke={color} strokeOpacity={0.42} strokeDasharray="6 5" strokeWidth={2} dot={{ r: 2.5, fill: color, fillOpacity: 0.42 }} activeDot={{ r: 5 }} connectNulls={false} />}
                      <Line type="linear" dataKey={`current_${index}`} name={name} stroke={color} strokeWidth={2.7} dot={{ r: 3.5, fill: color, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 6 }} connectNulls={false} />
                    </React.Fragment>;
                  })}
                </LineChart>
              )}
            </SafeResponsiveContainer>
          </div>
        </div>

        {activeDomain !== 'overview' && selectedSeries.length === 0 && <div className="py-10 text-center"><Target className="mx-auto text-slate-300" size={26} /><p className={`mt-2 text-sm ${subtle}`}>Selecione ao menos um alvo para visualizar.</p></div>}
        {activeDomain === 'overview' && <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${isDark ? 'border-slate-700 bg-slate-900/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}><Activity size={15} className="mt-0.5 shrink-0 text-violet-500" /><span>A visão geral mostra atividade clínica por domínio para facilitar a leitura rápida. Percentuais, duração, frequência e outras unidades não são somados entre si.</span></div>}
      </div>
    </section>
  );
}
