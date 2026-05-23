export type SessionSummaryPendingItem = {
  key: string;
  label: string;
  blocking?: boolean;
  count?: number;
};

export type SessionSummary = {
  id: string;
  sessionId: string;
  patientId: string;
  therapistId: string | null;
  patientName?: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  totalTrials: number;
  independentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  totalBehaviorEvents: number;
  frequencySummary: BehaviorFrequencySummary[];
  durationSummary: BehaviorDurationSummary[];
  intervalSummary: BehaviorIntervalSummary[];
  teachingSummary: TeachingSummary;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  pendingItems: SessionSummaryPendingItem[];
  createdAt: string;
};

export type BehaviorFrequencySummary = {
  behaviorName: string;
  occurrences: number;
};

export type BehaviorDurationSummary = {
  behaviorName: string;
  episodes: number;
  totalSeconds: number;
  averageSeconds: number;
  maxSeconds: number;
};

export type BehaviorIntervalSummary = {
  behaviorName: string;
  method: string;
  totalIntervals: number;
  occurredCount: number;
  notOccurredCount: number;
  occurrencePercent: number;
};

export type TeachingSummary = {
  totalTrials: number;
  independentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  typesUsed: string[];
};

type CalculateSessionSummaryInput = {
  id?: string;
  sessionId?: string;
  patientId?: string;
  patientName?: string;
  therapistId?: string | null;
  startedAt?: string;
  endedAt?: string;
  trials?: any[];
  behaviorEvents?: any[];
  pendingItems?: SessionSummaryPendingItem[];
  syncStatus?: 'local' | 'syncing' | 'synced' | 'error';
  createdAt?: string;
};

const collectionTypeLabels: Record<string, string> = {
  dtt: 'DTT',
  net: 'NET',
  cold_probe: 'Cold Probe',
  baseline_probe: 'Baseline Probe',
  maintenance_probe: 'Maintenance Probe'
};

const intervalMethods = new Set(['partial_interval', 'whole_interval', 'momentary_time_sampling']);

const valueOf = (row: any, ...keys: string[]) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return undefined;
};

const safeNumber = (value: any, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const safeIso = (value: any, fallback = new Date().toISOString()) => {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

const belongsToSession = (row: any, sessionId: string) => {
  const rowSessionId = valueOf(row, 'sessionId', 'session_id');
  return !rowSessionId || String(rowSessionId) === String(sessionId);
};

const measurementTypeOf = (event: any) => String(valueOf(event, 'measurementType', 'measurement_type') || '').toLowerCase();

const behaviorNameOf = (event: any) => String(valueOf(event, 'behaviorName', 'behavior_name', 'title') || 'Comportamento');

const isIntervalAggregate = (event: any) => Boolean(
  valueOf(event, 'intervalAggregate') ||
  valueOf(event, 'raw_payload', 'rawPayload')?.intervalAggregate
);

const trialTypeOf = (trial: any) => {
  const explicit = String(valueOf(trial, 'collectionType', 'collection_type', 'trialType', 'trial_type') || '').trim();
  if (explicit) return collectionTypeLabels[explicit] || explicit;
  const detail = String(valueOf(trial, 'detail') || '');
  const firstPart = detail.split('-')[0]?.trim();
  return firstPart || 'Nao informado';
};

const trialOutcome = (trial: any) => {
  const explicit = String(valueOf(trial, 'trialOutcome', 'outcome') || '').toLowerCase();
  const promptKey = String(valueOf(trial, 'promptLevelKey', 'prompt_level_key', 'promptLevel', 'prompt_level') || '').toLowerCase();
  const detail = String(valueOf(trial, 'detail') || '').toLowerCase();
  const score = safeNumber(valueOf(trial, 'score', 'responseScore', 'response_score'), NaN);
  const independent = Boolean(valueOf(trial, 'isIndependent', 'independent')) || explicit === 'independent' || promptKey === 'independent' || detail.includes('independente');
  const error = explicit === 'error' || promptKey === 'error' || detail.includes('erro') || score === 0;
  const correct = Boolean(valueOf(trial, 'isCorrect', 'correct')) || (!error && (score > 0 || independent || explicit === 'prompted'));
  const prompted = !independent && !error && (explicit === 'prompted' || correct || Boolean(promptKey && promptKey !== 'independent'));
  return { independent, prompted, error, correct };
};

const calculateTeachingSummary = (trials: any[]): TeachingSummary => {
  const outcomes = trials.map(trialOutcome);
  const totalTrials = outcomes.length;
  const independentTrials = outcomes.filter((outcome) => outcome.independent).length;
  const errorTrials = outcomes.filter((outcome) => outcome.error).length;
  const promptedTrials = outcomes.filter((outcome) => outcome.prompted).length;
  const correctTrials = outcomes.filter((outcome) => outcome.correct).length;
  const typesUsed = Array.from(new Set(trials.map(trialTypeOf).filter(Boolean)));
  return {
    totalTrials,
    independentTrials,
    promptedTrials,
    errorTrials,
    accuracyPercent: percent(correctTrials, totalTrials),
    independencePercent: percent(independentTrials, totalTrials),
    typesUsed
  };
};

const calculateFrequencySummary = (events: any[]): BehaviorFrequencySummary[] => {
  const grouped = new Map<string, BehaviorFrequencySummary>();
  for (const event of events) {
    if (measurementTypeOf(event) !== 'frequency') continue;
    const behaviorName = behaviorNameOf(event);
    const current = grouped.get(behaviorName) || { behaviorName, occurrences: 0 };
    current.occurrences += Math.max(1, safeNumber(valueOf(event, 'countDelta', 'count_delta'), 1));
    grouped.set(behaviorName, current);
  }
  return Array.from(grouped.values());
};

const calculateDurationSummary = (events: any[]): BehaviorDurationSummary[] => {
  const grouped = new Map<string, { behaviorName: string; durations: number[] }>();
  for (const event of events) {
    if (measurementTypeOf(event) !== 'duration') continue;
    const behaviorName = behaviorNameOf(event);
    const duration = Math.max(0, safeNumber(valueOf(event, 'durationSeconds', 'duration_seconds'), 0));
    const current = grouped.get(behaviorName) || { behaviorName, durations: [] };
    current.durations.push(duration);
    grouped.set(behaviorName, current);
  }
  return Array.from(grouped.values()).map((group) => {
    const totalSeconds = group.durations.reduce((sum, value) => sum + value, 0);
    const episodes = group.durations.length;
    return {
      behaviorName: group.behaviorName,
      episodes,
      totalSeconds,
      averageSeconds: episodes > 0 ? Math.round(totalSeconds / episodes) : 0,
      maxSeconds: group.durations.length > 0 ? Math.max(...group.durations) : 0
    };
  });
};

const calculateIntervalSummary = (events: any[]): BehaviorIntervalSummary[] => {
  const grouped = new Map<string, BehaviorIntervalSummary & { hasAggregate?: boolean }>();
  for (const event of events) {
    const method = measurementTypeOf(event);
    if (!intervalMethods.has(method)) continue;
    const behaviorName = behaviorNameOf(event);
    const key = `${behaviorName}:${method}`;
    const current = grouped.get(key) || {
      behaviorName,
      method,
      totalIntervals: 0,
      occurredCount: 0,
      notOccurredCount: 0,
      occurrencePercent: 0
    };
    const rawPayload = valueOf(event, 'raw_payload', 'rawPayload') || {};
    if (isIntervalAggregate(event)) {
      if (!current.hasAggregate) {
        current.totalIntervals = 0;
        current.occurredCount = 0;
        current.notOccurredCount = 0;
      }
      const aggregateTotal = Math.max(0, safeNumber(valueOf(event, 'totalIntervals') ?? rawPayload.totalIntervals, 0));
      const aggregateOccurred = Math.min(aggregateTotal, Math.max(0, safeNumber(valueOf(event, 'occurredCount') ?? rawPayload.occurredCount, 0)));
      current.totalIntervals += aggregateTotal;
      current.occurredCount += aggregateOccurred;
      current.notOccurredCount += Math.max(0, aggregateTotal - aggregateOccurred);
      current.hasAggregate = true;
    } else {
      if (current.hasAggregate) continue;
      const occurred = Boolean(valueOf(event, 'intervalOccurred', 'interval_occurred', 'occurred'));
      current.totalIntervals += 1;
      if (occurred) current.occurredCount += 1;
      else current.notOccurredCount += 1;
    }
    current.occurrencePercent = percent(current.occurredCount, current.totalIntervals);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).map(({ hasAggregate, ...summary }) => summary);
};

export const calculateSessionSummary = (sessionId: string, input: CalculateSessionSummaryInput = {}): SessionSummary => {
  const endedAt = safeIso(input.endedAt);
  const startedAt = safeIso(input.startedAt, endedAt);
  const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  const trials = (input.trials || []).filter((trial) => belongsToSession(trial, sessionId));
  const behaviorEvents = (input.behaviorEvents || []).filter((event) => belongsToSession(event, sessionId));
  const teachingSummary = calculateTeachingSummary(trials);
  const frequencySummary = calculateFrequencySummary(behaviorEvents);
  const durationSummary = calculateDurationSummary(behaviorEvents);
  const intervalSummary = calculateIntervalSummary(behaviorEvents);
  const totalBehaviorEvents = behaviorEvents.filter((event) => !isIntervalAggregate(event)).length;

  return {
    id: input.id || `summary-${sessionId}`,
    sessionId,
    patientId: input.patientId || '',
    therapistId: input.therapistId || null,
    patientName: input.patientName,
    startedAt,
    endedAt,
    durationSeconds,
    totalTrials: teachingSummary.totalTrials,
    independentTrials: teachingSummary.independentTrials,
    promptedTrials: teachingSummary.promptedTrials,
    errorTrials: teachingSummary.errorTrials,
    accuracyPercent: teachingSummary.accuracyPercent,
    independencePercent: teachingSummary.independencePercent,
    totalBehaviorEvents,
    frequencySummary,
    durationSummary,
    intervalSummary,
    teachingSummary,
    syncStatus: input.syncStatus || 'local',
    pendingItems: input.pendingItems || [],
    createdAt: input.createdAt || new Date().toISOString()
  };
};

export const canCloseAbaSession = (input: {
  openDurations?: any[];
  intervalRun?: any;
}) => ({
  canClose: !(input.openDurations?.length || input.intervalRun),
  blockers: [
    ...(input.openDurations?.length ? [{ key: 'open_duration', label: 'Ha eventos de duracao em aberto', blocking: true, count: input.openDurations.length }] : []),
    ...(input.intervalRun ? [{ key: 'open_interval_collection', label: 'Ha uma coleta por intervalo em andamento', blocking: true, count: 1 }] : [])
  ] as SessionSummaryPendingItem[]
});
