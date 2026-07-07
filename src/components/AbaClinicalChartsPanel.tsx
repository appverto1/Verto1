import React, { useEffect, useMemo, useState } from 'react';
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
  YAxis
} from 'recharts';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Filter,
  LineChart as LineChartIcon,
  ListTree,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  X
} from 'lucide-react';
import { SafeResponsiveContainer } from './SafeResponsiveContainer';
import { dataService } from '../services/dataService';
import {
  ABA_CLINICAL_LINE_METRICS,
  aggregateClinicalChangesBySession,
  buildBehaviorCompositionStack,
  getClinicalChangeDrilldown,
  type AbaAggregatedClinicalChange,
  type AbaAggregatedClinicalChangeGroup,
  type AbaBehaviorCompositionRow,
  type AbaBehaviorCompositionSeries,
  type AbaBehaviorContextDistributionValue,
  type AbaBehaviorContextPattern,
  type AbaClinicalChangeCategory,
  type AbaClinicalLineCategory
} from '../utils/abaClinicalCharts';
import { formatSessionLabel, safeDisplayValue } from '../utils/displayLabels';

type AbaClinicalChartsPanelProps = {
  patientId: string;
  isPanelDark?: boolean;
};

type ChartPoint = {
  id?: string;
  sessionId?: string | null;
  targetId?: string | null;
  behaviorId?: string | null;
  metricType?: string;
  metricLabel?: string;
  value?: number | string | null;
  metricValue?: number | string | null;
  previousValue?: number | string | null;
  deltaValue?: number | string | null;
  deltaPercent?: number | string | null;
  trendDirection?: string;
  changeStatus?: string;
  statusLabel?: string;
  metricDirection?: string;
  changedAt?: string;
  x?: string;
  chartValue?: number;
  currentStatus?: string;
  masteryStatus?: string;
  mostUsedTrialType?: string;
  trialTypeMostUsed?: string;
  sessionLabel?: string;
  itemId?: string | null;
  itemLabel?: string;
  metric?: string;
  secondaryValues?: Record<string, number | null>;
  attemptsCount?: number | null;
  prompt?: string | null;
  trialType?: string | null;
  date?: string;
  metadata?: Record<string, any>;
};

type ChangeCategoryFilter = AbaClinicalChangeCategory | 'all';
type ChangeDetailMode = 'summary' | 'detail';
type ChangeTrendFilter = 'all' | 'improved' | 'worsened' | 'alerts';
type ClinicalChartViewMode = 'stacked' | 'line';
type LineGroupBy = 'session' | 'day' | 'week';

const chartTabs = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'targets', label: 'Habilidades' },
  { id: 'behaviors', label: 'Comportamentos' },
  { id: 'mastery', label: 'Maestria' },
  { id: 'maintenance', label: 'Manutenção' },
  { id: 'session-changes', label: 'Mudanças por sessão' }
] as const;

const lineCategoryOptions: Array<{ id: AbaClinicalLineCategory; label: string }> = [
  { id: 'target', label: 'Habilidade' },
  { id: 'behavior', label: 'Comportamento' },
  { id: 'mastery', label: 'Maestria' },
  { id: 'maintenance', label: 'Manutenção' },
  { id: 'general', label: 'Geral' }
];

const lineCategoryForTab = (tab: string): AbaClinicalLineCategory => {
  if (tab === 'behaviors') return 'behavior';
  if (tab === 'mastery') return 'mastery';
  if (tab === 'maintenance') return 'maintenance';
  if (tab === 'overview' || tab === 'session-changes') return 'general';
  return 'target';
};

const changeCategoryToLineCategory = (category?: AbaClinicalChangeCategory): AbaClinicalLineCategory => {
  if (category === 'behavior') return 'behavior';
  if (category === 'mastery') return 'mastery';
  if (category === 'maintenance' || category === 'regression') return 'maintenance';
  return 'target';
};

const metricLabels: Record<string, string> = {
  TARGET_COMPARE_RESPONSES: 'Comparar respostas',
  TARGET_ACCURACY: 'Acurácia',
  TARGET_INDEPENDENCE: 'Independência',
  TARGET_PROMPTED: 'Com ajuda',
  TARGET_ERROR: 'Erro',
  TARGET_TRIAL_COUNT: 'Tentativas',
  FUNCTIONAL_COMMUNICATION: 'Comunicação funcional',
  ENGAGEMENT: 'Engajamento',
  BEHAVIOR_FREQUENCY: 'Frequência',
  BEHAVIOR_DURATION_EPISODES: 'Episódios de duração',
  BEHAVIOR_DURATION_TOTAL: 'Duração total',
  BEHAVIOR_DURATION_AVG: 'Duração média',
  BEHAVIOR_DURATION_MAX: 'Duração máxima',
  BEHAVIOR_INTERVAL_OCCURRENCE: 'Ocorrência por intervalo',
  MASTERY_STATUS: 'Status de maestria',
  MASTERY_CONSECUTIVE_DAYS: 'Dias consecutivos',
  MASTERY_VALID_ATTEMPTS: 'Tentativas válidas',
  MASTERY_READY_FOR_REVIEW: 'Pronto para revisão',
  MAINTENANCE_STATUS: 'Status de manutenção',
  MAINTENANCE_ACCURACY: 'Acurácia de manutenção',
  MAINTENANCE_INDEPENDENCE: 'Independência de manutenção',
  MAINTENANCE_FAILURES: 'Falhas consecutivas',
  MAINTENANCE_DAYS_SINCE_PROBE: 'Dias desde última sondagem',
  REGRESSION_RISK: 'Risco de regressão'
};

const targetMetricOptions = ['TARGET_INDEPENDENCE', 'TARGET_ACCURACY', 'TARGET_TRIAL_COUNT'];
const behaviorMetricOptions = [
  'BEHAVIOR_FREQUENCY',
  'BEHAVIOR_DURATION_EPISODES',
  'BEHAVIOR_DURATION_TOTAL',
  'BEHAVIOR_DURATION_AVG',
  'BEHAVIOR_INTERVAL_OCCURRENCE'
];
const masteryStatuses = ['INSUFFICIENT_DATA', 'NOT_MET', 'MET_TODAY', 'READY_FOR_REVIEW', 'MASTERED_APPROVED'];
const maintenanceStatuses = ['SCHEDULED', 'PENDING_NEXT_SESSION', 'PENDING', 'OVERDUE', 'MAINTAINED', 'WATCH', 'REGRESSION_RISK', 'MISSED'];
const clinicalChangeCategoryLabels: Record<AbaClinicalChangeCategory, string> = {
  skill: 'Habilidades',
  behavior: 'Comportamentos',
  mastery: 'Maestria',
  maintenance: 'Manutenção',
  regression: 'Regressão/alertas'
};
const clinicalChangeCategoryOrder: AbaClinicalChangeCategory[] = ['skill', 'behavior', 'mastery', 'maintenance', 'regression'];
const clinicalChangeCategoryTone: Record<AbaClinicalChangeCategory, {
  accent: string;
  badge: string;
  header: string;
  panel: string;
  ring: string;
  softText: string;
}> = {
  skill: {
    accent: 'bg-emerald-500',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    header: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    panel: 'border-emerald-100 bg-emerald-50/35',
    ring: 'ring-2 ring-emerald-200',
    softText: 'text-emerald-700'
  },
  behavior: {
    accent: 'bg-sky-500',
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
    header: 'border-sky-100 bg-sky-50 text-sky-800',
    panel: 'border-sky-100 bg-sky-50/35',
    ring: 'ring-2 ring-sky-200',
    softText: 'text-sky-700'
  },
  mastery: {
    accent: 'bg-violet-500',
    badge: 'border-violet-200 bg-violet-50 text-violet-700',
    header: 'border-violet-100 bg-violet-50 text-violet-800',
    panel: 'border-violet-100 bg-violet-50/35',
    ring: 'ring-2 ring-violet-200',
    softText: 'text-violet-700'
  },
  maintenance: {
    accent: 'bg-amber-500',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    header: 'border-amber-100 bg-amber-50 text-amber-900',
    panel: 'border-amber-100 bg-amber-50/40',
    ring: 'ring-2 ring-amber-200',
    softText: 'text-amber-800'
  },
  regression: {
    accent: 'bg-red-500',
    badge: 'border-red-200 bg-red-50 text-red-700',
    header: 'border-red-100 bg-red-50 text-red-800',
    panel: 'border-red-100 bg-red-50/35',
    ring: 'ring-2 ring-red-200',
    softText: 'text-red-700'
  }
};

const aggregateBarColors = {
  skillMagnitude: '#10B981',
  behaviorMagnitude: '#0EA5E9',
  masteryCount: '#A855F7',
  maintenanceCount: '#F59E0B',
  regressionCount: '#EF4444'
};

const aggregateBarDefinitions: Array<{ key: keyof typeof aggregateBarColors; category: AbaClinicalChangeCategory; label: string }> = [
  { key: 'skillMagnitude', category: 'skill', label: 'Habilidades' },
  { key: 'behaviorMagnitude', category: 'behavior', label: 'Comportamentos' },
  { key: 'masteryCount', category: 'mastery', label: 'Maestria' },
  { key: 'maintenanceCount', category: 'maintenance', label: 'Manutenção' },
  { key: 'regressionCount', category: 'regression', label: 'Regressão/alertas' }
];

const behaviorStackColors = [
  '#7C3AED',
  '#0284C7',
  '#F97316',
  '#0F766E',
  '#DB2777',
  '#64748B',
  '#84CC16',
  '#9333EA',
  '#475569'
];

const clinicalLineColors = {
  independencePct: '#2563EB',
  promptedPct: '#F59E0B',
  errorPct: '#EF4444',
  accuracyPct: '#10B981',
  value: '#7a32fc'
};

const clinicalLineLabels: Record<string, string> = {
  independencePct: 'Independente',
  promptedPct: 'Com ajuda',
  errorPct: 'Erro',
  accuracyPct: 'Acurácia'
};

const percentMetrics = new Set([
  'TARGET_ACCURACY',
  'TARGET_INDEPENDENCE',
  'TARGET_COMPARE_RESPONSES',
  'TARGET_PROMPTED',
  'TARGET_ERROR',
  'FUNCTIONAL_COMMUNICATION',
  'ENGAGEMENT',
  'BEHAVIOR_INTERVAL_OCCURRENCE',
  'MAINTENANCE_ACCURACY',
  'MAINTENANCE_INDEPENDENCE'
]);
const durationMetrics = new Set(['BEHAVIOR_DURATION_TOTAL', 'BEHAVIOR_DURATION_AVG', 'BEHAVIOR_DURATION_MAX']);
const statusMetrics = new Set(['MASTERY_STATUS', 'MASTERY_READY_FOR_REVIEW', 'MAINTENANCE_STATUS', 'REGRESSION_RISK']);

const metricAxisLabels: Record<string, string> = {
  TARGET_COMPARE_RESPONSES: 'Percentual (%)',
  TARGET_ACCURACY: 'Acurácia (%)',
  TARGET_INDEPENDENCE: 'Independência (%)',
  TARGET_PROMPTED: 'Com ajuda (%)',
  TARGET_ERROR: 'Erro (%)',
  TARGET_TRIAL_COUNT: 'Tentativas',
  BEHAVIOR_FREQUENCY: 'Ocorrências',
  BEHAVIOR_DURATION_EPISODES: 'Episódios',
  BEHAVIOR_DURATION_TOTAL: 'Duração total',
  BEHAVIOR_DURATION_AVG: 'Duração média',
  BEHAVIOR_DURATION_MAX: 'Duração máxima',
  BEHAVIOR_INTERVAL_OCCURRENCE: '% de ocorrência por intervalo',
  MASTERY_STATUS: 'Status',
  MASTERY_CONSECUTIVE_DAYS: 'Dias consecutivos',
  MASTERY_VALID_ATTEMPTS: 'Tentativas válidas',
  MASTERY_READY_FOR_REVIEW: 'Pronto para revisão',
  MAINTENANCE_STATUS: 'Status',
  MAINTENANCE_ACCURACY: 'Acurácia de manutenção (%)',
  MAINTENANCE_INDEPENDENCE: 'Independência de manutenção (%)',
  MAINTENANCE_FAILURES: 'Falhas consecutivas',
  MAINTENANCE_DAYS_SINCE_PROBE: 'Dias desde último probe'
};

const statusTone = (status?: string) => {
  if (status === 'REGRESSION_SIGNAL') return 'bg-red-50 text-red-700 border-red-100';
  if (status === 'CLINICALLY_SIGNIFICANT_CHANGE') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'CHANGED') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (status === 'FIRST_MEASUREMENT') return 'bg-slate-50 text-slate-600 border-slate-100';
  return 'bg-gray-50 text-gray-600 border-gray-100';
};

const normalizeFilterText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const isAlertChange = (point: Partial<ChartPoint> & { changeCategory?: AbaClinicalChangeCategory }) =>
  point.changeCategory === 'regression' ||
  point.changeStatus === 'REGRESSION_SIGNAL' ||
  String(point.metricType || '') === 'REGRESSION_RISK' ||
  String(point.currentStatus || '').toUpperCase() === 'REGRESSION_RISK';

const isImprovedChange = (point: Partial<ChartPoint>) => point.trendDirection === 'IMPROVED';
const isWorsenedChange = (point: Partial<ChartPoint>) => point.trendDirection === 'WORSENED' || point.changeStatus === 'REGRESSION_SIGNAL';
const isStableChange = (point: Partial<ChartPoint>) =>
  point.trendDirection === 'STABLE' ||
  point.changeStatus === 'NO_CHANGE' ||
  (!isImprovedChange(point) && !isWorsenedChange(point) && point.changeStatus !== 'FIRST_MEASUREMENT');

const isClinicallySignificantChange = (point: Partial<ChartPoint>) =>
  point.changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' || point.changeStatus === 'REGRESSION_SIGNAL';

const changeStatePresentation = (point: Partial<ChartPoint>) => {
  if (isAlertChange(point as any) || isWorsenedChange(point)) {
    return {
      label: 'Regressão',
      text: 'text-red-700',
      strongText: 'text-red-800',
      badge: 'border-red-200 bg-red-50 text-red-700'
    };
  }
  if (isImprovedChange(point)) {
    return {
      label: 'Melhora',
      text: 'text-emerald-700',
      strongText: 'text-emerald-800',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    };
  }
  if (point.changeStatus === 'FIRST_MEASUREMENT') {
    return {
      label: 'Primeira medição',
      text: 'text-slate-600',
      strongText: 'text-slate-700',
      badge: 'border-slate-200 bg-slate-50 text-slate-600'
    };
  }
  return {
    label: 'Estável',
    text: 'text-amber-700',
    strongText: 'text-amber-800',
    badge: 'border-amber-200 bg-amber-50 text-amber-800'
  };
};

const lineTrendPresentation = (trend: string) => {
  if (trend === 'improved') return { label: 'melhora', className: 'text-emerald-700' };
  if (trend === 'worsened') return { label: 'regressão', className: 'text-red-700' };
  if (trend === 'stable') return { label: 'estável', className: 'text-amber-700' };
  return { label: 'dados insuficientes', className: 'text-slate-600' };
};

const dateInputValue = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const chartColor = (point: ChartPoint) => {
  if (point.changeStatus === 'REGRESSION_SIGNAL' || point.trendDirection === 'WORSENED') return '#EF4444';
  if (point.trendDirection === 'IMPROVED') return '#10B981';
  if (point.changeStatus === 'FIRST_MEASUREMENT') return '#94A3B8';
  return '#7a32fc';
};

const safeNumber = (value: any, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

const formatDate = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatDateTime = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const valueUnit = (metricType?: string) => {
  const metric = String(metricType || '');
  if (percentMetrics.has(metric)) return '%';
  if (durationMetrics.has(metric)) return 's';
  return '';
};

const formatValue = (value: any, metricType?: string) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (statusMetrics.has(String(metricType || ''))) return String(Math.round(numeric));
  return `${round1(numeric)}${valueUnit(metricType)}`;
};

const isTechnicalClinicalLabel = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) return true;
  const normalized = normalizeFilterText(text);
  if (['sessao', 'session', 'target', 'habilidade', 'comportamento', 'metrica clinica', 'metric', 'probe'].includes(normalized)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{10,}$/i.test(text)) return true;
  if (/^(TARGET|BEHAVIOR|MASTERY|MAINTENANCE|REGRESSION)_/.test(text)) return true;
  return false;
};

const clinicalItemLabel = (point: Partial<ChartPoint>, fallback = 'Resumo da sessão sem item específico') => {
  const candidates = [
    point.metricLabel,
    (point as any).targetName,
    (point as any).target_name,
    (point as any).behaviorName,
    (point as any).behavior_name,
    point.itemLabel
  ];
  const found = candidates.find((candidate) => !isTechnicalClinicalLabel(candidate));
  return found ? safeDisplayValue(found, fallback) : fallback;
};

const translatedStatusLabel = (value: unknown) => {
  const status = String(value || '').trim().toUpperCase();
  if (masteryStatusLabel[status]) return masteryStatusLabel[status];
  if (maintenanceStatusLabel[status]) return maintenanceStatusLabel[status];
  if (status === 'FIRST_MEASUREMENT') return 'Primeira medição';
  if (status === 'REGRESSION_SIGNAL') return 'Sinal de regressão';
  if (status === 'CLINICALLY_SIGNIFICANT_CHANGE') return 'Mudança clinicamente relevante';
  if (status === 'NO_CHANGE') return 'Estável';
  if (status === 'CHANGED') return 'Mudança registrada';
  return safeDisplayValue(value, '-');
};

const formatClinicalValue = (value: any, metricType?: string, explicitStatus?: unknown) => {
  const metric = String(metricType || '');
  if (!statusMetrics.has(metric)) return formatValue(value, metricType);
  const translated = translatedStatusLabel(explicitStatus);
  if (translated !== '-') return translated;
  const numeric = Math.round(safeNumber(value, 0));
  if (metric === 'MASTERY_STATUS' || metric === 'MASTERY_READY_FOR_REVIEW') {
    if (numeric >= 4) return masteryStatusLabel.MASTERED_APPROVED;
    if (numeric === 3) return masteryStatusLabel.READY_FOR_REVIEW;
    if (numeric === 2) return masteryStatusLabel.MET_TODAY;
    if (numeric === 1) return masteryStatusLabel.NOT_MET;
    if (numeric < 0) return masteryStatusLabel.REGRESSION_RISK;
    return masteryStatusLabel.INSUFFICIENT_DATA;
  }
  if (numeric >= 3) return maintenanceStatusLabel.MAINTAINED;
  if (numeric < 0) return maintenanceStatusLabel.REGRESSION_RISK;
  if (numeric === 1) return maintenanceStatusLabel.WATCH;
  return maintenanceStatusLabel.PENDING;
};

const formatDelta = (point: ChartPoint) => {
  const metricType = String(point.metricType || '');
  const previous = point.previousValue;
  if (previous === null || previous === undefined || previous === '') return 'primeira medição';

  if (percentMetrics.has(metricType)) {
    const delta = safeNumber(point.deltaValue ?? point.deltaPercent, 0);
    return `${delta > 0 ? '+' : ''}${round1(delta)} p.p.`;
  }

  const deltaValue = safeNumber(point.deltaValue, 0);
  const deltaPercent = Number(point.deltaPercent);
  const unit = valueUnit(metricType);
  const absoluteText = `${deltaValue > 0 ? '+' : ''}${round1(deltaValue)}${unit}`;
  if (Number.isFinite(deltaPercent)) {
    return `${absoluteText} (${deltaPercent > 0 ? '+' : ''}${round1(deltaPercent)}%)`;
  }
  return absoluteText;
};

const clinicalInterpretation = (point: ChartPoint) => {
  if (point.changeStatus === 'FIRST_MEASUREMENT') return 'primeira medição';
  if (point.changeStatus === 'REGRESSION_SIGNAL') return 'sinal de regressão';
  if (point.changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' && point.trendDirection === 'IMPROVED') return 'melhora relevante';
  if (point.changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' && point.trendDirection === 'WORSENED') return 'piora relevante';
  if (point.trendDirection === 'IMPROVED' && point.metricDirection === 'LOWER_IS_BETTER') return 'melhora por redução';
  if (point.trendDirection === 'IMPROVED') return 'melhora';
  if (point.trendDirection === 'WORSENED' && point.metricDirection === 'LOWER_IS_BETTER') return 'piora por aumento';
  if (point.trendDirection === 'WORSENED') return 'piora';
  return 'estável';
};

const changeSentence = (point: ChartPoint, index: number) => {
  const metricType = String(point.metricType || '');
  const session = point.sessionId
    ? formatSessionLabel({ id: point.sessionId, startedAt: point.changedAt })
    : `Sessão ${index + 1}`;
  const target = clinicalItemLabel(point);
  const metric = metricLabels[metricType] || 'Métrica';
  const previous = formatClinicalValue(point.previousValue, metricType, (point as any).previousStatus);
  const current = formatClinicalValue(point.value ?? point.metricValue, metricType, point.currentStatus || point.masteryStatus || point.statusLabel);
  return `${formatDate(point.changedAt)} ${session} — ${target}: ${metric.toLowerCase()} ${previous} → ${current} (${formatDelta(point)}), ${clinicalInterpretation(point)}.`;
};

const changePrimaryLabel = (point: Partial<ChartPoint>) =>
  clinicalItemLabel(point);

const clinicalChangeBrief = (point?: Partial<ChartPoint> | null) => {
  if (!point) return 'Sem dados suficientes para interpretar.';
  const metricType = String(point.metricType || '');
  const metric = metricLabels[metricType] || 'Métrica';
  const label = clinicalItemLabel(point);
  const previous = formatClinicalValue(point.previousValue, metricType, (point as any).previousStatus);
  const current = formatClinicalValue((point as ChartPoint).value ?? point.metricValue, metricType, point.currentStatus || point.masteryStatus || point.statusLabel);
  const delta = formatDelta(point as ChartPoint);
  return `${label}: ${metric.toLowerCase()} ${previous} → ${current} (${delta}), ${clinicalInterpretation(point as ChartPoint)}.`;
};

const ChangeStateBadge = ({ point, compact = false }: { point: Partial<ChartPoint>; compact?: boolean }) => {
  const tone = changeStatePresentation(point);
  return (
    <span className={`inline-flex items-center rounded-full border ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'} font-bold uppercase tracking-widest ${tone.badge}`}>
      {tone.label}
    </span>
  );
};

const ClinicalChangeBriefView = ({ point }: { point?: Partial<ChartPoint> | null }) => {
  if (!point) return <span>Sem dados suficientes para interpretar.</span>;
  const metricType = String(point.metricType || '');
  const tone = changeStatePresentation(point);
  const metric = metricLabels[metricType] || 'Métrica';
  const previous = formatClinicalValue(point.previousValue, metricType, (point as any).previousStatus);
  const current = formatClinicalValue((point as ChartPoint).value ?? point.metricValue, metricType, point.currentStatus || point.masteryStatus || point.statusLabel);
  return (
    <span>
      <span className="font-bold text-slate-800">{clinicalItemLabel(point)}</span>
      {`: ${metric.toLowerCase()} ${previous} → ${current} `}
      <span className={`font-black ${tone.strongText}`}>({formatDelta(point as ChartPoint)})</span>
      {', '}
      <span className={`font-black ${tone.text}`}>{tone.label.toLowerCase()}</span>
      .
    </span>
  );
};

const topClinicalChangeForGroup = (group: AbaAggregatedClinicalChangeGroup) => {
  const changes = Array.isArray(group.topChanges) && group.topChanges.length > 0
    ? group.topChanges
    : group.topChange
      ? [group.topChange]
      : [];
  return changes.find((change) => safeNumber(change.rawMagnitude, 0) > 0 && !isTechnicalClinicalLabel(change.metricLabel)) ||
    changes.find((change) => safeNumber(change.rawMagnitude, 0) > 0) ||
    null;
};

const changeSessionLabel = (point: Partial<ChartPoint>, fallbackIndex = 0) =>
  point.sessionId
    ? formatSessionLabel({ id: point.sessionId, startedAt: point.changedAt })
    : `Sessão #${fallbackIndex + 1}`;

const changeSearchText = (point: Partial<ChartPoint>) => normalizeFilterText([
  point.metricLabel,
  point.targetId,
  point.behaviorId,
  point.metricType,
  point.statusLabel,
  point.currentStatus,
  clinicalInterpretation(point as ChartPoint)
].filter(Boolean).join(' '));

const masteryStatusFromPoint = (point: any) => {
  const explicit = String(point?.status || point?.currentStatus || point?.masteryStatus || '').toUpperCase();
  if (explicit) return explicit;
  const value = Math.round(safeNumber(point?.value ?? point?.metricValue, 0));
  if (value >= 4) return 'MASTERED_APPROVED';
  if (value === 3) return 'READY_FOR_REVIEW';
  if (value === 2) return 'MET_TODAY';
  if (value === 1) return 'NOT_MET';
  return 'INSUFFICIENT_DATA';
};

const masteryStatusLabel: Record<string, string> = {
  INSUFFICIENT_DATA: 'Dados insuficientes',
  NOT_MET: 'Critério não atingido',
  MET_TODAY: 'Critério atingido hoje',
  READY_FOR_REVIEW: 'Pronto para revisão',
  MASTERED_APPROVED: 'Maestria aprovada',
  REGRESSION_RISK: 'Risco de regressão'
};

const maintenanceStatusLabel: Record<string, string> = {
  SCHEDULED: 'Sondagem agendada',
  SCHEDULED_BY_DATE: 'Sondagem por data',
  PENDING: 'Sondagem pendente',
  PENDING_CONFIRMATION: 'Aguardando confirmação',
  PENDING_NEXT_SESSION: 'Aguardando próxima sessão',
  PENDING_LINK: 'Aguardando vínculo',
  PENDING_SCHEDULING: 'Aguardando agendamento',
  UNSCHEDULED: 'Sem consulta vinculada',
  DUE_TODAY: 'Sondagem para hoje',
  OVERDUE: 'Sondagem atrasada',
  IN_MAINTENANCE: 'Em manutenção',
  AVAILABLE_IN_SESSION: 'Disponível na sessão',
  NEEDS_REVIEW: 'Precisa de revisão',
  MAINTAINED: 'Mantido',
  WATCH: 'Em observação',
  REGRESSION_RISK: 'Risco de regressão',
  MISSED: 'Sondagem não realizada',
  COMPLETED: 'Sondagem concluída'
};

const EmptyState = ({ text }: { text: string }) => (
  <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
    <p className="max-w-sm text-sm font-semibold text-slate-400">{text}</p>
  </div>
);

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row: ChartPoint = payload[0]?.payload || {};
  const metricType = String(row.metricType || '');
  const trialType = safeDisplayValue(row.mostUsedTrialType || row.trialTypeMostUsed, '-');
  const masteryStatus = translatedStatusLabel(row.masteryStatus || row.currentStatus || (metricType === 'MASTERY_STATUS' ? row.statusLabel : '-'));
  const sessionLabel = formatSessionLabel({ id: row.sessionId, startedAt: row.changedAt });
  const itemLabel = clinicalItemLabel(row, 'Sem item específico');
  const isBehavior = String(row.metricType || '').startsWith('BEHAVIOR_') || Boolean(row.behaviorId);
  return (
    <div className="max-w-[320px] rounded-lg border border-slate-100 bg-white p-4 text-xs shadow-xl">
      <p className="font-black uppercase tracking-widest text-slate-900">{formatDateTime(row.changedAt)}</p>
      <p className="mt-2 font-bold text-slate-700">{itemLabel}</p>
      <div className="mt-3 space-y-1 text-slate-500">
        <p>Sessão: {row.sessionId || row.changedAt ? sessionLabel : '-'}</p>
        <p>{isBehavior ? 'Comportamento' : 'Habilidade'}: {itemLabel}</p>
        <p>Métrica: {metricLabels[metricType] || 'Métrica'}</p>
        <p>Valor anterior: {formatClinicalValue(row.previousValue, metricType, (row as any).previousStatus)}</p>
        <p>Valor atual: {formatClinicalValue(row.value ?? row.metricValue, metricType, row.currentStatus || row.masteryStatus || row.statusLabel)}</p>
        <p>Delta: <span className={`font-black ${changeStatePresentation(row).strongText}`}>{formatDelta(row)}</span></p>
        <p>Tipo de tentativa mais usado: {trialType}</p>
        <p>Status de maestria: {masteryStatus}</p>
      </div>
      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2">
        <ChangeStateBadge point={row} />
        <p className="mt-1 font-bold text-slate-700">{clinicalInterpretation(row)}</p>
      </div>
    </div>
  );
};

const ClinicalLineTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const visiblePayload = payload.filter((item: any) => item?.value !== null && item?.value !== undefined);
  return (
    <div className="max-w-[340px] rounded-lg border border-slate-100 bg-white p-4 text-xs shadow-xl">
      <p className="font-black uppercase tracking-widest text-slate-900">{row.sessionLabel || formatDate(row.date || row.changedAt)}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">{formatDateTime(row.date || row.changedAt)}</p>
      <p className="mt-3 font-bold text-slate-700">{safeDisplayValue(row.itemLabel || row.metricLabel, 'Item clínico')}</p>
      <div className="mt-3 space-y-1 text-slate-500">
        {visiblePayload.map((item: any) => (
          <p key={item.dataKey}>
            {item.name || clinicalLineLabels[item.dataKey] || 'Valor'}: <strong className="text-slate-800">{formatValue(item.value, row.metric || row.metricType)}</strong>
          </p>
        ))}
        <p>Tentativas: {row.attemptsCount ?? row.metadata?.attemptsCount ?? '-'}</p>
        <p>Tipo de sessão: {safeDisplayValue(row.trialType || row.metadata?.trialType, '-')}</p>
        <p>Prompt mais usado: {safeDisplayValue(row.prompt || row.metadata?.prompt, '-')}</p>
        <p>Status: {safeDisplayValue(row.status || row.metadata?.status, '-')}</p>
      </div>
    </div>
  );
};

const AggregatedTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const row: AbaAggregatedClinicalChangeGroup = payload[0]?.payload || {};
  const topChange = topClinicalChangeForGroup(row);
  const isDayGroup = row.groupBy === 'day';
  return (
    <div className="max-w-[340px] rounded-lg border border-slate-100 bg-white p-4 text-xs shadow-xl">
      <p className="font-black uppercase tracking-widest text-slate-900">
        {isDayGroup
          ? `Dia: ${row.clinicalDateLabel || row.label || 'Sem data'}`
          : `Sessão: ${row.sessionTooltipLabel || row.sessionDisplayLabel || row.label || 'Sessão'}`}
      </p>
      {!isDayGroup && row.sessionShortCode && (
        <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Código curto: {row.sessionShortCode}</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-slate-500">
        <p>Total: <strong className="text-slate-800">{row.totalChanges || 0}</strong></p>
        <p>Relevantes: <strong className="text-slate-800">{row.relevantChanges || 0}</strong></p>
        {isDayGroup && <p>Sessões incluídas: <strong className="text-slate-800">{row.sessionCount || 0}</strong></p>}
        <p>Habilidades: <strong className="text-slate-800">{row.categoryCounts?.skill || 0}</strong></p>
        <p>Comportamentos: <strong className="text-slate-800">{row.categoryCounts?.behavior || 0}</strong></p>
        <p>Maestria: <strong className="text-slate-800">{row.categoryCounts?.mastery || 0}</strong></p>
        <p>Manutenção: <strong className="text-slate-800">{row.categoryCounts?.maintenance || 0}</strong></p>
      </div>
      {topChange && (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 font-bold text-slate-700">
          Maior mudança: <ClinicalChangeBriefView point={topChange} />
        </p>
      )}
      {!topChange && (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 font-bold text-slate-700">
          Sem dados suficientes para interpretar.
        </p>
      )}
      {(row.hasRegressionAlert || row.hasReviewReady) && (
        <p className="mt-2 text-[11px] font-bold text-red-600">
          {row.hasRegressionAlert ? 'Alerta de regressão presente. ' : ''}{row.hasReviewReady ? 'Há item pronto para revisão.' : ''}
        </p>
      )}
    </div>
  );
};

const BehaviorCompositionTooltip = ({ active, payload, metricType }: any) => {
  if (!active || !payload?.length) return null;
  const row: AbaBehaviorCompositionRow = payload[0]?.payload || {};
  const segments = Array.isArray(row.segments) ? row.segments.filter((segment) => segment.value > 0) : [];
  const isDayGroup = row.groupBy === 'day';
  return (
    <div className="max-w-[340px] rounded-lg border border-slate-100 bg-white p-4 text-xs shadow-xl">
      <p className="font-black uppercase tracking-widest text-slate-900">
        {isDayGroup
          ? `Dia: ${row.clinicalDateLabel || row.label || 'Sem data'}`
          : `Sessão: ${row.sessionTooltipLabel || row.sessionDisplayLabel || row.label || 'Sessão'}`}
      </p>
      {!isDayGroup && row.sessionShortCode && (
        <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Código curto: {row.sessionShortCode}</p>
      )}
      <p className="mt-2 font-bold text-slate-700">
        Total: <span className="text-slate-900">{formatValue(row.total, metricType)}</span>
      </p>
      {isDayGroup && (
        <p className="mt-1 text-[11px] font-bold text-slate-500">Sessões incluídas: {row.sessionCount || 0}</p>
      )}
      <div className="mt-3 space-y-1 text-slate-500">
        {segments.map((segment) => (
          <p key={segment.key} className="flex items-center justify-between gap-3">
            <span className="truncate">{segment.label}</span>
            <strong className="shrink-0 text-slate-800">{formatValue(segment.value, metricType)}</strong>
          </p>
        ))}
      </div>
      {(row.dominantLocation || row.commonSeverity || row.commonCollectionMethod) && (
        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-slate-600">
          <p className="font-black uppercase tracking-widest text-slate-400">Contexto predominante</p>
          {row.dominantLocation && <p className="mt-1">Local mais frequente: <strong>{row.dominantLocation.value}</strong></p>}
          {row.commonSeverity && <p>Severidade predominante: <strong>{row.commonSeverity.value}</strong></p>}
          {row.commonCollectionMethod && <p>Método predominante: <strong>{row.commonCollectionMethod.value}</strong></p>}
        </div>
      )}
    </div>
  );
};

const aggregateBadgeTone = (group: AbaAggregatedClinicalChangeGroup) => {
  if (group.hasRegressionAlert) return 'border-red-100 bg-red-50 text-red-700';
  if (group.hasReviewReady) return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  return 'border-slate-100 bg-white text-slate-500';
};

const ClinicalChangeCard: React.FC<{ change: AbaAggregatedClinicalChange; index: number }> = ({ change, index }) => {
  const metricType = String(change.metricType || '');
  const categoryTone = clinicalChangeCategoryTone[change.changeCategory];
  const interpretation = clinicalInterpretation(change);
  const sessionLabel = changeSessionLabel(change, index);
  const previous = formatClinicalValue(change.previousValue, metricType, (change as any).previousStatus);
  const current = formatClinicalValue((change as ChartPoint).value ?? change.metricValue, metricType, change.currentStatus || change.masteryStatus || change.statusLabel);
  const contextPattern = (change as any).contextPattern || (change as any).context_pattern || null;
  const contextInsights = Array.isArray(contextPattern?.insights) ? contextPattern.insights.slice(0, 4) : [];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest ${categoryTone.badge}`}>
          {clinicalChangeCategoryLabels[change.changeCategory]}
        </span>
        <ChangeStateBadge point={change} compact />
      </div>
      <h5 className="text-sm font-semibold leading-snug text-slate-900">{changePrimaryLabel(change)}</h5>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        {clinicalChangeCategoryLabels[change.changeCategory]} • {formatDateTime(change.changedAt)} • {sessionLabel}
      </p>
      <p className="mt-1 text-[11px] font-bold text-slate-500">Métrica analisada: {metricLabels[metricType] || 'Métrica'}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Anterior</p>
          <p className="mt-1 font-semibold text-slate-800">{previous}</p>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Atual</p>
          <p className="mt-1 font-semibold text-slate-800">{current}</p>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Delta</p>
          <p className={`mt-1 font-black ${changeStatePresentation(change).strongText}`}>
            {formatDelta(change)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-600">
        <span className="font-medium text-slate-700">Interpretação:</span> <span className={changeStatePresentation(change).text}>{interpretation}</span>
      </p>
      {change.changeCategory === 'behavior' && contextPattern && (
        <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2" data-aba-behavior-context-insights>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-700">Contextos associados</p>
          {contextInsights.length === 0 ? (
            <p className="mt-1 text-xs font-semibold text-slate-600">Os registros do periodo nao tem contexto suficiente para identificar local, severidade ou metodo predominante.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-600">
              {contextInsights.map((insight: string, insightIndex: number) => (
                <li key={`${change.id || change.metricLabel}-context-${insightIndex}`}>{insight}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const ContextDistributionRows = ({
  title,
  rows,
  tone = 'sky'
}: {
  title: string;
  rows?: AbaBehaviorContextDistributionValue<string | number>[];
  tone?: 'sky' | 'amber' | 'violet' | 'slate';
}) => {
  const visibleRows = (rows || []).slice(0, 4);
  if (visibleRows.length === 0) return null;
  const toneClass = {
    sky: 'bg-sky-500',
    amber: 'bg-amber-500',
    violet: 'bg-violet-500',
    slate: 'bg-slate-500'
  }[tone];
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/70 px-2 py-2" data-aba-context-distribution>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
      <div className="space-y-1">
        {visibleRows.map((row) => (
          <div key={`${title}-${row.value}`} className="grid grid-cols-[minmax(72px,1fr)_minmax(64px,1fr)_24px] items-center gap-2 text-[11px] font-semibold text-slate-600">
            <span className="truncate" title={String(row.value)}>{row.value}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white">
              <span className={`block h-full rounded-full ${toneClass}`} style={{ width: `${Math.max(8, row.percent)}%` }} />
            </span>
            <span className="text-right text-slate-500">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export function AbaClinicalChartsPanel({ patientId, isPanelDark = false }: AbaClinicalChartsPanelProps) {
  const [activeTab, setActiveTab] = useState<(typeof chartTabs)[number]['id']>('overview');
  const [viewMode, setViewMode] = useState<ClinicalChartViewMode>('stacked');
  const [periodDays, setPeriodDays] = useState(30);
  const [targetId, setTargetId] = useState('');
  const [behaviorId, setBehaviorId] = useState('');
  const [metricType, setMetricType] = useState('');
  const [groupBy, setGroupBy] = useState<'session' | 'day'>('session');
  const [lineCategory, setLineCategory] = useState<AbaClinicalLineCategory>('target');
  const [lineItemId, setLineItemId] = useState('');
  const [lineMetric, setLineMetric] = useState('TARGET_COMPARE_RESPONSES');
  const [lineGroupBy, setLineGroupBy] = useState<LineGroupBy>('session');
  const [lineData, setLineData] = useState<any>({ points: [], phases: [], annotations: [], summary: null, availableMetrics: [], availableItems: [] });
  const [lineLoading, setLineLoading] = useState(false);
  const [groupByTouched, setGroupByTouched] = useState(false);
  const [selectedChangeGroupKey, setSelectedChangeGroupKey] = useState('');
  const [changeDetailMode, setChangeDetailMode] = useState<ChangeDetailMode>('summary');
  const [detailCategoryFilter, setDetailCategoryFilter] = useState<ChangeCategoryFilter>('all');
  const [detailSessionFilter, setDetailSessionFilter] = useState('');
  const [detailDayFilter, setDetailDayFilter] = useState('');
  const [detailTargetFilter, setDetailTargetFilter] = useState('');
  const [detailTrendFilter, setDetailTrendFilter] = useState<ChangeTrendFilter>('all');
  const [detailSignificantOnly, setDetailSignificantOnly] = useState(false);
  const [collapsedChangeCategories, setCollapsedChangeCategories] = useState<Partial<Record<AbaClinicalChangeCategory, boolean>>>({});
  const [significantOnly, setSignificantOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [dataByTab, setDataByTab] = useState<Record<string, any>>({});
  const [loadingTab, setLoadingTab] = useState('');
  const [error, setError] = useState('');
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState({
    annotationType: 'NOTE',
    label: '',
    value: '',
    date: new Date().toISOString().slice(0, 10)
  });

  const loadChart = async (tab: string) => {
    if (!patientId) return;
    setLoadingTab(tab);
    setError('');
    try {
      const result = await dataService.getAbaClinicalChart(patientId, tab as any, {
        days: periodDays,
        targetId,
        behaviorId,
        metricType,
        significantOnly,
        limit: 120
      });
      setDataByTab((current) => ({
        ...current,
        [tab]: result?.data || { points: [], insights: [], annotations: [] }
      }));
    } catch (chartError) {
      console.error('Erro ao carregar gráficos ABA:', chartError);
      setError('Não foi possível carregar os gráficos ABA agora.');
    } finally {
      setLoadingTab('');
    }
  };

  const loadLineChart = async () => {
    if (!patientId) return;
    setLineLoading(true);
    setError('');
    try {
      const result = await dataService.getAbaClinicalLineChart(patientId, {
        category: lineCategory,
        itemId: lineItemId,
        metric: lineMetric,
        days: periodDays,
        groupBy: lineGroupBy,
        limit: 120
      });
      setLineData(result?.data || { points: [], phases: [], annotations: [], summary: null, availableMetrics: [], availableItems: [] });
    } catch (chartError) {
      console.error('Erro ao carregar gráfico ABA em linha:', chartError);
      setError('Não foi possível carregar a evolução em linha agora.');
    } finally {
      setLineLoading(false);
    }
  };

  useEffect(() => {
    void loadChart('overview');
  }, [patientId, periodDays, targetId, behaviorId, metricType, significantOnly]);

  useEffect(() => {
    if (activeTab !== 'overview') void loadChart(activeTab);
  }, [activeTab, patientId, periodDays, targetId, behaviorId, metricType, significantOnly]);

  useEffect(() => {
    if (viewMode === 'line') void loadLineChart();
  }, [viewMode, patientId, periodDays, lineCategory, lineItemId, lineMetric, lineGroupBy]);

  useEffect(() => {
    const options = ABA_CLINICAL_LINE_METRICS[lineCategory] || ABA_CLINICAL_LINE_METRICS.general;
    if (!options.some((option) => option.id === lineMetric)) setLineMetric(options[0]?.id || 'TARGET_ACCURACY');
  }, [lineCategory, lineMetric]);

  useEffect(() => {
    const validMetrics = activeTab === 'targets'
      ? targetMetricOptions
      : activeTab === 'behaviors'
        ? behaviorMetricOptions
        : activeTab === 'mastery'
          ? ['MASTERY_STATUS']
          : activeTab === 'maintenance'
            ? ['MAINTENANCE_STATUS', 'REGRESSION_RISK']
            : [];
    if (metricType && validMetrics.length > 0 && !validMetrics.includes(metricType)) setMetricType('');
  }, [activeTab, metricType]);

  const overview = dataByTab.overview || {};
  const activeData = dataByTab[activeTab] || {};
  const activePoints: ChartPoint[] = Array.isArray(activeData.points) ? activeData.points : [];
  const overviewPoints: ChartPoint[] = Array.isArray(overview.points) ? overview.points : [];
  const allKnownPoints = useMemo(() => [...overviewPoints, ...activePoints], [activePoints, overviewPoints]);

  useEffect(() => {
    if (groupByTouched) return;
    const sessionCount = new Set(allKnownPoints.map((point) => String(point.sessionId || point.changedAt || '')).filter(Boolean)).size;
    setGroupBy(sessionCount > 12 ? 'day' : 'session');
  }, [allKnownPoints, groupByTouched]);

  const targetOptions = useMemo(() => {
    const map = new Map<string, string>();
    allKnownPoints.forEach((point: any) => {
      if (point?.targetId) map.set(String(point.targetId), safeDisplayValue(point.metricLabel || point.targetId, 'Habilidade sem nome'));
    });
    return Array.from(map.entries());
  }, [allKnownPoints]);

  const behaviorOptions = useMemo(() => {
    const map = new Map<string, string>();
    allKnownPoints.forEach((point: any) => {
      if (point?.behaviorId) map.set(String(point.behaviorId), safeDisplayValue(point.metricLabel || point.behaviorId, 'Comportamento sem nome'));
    });
    return Array.from(map.entries());
  }, [allKnownPoints]);

  const lineMetricOptions = useMemo(() => {
    const fromServer = Array.isArray(lineData.availableMetrics) && lineData.availableMetrics.length > 0
      ? lineData.availableMetrics
      : ABA_CLINICAL_LINE_METRICS[lineCategory] || ABA_CLINICAL_LINE_METRICS.general;
    return fromServer.map((option: any) => ({
      id: String(option.id),
      label: safeDisplayValue(option.label || metricLabels[String(option.id)] || option.id, 'Métrica')
    }));
  }, [lineCategory, lineData.availableMetrics]);

  const lineItemOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (lineCategory === 'target') targetOptions.forEach(([id, label]) => map.set(id, label));
    if (lineCategory === 'behavior') behaviorOptions.forEach(([id, label]) => map.set(id, label));
    if (Array.isArray(lineData.availableItems)) {
      lineData.availableItems.forEach((item: any) => {
        const id = String(item?.id || item?.itemId || '').trim();
        if (id) map.set(id, safeDisplayValue(item?.label || item?.itemLabel || id, 'Item clínico'));
      });
    }
    return Array.from(map.entries());
  }, [behaviorOptions, lineCategory, lineData.availableItems, targetOptions]);

  const availableMetrics = useMemo(() => {
    if (activeTab === 'targets') return targetMetricOptions;
    if (activeTab === 'behaviors') return behaviorMetricOptions;
    if (activeTab === 'mastery') return ['MASTERY_STATUS'];
    if (activeTab === 'maintenance') return ['MAINTENANCE_STATUS', 'REGRESSION_RISK'];
    return Object.keys(metricLabels);
  }, [activeTab]);

  const effectiveMetricType = useMemo(() => {
    if (metricType && availableMetrics.includes(metricType)) return metricType;
    const pointMetricSet = new Set(activePoints.map((point) => String(point.metricType || '')));
    if (activeTab === 'targets') {
      if (pointMetricSet.has('TARGET_INDEPENDENCE')) return 'TARGET_INDEPENDENCE';
      if (pointMetricSet.has('TARGET_ACCURACY')) return 'TARGET_ACCURACY';
      return 'TARGET_INDEPENDENCE';
    }
    if (activeTab === 'behaviors') {
      return behaviorMetricOptions.find((metric) => pointMetricSet.has(metric)) || 'BEHAVIOR_FREQUENCY';
    }
    if (activeTab === 'mastery') return 'MASTERY_STATUS';
    if (activeTab === 'maintenance') return 'MAINTENANCE_STATUS';
    return metricType || '';
  }, [activePoints, activeTab, availableMetrics, metricType]);

  const focusedTargetId = useMemo(() => {
    if (targetId) return targetId;
    const match = activePoints.find((point) => point.targetId && String(point.metricType || '') === effectiveMetricType);
    return match?.targetId ? String(match.targetId) : '';
  }, [activePoints, effectiveMetricType, targetId]);

  const focusedBehaviorId = useMemo(() => {
    if (behaviorId) return behaviorId;
    const match = activePoints.find((point) => point.behaviorId && String(point.metricType || '') === effectiveMetricType);
    return match?.behaviorId ? String(match.behaviorId) : '';
  }, [activePoints, behaviorId, effectiveMetricType]);

  const hasSpecificTarget = Boolean(targetId);
  const hasSpecificBehavior = Boolean(behaviorId);

  const aggregateSourcePoints = useMemo(() => {
    const source = activeTab === 'overview' ? overviewPoints : activePoints;
    if (activeTab === 'targets') {
      return source.filter((point) => ['TARGET_ACCURACY', 'TARGET_INDEPENDENCE', 'TARGET_TRIAL_COUNT', 'FUNCTIONAL_COMMUNICATION', 'ENGAGEMENT'].includes(String(point.metricType || '')));
    }
    if (activeTab === 'behaviors') {
      return source.filter((point) => String(point.metricType || '').startsWith('BEHAVIOR_'));
    }
    if (activeTab === 'mastery') {
      return source.filter((point) => String(point.metricType || '') === 'MASTERY_STATUS');
    }
    if (activeTab === 'maintenance') {
      return source.filter((point) => String(point.metricType || '') === 'MAINTENANCE_STATUS' || String(point.metricType || '') === 'REGRESSION_RISK');
    }
    return source;
  }, [activePoints, activeTab, overviewPoints]);

  const aggregatedChangeRows = useMemo(
    () => aggregateClinicalChangesBySession(aggregateSourcePoints, { groupBy, visualMagnitudeCap: 120 }),
    [aggregateSourcePoints, groupBy]
  );

  const selectedChangeGroup = useMemo(
    () => getClinicalChangeDrilldown(aggregatedChangeRows, selectedChangeGroupKey),
    [aggregatedChangeRows, selectedChangeGroupKey]
  );

  const detailSessionOptions = useMemo(() => {
    const map = new Map<string, string>();
    (selectedChangeGroup?.changes || []).forEach((change, index) => {
      const id = String(change.sessionId || '').trim();
      if (id) map.set(id, changeSessionLabel(change, index));
    });
    return Array.from(map.entries());
  }, [selectedChangeGroup]);

  const detailDayOptions = useMemo(() => {
    const map = new Map<string, string>();
    (selectedChangeGroup?.changes || []).forEach((change) => {
      const value = dateInputValue(change.changedAt);
      if (value) map.set(value, formatDate(change.changedAt));
    });
    return Array.from(map.entries());
  }, [selectedChangeGroup]);

  const selectedFilteredChanges = useMemo(() => {
    if (!selectedChangeGroup) return [] as AbaAggregatedClinicalChange[];
    const query = normalizeFilterText(detailTargetFilter);
    return selectedChangeGroup.changes.filter((change) => {
      if (detailCategoryFilter !== 'all' && change.changeCategory !== detailCategoryFilter) return false;
      if (detailSessionFilter && String(change.sessionId || '') !== detailSessionFilter) return false;
      if (detailDayFilter && dateInputValue(change.changedAt) !== detailDayFilter) return false;
      if (query && !changeSearchText(change).includes(query)) return false;
      if (detailSignificantOnly && !isClinicallySignificantChange(change)) return false;
      if (detailTrendFilter === 'improved' && !isImprovedChange(change)) return false;
      if (detailTrendFilter === 'worsened' && !isWorsenedChange(change)) return false;
      if (detailTrendFilter === 'alerts' && !isAlertChange(change)) return false;
      return true;
    });
  }, [
    detailCategoryFilter,
    detailDayFilter,
    detailSessionFilter,
    detailSignificantOnly,
    detailTargetFilter,
    detailTrendFilter,
    selectedChangeGroup
  ]);

  const visibleDetailChanges = useMemo(() => selectedFilteredChanges.slice(0, 80), [selectedFilteredChanges]);

  const detailKpis = useMemo(() => ({
    total: selectedFilteredChanges.length,
    improved: selectedFilteredChanges.filter(isImprovedChange).length,
    worsened: selectedFilteredChanges.filter(isWorsenedChange).length,
    stable: selectedFilteredChanges.filter(isStableChange).length,
    alerts: selectedFilteredChanges.filter(isAlertChange).length
  }), [selectedFilteredChanges]);

  const detailGroups = useMemo(() => clinicalChangeCategoryOrder
    .filter((category) => detailCategoryFilter === 'all' || detailCategoryFilter === category)
    .map((category) => ({
      category,
      changes: visibleDetailChanges.filter((change) => change.changeCategory === category)
    })), [detailCategoryFilter, visibleDetailChanges]);

  const aggregateTopChanges = useMemo(() => {
    return aggregatedChangeRows
      .flatMap((group) => group.topChanges.map((change) => ({ group, change })))
      .filter(({ change }) => safeNumber(change.rawMagnitude, 0) > 0)
      .sort((a, b) => b.change.rawMagnitude - a.change.rawMagnitude)
      .slice(0, 6);
  }, [aggregatedChangeRows]);

  const chartRows = useMemo(() => {
    const sorted = activePoints
      .slice()
      .sort((a: any, b: any) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime());

    let rows = sorted;
    if (activeTab === 'targets') {
      rows = rows.filter((point) => String(point.metricType || '') === effectiveMetricType);
      if (hasSpecificTarget) rows = rows.filter((point) => String(point.targetId || '') === targetId);
    }
    if (activeTab === 'behaviors') {
      rows = rows.filter((point) => String(point.metricType || '') === effectiveMetricType);
      if (hasSpecificBehavior) rows = rows.filter((point) => String(point.behaviorId || '') === behaviorId);
    }
    if (activeTab === 'mastery') {
      rows = rows.filter((point) => String(point.metricType || '') === 'MASTERY_STATUS');
      if (hasSpecificTarget) rows = rows.filter((point) => String(point.targetId || '') === targetId);
    }
    if (activeTab === 'maintenance') {
      rows = rows.filter((point) => String(point.metricType || '') === 'MAINTENANCE_STATUS' || String(point.metricType || '') === 'REGRESSION_RISK');
      if (hasSpecificTarget) rows = rows.filter((point) => String(point.targetId || '') === targetId);
    }

    return rows.map((point: ChartPoint, index: number) => {
      const rawValue = safeNumber(point.value ?? point.metricValue, 0);
      const magnitude = Math.abs(safeNumber(point.deltaPercent ?? point.deltaValue, rawValue));
      return {
        ...point,
        x: `${formatDate(point.changedAt)} #${index + 1}`,
        value: rawValue,
        chartValue: activeTab === 'overview' || activeTab === 'session-changes' ? magnitude : rawValue
      };
    });
  }, [activePoints, activeTab, behaviorId, effectiveMetricType, hasSpecificBehavior, hasSpecificTarget, targetId]);

  const behaviorComposition = useMemo(() => {
    if (activeTab !== 'behaviors') return { rows: [] as AbaBehaviorCompositionRow[], series: [] as AbaBehaviorCompositionSeries[] };
    return buildBehaviorCompositionStack(chartRows, {
      metricType: effectiveMetricType,
      groupBy: groupBy === 'day' ? 'day' : 'session',
      contextPatterns: Array.isArray(activeData.contextPatterns) ? activeData.contextPatterns as AbaBehaviorContextPattern[] : [],
      maxSeries: 8
    });
  }, [activeData.contextPatterns, activeTab, chartRows, effectiveMetricType, groupBy]);
  const behaviorCompositionRows = behaviorComposition.rows;
  const behaviorCompositionSeries = behaviorComposition.series;

  const lineChartRows = useMemo(() => {
    const points: ChartPoint[] = Array.isArray(lineData.points) ? lineData.points : [];
    return points
      .slice()
      .sort((a: any, b: any) => new Date(a.date || a.changedAt || 0).getTime() - new Date(b.date || b.changedAt || 0).getTime())
      .map((point: any, index: number) => ({
        ...point,
        x: point.sessionLabel || `${formatDate(point.date || point.changedAt)} #${index + 1}`,
        chartValue: safeNumber(point.value, 0),
        accuracyPct: point.secondaryValues?.accuracyPct ?? point.secondary_values?.accuracy_pct ?? null,
        independencePct: point.secondaryValues?.independencePct ?? point.secondary_values?.independence_pct ?? null,
        promptedPct: point.secondaryValues?.promptedPct ?? point.secondary_values?.prompted_pct ?? null,
        errorPct: point.secondaryValues?.errorPct ?? point.secondary_values?.error_pct ?? null
      }));
  }, [lineData.points]);

  const lineAnnotations = Array.isArray(lineData.annotations) ? lineData.annotations : [];
  const linePhases = Array.isArray(lineData.phases) ? lineData.phases : [];
  const lineGoalLines = lineAnnotations.filter((annotation: any) => annotation.annotation_type === 'GOAL_LINE' && annotation.value !== null && annotation.value !== '');
  const lineXMarkers = useMemo(() => {
    return lineAnnotations
      .filter((annotation: any) => annotation.annotation_type !== 'GOAL_LINE')
      .map((annotation: any) => {
        const annotationTime = new Date(annotation.date || 0).getTime();
        const nearest = lineChartRows.reduce((best: any, row: any) => {
          const diff = Math.abs(new Date(row.date || row.changedAt || 0).getTime() - annotationTime);
          if (!best || diff < best.diff) return { row, diff };
          return best;
        }, null);
        return nearest?.row?.x ? { ...annotation, x: nearest.row.x } : null;
      })
      .filter(Boolean);
  }, [lineAnnotations, lineChartRows]);

  const lineSummary = lineData.summary || {};
  const selectedLineMetricOption = lineMetricOptions.find((option) => option.id === lineMetric);
  const lineAxisLabel = metricAxisLabels[lineMetric] || selectedLineMetricOption?.label || 'Valor';
  const isCompareResponses = lineMetric === 'TARGET_COMPARE_RESPONSES';
  const lineTrendDisplay = lineTrendPresentation(String(lineSummary.trend || 'insufficient_data'));
  const lineNeedsItem = lineCategory !== 'general' && !lineItemId;
  const lineEmptyText = lineNeedsItem
    ? 'Selecione uma habilidade ou comportamento para visualizar a evolução em linha.'
    : 'Este item ainda não possui dados suficientes para gráfico de evolução.';
  const lineMinWidth = Math.max(720, lineChartRows.length * 72);

  const annotations = Array.isArray(activeData.annotations) ? activeData.annotations : [];
  const isLoading = loadingTab === activeTab || (activeTab === 'overview' && loadingTab === 'overview');
  const showBehaviorCompositionChart = viewMode === 'stacked' && activeTab === 'behaviors' && behaviorCompositionRows.length > 0;
  const showAggregatedChart = viewMode === 'stacked' && !showBehaviorCompositionChart && (
    activeTab === 'overview' ||
    activeTab === 'session-changes' ||
    activeTab === 'mastery' ||
    activeTab === 'maintenance' ||
    (activeTab === 'targets' && !hasSpecificTarget)
  );
  const shouldRenderChart = viewMode === 'stacked' && (
    showBehaviorCompositionChart ||
    (showAggregatedChart ? aggregatedChangeRows.length > 0 : chartRows.length > 0)
  );
  const visibleAggregateBars = useMemo(() => {
    if (activeTab === 'overview' || activeTab === 'session-changes') return aggregateBarDefinitions;
    if (activeTab === 'targets') return aggregateBarDefinitions.filter((bar) => bar.category === 'skill');
    if (activeTab === 'behaviors') return aggregateBarDefinitions.filter((bar) => bar.category === 'behavior');
    if (activeTab === 'mastery') return aggregateBarDefinitions.filter((bar) => bar.category === 'mastery');
    if (activeTab === 'maintenance') return aggregateBarDefinitions.filter((bar) => bar.category === 'maintenance' || bar.category === 'regression');
    return aggregateBarDefinitions;
  }, [activeTab]);
  const showFullAggregateLegend = activeTab === 'overview' || activeTab === 'session-changes';

  const yAxisLabel = showAggregatedChart
    ? 'Intensidade das mudanças'
    : metricAxisLabels[effectiveMetricType] || 'Valor';
  const stackedMinWidth = Math.max(760, (showBehaviorCompositionChart ? behaviorCompositionRows.length : showAggregatedChart ? aggregatedChangeRows.length : chartRows.length) * 72);

  const emptyText = activeTab === 'overview' || activeTab === 'session-changes'
    ? 'Sem mudanças clínicas detectadas neste período.'
    : activeTab === 'maintenance'
      ? 'Sem sondagens no período. A linha do tempo mostra sondagens pendentes, não realizadas e alertas quando existirem.'
      : activePoints.length === 1
        ? 'Primeira medição registrada. A comparação aparecerá após a próxima sessão.'
        : 'Sem dados no período selecionado.';

  const resetFilters = () => {
    setTargetId('');
    setBehaviorId('');
    setMetricType('');
    setSignificantOnly(false);
  };

  const setLineCategoryWithDefaults = (category: AbaClinicalLineCategory, itemId = '', metric = '') => {
    const options = ABA_CLINICAL_LINE_METRICS[category] || ABA_CLINICAL_LINE_METRICS.general;
    const nextMetric = metric && options.some((option) => option.id === metric) ? metric : options[0]?.id || 'TARGET_ACCURACY';
    setLineCategory(category);
    setLineItemId(itemId);
    setLineMetric(nextMetric);
  };

  const showLineFromCurrentContext = () => {
    const category = lineCategoryForTab(activeTab);
    const itemId = category === 'behavior' ? (behaviorId || focusedBehaviorId) : category === 'general' ? '' : (targetId || focusedTargetId);
    const options = ABA_CLINICAL_LINE_METRICS[category] || ABA_CLINICAL_LINE_METRICS.general;
    const nextMetric = metricType && options.some((option) => option.id === metricType) ? metricType : options[0]?.id || 'TARGET_ACCURACY';
    setLineCategoryWithDefaults(category, itemId, nextMetric);
    setLineGroupBy(groupBy === 'day' ? 'day' : 'session');
    setViewMode('line');
  };

  const showStackedView = () => setViewMode('stacked');

  const openLineFromChange = (change?: Partial<ChartPoint> & { changeCategory?: AbaClinicalChangeCategory }) => {
    if (!change) return;
    const category = changeCategoryToLineCategory(change.changeCategory);
    const itemId = category === 'behavior'
      ? String(change.behaviorId || '')
      : category === 'general'
        ? ''
        : String(change.targetId || '');
    const options = ABA_CLINICAL_LINE_METRICS[category] || ABA_CLINICAL_LINE_METRICS.general;
    const metric = options.some((option) => option.id === String(change.metricType || '')) ? String(change.metricType) : options[0]?.id || 'TARGET_ACCURACY';
    setLineCategoryWithDefaults(category, itemId, metric);
    setLineGroupBy('session');
    setViewMode('line');
    setSelectedChangeGroupKey('');
  };

  const resetDetailFilters = (category: ChangeCategoryFilter = 'all') => {
    setDetailCategoryFilter(category);
    setDetailSessionFilter('');
    setDetailDayFilter('');
    setDetailTargetFilter('');
    setDetailTrendFilter('all');
    setDetailSignificantOnly(false);
    setCollapsedChangeCategories({});
  };

  const openChangeGroup = (
    groupKey: string,
    category: ChangeCategoryFilter = 'all',
    mode: ChangeDetailMode = 'summary'
  ) => {
    if (!groupKey) return;
    setSelectedChangeGroupKey(groupKey);
    setChangeDetailMode(mode);
    resetDetailFilters(category);
  };

  const closeChangeGroup = () => setSelectedChangeGroupKey('');

  const toggleChangeCategory = (category: AbaClinicalChangeCategory) => {
    setCollapsedChangeCategories((current) => ({
      ...current,
      [category]: !current[category]
    }));
  };

  const saveAnnotation = async () => {
    if (!annotationDraft.label.trim()) return;
    const result = await dataService.saveAbaGraphAnnotation(patientId, {
      chartType: viewMode === 'line' ? 'clinical-line-chart' : activeTab,
      annotationType: annotationDraft.annotationType,
      label: annotationDraft.label,
      value: annotationDraft.value,
      date: `${annotationDraft.date}T12:00:00.000Z`,
      targetId: viewMode === 'line' && lineCategory !== 'behavior' ? lineItemId || undefined : targetId || focusedTargetId || undefined,
      behaviorId: viewMode === 'line' && lineCategory === 'behavior' ? lineItemId || undefined : behaviorId || focusedBehaviorId || undefined
    });
    if (result?.success) {
      setAnnotationDraft({ annotationType: 'NOTE', label: '', value: '', date: new Date().toISOString().slice(0, 10) });
      setAnnotationOpen(false);
      if (viewMode === 'line') void loadLineChart();
      else void loadChart(activeTab);
    }
  };

  const annotationXLines = useMemo(() => {
    return annotations
      .filter((annotation: any) => annotation.annotation_type !== 'GOAL_LINE')
      .map((annotation: any) => {
        const annotationTime = new Date(annotation.date || 0).getTime();
        const nearest = chartRows.reduce((best: any, row: any) => {
          const diff = Math.abs(new Date(row.changedAt || 0).getTime() - annotationTime);
          if (!best || diff < best.diff) return { row, diff };
          return best;
        }, null);
        return nearest?.row?.x ? { ...annotation, x: nearest.row.x } : null;
      })
      .filter(Boolean);
  }, [annotations, chartRows]);

  const overviewCards = useMemo(() => {
    const rows = overviewPoints.filter((point) => point.previousValue !== null && point.previousValue !== undefined);
    const skillImprovement = rows
      .filter((point) => ['TARGET_ACCURACY', 'TARGET_INDEPENDENCE', 'FUNCTIONAL_COMMUNICATION', 'ENGAGEMENT'].includes(String(point.metricType || '')) && point.trendDirection === 'IMPROVED')
      .sort((a, b) => Math.abs(safeNumber(b.deltaValue ?? b.deltaPercent)) - Math.abs(safeNumber(a.deltaValue ?? a.deltaPercent)))[0];
    const behaviorReduction = rows
      .filter((point) => String(point.metricType || '').startsWith('BEHAVIOR_') && point.metricDirection === 'LOWER_IS_BETTER' && point.trendDirection === 'IMPROVED')
      .sort((a, b) => Math.abs(safeNumber(b.deltaValue ?? b.deltaPercent)) - Math.abs(safeNumber(a.deltaValue ?? a.deltaPercent)))[0];
    const readyReview = overviewPoints.find((point) => point.metricType === 'MASTERY_STATUS' && (point.changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' || String(point.statusLabel || '').toLowerCase().includes('revis')));
    const regression = overviewPoints.find((point) => point.changeStatus === 'REGRESSION_SIGNAL' || point.metricType === 'REGRESSION_RISK');
    const firstMeasurement = overviewPoints.find((point) => point.changeStatus === 'FIRST_MEASUREMENT');

    return [
      {
        title: 'Maior melhora em habilidade',
        icon: TrendingUp,
        body: skillImprovement ? changeSentence(skillImprovement, 0) : 'Sem melhora de habilidade detectada no período.'
      },
      {
        title: 'Maior redução de comportamento',
        icon: TrendingDown,
        body: behaviorReduction ? changeSentence(behaviorReduction, 0) : 'Sem redução de comportamento detectada no período.'
      },
      {
        title: 'Metas prontas para revisão',
        icon: CheckCircle2,
        body: readyReview ? `${clinicalItemLabel(readyReview, 'Habilidade sem nome')}: ${translatedStatusLabel(readyReview.statusLabel || readyReview.currentStatus || 'READY_FOR_REVIEW')}.` : 'Nenhuma meta pronta para revisão no período.'
      },
      {
        title: 'Sinais de regressão',
        icon: AlertTriangle,
        body: regression ? changeSentence(regression, 0) : 'Nenhum sinal de regressão detectado no período.'
      },
      {
        title: 'Primeiras medições',
        icon: Sparkles,
        body: firstMeasurement ? `${clinicalItemLabel(firstMeasurement, 'Resumo da sessão sem item específico')}: primeira medição registrada.` : 'Sem primeiras medições no período.'
      }
    ];
  }, [overviewPoints]);

  const masteryBuckets = useMemo(() => {
    const latestByTarget = new Map<string, any>();
    const sourceRows = activePoints.length > 0 ? activePoints : overviewPoints;
    sourceRows
      .filter((point) => String(point.metricType || '') === 'MASTERY_STATUS')
      .forEach((point) => {
        const key = String(point.targetId || point.metricLabel || point.id || '');
        const current = latestByTarget.get(key);
        if (!current || new Date(point.changedAt || 0).getTime() >= new Date(current.changedAt || 0).getTime()) latestByTarget.set(key, point);
      });
    const evaluations = Array.isArray(activeData.evaluations) ? activeData.evaluations : [];
    evaluations.forEach((evaluation: any) => {
      const key = String(evaluation.target_id || evaluation.targetId || evaluation.id || '');
      if (!latestByTarget.has(key)) {
        latestByTarget.set(key, {
          id: evaluation.id,
          targetId: evaluation.target_id || evaluation.targetId,
          metricLabel: evaluation.target_name || evaluation.targetName || 'Habilidade sem nome',
          metricType: 'MASTERY_STATUS',
          status: evaluation.status,
          changedAt: evaluation.evaluated_at || evaluation.evaluatedAt
        });
      }
    });
    return masteryStatuses.map((status) => {
      const items = Array.from(latestByTarget.values()).filter((point) => masteryStatusFromPoint(point) === status);
      return { status, items };
    });
  }, [activeData.evaluations, activePoints, overviewPoints]);

  const maintenanceTimeline = useMemo(() => {
    const schedules = Array.isArray(activeData.schedules) ? activeData.schedules : [];
    const probes = Array.isArray(activeData.probeResults) ? activeData.probeResults : [];
    const alerts = Array.isArray(activeData.alerts) ? activeData.alerts : [];
    return [
      ...schedules.map((item: any) => ({
        id: item.id,
        at: item.scheduled_for || item.scheduledFor,
        status: String(item.status || 'PENDING').toUpperCase(),
        label: clinicalItemLabel({
          metricLabel: item.raw_payload?.targetName || item.target_name,
          targetId: item.target_id
        }, 'Sondagem sem habilidade vinculada'),
        kind: 'schedule'
      })),
      ...probes.map((item: any) => ({
        id: item.id,
        at: item.occurred_at || item.occurredAt,
        status: String(item.status || 'WATCH').toUpperCase(),
        label: clinicalItemLabel({
          metricLabel: item.raw_payload?.targetName || item.target_name,
          targetId: item.target_id
        }, 'Sondagem sem habilidade vinculada'),
        kind: 'probe'
      })),
      ...alerts.map((item: any) => ({
        id: item.id,
        at: item.created_at || item.createdAt,
        status: 'REGRESSION_RISK',
        label: safeDisplayValue(item.message || item.target_id, 'Alerta'),
        kind: 'alert'
      }))
    ].sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
  }, [activeData.alerts, activeData.probeResults, activeData.schedules]);

  const behaviorContextPatterns = useMemo(() => {
    const patterns = Array.isArray(activeData.contextPatterns) ? activeData.contextPatterns as AbaBehaviorContextPattern[] : [];
    return patterns
      .filter((pattern) => !behaviorId || String(pattern.behaviorId || '') === behaviorId)
      .sort((a, b) => b.totalRecords - a.totalRecords)
      .slice(0, 4);
  }, [activeData.contextPatterns, behaviorId]);

  const behaviorTrendSummary = useMemo(() => {
    const behaviorRows = aggregateSourcePoints.filter((point) => String(point.metricType || '').startsWith('BEHAVIOR_'));
    const improved = behaviorRows.filter(isImprovedChange).length;
    const worsened = behaviorRows.filter(isWorsenedChange).length;
    const stable = behaviorRows.filter(isStableChange).length;
    if (worsened > improved && worsened > 0) {
      return {
        label: 'Regressão',
        className: 'border-red-200 bg-red-50 text-red-700',
        body: `${worsened} registro(s) com aumento clínico de comportamento interferente no período.`
      };
    }
    if (improved > 0 && improved >= worsened) {
      return {
        label: 'Melhora',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        body: `${improved} registro(s) com redução ou melhora clínica no período.`
      };
    }
    if (stable > 0) {
      return {
        label: 'Estável',
        className: 'border-amber-200 bg-amber-50 text-amber-800',
        body: 'Sem mudança clínica relevante nos comportamentos interferentes filtrados.'
      };
    }
    return {
      label: 'Dados insuficientes',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
      body: 'Ainda não há comparação suficiente para tendência contextual.'
    };
  }, [aggregateSourcePoints]);

  const goalLines = annotations.filter((annotation: any) => annotation.annotation_type === 'GOAL_LINE' && annotation.value !== null && annotation.value !== '');
  const showDefaultCriterion = activeTab === 'targets' && percentMetrics.has(effectiveMetricType) && !goalLines.length;

  const Filters = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Período</label>
        <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setPeriodDays(days)}
              className={`rounded-md px-3 py-2 text-xs font-bold ${periodDays === days ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Agrupar por</label>
        <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'session', label: 'Sessão' },
            { id: 'day', label: 'Dia' }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setGroupBy(option.id as 'session' | 'day');
                setGroupByTouched(true);
              }}
              className={`rounded-md px-3 py-2 text-xs font-bold ${groupBy === option.id ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Habilidade</label>
        <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
          <option value="">Todos</option>
          {targetOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Comportamento</label>
        <select value={behaviorId} onChange={(event) => setBehaviorId(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
          <option value="">Todos</option>
          {behaviorOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Métrica</label>
        <select value={metricType} onChange={(event) => setMetricType(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
          <option value="">Auto</option>
          {availableMetrics.map((id) => <option key={id} value={id}>{metricLabels[id] || id}</option>)}
        </select>
        {!metricType && (
          <p className="mt-1 text-[10px] font-medium leading-snug text-slate-400">
            Métrica automática: cada habilidade usa sua métrica clínica principal.
          </p>
        )}
      </div>
      <div className="flex items-end gap-2">
        <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={significantOnly} onChange={(event) => setSignificantOnly(event.target.checked)} />
          Significativas
        </label>
        <button type="button" onClick={resetFilters} className="rounded-lg bg-slate-100 p-3 text-slate-500" title="Limpar filtros">
          <X size={16} />
        </button>
      </div>
    </div>
  );

  const LineFilters = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Período</label>
        <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setPeriodDays(days)}
              className={`rounded-md px-3 py-2 text-xs font-bold ${periodDays === days ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Categoria</label>
        <select
          value={lineCategory}
          onChange={(event) => setLineCategoryWithDefaults(event.target.value as AbaClinicalLineCategory)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none"
        >
          {lineCategoryOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Item</label>
        <select
          value={lineItemId}
          onChange={(event) => setLineItemId(event.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none"
        >
          <option value="">{lineCategory === 'general' ? 'Geral' : 'Selecionar'}</option>
          {lineItemOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Métrica</label>
        <select
          value={lineMetric}
          onChange={(event) => setLineMetric(event.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none"
        >
          {lineMetricOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Agrupar</label>
        <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'session', label: 'Sessão' },
            { id: 'day', label: 'Dia' },
            { id: 'week', label: 'Semana' }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setLineGroupBy(option.id as LineGroupBy)}
              className={`rounded-md px-2 py-2 text-[11px] font-bold ${lineGroupBy === option.id ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-end">
        <button type="button" onClick={() => setLineCategoryWithDefaults(lineCategory)} className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-600">
          <X size={16} /> Limpar
        </button>
      </div>
    </div>
  );

  const metricPills = activeTab === 'targets' || activeTab === 'behaviors'
    ? (activeTab === 'targets' ? targetMetricOptions : behaviorMetricOptions)
    : [];

  return (
    <div className={`space-y-5 rounded-lg border p-4 shadow-sm sm:p-6 ${isPanelDark ? 'border-slate-700 bg-[#101b2e]' : 'border-slate-100 bg-white'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#7a32fc]/10 text-[#7a32fc]">
            <BarChart3 size={22} />
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${isPanelDark ? 'text-violet-200' : 'text-[#7a32fc]'}`}>Gráficos ABA</p>
            <h3 className={`text-xl font-semibold tracking-tight ${isPanelDark ? 'text-slate-50' : 'text-slate-900'}`}>Mudanças clínicas por sessão</h3>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={showStackedView}
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold ${viewMode === 'stacked' ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              <BarChart3 size={15} /> Empilhado
            </button>
            <button
              type="button"
              onClick={showLineFromCurrentContext}
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold ${viewMode === 'line' ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
            >
              <LineChartIcon size={15} /> Linha
            </button>
          </div>
          <button type="button" onClick={() => setFilterOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-3 text-xs font-bold text-slate-600 md:hidden">
            <Filter size={16} /> Filtros
          </button>
          <button type="button" onClick={() => setAnnotationOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-[#7a32fc] px-4 py-3 text-xs font-bold text-white">
            <Plus size={16} /> Anotação
          </button>
        </div>
      </div>

      <div className="hidden md:block">{viewMode === 'line' ? LineFilters : Filters}</div>

      {filterOpen && (
        <div className="fixed inset-0 z-[140] flex items-end bg-black/30 p-3 md:hidden">
          <div className="w-full rounded-lg bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">Filtros</p>
              <button type="button" onClick={() => setFilterOpen(false)} className="rounded-lg bg-slate-100 p-2 text-slate-500"><X size={16} /></button>
            </div>
            {viewMode === 'line' ? LineFilters : Filters}
          </div>
        </div>
      )}

      {annotationOpen && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-4 md:grid-cols-[180px_1fr_140px_160px_auto]">
          <select value={annotationDraft.annotationType} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, annotationType: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none">
            <option value="NOTE">Evento externo</option>
            <option value="GOAL_LINE">Linha de critério/meta</option>
            <option value="CONDITION_LINE">Fase/intervenção</option>
          </select>
          <input value={annotationDraft.label} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Início do protocolo" className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none" />
          <input value={annotationDraft.value} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, value: event.target.value }))} placeholder="Valor" className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none" />
          <input type="date" value={annotationDraft.date} onChange={(event) => setAnnotationDraft((draft) => ({ ...draft, date: event.target.value }))} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-700 outline-none" />
          <button type="button" onClick={() => void saveAnnotation()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-xs font-bold text-white">
            <Save size={15} /> Salvar
          </button>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {chartTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              if (viewMode === 'line') setLineCategoryWithDefaults(lineCategoryForTab(tab.id));
            }}
            className={`shrink-0 rounded-md px-4 py-2 text-xs font-bold transition-all ${activeTab === tab.id ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {viewMode === 'stacked' && metricPills.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {metricPills.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setMetricType(id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${effectiveMetricType === id ? 'border-[#7a32fc] bg-[#7a32fc]/10 text-[#7a32fc]' : 'border-slate-200 bg-white text-slate-500'}`}
            >
              <Target size={14} />
              {metricLabels[id]}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'behaviors' && (
        <section className="grid grid-cols-1 gap-3 rounded-lg border border-sky-100 bg-sky-50/50 p-4 lg:grid-cols-[240px_1fr]" data-aba-behavior-context-panel>
          <div className={`rounded-lg border p-3 ${behaviorTrendSummary.className}`} data-aba-behavior-trend-summary>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">Resumo visual da tendência</p>
            <p className="mt-2 text-lg font-black">{behaviorTrendSummary.label}</p>
            <p className="mt-1 text-xs font-semibold leading-relaxed">{behaviorTrendSummary.body}</p>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700">Padrões identificados</p>
                <h4 className="text-sm font-bold text-slate-900">Insights contextuais dos comportamentos</h4>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-sky-700">
                {behaviorContextPatterns.length} comportamento(s)
              </span>
            </div>
            {behaviorContextPatterns.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {behaviorContextPatterns.map((pattern) => (
                  <div key={pattern.behaviorKey} className="rounded-lg border border-sky-100 bg-white px-3 py-2" data-aba-behavior-context-card>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{safeDisplayValue(pattern.behaviorName, 'Comportamento')}</p>
                      <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">{pattern.totalRecords} registro(s)</span>
                    </div>
                    {(pattern.insights || []).length === 0 ? (
                      <p className="mt-2 text-xs font-semibold text-slate-500">Os registros do periodo nao tem contexto suficiente para identificar local, severidade ou metodo predominante.</p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs font-semibold leading-relaxed text-slate-600">
                        {(pattern.insights || []).slice(0, 3).map((insight, index) => (
                          <li key={`${pattern.behaviorKey}-insight-${index}`}>{insight}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {pattern.dominantLocation && <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700">Local: {pattern.dominantLocation.value}</span>}
                      {pattern.commonSeverity && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Severidade: {pattern.commonSeverity.value}</span>}
                      {pattern.commonCollectionMethod && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">Método: {pattern.commonCollectionMethod.value}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <ContextDistributionRows title="Por local" rows={pattern.locationDistribution} tone="sky" />
                      <ContextDistributionRows title="Por severidade" rows={pattern.severityDistribution} tone="amber" />
                      <ContextDistributionRows title="Por método" rows={pattern.collectionMethodDistribution} tone="violet" />
                      <ContextDistributionRows title="Por horário" rows={pattern.timeOfDayDistribution} tone="slate" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-sky-100 bg-white px-3 py-3 text-xs font-semibold text-slate-500">
                Os registros do periodo nao tem contexto suficiente para identificar local, severidade ou metodo predominante.
              </p>
            )}
          </div>
        </section>
      )}

      {error && <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-700">{error}</div>}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {overviewCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <Icon size={16} className="mb-3 text-[#7a32fc]" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{card.title}</p>
                <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-700">{card.body}</p>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'mastery' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {masteryBuckets.map((bucket) => (
            <div key={bucket.status} className="rounded-lg border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{masteryStatusLabel[bucket.status]}</p>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{bucket.items.length}</span>
              </div>
              <div className="space-y-2">
                {bucket.items.slice(0, 3).map((item: any) => (
                  <p key={`${bucket.status}-${item.id || item.targetId || item.metricLabel}`} className="truncate text-xs font-semibold text-slate-700">{safeDisplayValue(item.metricLabel || item.targetId, 'Meta sem nome')}</p>
                ))}
                {bucket.items.length === 0 && <p className="text-xs font-semibold text-slate-300">Sem habilidades neste status</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'maintenance' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {maintenanceStatuses.map((status) => {
              const count = maintenanceTimeline.filter((item) => item.status === status).length;
              return (
                <div key={status} className="rounded-lg border border-slate-100 bg-white p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{maintenanceStatusLabel[status]}</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{count}</p>
                </div>
              );
            })}
          </div>
          {maintenanceTimeline.length > 0 ? (
            <div className="rounded-lg border border-slate-100 bg-white p-4">
              <p className="mb-4 text-sm font-bold text-slate-900">Timeline de manutenção</p>
              <div className="space-y-3">
                {maintenanceTimeline.slice(0, 12).map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 rounded-lg bg-slate-50 p-3 text-xs">
                    <span className="font-bold text-slate-500">{formatDateTime(item.at)}</span>
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${item.status === 'REGRESSION_RISK' ? 'border-red-100 bg-red-50 text-red-700' : item.status === 'MAINTAINED' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-white text-slate-500'}`}>
                      {maintenanceStatusLabel[item.status] || item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState text={emptyText} />
          )}
        </div>
      )}

      {viewMode === 'line' ? (
        lineLoading ? (
          <div className="h-[420px] animate-pulse rounded-lg bg-slate-50" />
        ) : lineChartRows.length > 0 ? (
          <div className="rounded-lg border border-slate-100 bg-white p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Evolução clínica em linha
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {selectedLineMetricOption?.label || lineAxisLabel} · {lineChartRows.length} ponto(s) · {lineGroupBy === 'week' ? 'por semana' : lineGroupBy === 'day' ? 'por dia' : 'por sessão'}
                </p>
              </div>
              <LineChartIcon size={18} className="text-slate-300" />
            </div>

            <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-4">
              {[
                { label: 'Valor atual', value: formatClinicalValue(lineSummary.currentValue, lineMetric, lineSummary.status) },
                { label: 'Variação', value: lineSummary.delta === null || lineSummary.delta === undefined ? '-' : `${lineSummary.delta > 0 ? '+' : ''}${formatValue(lineSummary.delta, lineMetric)}` },
                { label: 'Tendência', value: lineTrendDisplay.label, className: lineTrendDisplay.className },
                { label: 'Última medição', value: lineSummary.lastMeasuredAt ? `${formatDate(lineSummary.lastMeasuredAt)} · ${lineSummary.lastSessionLabel || 'sessão'}` : '-' }
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                  <p className={`mt-1 truncate text-sm font-black ${item.className || 'text-slate-900'}`}>{item.value}</p>
                </div>
              ))}
            </div>

            {linePhases.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {linePhases.slice(0, 6).map((phase: any) => (
                  <span key={phase.id || phase.date || phase.label} className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-[10px] font-bold text-violet-700">
                    {phase.label || 'Fase clínica'} · {formatDate(phase.date)}
                  </span>
                ))}
              </div>
            )}

            <div className="h-[380px] min-w-0 overflow-x-auto">
              <div className="h-full" style={{ minWidth: lineMinWidth }}>
                <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={340}>
                  <LineChart data={lineChartRows} margin={{ top: 20, right: 24, left: 8, bottom: 52 }}>
                    <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="x" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} angle={-18} textAnchor="end" height={62} interval={0} />
                    <YAxis
                      tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 700 }}
                      domain={percentMetrics.has(lineMetric) || isCompareResponses ? [0, 100] : ['auto', 'auto']}
                      label={{ value: lineAxisLabel, angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11, fontWeight: 700 }}
                    />
                    <Tooltip content={<ClinicalLineTooltip />} />
                    {isCompareResponses && <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />}
                    {lineGoalLines.map((annotation: any) => (
                      <ReferenceLine key={annotation.id} y={Number(annotation.value)} stroke="#10B981" strokeDasharray="4 4" label={annotation.label} />
                    ))}
                    {lineXMarkers.map((annotation: any) => (
                      <ReferenceLine key={annotation.id || `${annotation.x}-${annotation.label}`} x={annotation.x} stroke={annotation.annotation_type === 'CONDITION_LINE' ? '#7a32fc' : '#64748B'} strokeDasharray="4 4" label={annotation.label} />
                    ))}
                    {isCompareResponses ? (
                      (['independencePct', 'promptedPct', 'errorPct', 'accuracyPct'] as const).map((key) => (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          name={clinicalLineLabels[key]}
                          stroke={clinicalLineColors[key]}
                          strokeWidth={key === 'accuracyPct' ? 3 : 2.5}
                          dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 7 }}
                          connectNulls
                        />
                      ))
                    ) : (
                      <Line
                        type="monotone"
                        dataKey="chartValue"
                        name={selectedLineMetricOption?.label || clinicalLineLabels.value || 'Valor'}
                        stroke={clinicalLineColors.value}
                        strokeWidth={3}
                        dot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 7 }}
                        connectNulls
                      />
                    )}
                  </LineChart>
                </SafeResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState text={lineEmptyText} />
        )
      ) : isLoading ? (
        <div className="h-[360px] animate-pulse rounded-lg bg-slate-50" />
      ) : shouldRenderChart ? (
        <div className="rounded-lg border border-slate-100 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">
                {showBehaviorCompositionChart
                  ? 'Composição por comportamento'
                  : showAggregatedChart
                  ? 'Resumo clínico agrupado'
                  : metricAxisLabels[effectiveMetricType] || chartTabs.find((tab) => tab.id === activeTab)?.label}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {showBehaviorCompositionChart
                  ? `${behaviorCompositionRows.length} grupo(s) · ${behaviorCompositionSeries.length} comportamento(s)`
                  : showAggregatedChart ? `${aggregatedChangeRows.length} grupo(s) · ${groupBy === 'day' ? 'por dia' : 'por sessão'}` : `${chartRows.length} ponto(s) · ${yAxisLabel}`}
              </p>
            </div>
            <SlidersHorizontal size={18} className="text-slate-300" />
          </div>
          <div className="h-[360px] min-w-0 overflow-x-auto">
            <div className="h-full" style={{ minWidth: stackedMinWidth }}>
              <SafeResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320}>
                {showBehaviorCompositionChart ? (
                  <BarChart data={behaviorCompositionRows} margin={{ top: 20, right: 24, left: 8, bottom: 44 }} data-aba-behavior-composition-chart>
                  <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} angle={-18} textAnchor="end" height={58} interval={0} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} />
                  <Tooltip content={<BehaviorCompositionTooltip metricType={effectiveMetricType} />} cursor={{ fill: 'rgba(122, 50, 252, 0.06)' }} />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                  {behaviorCompositionSeries.map((series, index) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.label}
                      stackId="behavior-composition"
                      fill={behaviorStackColors[index % behaviorStackColors.length]}
                      radius={index === behaviorCompositionSeries.length - 1 ? [6, 6, 0, 0] : undefined}
                      maxBarSize={56}
                    />
                  ))}
                  </BarChart>
                ) : showAggregatedChart ? (
                  <BarChart data={aggregatedChangeRows} margin={{ top: 20, right: 24, left: 8, bottom: 44 }}>
                  <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} angle={-18} textAnchor="end" height={58} interval={0} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} />
                  <Tooltip content={<AggregatedTooltip />} cursor={{ fill: 'rgba(122, 50, 252, 0.06)' }} />
                  {showFullAggregateLegend && <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />}
                  {visibleAggregateBars.map((bar, index) => (
                    <Bar
                      key={bar.key}
                      dataKey={bar.key}
                      name={bar.label}
                      stackId="changes"
                      fill={aggregateBarColors[bar.key]}
                      radius={index === visibleAggregateBars.length - 1 ? [6, 6, 0, 0] : undefined}
                      maxBarSize={56}
                      onClick={(entry: any) => openChangeGroup(entry?.payload?.groupKey || '', bar.category, 'detail')}
                    />
                  ))}
                  </BarChart>
                ) : (
                  <LineChart data={chartRows} margin={{ top: 20, right: 24, left: 8, bottom: 44 }}>
                  <CartesianGrid stroke="#EEF2F7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="x" tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} angle={-18} textAnchor="end" height={58} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#94A3B8', fontSize: 11, fontWeight: 700 }} />
                  <Tooltip content={<CustomTooltip />} />
                  {showDefaultCriterion && <ReferenceLine y={80} stroke="#10B981" strokeDasharray="4 4" label="Critério 80%" />}
                  {goalLines.map((annotation: any) => (
                    <ReferenceLine key={annotation.id} y={Number(annotation.value)} stroke="#10B981" strokeDasharray="4 4" label={annotation.label} />
                  ))}
                  {annotationXLines.map((annotation: any) => (
                    <ReferenceLine key={annotation.id} x={annotation.x} stroke={annotation.annotation_type === 'CONDITION_LINE' ? '#F97316' : '#64748B'} strokeDasharray="4 4" label={annotation.label} />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="chartValue"
                    stroke="#7a32fc"
                    strokeWidth={3}
                    dot={(props: any) => {
                      const row = props?.payload || {};
                      const important = row.changeStatus === 'REGRESSION_SIGNAL' || row.changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' || row.trendDirection === 'IMPROVED' || row.trendDirection === 'WORSENED';
                      return <circle cx={props.cx} cy={props.cy} r={important ? 6 : 4} fill={important ? chartColor(row) : '#7a32fc'} stroke="#fff" strokeWidth={2} />;
                    }}
                    activeDot={{ r: 7 }}
                  />
                  </LineChart>
                )}
              </SafeResponsiveContainer>
            </div>
          </div>
        </div>
      ) : activeTab !== 'maintenance' && activeTab !== 'mastery' ? (
        <EmptyState text={emptyText} />
      ) : null}

      {activeTab === 'session-changes' && aggregatedChangeRows.length > 0 && (
        <div className="rounded-lg border border-slate-100 bg-white p-4">
          <p className="mb-4 text-sm font-bold text-slate-900">Linha do tempo clínica</p>
          <div className="space-y-3">
            {aggregatedChangeRows.slice().reverse().map((group) => (
              <div key={group.groupKey} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${aggregateBadgeTone(group)}`}>
                      {group.hasRegressionAlert ? 'Alerta' : group.hasReviewReady ? 'Pronto para revisão' : `${group.totalChanges} mudanças`}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{group.label}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => openChangeGroup(group.groupKey, 'all', 'summary')}
                    className="rounded-md bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#7a32fc] shadow-sm"
                  >
                    Ver detalhes
                  </button>
                </div>
                <p className="text-sm font-semibold text-slate-800">
                  {group.relevantChanges} relevantes de {group.totalChanges} mudanças. Maior mudança: <ClinicalChangeBriefView point={topClinicalChangeForGroup(group)} />
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {clinicalChangeCategoryOrder.map((category) => (
                    <span key={category} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500">
                      {clinicalChangeCategoryLabels[category]}: {group.categoryCounts[category] || 0}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAggregatedChart && activeTab !== 'session-changes' && aggregateTopChanges.length > 0 && (
        <div className="rounded-lg border border-slate-100 bg-white p-4">
          <p className="mb-4 text-sm font-bold text-slate-900">
            {activeTab === 'overview' ? 'Maiores mudanças recentes' : 'Ranking clínico agregado'}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {aggregateTopChanges.map(({ group, change }, index) => (
              <button
                key={`${group.groupKey}-${change.id || change.metricType}-${index}`}
                type="button"
                onClick={() => openChangeGroup(group.groupKey, change.changeCategory, 'detail')}
                className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-left transition hover:border-[#7a32fc]/30 hover:bg-white"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${statusTone(change.changeStatus)}`}>
                    {translatedStatusLabel(change.statusLabel || change.currentStatus) !== '-' ? translatedStatusLabel(change.statusLabel || change.currentStatus) : clinicalInterpretation(change)}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{group.label}</span>
                </div>
                <p className="text-sm font-bold text-slate-900">{clinicalItemLabel(change)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {clinicalChangeCategoryLabels[change.changeCategory]} · <ClinicalChangeBriefView point={change} />
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!showAggregatedChart && chartRows.length > 0 && activeTab !== 'session-changes' && activeTab !== 'maintenance' && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {chartRows.slice(-6).reverse().map((point: ChartPoint, index: number) => (
            <div key={`${point.id || point.sessionId}-${point.metricType}-${index}`} className="rounded-lg border border-slate-100 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${statusTone(point.changeStatus)}`}>
                  {point.statusLabel || clinicalInterpretation(point)}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{formatDateTime(point.changedAt)}</span>
              </div>
              <p className="text-sm font-bold text-slate-900">{clinicalItemLabel(point)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Métrica analisada: {metricLabels[String(point.metricType || '')] || 'Métrica'} · atual {formatClinicalValue(point.value ?? point.metricValue, point.metricType, point.currentStatus || point.masteryStatus || point.statusLabel)} · anterior {formatClinicalValue(point.previousValue, point.metricType, (point as any).previousStatus)} · delta <span className={`font-black ${changeStatePresentation(point).strongText}`}>{formatDelta(point)}</span> · <span className={`font-black ${changeStatePresentation(point).text}`}>{changeStatePresentation(point).label}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {selectedChangeGroup && (
        <div className="fixed inset-0 z-[150] flex items-end bg-black/30 p-3 md:items-stretch md:justify-end md:p-4" onClick={closeChangeGroup}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes das mudanças clínicas"
            className="max-h-[88vh] w-full overflow-y-auto rounded-lg bg-white p-4 shadow-2xl md:h-full md:max-h-none md:w-[620px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#7a32fc]">{selectedChangeGroup.groupBy === 'day' ? 'Dia selecionado' : 'Sessão selecionada'}</p>
                <h4 className="mt-1 text-lg font-semibold text-slate-900">{selectedChangeGroup.label}</h4>
                <p className="mt-1 text-xs text-slate-500">
                  {selectedChangeGroup.totalChanges} mudanças · {selectedChangeGroup.relevantChanges} relevantes · {detailKpis.total} no filtro atual
                </p>
              </div>
              <button type="button" onClick={closeChangeGroup} className="rounded-lg bg-slate-100 p-2 text-slate-500" title="Fechar detalhes">
                <X size={16} />
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                { label: 'Mudanças', value: detailKpis.total, className: 'border-slate-200 bg-slate-50 text-slate-700' },
                { label: 'Melhoras', value: detailKpis.improved, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
                { label: 'Pioras', value: detailKpis.worsened, className: 'border-red-200 bg-red-50 text-red-700' },
                { label: 'Estáveis', value: detailKpis.stable, className: 'border-slate-200 bg-white text-slate-600' },
                { label: 'Alertas', value: detailKpis.alerts, className: 'border-red-200 bg-red-50 text-red-700' }
              ].map((item) => (
                <div key={item.label} className={`rounded-lg border p-3 ${item.className}`}>
                  <p className="text-[10px] font-medium uppercase tracking-widest opacity-75">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Resumo por sessão</p>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">
                  {selectedChangeGroup.totalChanges} total
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                {clinicalChangeCategoryOrder.map((category) => {
                  const tone = clinicalChangeCategoryTone[category];
                  const active = detailCategoryFilter === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => {
                        setDetailCategoryFilter(active ? 'all' : category);
                        setChangeDetailMode('detail');
                      }}
                      className={`rounded-lg border p-3 text-left transition ${tone.header} ${active ? tone.ring : ''}`}
                    >
                      <span className={`mb-2 block h-1 w-8 rounded-full ${tone.accent}`} />
                      <span className="block text-[10px] font-medium uppercase tracking-widest">{clinicalChangeCategoryLabels[category]}</span>
                      <span className="mt-1 block text-xl font-semibold">{selectedChangeGroup.categoryCounts[category] || 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-grid grid-cols-2 rounded-lg bg-slate-100 p-1">
                  {[
                    { id: 'summary', label: 'Resumo' },
                    { id: 'detail', label: 'Detalhado' }
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setChangeDetailMode(mode.id as ChangeDetailMode)}
                      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${changeDetailMode === mode.id ? 'bg-white text-[#7a32fc] shadow-sm' : 'text-slate-500'}`}
                    >
                      <ListTree size={14} />
                      {mode.label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => resetDetailFilters('all')} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-500">
                  Limpar filtros
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-widest text-slate-400">Categoria</label>
                  <select value={detailCategoryFilter} onChange={(event) => setDetailCategoryFilter(event.target.value as ChangeCategoryFilter)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 outline-none">
                    <option value="all">Todas</option>
                    {clinicalChangeCategoryOrder.map((category) => (
                      <option key={category} value={category}>{clinicalChangeCategoryLabels[category]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-widest text-slate-400">Sessão</label>
                  <select value={detailSessionFilter} onChange={(event) => setDetailSessionFilter(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 outline-none">
                    <option value="">Todas</option>
                    {detailSessionOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-widest text-slate-400">Dia</label>
                  <select value={detailDayFilter} onChange={(event) => setDetailDayFilter(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 outline-none">
                    <option value="">Todos</option>
                    {detailDayOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-widest text-slate-400">Habilidade/meta</label>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                    <Search size={14} className="text-slate-400" />
                    <input value={detailTargetFilter} onChange={(event) => setDetailTargetFilter(event.target.value)} placeholder="Filtrar por nome" className="min-w-0 flex-1 bg-transparent text-xs font-medium text-slate-700 outline-none placeholder:text-slate-300" />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <label className="inline-flex min-h-[34px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600">
                  <input type="checkbox" checked={detailSignificantOnly} onChange={(event) => setDetailSignificantOnly(event.target.checked)} />
                  Somente significativas
                </label>
                {[
                  { id: 'all', label: 'Todos' },
                  { id: 'improved', label: 'Somente melhora' },
                  { id: 'worsened', label: 'Somente piora' },
                  { id: 'alerts', label: 'Somente alertas' }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDetailTrendFilter(item.id as ChangeTrendFilter)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium ${detailTrendFilter === item.id ? 'border-[#7a32fc] bg-[#7a32fc]/10 text-[#7a32fc]' : 'border-slate-200 bg-white text-slate-500'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {changeDetailMode === 'summary' ? (
              <div className="space-y-3">
                {detailGroups.map(({ category, changes }) => {
                  const tone = clinicalChangeCategoryTone[category];
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => {
                        setDetailCategoryFilter(category);
                        setChangeDetailMode('detail');
                      }}
                      className={`w-full rounded-lg border p-3 text-left transition hover:bg-white ${tone.panel} ${detailCategoryFilter === category ? tone.ring : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${tone.accent}`} />
                          <span className={`text-sm font-semibold ${tone.softText}`}>{clinicalChangeCategoryLabels[category]}</span>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-widest ${tone.badge}`}>
                          {changes.length} itens
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {changes.slice(0, 3).map((change, index) => (
                          <div key={`${change.id || change.sessionId}-${change.metricType}-${index}`} className="rounded-md bg-white/80 px-3 py-2">
                            <p className="truncate text-xs font-medium text-slate-800">{changePrimaryLabel(change)}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {formatClinicalValue(change.previousValue, change.metricType, (change as any).previousStatus)} → {formatClinicalValue((change as ChartPoint).value ?? change.metricValue, change.metricType, change.currentStatus || change.masteryStatus || change.statusLabel)} · <span className={`font-black ${changeStatePresentation(change).strongText}`}>{formatDelta(change)}</span> · <span className={`font-black ${changeStatePresentation(change).text}`}>{changeStatePresentation(change).label}</span>
                            </p>
                          </div>
                        ))}
                        {changes.length === 0 && <p className="rounded-md bg-white/70 px-3 py-2 text-xs text-slate-400">Nenhum item nesta seleção.</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {detailGroups.map(({ category, changes }) => {
                  const tone = clinicalChangeCategoryTone[category];
                  const collapsed = Boolean(collapsedChangeCategories[category]);
                  return (
                    <section key={category} className={`rounded-lg border p-3 ${tone.panel} ${detailCategoryFilter === category ? tone.ring : ''}`}>
                      <button type="button" onClick={() => toggleChangeCategory(category)} className="flex w-full items-center justify-between gap-3 text-left">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.accent}`} />
                          <span className={`truncate text-sm font-semibold ${tone.softText}`}>{clinicalChangeCategoryLabels[category]}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>{changes.length}</span>
                        </div>
                        {collapsed ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                      </button>
                      {!collapsed && (
                        <div className="mt-3 space-y-3">
                          {changes.length > 0 ? (
                            changes.map((change, index) => (
                              <ClinicalChangeCard key={`${change.id || change.sessionId}-${change.metricType}-${index}`} change={change} index={index} />
                            ))
                          ) : (
                            <p className="rounded-lg bg-white/70 px-3 py-4 text-center text-xs text-slate-400">Nenhum item nesta categoria com os filtros atuais.</p>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
                {selectedFilteredChanges.length > visibleDetailChanges.length && (
                  <p className="text-center text-[11px] text-slate-400">
                    Mostrando {visibleDetailChanges.length} de {selectedFilteredChanges.length} itens filtrados.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
