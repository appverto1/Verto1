export type AbaMetricDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'STATUS_BASED';

export type AbaMetricType =
  | 'TARGET_ACCURACY'
  | 'TARGET_INDEPENDENCE'
  | 'TARGET_TRIAL_COUNT'
  | 'FUNCTIONAL_COMMUNICATION'
  | 'ENGAGEMENT'
  | 'BEHAVIOR_FREQUENCY'
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
  sessionId?: string | null;
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
  BEHAVIOR_DURATION_TOTAL: 'LOWER_IS_BETTER',
  BEHAVIOR_DURATION_AVG: 'LOWER_IS_BETTER',
  BEHAVIOR_DURATION_MAX: 'LOWER_IS_BETTER',
  BEHAVIOR_INTERVAL_OCCURRENCE: 'LOWER_IS_BETTER',
  MASTERY_STATUS: 'STATUS_BASED',
  MAINTENANCE_STATUS: 'STATUS_BASED',
  REGRESSION_RISK: 'STATUS_BASED'
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
  const statusMetric = metricType === 'MASTERY_STATUS' || metricType === 'MAINTENANCE_STATUS' || metricType === 'REGRESSION_RISK';
  if (statusMetric) return 1;
  const deltaPercent = Number(point?.deltaPercent);
  if (Number.isFinite(deltaPercent)) return Math.abs(deltaPercent);
  const deltaValue = Number(point?.deltaValue);
  if (Number.isFinite(deltaValue)) return Math.abs(deltaValue);
  if (normalizeStatus(point?.changeStatus) === 'FIRST_MEASUREMENT') return 1;
  return Math.abs(safeNumber(point?.value ?? point?.metricValue, 0));
};

const aggregateDateKey = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return 'sem-data';
  return date.toISOString().slice(0, 10);
};

const aggregateDateLabel = (value: any) => {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export function aggregateClinicalChangesBySession(
  points: Array<Partial<AbaSessionMetricSnapshot> & Record<string, any>>,
  options: { groupBy?: 'session' | 'day'; visualMagnitudeCap?: number } = {}
): AbaAggregatedClinicalChangeGroup[] {
  const groupBy = options.groupBy || 'session';
  const visualMagnitudeCap = Math.max(1, Number(options.visualMagnitudeCap || 120));
  const groups = new Map<string, AbaAggregatedClinicalChangeGroup>();

  for (const point of Array.isArray(points) ? points : []) {
    const changedAt = String(point?.changedAt || point?.changed_at || '');
    const sessionId = String(point?.sessionId || point?.session_id || '').trim() || null;
    const groupKey = groupBy === 'day'
      ? `day:${aggregateDateKey(changedAt)}`
      : `session:${sessionId || aggregateDateKey(changedAt)}`;
    const category = clinicalChangeCategoryFor(point);
    const rawMagnitude = rawClinicalMagnitudeFor(point);
    const visualMagnitude = Math.min(rawMagnitude, visualMagnitudeCap);
    const date = aggregateDateKey(changedAt);
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
          : `${aggregateDateLabel(changedAt)} ${sessionId ? `#${sessionId.slice(-4)}` : ''}`.trim(),
        sessionId,
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
    }

    const group = groups.get(groupKey)!;
    if (new Date(changedAt || 0).getTime() < new Date(group.sortAt || 0).getTime()) {
      group.sortAt = changedAt || group.sortAt;
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

  return Array.from(groups.values())
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
        topChange: sortedChanges[0] || null,
        topChanges: sortedChanges.slice(0, 8),
        changes: group.changes.slice().sort((a, b) => {
          const categoryOrder: Record<AbaClinicalChangeCategory, number> = { regression: 0, skill: 1, behavior: 2, mastery: 3, maintenance: 4 };
          return categoryOrder[a.changeCategory] - categoryOrder[b.changeCategory] || b.rawMagnitude - a.rawMagnitude;
        })
      };
    })
    .sort((a, b) => new Date(a.sortAt || 0).getTime() - new Date(b.sortAt || 0).getTime());
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
