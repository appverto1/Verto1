import { formatDisplayDate } from './dateFormatting';

export type AbaMetricDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'STATUS_BASED';

export type AbaMetricType =
  | 'TARGET_ACCURACY'
  | 'TARGET_INDEPENDENCE'
  | 'TARGET_TRIAL_COUNT'
  | 'FUNCTIONAL_COMMUNICATION'
  | 'ENGAGEMENT'
  | 'BEHAVIOR_FREQUENCY'
  | 'BEHAVIOR_DURATION_EPISODES'
  | 'BEHAVIOR_DURATION_TOTAL'
  | 'BEHAVIOR_DURATION_AVG'
  | 'BEHAVIOR_DURATION_MAX'
  | 'BEHAVIOR_INTERVAL_OCCURRENCE'
  | 'MASTERY_STATUS'
  | 'MAINTENANCE_STATUS'
  | 'REGRESSION_RISK';

export type AbaTrendDirection = 'IMPROVED' | 'WORSENED' | 'STABLE' | 'INSUFFICIENT_DATA';

export type AbaChangeStatus =
  | 'FIRST_MEASUREMENT'
  | 'CHANGED'
  | 'NO_CHANGE'
  | 'CLINICALLY_SIGNIFICANT_CHANGE'
  | 'REGRESSION_SIGNAL';

export type AbaClinicalChartThresholds = {
  stablePercent: number;
  meaningfulPercent: number;
  targetClinicalCriterion: number;
};

export type AbaMetricComparisonInput = {
  metricType: AbaMetricType | string;
  metricLabel?: string | null;
  metricValue: number | string | null | undefined;
  previousValue?: number | string | null;
  currentStatus?: string | null;
  previousStatus?: string | null;
  clinicalCriterion?: number | null;
  thresholds?: Partial<AbaClinicalChartThresholds>;
};

export type AbaMetricComparison = {
  metricValue: number;
  previousValue: number | null;
  deltaValue: number | null;
  deltaPercent: number | null;
  trendDirection: AbaTrendDirection;
  changeStatus: AbaChangeStatus;
  statusLabel: string;
  metricDirection: AbaMetricDirection;
};

export type AbaSessionMetricSnapshot = AbaMetricComparison & {
  id?: string | null;
  organizationId?: string | null;
  clinicId?: string | null;
  patientId?: string | null;
  sessionId: string;
  targetId?: string | null;
  behaviorId?: string | null;
  metricType: AbaMetricType | string;
  metricLabel: string;
  changedAt: string;
  sourceSummaryId?: string | null;
};

export type AbaClinicalChangeCategory = 'skill' | 'behavior' | 'mastery' | 'maintenance' | 'regression';

export type AbaClinicalLineCategory = 'target' | 'behavior' | 'mastery' | 'maintenance' | 'general';

export type AbaClinicalLineMetricOption = {
  id: string;
  label: string;
  axis: 'percent' | 'count' | 'duration' | 'status';
  multiLine?: boolean;
};

export type AbaClinicalLinePoint = {
  id?: string | null;
  sessionId?: string | null;
  sessionLabel: string;
  itemId?: string | null;
  itemLabel: string;
  metric: string;
  metricLabel: string;
  date: string;
  value: number | null;
  secondaryValues?: Record<string, number | null>;
  trialType?: string | null;
  prompt?: string | null;
  attemptsCount?: number | null;
  status?: string | null;
  metadata?: Record<string, any>;
};

export type AbaClinicalLineSummary = {
  currentValue: number | null;
  previousValue: number | null;
  delta: number | null;
  trend: 'improved' | 'worsened' | 'stable' | 'insufficient_data';
  lastMeasuredAt: string | null;
  lastSessionLabel: string | null;
  attemptsCount: number | null;
  status: string | null;
};

export type AbaAggregatedClinicalChange = AbaSessionMetricSnapshot & {
  changeCategory: AbaClinicalChangeCategory;
  rawMagnitude: number;
  visualMagnitude: number;
  realMagnitude: number;
};

export type AbaAggregatedClinicalChangeGroup = {
  groupKey: string;
  groupBy: 'session' | 'day';
  label: string;
  groupLabel?: string;
  sessionId?: string | null;
  sessionDisplayLabel?: string | null;
  sessionTooltipLabel?: string | null;
  sessionShortCode?: string | null;
  sessionCount?: number;
  clinicalDate?: string;
  clinicalDateLabel?: string;
  clinicalDateShortLabel?: string;
  date: string;
  sortAt: string;
  totalChanges: number;
  relevantChanges: number;
  skillMagnitude: number;
  behaviorMagnitude: number;
  masteryCount: number;
  maintenanceCount: number;
  regressionCount: number;
  totalRawMagnitude: number;
  totalVisualMagnitude: number;
  categoryCounts: Record<AbaClinicalChangeCategory, number>;
  topChange?: AbaAggregatedClinicalChange | null;
  topChanges: AbaAggregatedClinicalChange[];
  changes: AbaAggregatedClinicalChange[];
  hasRegressionAlert: boolean;
  hasReviewReady: boolean;
};

export type AbaBehaviorContextDistributionValue<T extends string | number = string> = {
  value: T;
  count: number;
  percent: number;
};

export type NormalizedBehaviorContext = {
  locationLabel?: string;
  severity?: number;
  collectionMethod?: string;
  durationSeconds?: number;
  quantity?: number;
  alertMode?: string;
  recordedHour?: number;
  timeOfDay?: string;
  sessionLabel?: string;
  hasAnyContext: boolean;
};

export type AbaBehaviorContextPattern = {
  behaviorKey: string;
  behaviorId?: string | null;
  behaviorName: string;
  totalRecords: number;
  contextualRecords: number;
  enoughData: boolean;
  smallSample?: boolean;
  singleContextRecord?: boolean;
  noContext?: boolean;
  dominantLocation?: AbaBehaviorContextDistributionValue | null;
  commonSeverity?: AbaBehaviorContextDistributionValue<number> | null;
  commonCollectionMethod?: AbaBehaviorContextDistributionValue | null;
  commonTimeOfDay?: AbaBehaviorContextDistributionValue | null;
  locationDistribution?: AbaBehaviorContextDistributionValue[];
  severityDistribution?: AbaBehaviorContextDistributionValue<number>[];
  collectionMethodDistribution?: AbaBehaviorContextDistributionValue[];
  timeOfDayDistribution?: AbaBehaviorContextDistributionValue[];
  highSeverity?: { count: number; percent: number } | null;
  averageDurationSeconds?: number | null;
  totalQuantity?: number | null;
  insights: string[];
};

export type AbaBehaviorCompositionSeries = {
  key: string;
  label: string;
  behaviorId?: string | null;
  total: number;
  isOther?: boolean;
};

export type AbaBehaviorCompositionSegment = {
  key: string;
  label: string;
  behaviorId?: string | null;
  value: number;
  count: number;
  contextPattern?: AbaBehaviorContextPattern | null;
};

export type AbaBehaviorCompositionRow = {
  groupKey: string;
  groupBy: 'session' | 'day';
  label: string;
  groupLabel?: string;
  sessionId?: string | null;
  sessionIds?: string[];
  sessionDisplayLabel?: string | null;
  sessionTooltipLabel?: string | null;
  sessionShortCode?: string | null;
  sessionCount?: number;
  clinicalDate?: string;
  clinicalDateLabel?: string;
  clinicalDateShortLabel?: string;
  sortAt: string;
  total: number;
  segments: AbaBehaviorCompositionSegment[];
  dominantLocation?: AbaBehaviorContextPattern['dominantLocation'] | null;
  commonSeverity?: AbaBehaviorContextPattern['commonSeverity'] | null;
  commonCollectionMethod?: AbaBehaviorContextPattern['commonCollectionMethod'] | null;
  [seriesKey: string]: any;
};

export const ABA_CLINICAL_CHART_DEFAULT_THRESHOLDS: AbaClinicalChartThresholds = {
  stablePercent: 5,
  meaningfulPercent: 10,
  targetClinicalCriterion: 80
};

export const ABA_METRIC_DIRECTION: Record<string, AbaMetricDirection> = {
  TARGET_ACCURACY: 'HIGHER_IS_BETTER',
  TARGET_INDEPENDENCE: 'HIGHER_IS_BETTER',
  FUNCTIONAL_COMMUNICATION: 'HIGHER_IS_BETTER',
  ENGAGEMENT: 'HIGHER_IS_BETTER',
  TARGET_TRIAL_COUNT: 'HIGHER_IS_BETTER',
  BEHAVIOR_FREQUENCY: 'LOWER_IS_BETTER',
  BEHAVIOR_DURATION_EPISODES: 'LOWER_IS_BETTER',
  BEHAVIOR_DURATION_TOTAL: 'LOWER_IS_BETTER',
  BEHAVIOR_DURATION_AVG: 'LOWER_IS_BETTER',
  BEHAVIOR_DURATION_MAX: 'LOWER_IS_BETTER',
  BEHAVIOR_INTERVAL_OCCURRENCE: 'LOWER_IS_BETTER',
  MASTERY_STATUS: 'STATUS_BASED',
  MAINTENANCE_STATUS: 'STATUS_BASED',
  REGRESSION_RISK: 'STATUS_BASED'
};

export const ABA_CLINICAL_LINE_METRICS: Record<AbaClinicalLineCategory, AbaClinicalLineMetricOption[]> = {
  target: [
    { id: 'TARGET_COMPARE_RESPONSES', label: 'Comparar respostas', axis: 'percent', multiLine: true },
    { id: 'TARGET_ACCURACY', label: 'Acurácia %', axis: 'percent' },
    { id: 'TARGET_INDEPENDENCE', label: 'Independência %', axis: 'percent' },
    { id: 'TARGET_PROMPTED', label: 'Com ajuda %', axis: 'percent' },
    { id: 'TARGET_ERROR', label: 'Erro %', axis: 'percent' },
    { id: 'TARGET_TRIAL_COUNT', label: 'Número de tentativas', axis: 'count' }
  ],
  behavior: [
    { id: 'BEHAVIOR_FREQUENCY', label: 'Frequência', axis: 'count' },
    { id: 'BEHAVIOR_DURATION_EPISODES', label: 'Episódios de duração', axis: 'count' },
    { id: 'BEHAVIOR_DURATION_TOTAL', label: 'Duração total', axis: 'duration' },
    { id: 'BEHAVIOR_DURATION_AVG', label: 'Duração média', axis: 'duration' },
    { id: 'BEHAVIOR_INTERVAL_OCCURRENCE', label: 'Intervalo parcial %', axis: 'percent' }
  ],
  mastery: [
    { id: 'MASTERY_STATUS', label: 'Status de maestria', axis: 'status' },
    { id: 'MASTERY_CONSECUTIVE_DAYS', label: 'Dias consecutivos', axis: 'count' },
    { id: 'MASTERY_VALID_ATTEMPTS', label: 'Tentativas válidas', axis: 'count' },
    { id: 'MASTERY_READY_FOR_REVIEW', label: 'Pronto para revisão', axis: 'status' }
  ],
  maintenance: [
    { id: 'MAINTENANCE_STATUS', label: 'Resultado da sondagem de manutenção', axis: 'status' },
    { id: 'MAINTENANCE_ACCURACY', label: 'Acurácia de manutenção', axis: 'percent' },
    { id: 'MAINTENANCE_INDEPENDENCE', label: 'Independência de manutenção', axis: 'percent' },
    { id: 'MAINTENANCE_FAILURES', label: 'Falhas consecutivas', axis: 'count' },
    { id: 'MAINTENANCE_DAYS_SINCE_PROBE', label: 'Dias desde última sondagem', axis: 'count' }
  ],
  general: [
    { id: 'TARGET_ACCURACY', label: 'Acurácia geral', axis: 'percent' },
    { id: 'TARGET_INDEPENDENCE', label: 'Independência geral', axis: 'percent' },
    { id: 'TARGET_TRIAL_COUNT', label: 'Tentativas', axis: 'count' }
  ]
};

const MASTERY_STATUS_SCORE: Record<string, number> = {
  INSUFFICIENT_DATA: 0,
  NOT_MET: 1,
  NOTMET: 1,
  MET_TODAY: 2,
  READY_FOR_REVIEW: 3,
  MASTERED_APPROVED: 4,
  MASTERED: 4,
  REGRESSION_RISK: -1
};

const MAINTENANCE_STATUS_SCORE: Record<string, number> = {
  REGRESSION_RISK: -1,
  WATCH: 1,
  PENDING: 1,
  MAINTAINED: 3,
  COMPLETED: 3
};

const normalizeStatus = (value: unknown) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

const safeNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const round2 = (value: number | null) =>
  value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;

const normalizeContextKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const firstContextValue = (source: any, ...keys: string[]) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return undefined;
};

const asObject = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

const contextSourcesForEvent = (event: any = {}) => {
  const raw = event?.raw_payload || event?.rawPayload || {};
  const metadata = event?.metadata || raw?.metadata || {};
  return [
    event?.context,
    event?.contextSnapshot,
    event?.context_snapshot,
    event?.behaviorEventContext,
    event?.eventContext,
    event?.event_context,
    metadata?.context,
    metadata?.contextSnapshot,
    metadata?.context_snapshot,
    metadata,
    raw?.context,
    raw?.contextSnapshot,
    raw?.context_snapshot,
    raw?.behaviorEventContext,
    raw?.eventContext,
    raw?.event_context,
    raw?.currentContext,
    raw?.current_context,
    raw?.sessionContext,
    raw?.session_context,
    raw?.metadata?.context,
    raw?.metadata?.contextSnapshot,
    raw?.metadata?.context_snapshot,
    raw?.metadata,
    raw,
    event
  ].map(asObject).filter(Boolean) as Record<string, any>[];
};

const firstContextValueFromSources = (sources: Record<string, any>[], ...keys: string[]) => {
  for (const source of sources) {
    const value = firstContextValue(source, ...keys);
    if (value !== undefined) return value;
  }
  return undefined;
};

const coerceContextText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const source = value as Record<string, any>;
    return String(firstContextValue(source, 'label', 'name', 'title', 'value', 'id') || '').trim();
  }
  return String(value).trim();
};

const configuredLocationLabel = (value: unknown, clinicContextConfig?: any) => {
  const rawLabel = coerceContextText(value);
  if (!rawLabel) return '';
  const locationLists = [
    clinicContextConfig?.locations,
    clinicContextConfig?.behaviorLocations,
    clinicContextConfig?.contextLocations,
    clinicContextConfig?.context?.locations
  ].filter(Array.isArray) as any[][];
  const matched = locationLists.flat().find((item) => {
    const source = asObject(item);
    if (!source) return false;
    const candidates = ['id', 'key', 'value', 'label', 'name', 'title']
      .map((key) => coerceContextText(source[key]))
      .filter(Boolean);
    return candidates.includes(rawLabel);
  });
  if (!matched) return rawLabel;
  const source = asObject(matched);
  return coerceContextText(firstContextValue(source, 'label', 'name', 'title', 'value')) || rawLabel;
};

const timeOfDayLabel = (value: unknown) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'manhã';
  if (hour >= 12 && hour < 18) return 'tarde';
  if (hour >= 18 && hour < 23) return 'noite';
  return 'madrugada';
};

const topDistributionValue = <T extends string | number>(values: T[]) => {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top) return null;
  return {
    value: top[0],
    count: top[1],
    percent: Math.round((top[1] / Math.max(values.length, 1)) * 100)
  };
};

const recordedHourValue = (value: unknown) => {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? undefined : date.getHours();
};

const distributionValues = <T extends string | number>(values: T[]): AbaBehaviorContextDistributionValue<T>[] => {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([value, count]) => ({
      value,
      count,
      percent: Math.round((count / Math.max(values.length, 1)) * 100)
    }));
};

export function normalizeBehaviorContext(event: any = {}, clinicContextConfig?: any): NormalizedBehaviorContext {
  const sources = contextSourcesForEvent(event);
  const timestamp = firstContextValueFromSources(sources, 'timestamp', 'recordedAt', 'recorded_at', 'occurredAt', 'occurred_at', 'createdAt', 'created_at');
  const severityRaw = firstContextValueFromSources(sources, 'severity', 'intensity');
  const severity = Number(severityRaw);
  const durationRaw = firstContextValueFromSources(sources, 'durationSeconds', 'duration_seconds', 'duration');
  const durationSeconds = Number(durationRaw);
  const quantityRaw = firstContextValueFromSources(sources, 'quantity', 'countDelta', 'count_delta', 'count');
  const quantity = Number(quantityRaw);
  const locationLabel = configuredLocationLabel(firstContextValueFromSources(
    sources,
    'location',
    'locationLabel',
    'location_label',
    'local',
    'environment',
    'environmentLabel',
    'environment_label',
    'place',
    'setting',
    'room',
    'roomName',
    'room_name'
  ), clinicContextConfig);
  const collectionMethod = coerceContextText(firstContextValueFromSources(sources, 'collectionMethod', 'collection_method', 'method', 'measurementType', 'measurement_type', 'collectionType', 'collection_type'));
  const alertMode = coerceContextText(firstContextValueFromSources(sources, 'alertMode', 'alert_mode', 'alertTarget', 'alert_target', 'alert'));
  const sessionLabel = coerceContextText(firstContextValueFromSources(sources, 'sessionLabel', 'session_label', 'sessionName', 'session_name', 'sessionId', 'session_id'));
  const normalized = {
    locationLabel: locationLabel || undefined,
    severity: Number.isFinite(severity) && severity >= 1 && severity <= 5 ? severity : undefined,
    collectionMethod: collectionMethod || undefined,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
    alertMode: alertMode || undefined,
    recordedHour: recordedHourValue(timestamp),
    timeOfDay: timeOfDayLabel(timestamp) || undefined,
    sessionLabel: sessionLabel || undefined
  };
  return {
    ...normalized,
    hasAnyContext: Boolean(
      normalized.locationLabel ||
      normalized.severity !== undefined ||
      normalized.collectionMethod ||
      normalized.durationSeconds !== undefined ||
      normalized.quantity !== undefined ||
      normalized.alertMode ||
      normalized.sessionLabel
    )
  };
}

const behaviorContextTrendInsight = (rows: Array<{ event: any; context: NormalizedBehaviorContext; behaviorName: string }>) => {
  const withLocation = rows
    .filter((row) => row.context.locationLabel)
    .sort((a, b) => String(firstContextValue(a.event, 'occurredAt', 'occurred_at', 'timestamp', 'createdAt', 'created_at') || '').localeCompare(
      String(firstContextValue(b.event, 'occurredAt', 'occurred_at', 'timestamp', 'createdAt', 'created_at') || '')
    ));
  if (withLocation.length < 4) return '';
  const midpoint = Math.floor(withLocation.length / 2);
  const previous = withLocation.slice(0, midpoint);
  const recent = withLocation.slice(midpoint);
  const locations = Array.from(new Set(withLocation.map((row) => row.context.locationLabel).filter(Boolean))) as string[];
  let strongest: { location: string; previous: number; recent: number; delta: number } | null = null;
  locations.forEach((location) => {
    const previousCount = previous.filter((row) => row.context.locationLabel === location).length;
    const recentCount = recent.filter((row) => row.context.locationLabel === location).length;
    const delta = recentCount - previousCount;
    if (Math.abs(delta) < 1) return;
    if (!strongest || Math.abs(delta) > Math.abs(strongest.delta)) {
      strongest = { location, previous: previousCount, recent: recentCount, delta };
    }
  });
  if (!strongest || (strongest.previous + strongest.recent) < 2) return '';
  const behaviorName = rows[0]?.behaviorName || 'Comportamento';
  const trendDirection = strongest.delta > 0 ? 'aumento' : 'reducao';
  const trendPrefix = strongest.delta > 0 ? `Em ${strongest.location}` : `Nos registros em ${strongest.location}`;
  return `${trendPrefix}, ${behaviorName} apresentou ${trendDirection} nos registros recentes do periodo.`;
};

export function analyzeBehaviorContextPatterns(events: any[] = [], clinicContextConfig?: any): AbaBehaviorContextPattern[] {
  const grouped = new Map<string, any[]>();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const sources = contextSourcesForEvent(event);
    const context = normalizeBehaviorContext(event, clinicContextConfig);
    const behaviorId = String(firstContextValueFromSources(sources, 'behaviorId', 'behavior_id') || '').trim();
    const behaviorName = String(firstContextValueFromSources(sources, 'behaviorName', 'behavior_name') || 'Comportamento').trim();
    const behaviorKey = behaviorId || normalizeContextKey(behaviorName) || 'behavior';
    if (!grouped.has(behaviorKey)) grouped.set(behaviorKey, []);
    grouped.get(behaviorKey)!.push({ event, context, behaviorId, behaviorName });
  });

  return Array.from(grouped.entries()).map(([behaviorKey, rows]) => {
    const behaviorId = rows.find((row) => row.behaviorId)?.behaviorId || null;
    const behaviorName = rows.find((row) => row.behaviorName)?.behaviorName || 'Comportamento';
    const locations = rows
      .map(({ context }) => context.locationLabel)
      .filter(Boolean);
    const severities = rows
      .map(({ context }) => context.severity)
      .filter((value) => Number.isFinite(value)) as number[];
    const collectionMethods = rows
      .map(({ context }) => context.collectionMethod)
      .filter(Boolean);
    const durations = rows
      .map(({ context }) => context.durationSeconds)
      .filter((value) => Number.isFinite(value) && Number(value) > 0) as number[];
    const quantities = rows
      .map(({ context }) => context.quantity)
      .filter((value) => Number.isFinite(value) && Number(value) > 0) as number[];
    const alertTargets = rows
      .map(({ context }) => context.alertMode)
      .filter(Boolean);
    const periods = rows
      .map(({ context }) => context.timeOfDay)
      .filter(Boolean);
    const contextualRecords = rows.filter(({ context }) => context.hasAnyContext).length;
    const dominantLocation = topDistributionValue(locations);
    const commonSeverity = topDistributionValue(severities);
    const commonCollectionMethod = topDistributionValue(collectionMethods);
    const commonTimeOfDay = topDistributionValue(periods);
    const locationDistribution = distributionValues(locations);
    const severityDistribution = distributionValues(severities);
    const collectionMethodDistribution = distributionValues(collectionMethods);
    const timeOfDayDistribution = distributionValues(periods);
    const highSeverityCount = severities.filter((value) => value >= 4).length;
    const highSeverity = severities.length > 0
      ? { count: highSeverityCount, percent: Math.round((highSeverityCount / severities.length) * 100) }
      : null;
    const averageDurationSeconds = durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null;
    const totalQuantity = quantities.length
      ? quantities.reduce((sum, value) => sum + value, 0)
      : null;
    const commonAlertTarget = topDistributionValue(alertTargets);
    const totalRecords = rows.length;
    const enoughData = contextualRecords >= 3;
    const smallSample = contextualRecords === 2;
    const singleContextRecord = contextualRecords === 1;
    const noContext = contextualRecords === 0;
    const insights: string[] = [];

    if (noContext) {
      insights.push('Os registros do periodo nao tem contexto suficiente para identificar local, severidade ou metodo predominante.');
    } else if (singleContextRecord) {
      if (dominantLocation) {
        insights.push(`Apenas 1 registro com contexto no periodo: ${behaviorName} foi registrado em ${dominantLocation.value}. Ainda nao ha padrao confiavel.`);
      } else {
        insights.push('Apenas 1 registro com contexto no periodo. Ainda nao ha padrao confiavel.');
      }
    } else if (smallSample) {
      if (dominantLocation) {
        insights.push(`Amostra pequena: ${behaviorName} apareceu mais em ${dominantLocation.value} nos registros disponiveis (${dominantLocation.count} de ${contextualRecords} com contexto).`);
      } else if (commonSeverity) {
        insights.push(`Amostra pequena: a severidade mais frequente foi ${commonSeverity.value} nos registros disponiveis.`);
      } else if (commonCollectionMethod) {
        insights.push(`Amostra pequena: ${behaviorName} apareceu mais em registros com metodo ${commonCollectionMethod.value}.`);
      } else {
        insights.push(`Amostra pequena: ha ${contextualRecords} registros com contexto, ainda sem predominancia clara.`);
      }
    } else {
      if (dominantLocation && dominantLocation.count === totalRecords) {
        insights.push(`${behaviorName} foi observado em todos os registros recentes no ambiente ${dominantLocation.value} (${dominantLocation.count} de ${totalRecords}).`);
      } else if (dominantLocation && dominantLocation.percent >= 80) {
        insights.push(`${behaviorName} ocorreu principalmente em ${dominantLocation.value} (${dominantLocation.count} de ${totalRecords} registros).`);
      } else if (dominantLocation && totalRecords >= 5) {
        insights.push(`${behaviorName} teve maior concentração em ${dominantLocation.value}: ${dominantLocation.count} de ${totalRecords} registros recentes.`);
      } else if (dominantLocation) {
        insights.push(`As ocorrências recentes apareceram com mais frequência em ${dominantLocation.value}.`);
      }
      if (commonSeverity) {
        insights.push(`A severidade mais frequente foi ${commonSeverity.value}, presente em ${commonSeverity.percent}% dos registros de ${behaviorName} com severidade informada.`);
      }
      if (highSeverity && highSeverity.count >= 2 && highSeverity.percent >= 60) {
        insights.push(`${behaviorName} apareceu com severidade 4 ou 5 em ${highSeverity.percent}% dos registros com severidade informada.`);
      }
      if (commonCollectionMethod && commonCollectionMethod.count >= 2) {
        insights.push(`${behaviorName} foi registrado com mais frequência pelo método ${commonCollectionMethod.value}.`);
      }
      const trendInsight = behaviorContextTrendInsight(rows);
      if (trendInsight) insights.push(trendInsight);
      if (averageDurationSeconds !== null && averageDurationSeconds >= 10) {
        insights.push(`Duração média registrada: ${averageDurationSeconds}s.`);
      }
      if (totalQuantity !== null && totalQuantity > totalRecords) {
        insights.push(`Quantidade total registrada no período: ${totalQuantity}.`);
      }
      if (commonAlertTarget && commonAlertTarget.count >= 2) {
        insights.push(`Alerta mais associado aos registros: ${commonAlertTarget.value}.`);
      }
      if (commonTimeOfDay && commonTimeOfDay.count >= 2) {
        insights.push(`Horário mais comum: ${commonTimeOfDay.value}.`);
      }
      if (insights.length === 0) {
        insights.push('Contextos registrados, sem predominância clara no período.');
      }
    }

    return {
      behaviorKey,
      behaviorId,
      behaviorName,
      totalRecords,
      contextualRecords,
      enoughData,
      smallSample,
      singleContextRecord,
      noContext,
      dominantLocation: dominantLocation as AbaBehaviorContextPattern['dominantLocation'],
      commonSeverity: commonSeverity as AbaBehaviorContextPattern['commonSeverity'],
      commonCollectionMethod: commonCollectionMethod as AbaBehaviorContextPattern['commonCollectionMethod'],
      commonTimeOfDay: commonTimeOfDay as AbaBehaviorContextPattern['commonTimeOfDay'],
      locationDistribution: locationDistribution as AbaBehaviorContextPattern['locationDistribution'],
      severityDistribution: severityDistribution as AbaBehaviorContextPattern['severityDistribution'],
      collectionMethodDistribution: collectionMethodDistribution as AbaBehaviorContextPattern['collectionMethodDistribution'],
      timeOfDayDistribution: timeOfDayDistribution as AbaBehaviorContextPattern['timeOfDayDistribution'],
      highSeverity,
      averageDurationSeconds,
      totalQuantity,
      insights
    };
  });
}

const behaviorCompositionDateValue = (point: any) =>
  point?.changedAt ||
  point?.changed_at ||
  point?.date ||
  point?.occurredAt ||
  point?.occurred_at ||
  point?.createdAt ||
  point?.created_at ||
  '';

const padChartDatePart = (value: number) => String(value).padStart(2, '0');

export const buildCanonicalChartDayKey = (value: unknown) => {
  const raw = String(value || '');
  if (!raw) return 'sem-data';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${padChartDatePart(date.getMonth() + 1)}-${padChartDatePart(date.getDate())}`;
  }
  return raw.slice(0, 10) || 'sem-data';
};

export const formatCanonicalChartDayLabel = (key: string, options: { full?: boolean; short?: boolean } = {}) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key === 'sem-data' ? 'Sem data' : key;
  const [year, month, day] = key.split('-');
  return options.short ? `${day}/${month}` : `${day}/${month}/${year}`;
};

export const buildAbaSessionShortCode = (sessionId: unknown) => {
  const clean = String(sessionId || '').replace(/^session[-_]?/i, '').replace(/[^a-z0-9]/gi, '');
  return clean ? clean.slice(-6).toUpperCase() : '';
};

export const buildSessionDisplayLabel = (input: {
  sessionId?: string | null;
  changedAt?: string | null;
  fallbackIndex?: number;
}) => {
  const date = new Date(input.changedAt || 0);
  const shortCode = buildAbaSessionShortCode(input.sessionId);
  if (Number.isNaN(date.getTime())) {
    const fallback = Number.isFinite(Number(input.fallbackIndex)) ? `Sessão ${Number(input.fallbackIndex) + 1}` : 'Sessão';
    return {
      label: shortCode ? `${fallback} cód. ${shortCode}` : fallback,
      tooltipLabel: shortCode ? `${fallback} cód. ${shortCode}` : fallback,
      shortCode
    };
  }
  const day = formatDisplayDate(date);
  const fullDay = day;
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return {
    label: `${day} · ${time}`,
    tooltipLabel: `${fullDay} às ${time}`,
    shortCode
  };
};

const withHumanSessionLabelCollisions = <
  T extends {
    groupBy: 'session' | 'day';
    label: string;
    sessionDisplayLabel?: string | null;
    sessionTooltipLabel?: string | null;
    sessionShortCode?: string | null;
  }
>(rows: T[]) => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    if (row.groupBy !== 'session') return;
    const label = row.sessionDisplayLabel || row.label || 'Sessão';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const seen = new Map<string, number>();
  return rows.map((row) => {
    if (row.groupBy !== 'session') return row;
    const baseLabel = row.sessionDisplayLabel || row.label || 'Sessão';
    if ((counts.get(baseLabel) || 0) <= 1) return { ...row, label: baseLabel, groupLabel: baseLabel };
    const next = (seen.get(baseLabel) || 0) + 1;
    seen.set(baseLabel, next);
    const label = `${baseLabel} · #${next}`;
    return {
      ...row,
      label,
      groupLabel: label,
      sessionDisplayLabel: label,
      sessionTooltipLabel: row.sessionTooltipLabel ? `${row.sessionTooltipLabel} · #${next}` : label
    };
  });
};

const behaviorCompositionBehaviorId = (point: any) =>
  String(point?.behaviorId || point?.behavior_id || point?.itemId || point?.item_id || '').trim() || null;

const behaviorCompositionBehaviorLabel = (point: any) =>
  String(
    point?.behaviorName ||
    point?.behavior_name ||
    point?.itemLabel ||
    point?.item_label ||
    point?.metricLabel ||
    point?.metric_label ||
    point?.label ||
    point?.name ||
    'Comportamento'
  ).trim() || 'Comportamento';

const behaviorCompositionValue = (point: any) =>
  safeNumber(point?.value ?? point?.metricValue ?? point?.metric_value ?? point?.chartValue ?? point?.chart_value, 0);

const behaviorCompositionPatternFor = (
  point: any,
  patternById: Map<string, AbaBehaviorContextPattern>,
  patternByName: Map<string, AbaBehaviorContextPattern>
) => {
  const behaviorId = behaviorCompositionBehaviorId(point);
  if (behaviorId && patternById.has(behaviorId)) return patternById.get(behaviorId) || null;
  const labelKey = behaviorCompositionBehaviorLabel(point).toLowerCase();
  return patternByName.get(labelKey) || null;
};

export function buildBehaviorCompositionStack(
  points: any[] = [],
  options: {
    metricType?: string;
    groupBy?: 'session' | 'day';
    contextPatterns?: AbaBehaviorContextPattern[];
    maxSeries?: number;
  } = {}
): { rows: AbaBehaviorCompositionRow[]; series: AbaBehaviorCompositionSeries[] } {
  const metricType = String(options.metricType || 'BEHAVIOR_FREQUENCY');
  const groupBy = options.groupBy || 'session';
  const maxSeries = Math.max(1, options.maxSeries || 8);
  const metricUsesAverage = ['BEHAVIOR_DURATION_AVG', 'BEHAVIOR_INTERVAL_OCCURRENCE'].includes(normalizeStatus(metricType));
  const filtered = (Array.isArray(points) ? points : [])
    .filter((point) => String(point?.metricType || point?.metric_type || '') === metricType)
    .filter((point) => behaviorCompositionValue(point) > 0);

  const patternById = new Map<string, AbaBehaviorContextPattern>();
  const patternByName = new Map<string, AbaBehaviorContextPattern>();
  (options.contextPatterns || []).forEach((pattern) => {
    const id = String(pattern.behaviorId || '').trim();
    if (id) patternById.set(id, pattern);
    const name = String(pattern.behaviorName || '').trim().toLowerCase();
    if (name) patternByName.set(name, pattern);
  });

  const totalsByBehavior = new Map<string, { label: string; behaviorId?: string | null; total: number }>();
  filtered.forEach((point) => {
    const behaviorId = behaviorCompositionBehaviorId(point);
    const label = behaviorCompositionBehaviorLabel(point);
    const key = behaviorId || normalizeContextKey(label) || label;
    const value = behaviorCompositionValue(point);
    const current = totalsByBehavior.get(key) || { label, behaviorId, total: 0 };
    current.total += value;
    totalsByBehavior.set(key, current);
  });

  const ranked = Array.from(totalsByBehavior.entries())
    .sort((a, b) => b[1].total - a[1].total || a[1].label.localeCompare(b[1].label));
  const selectedKeys = new Set(ranked.slice(0, maxSeries).map(([key]) => key));
  const series = ranked.slice(0, maxSeries).map(([key, value], index) => ({
    key: `behavior_${index}`,
    label: value.label,
    behaviorId: value.behaviorId || null,
    total: round2(value.total) || 0,
    sourceKey: key
  } as AbaBehaviorCompositionSeries & { sourceKey: string }));
  const hasOther = ranked.length > maxSeries;
  if (hasOther) {
    series.push({
      key: 'behavior_other',
      label: 'Outros comportamentos',
      behaviorId: null,
      total: round2(ranked.slice(maxSeries).reduce((sum, [, value]) => sum + value.total, 0)) || 0,
      isOther: true,
      sourceKey: '__other__'
    } as AbaBehaviorCompositionSeries & { sourceKey: string });
  }
  const seriesKeyBySource = new Map<string, string>();
  series.forEach((item: any) => {
    if (item.sourceKey && item.sourceKey !== '__other__') seriesKeyBySource.set(item.sourceKey, item.key);
  });

  const grouped = new Map<string, {
    label: string;
    groupLabel: string;
    sortAt: string;
    sessionId?: string | null;
    sessionIds: Set<string>;
    sessionDisplayLabel?: string | null;
    sessionTooltipLabel?: string | null;
    sessionShortCode?: string | null;
    clinicalDate: string;
    clinicalDateLabel: string;
    clinicalDateShortLabel: string;
    segments: Map<string, {
      key: string;
      label: string;
      behaviorId?: string | null;
      values: number[];
      contextPattern?: AbaBehaviorContextPattern | null;
    }>;
  }>();

  filtered.forEach((point, index) => {
    const dateValue = behaviorCompositionDateValue(point);
    const dayKey = buildCanonicalChartDayKey(dateValue);
    const sessionId = String(point?.sessionId || point?.session_id || '').trim() || null;
    const sessionLabel = buildSessionDisplayLabel({ sessionId, changedAt: String(dateValue || ''), fallbackIndex: index });
    const groupKey = groupBy === 'day'
      ? `day:${dayKey}`
      : `session:${sessionId || String(dateValue || dayKey || index).trim() || index}`;
    const groupLabel = groupBy === 'day'
      ? formatCanonicalChartDayLabel(dayKey)
      : sessionLabel.label;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        label: groupLabel || 'Sessão',
        groupLabel: groupLabel || 'Sessão',
        sortAt: String(dateValue || dayKey || index),
        sessionId,
        sessionIds: new Set(),
        sessionDisplayLabel: groupBy === 'session' ? sessionLabel.label : null,
        sessionTooltipLabel: groupBy === 'session' ? sessionLabel.tooltipLabel : null,
        sessionShortCode: groupBy === 'session' ? sessionLabel.shortCode : null,
        clinicalDate: dayKey,
        clinicalDateLabel: formatCanonicalChartDayLabel(dayKey, { full: true }),
        clinicalDateShortLabel: formatCanonicalChartDayLabel(dayKey),
        segments: new Map()
      });
    }
    const group = grouped.get(groupKey)!;
    if (sessionId) group.sessionIds.add(sessionId);
    else if (dateValue) group.sessionIds.add(String(dateValue));
    const currentSort = new Date(group.sortAt || 0).getTime();
    const nextSort = new Date(String(dateValue || 0)).getTime();
    if (!Number.isNaN(nextSort) && (Number.isNaN(currentSort) || nextSort < currentSort)) {
      group.sortAt = String(dateValue || group.sortAt);
      if (groupBy === 'session') {
        group.label = groupLabel || group.label;
        group.groupLabel = group.label;
        group.sessionDisplayLabel = sessionLabel.label;
        group.sessionTooltipLabel = sessionLabel.tooltipLabel;
      }
    }
    const behaviorId = behaviorCompositionBehaviorId(point);
    const label = behaviorCompositionBehaviorLabel(point);
    const sourceKey = behaviorId || normalizeContextKey(label) || label;
    const seriesKey = selectedKeys.has(sourceKey) ? seriesKeyBySource.get(sourceKey) || sourceKey : 'behavior_other';
    const segment = group.segments.get(seriesKey) || {
      key: seriesKey,
      label: selectedKeys.has(sourceKey) ? label : 'Outros comportamentos',
      behaviorId: selectedKeys.has(sourceKey) ? behaviorId : null,
      values: [],
      contextPattern: selectedKeys.has(sourceKey) ? behaviorCompositionPatternFor(point, patternById, patternByName) : null
    };
    segment.values.push(behaviorCompositionValue(point));
    if (!segment.contextPattern && selectedKeys.has(sourceKey)) {
      segment.contextPattern = behaviorCompositionPatternFor(point, patternById, patternByName);
    }
    group.segments.set(seriesKey, segment);
  });

  const rows = Array.from(grouped.entries())
    .map(([groupKey, group]) => {
      const segments = Array.from(group.segments.values())
        .map((segment) => {
          const value = metricUsesAverage
            ? segment.values.reduce((sum, item) => sum + item, 0) / Math.max(segment.values.length, 1)
            : segment.values.reduce((sum, item) => sum + item, 0);
          return {
            key: segment.key,
            label: segment.label,
            behaviorId: segment.behaviorId || null,
            value: round2(value) || 0,
            count: segment.values.length,
            contextPattern: segment.contextPattern || null
          };
        })
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      const row: AbaBehaviorCompositionRow = {
        groupKey,
        groupBy,
        label: group.label,
        groupLabel: group.groupLabel,
        sessionId: group.sessionId || null,
        sessionIds: Array.from(group.sessionIds),
        sessionDisplayLabel: group.sessionDisplayLabel || null,
        sessionTooltipLabel: group.sessionTooltipLabel || null,
        sessionShortCode: group.sessionShortCode || null,
        sessionCount: group.sessionIds.size || undefined,
        clinicalDate: group.clinicalDate,
        clinicalDateLabel: group.clinicalDateLabel,
        clinicalDateShortLabel: group.clinicalDateShortLabel,
        sortAt: group.sortAt,
        total: round2(segments.reduce((sum, segment) => sum + segment.value, 0)) || 0,
        segments,
        dominantLocation: segments.find((segment) => segment.contextPattern?.dominantLocation)?.contextPattern?.dominantLocation || null,
        commonSeverity: segments.find((segment) => segment.contextPattern?.commonSeverity)?.contextPattern?.commonSeverity || null,
        commonCollectionMethod: segments.find((segment) => segment.contextPattern?.commonCollectionMethod)?.contextPattern?.commonCollectionMethod || null
      };
      segments.forEach((segment) => {
        row[segment.key] = segment.value;
      });
      return row;
    })
    .sort((a, b) => new Date(a.sortAt || 0).getTime() - new Date(b.sortAt || 0).getTime());

  return {
    rows: withHumanSessionLabelCollisions(rows),
    series: series.map(({ sourceKey, ...item }: any) => item)
  };
}

const metricStatusScore = (metricType: string, status: unknown, fallbackValue: number) => {
  const normalized = normalizeStatus(status);
  if (metricType === 'MAINTENANCE_STATUS' || metricType === 'REGRESSION_RISK') {
    return MAINTENANCE_STATUS_SCORE[normalized] ?? fallbackValue;
  }
  if (metricType === 'MASTERY_STATUS') {
    return MASTERY_STATUS_SCORE[normalized] ?? fallbackValue;
  }
  return fallbackValue;
};

export const isAbaPercentMetric = (metricType: string) => {
  const normalized = normalizeStatus(metricType);
  return normalized === 'TARGET_ACCURACY' ||
    normalized === 'TARGET_INDEPENDENCE' ||
    normalized === 'FUNCTIONAL_COMMUNICATION' ||
    normalized === 'ENGAGEMENT' ||
    normalized === 'BEHAVIOR_INTERVAL_OCCURRENCE';
};

export const isAbaRelativeChangeMetric = (metricType: string) => {
  const normalized = normalizeStatus(metricType);
  return normalized === 'TARGET_TRIAL_COUNT' ||
    normalized === 'BEHAVIOR_FREQUENCY' ||
    normalized === 'BEHAVIOR_DURATION_TOTAL' ||
    normalized === 'BEHAVIOR_DURATION_AVG' ||
    normalized === 'BEHAVIOR_DURATION_MAX';
};

const statusLabelFor = (changeStatus: AbaChangeStatus, trendDirection: AbaTrendDirection, currentStatus?: string | null) => {
  const normalizedStatus = normalizeStatus(currentStatus);
  if (changeStatus === 'FIRST_MEASUREMENT') return 'Primeira medição';
  if (changeStatus === 'REGRESSION_SIGNAL') return 'Sinal de regressão';
  if (normalizedStatus === 'READY_FOR_REVIEW') return 'Pronto para revisão';
  if (changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' && trendDirection === 'IMPROVED') return 'Melhora relevante';
  if (changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' && trendDirection === 'WORSENED') return 'Piora relevante';
  if (changeStatus === 'NO_CHANGE' || trendDirection === 'STABLE') return 'Estável';
  if (trendDirection === 'IMPROVED') return 'Melhorou nesta sessão';
  if (trendDirection === 'WORSENED') return 'Piorou nesta sessão';
  return 'Estável';
};

export const getAbaMetricDirection = (metricType: string): AbaMetricDirection =>
  ABA_METRIC_DIRECTION[normalizeStatus(metricType)] || 'HIGHER_IS_BETTER';

export const isAbaSignificantChange = (changeStatus: string, trendDirection?: string) => {
  const normalized = normalizeStatus(changeStatus);
  return normalized === 'CLINICALLY_SIGNIFICANT_CHANGE' ||
    normalized === 'REGRESSION_SIGNAL';
};

const clinicalChangeCategoryFor = (point: any): AbaClinicalChangeCategory => {
  const metricType = normalizeStatus(point?.metricType);
  const changeStatus = normalizeStatus(point?.changeStatus);
  const currentStatus = normalizeStatus(point?.currentStatus || point?.masteryStatus || point?.statusLabel);
  if (
    changeStatus === 'REGRESSION_SIGNAL' ||
    metricType === 'REGRESSION_RISK' ||
    currentStatus === 'REGRESSION_RISK'
  ) {
    return 'regression';
  }
  if (metricType === 'MASTERY_STATUS') return 'mastery';
  if (metricType === 'MAINTENANCE_STATUS') return 'maintenance';
  if (metricType.startsWith('BEHAVIOR_')) return 'behavior';
  return 'skill';
};

const rawClinicalMagnitudeFor = (point: any) => {
  const metricType = normalizeStatus(point?.metricType);
  const changeStatus = normalizeStatus(point?.changeStatus);
  const statusMetric = metricType === 'MASTERY_STATUS' || metricType === 'MAINTENANCE_STATUS' || metricType === 'REGRESSION_RISK';
  if (statusMetric) return 1;
  const deltaPercent = Number(point?.deltaPercent);
  if (Number.isFinite(deltaPercent) && Math.abs(deltaPercent) > 0) return Math.abs(deltaPercent);
  const deltaValue = Number(point?.deltaValue);
  if (Number.isFinite(deltaValue) && Math.abs(deltaValue) > 0) return Math.abs(deltaValue);
  const currentMagnitude = Math.abs(safeNumber(point?.value ?? point?.metricValue, 0));
  if (currentMagnitude > 0) return currentMagnitude;
  if (
    changeStatus === 'FIRST_MEASUREMENT' ||
    changeStatus === 'CHANGED' ||
    changeStatus === 'CLINICALLY_SIGNIFICANT_CHANGE' ||
    changeStatus === 'REGRESSION_SIGNAL'
  ) {
    return 1;
  }
  return 0;
};

const aggregateDateKey = (value: any) => {
  return buildCanonicalChartDayKey(value);
};

const aggregateDateLabel = (value: any) => {
  return formatCanonicalChartDayLabel(aggregateDateKey(value));
};

export function aggregateClinicalChangesBySession(
  points: Array<Partial<AbaSessionMetricSnapshot> & Record<string, any>>,
  options: { groupBy?: 'session' | 'day'; visualMagnitudeCap?: number } = {}
): AbaAggregatedClinicalChangeGroup[] {
  const groupBy = options.groupBy || 'session';
  const visualMagnitudeCap = Math.max(1, Number(options.visualMagnitudeCap || 120));
  const groups = new Map<string, AbaAggregatedClinicalChangeGroup>();
  const sessionIdsByGroup = new Map<string, Set<string>>();

  for (const [index, point] of (Array.isArray(points) ? points : []).entries()) {
    const changedAt = String(point?.changedAt || point?.changed_at || '');
    const sessionId = String(point?.sessionId || point?.session_id || '').trim() || null;
    const date = aggregateDateKey(changedAt);
    const sessionLabel = buildSessionDisplayLabel({ sessionId, changedAt, fallbackIndex: index });
    const groupKey = groupBy === 'day'
      ? `day:${date}`
      : `session:${sessionId || changedAt || date || index}`;
    const category = clinicalChangeCategoryFor(point);
    const rawMagnitude = rawClinicalMagnitudeFor(point);
    const visualMagnitude = Math.min(rawMagnitude, visualMagnitudeCap);
    const change = {
      ...(point as AbaSessionMetricSnapshot),
      changeCategory: category,
      rawMagnitude,
      realMagnitude: rawMagnitude,
      visualMagnitude
    };

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        groupBy,
        label: groupBy === 'day'
          ? aggregateDateLabel(changedAt)
          : sessionLabel.label,
        groupLabel: groupBy === 'day' ? aggregateDateLabel(changedAt) : sessionLabel.label,
        sessionId,
        sessionDisplayLabel: groupBy === 'session' ? sessionLabel.label : null,
        sessionTooltipLabel: groupBy === 'session' ? sessionLabel.tooltipLabel : null,
        sessionShortCode: groupBy === 'session' ? sessionLabel.shortCode : null,
        sessionCount: undefined,
        clinicalDate: date,
        clinicalDateLabel: formatCanonicalChartDayLabel(date, { full: true }),
        clinicalDateShortLabel: formatCanonicalChartDayLabel(date),
        date,
        sortAt: changedAt || date,
        totalChanges: 0,
        relevantChanges: 0,
        skillMagnitude: 0,
        behaviorMagnitude: 0,
        masteryCount: 0,
        maintenanceCount: 0,
        regressionCount: 0,
        totalRawMagnitude: 0,
        totalVisualMagnitude: 0,
        categoryCounts: {
          skill: 0,
          behavior: 0,
          mastery: 0,
          maintenance: 0,
          regression: 0
        },
        topChange: null,
        topChanges: [],
        changes: [],
        hasRegressionAlert: false,
        hasReviewReady: false
      });
      sessionIdsByGroup.set(groupKey, new Set());
    }

    const group = groups.get(groupKey)!;
    const sessionSet = sessionIdsByGroup.get(groupKey)!;
    if (sessionId) sessionSet.add(sessionId);
    else if (changedAt) sessionSet.add(changedAt);
    if (new Date(changedAt || 0).getTime() < new Date(group.sortAt || 0).getTime()) {
      group.sortAt = changedAt || group.sortAt;
      group.date = date;
      group.clinicalDate = date;
      group.clinicalDateLabel = formatCanonicalChartDayLabel(date, { full: true });
      group.clinicalDateShortLabel = formatCanonicalChartDayLabel(date);
      if (groupBy === 'session') {
        group.label = sessionLabel.label;
        group.groupLabel = sessionLabel.label;
        group.sessionDisplayLabel = sessionLabel.label;
        group.sessionTooltipLabel = sessionLabel.tooltipLabel;
        group.sessionShortCode = sessionLabel.shortCode;
      }
    }
    group.totalChanges += 1;
    if (
      isAbaSignificantChange(String(point?.changeStatus || ''), String(point?.trendDirection || '')) ||
      normalizeStatus(point?.changeStatus) === 'CHANGED' ||
      normalizeStatus(point?.changeStatus) === 'FIRST_MEASUREMENT'
    ) {
      group.relevantChanges += 1;
    }
    group.categoryCounts[category] += 1;
    group.totalRawMagnitude += rawMagnitude;
    group.totalVisualMagnitude += visualMagnitude;
    if (category === 'skill') group.skillMagnitude += visualMagnitude;
    if (category === 'behavior') group.behaviorMagnitude += visualMagnitude;
    if (category === 'mastery') group.masteryCount += 1;
    if (category === 'maintenance') group.maintenanceCount += 1;
    if (category === 'regression') group.regressionCount += 1;
    group.hasRegressionAlert = group.hasRegressionAlert || category === 'regression';
    group.hasReviewReady = group.hasReviewReady || normalizeStatus(point?.currentStatus || point?.statusLabel) === 'READY_FOR_REVIEW' || String(point?.statusLabel || '').toLowerCase().includes('revis');
    group.changes.push(change);
  }

  const rows = Array.from(groups.values())
    .map((group) => {
      const sortedChanges = group.changes
        .slice()
        .sort((a, b) => b.rawMagnitude - a.rawMagnitude || new Date(b.changedAt || 0).getTime() - new Date(a.changedAt || 0).getTime());
      return {
        ...group,
        skillMagnitude: round2(group.skillMagnitude) || 0,
        behaviorMagnitude: round2(group.behaviorMagnitude) || 0,
        totalRawMagnitude: round2(group.totalRawMagnitude) || 0,
        totalVisualMagnitude: round2(group.totalVisualMagnitude) || 0,
        sessionCount: sessionIdsByGroup.get(group.groupKey)?.size || undefined,
        topChange: sortedChanges[0] || null,
        topChanges: sortedChanges.slice(0, 8),
        changes: group.changes.slice().sort((a, b) => {
          const categoryOrder: Record<AbaClinicalChangeCategory, number> = { regression: 0, skill: 1, behavior: 2, mastery: 3, maintenance: 4 };
          return categoryOrder[a.changeCategory] - categoryOrder[b.changeCategory] || b.rawMagnitude - a.rawMagnitude;
        })
      };
    })
    .sort((a, b) => new Date(a.sortAt || 0).getTime() - new Date(b.sortAt || 0).getTime());
  return withHumanSessionLabelCollisions(rows);
}

export function getClinicalChangeDrilldown(groups: AbaAggregatedClinicalChangeGroup[], groupKey: string) {
  return (Array.isArray(groups) ? groups : []).find((group) => group.groupKey === groupKey) || null;
}

export function compareAbaMetric(input: AbaMetricComparisonInput): AbaMetricComparison {
  const metricType = normalizeStatus(input.metricType);
  const thresholds = {
    ...ABA_CLINICAL_CHART_DEFAULT_THRESHOLDS,
    ...(input.thresholds || {})
  };
  const direction = getAbaMetricDirection(metricType);
  const currentRaw = safeNumber(input.metricValue, 0);
  const current = direction === 'STATUS_BASED'
    ? metricStatusScore(metricType, input.currentStatus, currentRaw)
    : currentRaw;
  const hasPrevious = input.previousValue !== null && input.previousValue !== undefined && input.previousValue !== '';
  const previousRaw = hasPrevious ? safeNumber(input.previousValue, 0) : null;
  const previous = previousRaw === null
    ? null
    : direction === 'STATUS_BASED'
      ? metricStatusScore(metricType, input.previousStatus, previousRaw)
      : previousRaw;

  if (previous === null) {
    return {
      metricValue: round2(current) ?? 0,
      previousValue: null,
      deltaValue: null,
      deltaPercent: null,
      trendDirection: 'INSUFFICIENT_DATA',
      changeStatus: 'FIRST_MEASUREMENT',
      statusLabel: statusLabelFor('FIRST_MEASUREMENT', 'INSUFFICIENT_DATA', input.currentStatus),
      metricDirection: direction
    };
  }

  const deltaValue = round2(current - previous);

  if (direction === 'STATUS_BASED') {
    const deltaPercent = null;
    const currentStatus = normalizeStatus(input.currentStatus);
    let trendDirection: AbaTrendDirection = 'STABLE';
    if ((deltaValue || 0) > 0) trendDirection = 'IMPROVED';
    if ((deltaValue || 0) < 0) trendDirection = 'WORSENED';

    let changeStatus: AbaChangeStatus = trendDirection === 'STABLE' ? 'NO_CHANGE' : 'CHANGED';
    if (currentStatus === 'READY_FOR_REVIEW' || currentStatus === 'MASTERED_APPROVED') {
      changeStatus = 'CLINICALLY_SIGNIFICANT_CHANGE';
      trendDirection = 'IMPROVED';
    }
    if (currentStatus === 'REGRESSION_RISK') {
      changeStatus = 'REGRESSION_SIGNAL';
      trendDirection = 'WORSENED';
    }

    return {
      metricValue: round2(current) ?? 0,
      previousValue: round2(previous),
      deltaValue,
      deltaPercent,
      trendDirection,
      changeStatus,
      statusLabel: statusLabelFor(changeStatus, trendDirection, input.currentStatus),
      metricDirection: direction
    };
  }

  const clinicalCriterion = Number.isFinite(Number(input.clinicalCriterion))
    ? Number(input.clinicalCriterion)
    : thresholds.targetClinicalCriterion;
  const percentMetric = isAbaPercentMetric(metricType);
  const relativeMetric = isAbaRelativeChangeMetric(metricType);
  const deltaPercent = percentMetric
    ? deltaValue
    : relativeMetric && Math.abs(previous) > 0
      ? round2(((current - previous) / Math.abs(previous)) * 100)
      : null;
  const effectiveDeltaValue = direction === 'LOWER_IS_BETTER' ? -(deltaValue || 0) : (deltaValue || 0);
  const absoluteClinicalDelta = percentMetric
    ? Math.abs(deltaValue || 0)
    : Math.abs(deltaPercent ?? deltaValue ?? 0);

  let trendDirection: AbaTrendDirection = 'STABLE';
  let changeStatus: AbaChangeStatus = 'NO_CHANGE';

  if (percentMetric) {
    if (absoluteClinicalDelta >= thresholds.stablePercent) {
      if (effectiveDeltaValue > 0) trendDirection = 'IMPROVED';
      if (effectiveDeltaValue < 0) trendDirection = 'WORSENED';
      changeStatus = absoluteClinicalDelta >= thresholds.meaningfulPercent
        ? 'CLINICALLY_SIGNIFICANT_CHANGE'
        : 'CHANGED';
    }
  } else if (Math.abs(deltaValue || 0) > 0) {
    if (effectiveDeltaValue > 0) trendDirection = 'IMPROVED';
    if (effectiveDeltaValue < 0) trendDirection = 'WORSENED';
    changeStatus = trendDirection === 'STABLE' ? 'NO_CHANGE' : 'CHANGED';
  }

  const isTargetMetric = metricType === 'TARGET_ACCURACY' || metricType === 'TARGET_INDEPENDENCE';
  if (isTargetMetric && previous >= clinicalCriterion && current < clinicalCriterion && effectiveDeltaValue <= -thresholds.meaningfulPercent) {
    changeStatus = 'REGRESSION_SIGNAL';
    trendDirection = 'WORSENED';
  }

  return {
    metricValue: round2(current) ?? 0,
    previousValue: round2(previous),
    deltaValue,
    deltaPercent,
    trendDirection,
    changeStatus,
    statusLabel: statusLabelFor(changeStatus, trendDirection, input.currentStatus),
    metricDirection: direction
  };
}

const firstValue = (row: any, keys: string[]) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return undefined;
};

const labelKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const arrayOf = (value: unknown): any[] => Array.isArray(value) ? value : [];

const findMatching = (rows: any[], current: any, idKeys: string[], labelKeys: string[]) => {
  const id = String(firstValue(current, idKeys) || '').trim();
  const label = labelKey(firstValue(current, labelKeys));
  return rows.find((row) => {
    const rowId = String(firstValue(row, idKeys) || '').trim();
    const rowLabel = labelKey(firstValue(row, labelKeys));
    return Boolean((id && rowId === id) || (label && rowLabel === label));
  }) || null;
};

const percentOf = (part: unknown, total: unknown) => {
  const denominator = safeNumber(total, 0);
  if (denominator <= 0) return null;
  return round2((safeNumber(part, 0) / denominator) * 100);
};

const linePointDate = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
};

const lineWeekKey = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return 'semana-sem-data';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
};

const statusValueFrom = (status: unknown, metric: string) => {
  const normalized = normalizeStatus(status);
  if (metric.startsWith('MAINTENANCE')) return metricStatusScore('MAINTENANCE_STATUS', normalized, normalized === 'WATCH' ? 1 : 0);
  return metricStatusScore('MASTERY_STATUS', normalized, normalized === 'READY_FOR_REVIEW' ? 3 : 0);
};

const targetLineValue = (secondaryValues: Record<string, number | null>, attempts: number, metric: string) => {
  if (metric === 'TARGET_ACCURACY') return secondaryValues.accuracyPct;
  if (metric === 'TARGET_INDEPENDENCE') return secondaryValues.independencePct;
  if (metric === 'TARGET_PROMPTED') return secondaryValues.promptedPct;
  if (metric === 'TARGET_ERROR') return secondaryValues.errorPct;
  if (metric === 'TARGET_TRIAL_COUNT') return attempts;
  return secondaryValues.independencePct ?? secondaryValues.accuracyPct;
};

export const normalizeAbaClinicalLineCategory = (value: unknown): AbaClinicalLineCategory => {
  const normalized = normalizeStatus(value);
  if (['TARGET', 'TARGETS', 'SKILL', 'SKILLS', 'HABILIDADE', 'HABILIDADES'].includes(normalized)) return 'target';
  if (['BEHAVIOR', 'BEHAVIORS', 'COMPORTAMENTO', 'COMPORTAMENTOS'].includes(normalized)) return 'behavior';
  if (['MASTERY', 'MAESTRIA'].includes(normalized)) return 'mastery';
  if (['MAINTENANCE', 'MANUTENCAO', 'MANUTENÇÃO'].includes(normalized)) return 'maintenance';
  return 'general';
};

export const getAbaClinicalLineMetricOptions = (category: AbaClinicalLineCategory | string) =>
  ABA_CLINICAL_LINE_METRICS[normalizeAbaClinicalLineCategory(category)] || ABA_CLINICAL_LINE_METRICS.general;

export const resolveAbaClinicalLineMetric = (category: AbaClinicalLineCategory | string, metric?: string | null) => {
  const options = getAbaClinicalLineMetricOptions(category);
  const normalizedMetric = normalizeStatus(metric);
  return options.find((option) => option.id === normalizedMetric)?.id || options[0]?.id || 'TARGET_ACCURACY';
};

export function buildAbaClinicalLinePointsFromTargetSummaries(
  rows: any[],
  options: { metric?: string; groupBy?: 'session' | 'day' | 'week' } = {}
): AbaClinicalLinePoint[] {
  const metric = resolveAbaClinicalLineMetric('target', options.metric);
  const points = arrayOf(rows)
    .map((row, index) => {
      const attempts = safeNumber(firstValue(row, ['attempts_today', 'attemptsToday', 'total_trials', 'totalTrials']), 0);
      const secondaryValues = {
        independencePct: round2(safeNumber(firstValue(row, ['independence_percent', 'independencePercent']), percentOf(firstValue(row, ['independent_today', 'independentToday']), attempts) || 0)),
        promptedPct: percentOf(firstValue(row, ['prompted_today', 'promptedToday']), attempts),
        errorPct: percentOf(firstValue(row, ['errors_today', 'errorsToday']), attempts),
        accuracyPct: round2(safeNumber(firstValue(row, ['accuracy_percent', 'accuracyPercent']), percentOf(firstValue(row, ['correct_today', 'correctToday']), attempts) || 0))
      };
      const targetId = String(firstValue(row, ['target_id', 'targetId', 'target_key', 'targetKey']) || '').trim() || null;
      const targetLabel = String(firstValue(row, ['target_name', 'targetName', 'name', 'target_key', 'targetKey']) || targetId || 'Habilidade').trim();
      const changedAt = linePointDate(firstValue(row, ['ended_at', 'endedAt', 'updated_at', 'updatedAt', 'created_at', 'createdAt']));
      return {
        id: String(firstValue(row, ['id']) || `${targetId || 'target'}-${index}`),
        sessionId: String(firstValue(row, ['session_id', 'sessionId']) || '').trim() || null,
        sessionLabel: String(firstValue(row, ['session_label', 'sessionLabel']) || `Sessão ${index + 1}`),
        itemId: targetId,
        itemLabel: targetLabel,
        metric,
        metricLabel: targetLabel,
        date: changedAt,
        value: targetLineValue(secondaryValues, attempts, metric),
        secondaryValues,
        attemptsCount: attempts,
        trialType: String(firstValue(row, ['trial_type', 'trialType', 'most_used_trial_type', 'mostUsedTrialType']) || '').trim() || null,
        prompt: String(firstValue(row, ['most_used_prompt', 'mostUsedPrompt', 'prompt']) || '').trim() || null,
        metadata: {
          source: 'aba_target_live_summaries',
          accuracyPct: secondaryValues.accuracyPct,
          independencePct: secondaryValues.independencePct,
          promptedPct: secondaryValues.promptedPct,
          errorPct: secondaryValues.errorPct
        }
      } as AbaClinicalLinePoint;
    })
    .filter((point) => point.value !== null || metric === 'TARGET_COMPARE_RESPONSES');
  return aggregateAbaClinicalLinePoints(points, options.groupBy || 'session', metric);
}

export function buildAbaClinicalLinePointsFromSnapshots(
  rows: any[],
  options: { category?: AbaClinicalLineCategory | string; metric?: string; groupBy?: 'session' | 'day' | 'week' } = {}
): AbaClinicalLinePoint[] {
  const category = normalizeAbaClinicalLineCategory(options.category || 'general');
  const metric = resolveAbaClinicalLineMetric(category, options.metric);
  const mapped = arrayOf(rows)
    .filter((row) => metric === 'TARGET_COMPARE_RESPONSES' || !metric || normalizeStatus(firstValue(row, ['metric_type', 'metricType'])) === metric)
    .map((row, index) => {
      const metricType = normalizeStatus(firstValue(row, ['metric_type', 'metricType'])) || metric;
      const value = firstValue(row, ['metric_value', 'metricValue', 'value']);
      const itemId = category === 'behavior'
        ? String(firstValue(row, ['behavior_id', 'behaviorId']) || '').trim()
        : String(firstValue(row, ['target_id', 'targetId']) || '').trim();
      const metricLabel = String(firstValue(row, ['metric_label', 'metricLabel']) || itemId || 'Métrica clínica').trim();
      const changedAt = linePointDate(firstValue(row, ['changed_at', 'changedAt', 'date']));
      return {
        id: String(firstValue(row, ['id']) || `${metricType}-${index}`),
        sessionId: String(firstValue(row, ['session_id', 'sessionId']) || '').trim() || null,
        sessionLabel: String(firstValue(row, ['session_label', 'sessionLabel']) || `Sessão ${index + 1}`),
        itemId: itemId || null,
        itemLabel: metricLabel,
        metric: metric === 'TARGET_COMPARE_RESPONSES' ? metric : metricType,
        metricLabel,
        date: changedAt,
        value: round2(safeNumber(value, 0)),
        secondaryValues: metric === 'TARGET_COMPARE_RESPONSES'
          ? {
              accuracyPct: metricType === 'TARGET_ACCURACY' ? round2(safeNumber(value, 0)) : null,
              independencePct: metricType === 'TARGET_INDEPENDENCE' ? round2(safeNumber(value, 0)) : null,
              promptedPct: null,
              errorPct: null
            }
          : undefined,
        attemptsCount: metricType === 'TARGET_TRIAL_COUNT' ? safeNumber(value, 0) : null,
        status: String(firstValue(row, ['current_status', 'currentStatus', 'status_label', 'statusLabel']) || '').trim() || null,
        metadata: {
          source: 'aba_session_metric_snapshots',
          trendDirection: firstValue(row, ['trend_direction', 'trendDirection']),
          changeStatus: firstValue(row, ['change_status', 'changeStatus']),
          previousValue: firstValue(row, ['previous_value', 'previousValue']),
          deltaValue: firstValue(row, ['delta_value', 'deltaValue']),
          deltaPercent: firstValue(row, ['delta_percent', 'deltaPercent'])
        }
      } as AbaClinicalLinePoint;
    });

  if (metric !== 'TARGET_COMPARE_RESPONSES') return aggregateAbaClinicalLinePoints(mapped, options.groupBy || 'session', metric);

  const grouped = new Map<string, AbaClinicalLinePoint>();
  for (const point of mapped) {
    const key = `${point.sessionId || point.date}|${point.itemId || point.itemLabel}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...point, value: point.secondaryValues?.independencePct ?? point.value });
      continue;
    }
    current.secondaryValues = {
      ...(current.secondaryValues || {}),
      ...(Object.fromEntries(Object.entries(point.secondaryValues || {}).filter(([, value]) => value !== null)) as Record<string, number | null>)
    };
    current.value = current.secondaryValues?.independencePct ?? current.secondaryValues?.accuracyPct ?? current.value;
    current.attemptsCount = current.attemptsCount ?? point.attemptsCount;
  }

  return aggregateAbaClinicalLinePoints(Array.from(grouped.values()), options.groupBy || 'session', metric);
}

export function aggregateAbaClinicalLinePoints(
  points: AbaClinicalLinePoint[],
  groupBy: 'session' | 'day' | 'week' = 'session',
  metric = ''
): AbaClinicalLinePoint[] {
  const sorted = arrayOf(points)
    .slice()
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
  if (groupBy === 'session') {
    return sorted.map((point, index) => ({
      ...point,
      sessionLabel: point.sessionLabel || `Sessão ${index + 1}`
    }));
  }

  const sumMetric = ['TARGET_TRIAL_COUNT', 'BEHAVIOR_FREQUENCY', 'BEHAVIOR_DURATION_EPISODES', 'BEHAVIOR_DURATION_TOTAL', 'MASTERY_VALID_ATTEMPTS', 'MAINTENANCE_FAILURES'].includes(metric);
  const groups = new Map<string, AbaClinicalLinePoint[]>();
  for (const point of sorted) {
    const key = groupBy === 'week' ? lineWeekKey(point.date) : aggregateDateKey(point.date);
    groups.set(key, [...(groups.get(key) || []), point]);
  }

  return Array.from(groups.entries()).map(([key, group], index) => {
    const values = group.map((point) => point.value).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const secondaryKeys = new Set(group.flatMap((point) => Object.keys(point.secondaryValues || {})));
    const secondaryValues: Record<string, number | null> = {};
    secondaryKeys.forEach((secondaryKey) => {
      const secondaryNumbers = group
        .map((point) => point.secondaryValues?.[secondaryKey])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      secondaryValues[secondaryKey] = secondaryNumbers.length
        ? round2(secondaryNumbers.reduce((sum, value) => sum + value, 0) / secondaryNumbers.length)
        : null;
    });
    const value = values.length
      ? round2(sumMetric ? values.reduce((sum, item) => sum + item, 0) : values.reduce((sum, item) => sum + item, 0) / values.length)
      : null;
    const latest = group[group.length - 1];
    return {
      ...latest,
      id: `${groupBy}-${key}`,
      sessionId: null,
      sessionLabel: groupBy === 'week' ? `Semana ${index + 1}` : aggregateDateLabel(latest.date),
      date: latest.date,
      value,
      secondaryValues: Object.keys(secondaryValues).length ? secondaryValues : latest.secondaryValues,
      attemptsCount: group.reduce((sum, point) => sum + safeNumber(point.attemptsCount, 0), 0) || latest.attemptsCount || null,
      metadata: {
        ...(latest.metadata || {}),
        groupBy,
        groupedPoints: group.length,
        groupKey: key
      }
    };
  });
}

export function buildAbaClinicalLineSummary(points: AbaClinicalLinePoint[]): AbaClinicalLineSummary {
  const rows = arrayOf(points)
    .filter((point) => point.value !== null && point.value !== undefined)
    .slice()
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
  const last = rows[rows.length - 1] || null;
  const previous = rows[rows.length - 2] || null;
  const currentValue = last ? round2(safeNumber(last.value, 0)) : null;
  const previousValue = previous ? round2(safeNumber(previous.value, 0)) : null;
  const delta = currentValue !== null && previousValue !== null ? round2(currentValue - previousValue) : null;
  return {
    currentValue,
    previousValue,
    delta,
    trend: delta === null ? 'insufficient_data' : delta > 0 ? 'improved' : delta < 0 ? 'worsened' : 'stable',
    lastMeasuredAt: last?.date || null,
    lastSessionLabel: last?.sessionLabel || null,
    attemptsCount: last?.attemptsCount ?? null,
    status: last?.status || null
  };
}

const buildSnapshot = (base: {
  organizationId?: string | null;
  clinicId?: string | null;
  patientId?: string | null;
  sessionId: string;
  targetId?: string | null;
  behaviorId?: string | null;
  metricType: AbaMetricType;
  metricLabel: string;
  metricValue: unknown;
  previousValue?: unknown;
  currentStatus?: string | null;
  previousStatus?: string | null;
  changedAt: string;
  sourceSummaryId?: string | null;
  clinicalCriterion?: number | null;
}) => ({
  ...base,
  ...compareAbaMetric({
    metricType: base.metricType,
    metricLabel: base.metricLabel,
    metricValue: base.metricValue as any,
    previousValue: base.previousValue as any,
    currentStatus: base.currentStatus,
    previousStatus: base.previousStatus,
    clinicalCriterion: base.clinicalCriterion
  })
});

export function buildSessionMetricSnapshotsFromSummaries(input: {
  currentSummary: any;
  previousSummary?: any | null;
  currentTargetSummaries?: any[];
  previousTargetSummaries?: any[];
}): AbaSessionMetricSnapshot[] {
  const current = input.currentSummary || {};
  const previous = input.previousSummary || null;
  const sessionId = String(firstValue(current, ['session_id', 'sessionId']) || '').trim();
  if (!sessionId) return [];

  const changedAt = String(firstValue(current, ['ended_at', 'endedAt', 'created_at', 'createdAt']) || new Date().toISOString());
  const common = {
    organizationId: String(firstValue(current, ['organization_id', 'organizationId', 'clinic_id', 'clinicId']) || '').trim() || null,
    clinicId: String(firstValue(current, ['clinic_id', 'clinicId']) || '').trim() || null,
    patientId: String(firstValue(current, ['patient_id', 'patientId']) || '').trim() || null,
    sessionId,
    changedAt,
    sourceSummaryId: String(firstValue(current, ['id', 'summary_id', 'summaryId']) || '').trim() || null
  };
  const snapshots: AbaSessionMetricSnapshot[] = [];

  const currentTargets = arrayOf(input.currentTargetSummaries);
  const previousTargets = arrayOf(input.previousTargetSummaries);
  if (currentTargets.length > 0) {
    currentTargets.forEach((target) => {
      const previousTarget = findMatching(previousTargets, target, ['target_id', 'targetId', 'target_key', 'targetKey'], ['target_name', 'targetName', 'name']);
      const targetId = String(firstValue(target, ['target_id', 'targetId']) || '').trim() || null;
      const metricLabel = String(firstValue(target, ['target_name', 'targetName', 'name']) || targetId || 'Habilidade').trim();
      snapshots.push(buildSnapshot({
        ...common,
        targetId,
        metricType: 'TARGET_ACCURACY',
        metricLabel,
        metricValue: firstValue(target, ['accuracy_percent', 'accuracyPercent']),
        previousValue: firstValue(previousTarget, ['accuracy_percent', 'accuracyPercent'])
      }));
      snapshots.push(buildSnapshot({
        ...common,
        targetId,
        metricType: 'TARGET_INDEPENDENCE',
        metricLabel,
        metricValue: firstValue(target, ['independence_percent', 'independencePercent']),
        previousValue: firstValue(previousTarget, ['independence_percent', 'independencePercent'])
      }));
      snapshots.push(buildSnapshot({
        ...common,
        targetId,
        metricType: 'TARGET_TRIAL_COUNT',
        metricLabel,
        metricValue: firstValue(target, ['attempts_today', 'attemptsToday', 'total_trials', 'totalTrials']),
        previousValue: firstValue(previousTarget, ['attempts_today', 'attemptsToday', 'total_trials', 'totalTrials'])
      }));
    });
  } else {
    snapshots.push(buildSnapshot({
      ...common,
      metricType: 'TARGET_ACCURACY',
      metricLabel: 'Sessão',
      metricValue: firstValue(current, ['accuracy_percent', 'accuracyPercent']),
      previousValue: firstValue(previous, ['accuracy_percent', 'accuracyPercent'])
    }));
    snapshots.push(buildSnapshot({
      ...common,
      metricType: 'TARGET_INDEPENDENCE',
      metricLabel: 'Sessão',
      metricValue: firstValue(current, ['independence_percent', 'independencePercent']),
      previousValue: firstValue(previous, ['independence_percent', 'independencePercent'])
    }));
  }

  const previousFrequency = arrayOf(firstValue(previous, ['frequency_summary', 'frequencySummary']));
  arrayOf(firstValue(current, ['frequency_summary', 'frequencySummary'])).forEach((item) => {
    const prev = findMatching(previousFrequency, item, ['behavior_id', 'behaviorId'], ['behaviorName', 'behavior_name', 'behavior']);
    snapshots.push(buildSnapshot({
      ...common,
      behaviorId: String(firstValue(item, ['behavior_id', 'behaviorId']) || '').trim() || null,
      metricType: 'BEHAVIOR_FREQUENCY',
      metricLabel: String(firstValue(item, ['behaviorName', 'behavior_name', 'behavior']) || 'Comportamento').trim(),
      metricValue: firstValue(item, ['occurrences', 'frequency_count', 'frequencyCount', 'count']),
      previousValue: firstValue(prev, ['occurrences', 'frequency_count', 'frequencyCount', 'count'])
    }));
  });

  const previousDuration = arrayOf(firstValue(previous, ['duration_summary', 'durationSummary']));
  arrayOf(firstValue(current, ['duration_summary', 'durationSummary'])).forEach((item) => {
    const prev = findMatching(previousDuration, item, ['behavior_id', 'behaviorId'], ['behaviorName', 'behavior_name', 'behavior']);
    const label = String(firstValue(item, ['behaviorName', 'behavior_name', 'behavior']) || 'Comportamento').trim();
    const behaviorId = String(firstValue(item, ['behavior_id', 'behaviorId']) || '').trim() || null;
    snapshots.push(buildSnapshot({
      ...common,
      behaviorId,
      metricType: 'BEHAVIOR_DURATION_EPISODES',
      metricLabel: label,
      metricValue: firstValue(item, ['episodes', 'duration_episode_count', 'durationEpisodeCount']),
      previousValue: firstValue(prev, ['episodes', 'duration_episode_count', 'durationEpisodeCount'])
    }));
    snapshots.push(buildSnapshot({
      ...common,
      behaviorId,
      metricType: 'BEHAVIOR_DURATION_TOTAL',
      metricLabel: label,
      metricValue: firstValue(item, ['totalSeconds', 'total_seconds', 'duration_total_seconds']),
      previousValue: firstValue(prev, ['totalSeconds', 'total_seconds', 'duration_total_seconds'])
    }));
    snapshots.push(buildSnapshot({
      ...common,
      behaviorId,
      metricType: 'BEHAVIOR_DURATION_AVG',
      metricLabel: label,
      metricValue: firstValue(item, ['averageSeconds', 'average_seconds', 'duration_avg_seconds']),
      previousValue: firstValue(prev, ['averageSeconds', 'average_seconds', 'duration_avg_seconds'])
    }));
  });

  const previousInterval = arrayOf(firstValue(previous, ['interval_summary', 'intervalSummary']));
  arrayOf(firstValue(current, ['interval_summary', 'intervalSummary'])).forEach((item) => {
    const prev = findMatching(previousInterval, item, ['behavior_id', 'behaviorId'], ['behaviorName', 'behavior_name', 'behavior']);
    snapshots.push(buildSnapshot({
      ...common,
      behaviorId: String(firstValue(item, ['behavior_id', 'behaviorId']) || '').trim() || null,
      metricType: 'BEHAVIOR_INTERVAL_OCCURRENCE',
      metricLabel: String(firstValue(item, ['behaviorName', 'behavior_name', 'behavior']) || 'Comportamento').trim(),
      metricValue: firstValue(item, ['occurrencePercent', 'occurrence_percent']),
      previousValue: firstValue(prev, ['occurrencePercent', 'occurrence_percent'])
    }));
  });

  const previousMastery = arrayOf(firstValue(previous, ['mastery_summary', 'masterySummary']));
  arrayOf(firstValue(current, ['mastery_summary', 'masterySummary'])).forEach((item) => {
    const prev = findMatching(previousMastery, item, ['targetId', 'target_id', 'id'], ['name', 'targetName', 'target_name']);
    const currentStatus = String(firstValue(item, ['statusCode', 'status_code', 'status']) || '');
    snapshots.push(buildSnapshot({
      ...common,
      targetId: String(firstValue(item, ['targetId', 'target_id', 'id']) || '').trim() || null,
      metricType: 'MASTERY_STATUS',
      metricLabel: String(firstValue(item, ['name', 'targetName', 'target_name']) || 'Habilidade').trim(),
      metricValue: metricStatusScore('MASTERY_STATUS', currentStatus, 0),
      previousValue: prev ? metricStatusScore('MASTERY_STATUS', firstValue(prev, ['statusCode', 'status_code', 'status']), 0) : null,
      currentStatus,
      previousStatus: firstValue(prev, ['statusCode', 'status_code', 'status'])
    }));
  });

  const previousMaintenance = arrayOf(firstValue(previous, ['maintenance_summary', 'maintenanceSummary']));
  arrayOf(firstValue(current, ['maintenance_summary', 'maintenanceSummary'])).forEach((item) => {
    const prev = findMatching(previousMaintenance, item, ['targetId', 'target_id', 'id'], ['name', 'targetName', 'target_name']);
    const currentStatus = String(firstValue(item, ['status', 'probeStatus']) || '');
    snapshots.push(buildSnapshot({
      ...common,
      targetId: String(firstValue(item, ['targetId', 'target_id', 'id']) || '').trim() || null,
      metricType: 'MAINTENANCE_STATUS',
      metricLabel: String(firstValue(item, ['name', 'targetName', 'target_name']) || 'Habilidade').trim(),
      metricValue: metricStatusScore('MAINTENANCE_STATUS', currentStatus, 0),
      previousValue: prev ? metricStatusScore('MAINTENANCE_STATUS', firstValue(prev, ['status', 'probeStatus']), 0) : null,
      currentStatus,
      previousStatus: firstValue(prev, ['status', 'probeStatus'])
    }));
  });

  return snapshots;
}

export function compareSessionMetrics(
  currentSessionId: string,
  previousSessionId: string | null,
  input: {
    currentSummary: any;
    previousSummary?: any | null;
    currentTargetSummaries?: any[];
    previousTargetSummaries?: any[];
  }
) {
  return buildSessionMetricSnapshotsFromSummaries({
    ...input,
    currentSummary: {
      ...(input.currentSummary || {}),
      session_id: currentSessionId
    },
    previousSummary: input.previousSummary
      ? {
          ...(input.previousSummary || {}),
          session_id: previousSessionId
        }
      : null
  });
}
