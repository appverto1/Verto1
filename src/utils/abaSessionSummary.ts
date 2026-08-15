import { getIntervalRunStatus, isActiveIntervalCollection, type AbaIntervalCollectionStatus } from './abaIntervalLifecycle';
import { resolveTrialPromptInfo } from './abaPromptLevels';
import { formatPatientLabel, formatTherapistLabel, isTechnicalId, safeDisplayValue } from './displayLabels';

export type SessionSummaryPendingItem = {
  key: string;
  label: string;
  blocking?: boolean;
  count?: number;
  category?: 'blocker' | 'warning';
};

export type SessionMasterySummaryItem = {
  id?: string;
  name: string;
  criterion: string;
  performanceText: string;
  contributes: boolean;
  status: string;
  independentTrials?: number;
};

export type SessionMaintenanceSummaryItem = {
  id?: string;
  targetId?: string | null;
  name: string;
  status: string;
  totalTrials?: number;
  accuracyPercent?: number;
  independencePercent?: number;
  consecutiveFailureCount?: number;
};

export type SessionSummary = {
  id: string;
  sessionId: string;
  patientId: string;
  therapistId: string | null;
  therapistName?: string | null;
  patientName?: string;
  careSetting?: 'CLINIC' | 'ONLINE' | 'PATIENT_HOME' | 'SCHOOL' | 'OTHER' | null;
  locationNameSnapshot?: string | null;
  locationContextSnapshot?: {
    careSetting?: string | null;
    schoolId?: string | null;
    schoolUnitId?: string | null;
    locationName?: string | null;
    locationSource?: string | null;
    locationTimezone?: string | null;
  } | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  totalTrials: number;
  independentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  trialTypesUsed: string[];
  totalBehaviorEvents: number;
  frequencySummary: BehaviorFrequencySummary[];
  durationSummary: BehaviorDurationSummary[];
  intervalSummary: BehaviorIntervalSummary[];
  abcSummary: BehaviorAbcSummary[];
  masterySummary: SessionMasterySummaryItem[];
  maintenanceSummary?: SessionMaintenanceSummaryItem[];
  teachingSummary: TeachingSummary;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  blockingItems: SessionSummaryPendingItem[];
  warningItems: SessionSummaryPendingItem[];
  pendingItems: SessionSummaryPendingItem[];
  pendingWarnings: SessionSummaryPendingItem[];
  sessionNote: string;
  createdAt: string;
  sourceRecords?: any[];
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
  plannedIntervals?: number;
  answeredIntervals?: number;
  occurredCount: number;
  notOccurredCount: number;
  occurrencePercent: number;
  status?: AbaIntervalCollectionStatus;
};

export type BehaviorAbcSummary = {
  behaviorName: string;
  totalEvents: number;
  completedEvents: number;
  missingEvents: number;
  locations: string[];
  averageSeverity: number | null;
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

export type SessionReport = {
  header: {
    patient: string;
    therapist: string;
    date: string;
    startedAt: string;
    endedAt: string;
    duration: string;
    durationSeconds: number;
    status: 'concluida';
    syncStatus: SessionSummary['syncStatus'];
  };
  generalSummary: {
    totalTeachingTrials: number;
    totalBehaviorRecords: number;
    totalFrequencyEvents: number;
    totalDurationEvents: number;
    totalIntervalCollections: number;
    sessionNote: string;
  };
  teachingSummary: Omit<TeachingSummary, 'typesUsed'> & {
    correctTrials: number;
    typesUsed: Array<{ key: string; label: string; count: number }>;
    promptsUsed: Array<{ key: string; label: string; count: number }>;
  };
  targetSummaries: Array<{
    targetId?: string;
    targetName: string;
    program: string;
    totalTrials: number;
    independentCorrect: number;
    promptedCorrect: number;
    errors: number;
    accuracyPercent: number;
    independencePercent: number;
    mostUsedTrialType: string;
    masteryStatus: 'critério atingido hoje' | 'critério não atingido' | 'dados insuficientes';
  }>;
  behaviorSummaries: {
    frequency: Array<{
      behavior: string;
      totalOccurrences: number;
      locations: string[];
      averageSeverity: number | null;
      occurrenceTimes: string[];
    }>;
    duration: Array<{
      behavior: string;
      episodes: number;
      totalSeconds: number;
      averageSeconds: number;
      maxSeconds: number;
      locations: string[];
      averageSeverity: number | null;
    }>;
    interval: Array<{
      behavior: string;
      method: string;
      totalIntervals: number;
      plannedIntervals?: number;
      answeredIntervals?: number;
      yes: number;
      no: number;
      occurrencePercent: number;
      intervalSeconds: number | null;
      location: string;
      averageSeverity: number | null;
      status?: AbaIntervalCollectionStatus;
    }>;
  };
  abcEvents: Array<{
    antecedent: string;
    behavior: string;
    consequence: string;
    location: string;
    severity: number | null;
    note: string;
  }>;
  pendingComplements: {
    guardianSignature: 'pending' | 'completed';
    sessionNote: 'pending' | 'completed';
    abcPendingCount: number;
    unsyncedCount: number;
    items: SessionSummaryPendingItem[];
  };
};

type CalculateSessionSummaryInput = {
  id?: string;
  sessionId?: string;
  patientId?: string;
  patientName?: string;
  therapistId?: string | null;
  therapistName?: string | null;
  careSetting?: SessionSummary['careSetting'];
  locationNameSnapshot?: string | null;
  locationContextSnapshot?: SessionSummary['locationContextSnapshot'];
  startedAt?: string;
  endedAt?: string;
  trials?: any[];
  behaviorEvents?: any[];
  abcSummary?: BehaviorAbcSummary[];
  masterySummary?: SessionMasterySummaryItem[];
  maintenanceSummary?: SessionMaintenanceSummaryItem[];
  blockingItems?: SessionSummaryPendingItem[];
  warningItems?: SessionSummaryPendingItem[];
  pendingItems?: SessionSummaryPendingItem[];
  pendingWarnings?: SessionSummaryPendingItem[];
  sessionNote?: string;
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

const promptTypeLabels: Record<string, string> = {
  independent: 'Independente',
  visual: 'Visual',
  gestural: 'Gestual',
  verbal: 'Verbal',
  model: 'Modelo',
  partial_physical: 'Física parcial',
  full_physical: 'Física total',
  prompted: 'Com ajuda',
  error: 'Erro / sem resposta'
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

const uniqueStrings = (values: any[]) => Array.from(new Set(
  values.map((value) => String(value || '').trim()).filter(Boolean)
));

const averageOrNull = (values: any[]) => {
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
};

const formatReportDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
};

const formatReportTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const formatReportDuration = (durationSeconds: number) => {
  const safeSeconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
};

const countBy = (values: string[]) => {
  const grouped = new Map<string, number>();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key) continue;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  return grouped;
};

const mostUsed = (values: string[], fallback = 'Não informado') => {
  const grouped = countBy(values);
  let best = fallback;
  let bestCount = 0;
  for (const [value, count] of grouped.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

const belongsToSession = (row: any, sessionId: string) => {
  const rowSessionId = valueOf(row, 'sessionId', 'session_id');
  return !rowSessionId || String(rowSessionId) === String(sessionId);
};

const measurementTypeOf = (event: any) => String(valueOf(event, 'measurementType', 'measurement_type') || '').toLowerCase();

const behaviorNameOf = (event: any) => String(valueOf(event, 'behaviorName', 'behavior_name', 'title') || 'Comportamento');

const isCompletedDurationEvent = (event: any) => {
  if (measurementTypeOf(event) !== 'duration') return false;
  const status = String(valueOf(event, 'status') || '').trim().toUpperCase();
  if (status === 'IN_PROGRESS') return false;
  const durationValue = valueOf(event, 'durationSeconds', 'duration_seconds');
  const hasDuration = durationValue !== undefined && durationValue !== null;
  const hasEndedAt = Boolean(valueOf(event, 'endedAt', 'ended_at'));
  return status === 'COMPLETED' || hasEndedAt || hasDuration;
};

const isIntervalAggregate = (event: any) => Boolean(
  valueOf(event, 'intervalAggregate') ||
  valueOf(event, 'raw_payload', 'rawPayload')?.intervalAggregate
);

const intervalCollectionStatusOf = (event: any): AbaIntervalCollectionStatus | null => {
  const rawPayload = valueOf(event, 'raw_payload', 'rawPayload') || {};
  const explicitStatus = valueOf(event, 'status') ?? rawPayload.status;
  const explicitCollectionStatus = valueOf(event, 'collectionStatus', 'collection_status') ?? rawPayload.collectionStatus;
  const lifecycleKnown = Boolean(
    explicitStatus ||
    explicitCollectionStatus ||
    valueOf(event, 'cancelledAt', 'cancelled_at') ||
    rawPayload.cancelledAt ||
    valueOf(event, 'paused') !== undefined ||
    rawPayload.paused !== undefined ||
    valueOf(event, 'awaitingResponse') !== undefined ||
    rawPayload.awaitingResponse !== undefined ||
    valueOf(event, 'completed') !== undefined ||
    rawPayload.completed !== undefined
  );
  if (!lifecycleKnown) return null;
  return getIntervalRunStatus({
    status: explicitStatus,
    collectionStatus: explicitCollectionStatus,
    paused: Boolean(valueOf(event, 'paused') ?? rawPayload.paused),
    awaitingResponse: Boolean(valueOf(event, 'awaitingResponse') ?? rawPayload.awaitingResponse),
    completed: Boolean(valueOf(event, 'completed') ?? rawPayload.completed),
    cancelledAt: valueOf(event, 'cancelledAt', 'cancelled_at') ?? rawPayload.cancelledAt
  });
};

const isCancelledIntervalEvent = (event: any) => {
  const rawPayload = valueOf(event, 'raw_payload', 'rawPayload') || {};
  const status = intervalCollectionStatusOf(event);
  return status === 'CANCELLED' ||
    Boolean(valueOf(event, 'intervalCancelled', 'interval_cancelled')) ||
    Boolean(valueOf(event, 'cancelledAt', 'cancelled_at') || rawPayload.cancelledAt) ||
    String(rawPayload.collectionStatus || rawPayload.status || '').toUpperCase() === 'CANCELLED';
};

const trialTypeOf = (trial: any) => {
  const explicit = String(valueOf(trial, 'collectionType', 'collection_type', 'trialType', 'trial_type') || '').trim();
  if (explicit) return collectionTypeLabels[explicit] || explicit;
  const detail = String(valueOf(trial, 'detail') || '');
  const firstPart = detail.split('-')[0]?.trim();
  return firstPart || 'Não informado';
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

const v3TrialActionKey = (trial: any) => {
  const rawPayload = valueOf(trial, 'raw_payload', 'rawPayload') || {};
  return String(
    valueOf(trial, 'v3ActionKey', 'v3_action_key') ??
    rawPayload.v3ActionKey ??
    rawPayload.v3_action_key ??
    ''
  ).trim().toUpperCase();
};

const isV3Trial = (trial: any) => {
  const rawPayload = valueOf(trial, 'raw_payload', 'rawPayload') || {};
  const modelVersion = String(
    valueOf(trial, 'measurementModelVersion', 'measurement_model_version') ??
    rawPayload.measurementModelVersion ??
    rawPayload.measurement_model_version ??
    ''
  ).trim().toUpperCase();
  return modelVersion === 'V3' || Boolean(v3TrialActionKey(trial));
};

const trialPromptScoreSnapshot = (trial: any): number | null => {
  const rawPayload = valueOf(trial, 'raw_payload', 'rawPayload') || {};
  const raw = valueOf(trial, 'promptIndependenceScoreSnapshot', 'prompt_independence_score_snapshot') ??
    rawPayload.promptIndependenceScoreSnapshot ??
    rawPayload.prompt_independence_score_snapshot;
  const numberValue = Number(raw);
  return Number.isFinite(numberValue) ? Math.max(0, Math.min(100, numberValue)) : null;
};

export const calculateTrialAccuracy = (trials: any[]) => {
  const outcomes = trials.map(trialOutcome);
  const totalTrials = outcomes.length;
  const correctTrials = outcomes.filter((outcome) => outcome.correct).length;
  return percent(correctTrials, totalTrials);
};

export const calculateTrialIndependence = (trials: any[]) => {
  const hasV3Trial = trials.some(isV3Trial);
  if (hasV3Trial) {
    // V3 never reuses the Legacy 0-100 prompt score. A V3 independent-opportunity
    // denominator contains only explicit independent correct/incorrect/no-response
    // actions; prompted-correct trials are support steps and do not inflate it.
    // In a rare mixed V2/V3 session, Legacy trials remain count-based here rather
    // than blending incomparable V2 weighted scores with V3 categorical semantics.
    let eligibleOpportunities = 0;
    let independentCorrect = 0;
    for (const trial of trials) {
      if (isV3Trial(trial)) {
        const actionKey = v3TrialActionKey(trial);
        if (['INDEPENDENT_CORRECT', 'INDEPENDENT_INCORRECT', 'NO_RESPONSE'].includes(actionKey)) {
          eligibleOpportunities += 1;
          if (actionKey === 'INDEPENDENT_CORRECT') independentCorrect += 1;
        }
        continue;
      }
      eligibleOpportunities += 1;
      if (trialOutcome(trial).independent) independentCorrect += 1;
    }
    return percent(independentCorrect, eligibleOpportunities);
  }

  const snapshotScores = trials.map(trialPromptScoreSnapshot);
  if (snapshotScores.some((score) => score !== null)) {
    const normalizedScores = trials.map((trial, index) => {
      const snapshotScore = snapshotScores[index];
      if (snapshotScore !== null) return snapshotScore;
      const outcome = trialOutcome(trial);
      return outcome.independent ? 100 : 0;
    });
    return normalizedScores.length > 0
      ? Math.round(normalizedScores.reduce((sum, value) => sum + value, 0) / normalizedScores.length)
      : 0;
  }
  const outcomes = trials.map(trialOutcome);
  const totalTrials = outcomes.length;
  const independentTrials = outcomes.filter((outcome) => outcome.independent).length;
  return percent(independentTrials, totalTrials);
};

const calculateTeachingSummary = (trials: any[]): TeachingSummary => {
  const outcomes = trials.map(trialOutcome);
  const totalTrials = outcomes.length;
  const independentTrials = outcomes.filter((outcome) => outcome.independent).length;
  const errorTrials = outcomes.filter((outcome) => outcome.error).length;
  const promptedTrials = outcomes.filter((outcome) => outcome.prompted).length;
  const typesUsed = Array.from(new Set(trials.map(trialTypeOf).filter(Boolean)));
  return {
    totalTrials,
    independentTrials,
    promptedTrials,
    errorTrials,
    accuracyPercent: calculateTrialAccuracy(trials),
    independencePercent: calculateTrialIndependence(trials),
    typesUsed
  };
};

export const calculateFrequencySummary = (events: any[]): BehaviorFrequencySummary[] => {
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

export const calculateDurationSummary = (events: any[]): BehaviorDurationSummary[] => {
  const grouped = new Map<string, { behaviorName: string; durations: number[] }>();
  for (const event of events) {
    if (!isCompletedDurationEvent(event)) continue;
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

export const calculateIntervalSummary = (events: any[]): BehaviorIntervalSummary[] => {
  const grouped = new Map<string, BehaviorIntervalSummary & { hasAggregate?: boolean }>();
  for (const event of events) {
    const method = measurementTypeOf(event);
    if (!intervalMethods.has(method)) continue;
    if (isCancelledIntervalEvent(event)) continue;
    const behaviorName = behaviorNameOf(event);
    const key = `${behaviorName}:${method}`;
    const current = grouped.get(key) || {
      behaviorName,
      method,
      totalIntervals: 0,
      plannedIntervals: 0,
      answeredIntervals: 0,
      occurredCount: 0,
      notOccurredCount: 0,
      occurrencePercent: 0,
      status: undefined
    };
    const rawPayload = valueOf(event, 'raw_payload', 'rawPayload') || {};
    if (isIntervalAggregate(event)) {
      if (!current.hasAggregate) {
        current.totalIntervals = 0;
        current.plannedIntervals = 0;
        current.answeredIntervals = 0;
        current.occurredCount = 0;
        current.notOccurredCount = 0;
      }
      const aggregateAnswered = Math.max(0, safeNumber(
        valueOf(event, 'answeredIntervals', 'answered_intervals') ??
        valueOf(event, 'totalIntervals', 'total_intervals') ??
        rawPayload.answeredIntervals ??
        rawPayload.totalIntervals,
        0
      ));
      const aggregatePlanned = Math.max(aggregateAnswered, safeNumber(
        valueOf(event, 'plannedIntervals', 'planned_intervals') ??
        rawPayload.plannedIntervals ??
        rawPayload.plannedTotalIntervals ??
        aggregateAnswered,
        aggregateAnswered
      ));
      const aggregateOccurred = Math.min(aggregateAnswered, Math.max(0, safeNumber(
        valueOf(event, 'yesCount', 'yes_count', 'occurredCount') ??
        rawPayload.yesCount ??
        rawPayload.occurredCount,
        0
      )));
      current.totalIntervals += aggregateAnswered;
      current.answeredIntervals = (current.answeredIntervals || 0) + aggregateAnswered;
      current.plannedIntervals = (current.plannedIntervals || 0) + aggregatePlanned;
      current.occurredCount += aggregateOccurred;
      current.notOccurredCount += Math.max(0, aggregateAnswered - aggregateOccurred);
      current.status = intervalCollectionStatusOf(event) || current.status || (aggregateAnswered < aggregatePlanned ? 'PARTIALLY_COMPLETED' : 'COMPLETED');
      current.hasAggregate = true;
    } else {
      if (current.hasAggregate) continue;
      const occurred = Boolean(valueOf(event, 'intervalOccurred', 'interval_occurred', 'occurred'));
      current.totalIntervals += 1;
      current.answeredIntervals = (current.answeredIntervals || 0) + 1;
      current.plannedIntervals = Math.max(current.plannedIntervals || 0, current.totalIntervals);
      if (occurred) current.occurredCount += 1;
      else current.notOccurredCount += 1;
    }
    current.occurrencePercent = percent(current.occurredCount, current.totalIntervals);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).map(({ hasAggregate, ...summary }) => ({
    ...summary,
    plannedIntervals: summary.plannedIntervals || summary.totalIntervals,
    answeredIntervals: summary.answeredIntervals || summary.totalIntervals
  }));
};

const hasAbcFields = (record: any) => Boolean(valueOf(record, 'antecedent') || valueOf(record, 'consequence'));

const calculateAbcSummary = (events: any[]): BehaviorAbcSummary[] => {
  const grouped = new Map<string, {
    behaviorName: string;
    totalEvents: number;
    completedEvents: number;
    missingEvents: number;
    locations: any[];
    severities: any[];
  }>();

  for (const event of events) {
    if (isIntervalAggregate(event)) continue;
    const behaviorName = behaviorNameOf(event);
    const current = grouped.get(behaviorName) || {
      behaviorName,
      totalEvents: 0,
      completedEvents: 0,
      missingEvents: 0,
      locations: [],
      severities: []
    };
    current.totalEvents += 1;
    current.locations.push(valueOf(event, 'location'));
    current.severities.push(valueOf(event, 'severity'));
    if (measurementTypeOf(event) === 'abc' || hasAbcFields(event)) current.completedEvents += 1;
    else current.missingEvents += 1;
    grouped.set(behaviorName, current);
  }

  return Array.from(grouped.values()).map((group) => ({
    behaviorName: group.behaviorName,
    totalEvents: group.totalEvents,
    completedEvents: group.completedEvents,
    missingEvents: group.missingEvents,
    locations: uniqueStrings(group.locations),
    averageSeverity: averageOrNull(group.severities)
  }));
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
  const abcSummary = input.abcSummary || calculateAbcSummary(behaviorEvents);
  const totalBehaviorEvents = behaviorEvents.filter((event) => !isIntervalAggregate(event)).length;
  const blockingItems = input.blockingItems || input.pendingItems || [];
  const warningItems = input.warningItems || input.pendingWarnings || [];

  return {
    id: input.id || `summary-${sessionId}`,
    sessionId,
    patientId: input.patientId || '',
    therapistId: input.therapistId || null,
    therapistName: input.therapistName || null,
    patientName: input.patientName,
    careSetting: input.careSetting || null,
    locationNameSnapshot: input.locationNameSnapshot || null,
    locationContextSnapshot: input.locationContextSnapshot || null,
    startedAt,
    endedAt,
    durationSeconds,
    totalTrials: teachingSummary.totalTrials,
    independentTrials: teachingSummary.independentTrials,
    promptedTrials: teachingSummary.promptedTrials,
    errorTrials: teachingSummary.errorTrials,
    accuracyPercent: teachingSummary.accuracyPercent,
    independencePercent: teachingSummary.independencePercent,
    trialTypesUsed: teachingSummary.typesUsed,
    totalBehaviorEvents,
    frequencySummary,
    durationSummary,
    intervalSummary,
    abcSummary,
    masterySummary: input.masterySummary || [],
    maintenanceSummary: input.maintenanceSummary || [],
    teachingSummary,
    syncStatus: input.syncStatus || 'local',
    blockingItems,
    warningItems,
    pendingItems: blockingItems,
    pendingWarnings: warningItems,
    sessionNote: input.sessionNote || '',
    createdAt: input.createdAt || new Date().toISOString()
  };
};

export const buildSessionReport = (sessionSummary: SessionSummary): SessionReport => {
  const sourceRecords = Array.isArray(sessionSummary.sourceRecords)
    ? sessionSummary.sourceRecords
    : Array.isArray((sessionSummary as any).records)
      ? (sessionSummary as any).records
      : [];
  const sourceTrials = sourceRecords.filter((record) => String(valueOf(record, 'kind') || '').toLowerCase() === 'trial');
  const sourceBehaviorRecords = sourceRecords.filter((record) => (
    String(valueOf(record, 'kind') || '').toLowerCase() === 'behavior' &&
    !isCancelledIntervalEvent(record)
  ));

  const effectiveTrials = sourceTrials.length > 0 ? sourceTrials : [];
  const effectiveBehaviorRecords = sourceBehaviorRecords.length > 0 ? sourceBehaviorRecords : [];
  const teachingSummaryBase = effectiveTrials.length > 0
    ? calculateTeachingSummary(effectiveTrials)
    : sessionSummary.teachingSummary;
  const trialOutcomes = effectiveTrials.map(trialOutcome);
  const correctTrials = effectiveTrials.length > 0
    ? trialOutcomes.filter((outcome) => outcome.correct).length
    : Math.max(0, sessionSummary.independentTrials + sessionSummary.promptedTrials);
  const promptCounts = countBy(effectiveTrials.map((trial) => {
    const promptInfo = resolveTrialPromptInfo(trial);
    if (promptInfo.key && !promptInfo.isIndependent && !promptInfo.isError) return promptInfo.key;
    const promptKey = String(valueOf(trial, 'promptLevelKey', 'prompt_level_key', 'promptLevel', 'prompt_level') || '').toLowerCase();
    if (promptKey) return promptKey;
    const outcome = trialOutcome(trial);
    if (outcome.independent) return 'independent';
    if (outcome.error) return 'error';
    return 'prompted';
  }));
  const promptLabelsByKey = new Map(effectiveTrials.map((trial) => {
    const promptInfo = resolveTrialPromptInfo(trial);
    return [promptInfo.key, promptInfo.label] as const;
  }));
  const typeCounts = countBy(effectiveTrials.map((trial) => {
    const raw = String(valueOf(trial, 'collectionType', 'collection_type', 'trialType', 'trial_type') || '').toLowerCase();
    return raw || trialTypeOf(trial);
  }));

  const targetGroups = new Map<string, any[]>();
  for (const trial of effectiveTrials) {
    const targetName = String(valueOf(trial, 'targetName', 'target_name', 'title') || 'Meta sem nome');
    const key = String(valueOf(trial, 'targetId', 'target_id') || targetName);
    targetGroups.set(key, [...(targetGroups.get(key) || []), trial]);
  }
  const masteryByName = new Map(
    (sessionSummary.masterySummary || []).map((item) => [String(item.name || '').toLowerCase(), item])
  );
  const targetSummaries: SessionReport['targetSummaries'] = targetGroups.size > 0
    ? Array.from(targetGroups.entries()).map(([targetId, trials]) => {
        const targetName = String(valueOf(trials[0], 'targetName', 'target_name', 'title') || 'Meta sem nome');
        const outcomes = trials.map(trialOutcome);
        const independentCorrect = outcomes.filter((outcome) => outcome.independent && outcome.correct).length;
        const promptedCorrect = outcomes.filter((outcome) => outcome.prompted && outcome.correct).length;
        const errors = outcomes.filter((outcome) => outcome.error).length;
        const correct = outcomes.filter((outcome) => outcome.correct).length;
        const mastery = masteryByName.get(targetName.toLowerCase());
        const masteryStatus = trials.length === 0
          ? 'dados insuficientes'
          : String(mastery?.status || '').toLowerCase().includes('atingido')
            ? 'critério atingido hoje'
            : 'critério não atingido';
        return {
          targetId: isTechnicalId(targetId) ? undefined : targetId,
          targetName: safeDisplayValue(targetName, 'Meta sem nome'),
          program: safeDisplayValue(valueOf(trials[0], 'programName', 'program_name', 'programTitle', 'program_title', 'domainName', 'domain_name'), 'Nao informado'),
          totalTrials: trials.length,
          independentCorrect,
          promptedCorrect,
          errors,
          accuracyPercent: percent(correct, trials.length),
          independencePercent: calculateTrialIndependence(trials),
          mostUsedTrialType: mostUsed(trials.map(trialTypeOf)),
          masteryStatus: masteryStatus as SessionReport['targetSummaries'][number]['masteryStatus']
        };
      })
    : (sessionSummary.masterySummary || []).map((item) => ({
        targetId: isTechnicalId(item.id) ? undefined : item.id,
        targetName: safeDisplayValue(item.name, 'Meta sem nome'),
        program: 'Nao informado',
        totalTrials: 0,
        independentCorrect: Number(item.independentTrials || 0),
        promptedCorrect: 0,
        errors: 0,
        accuracyPercent: 0,
        independencePercent: 0,
        mostUsedTrialType: 'Não informado',
        masteryStatus: (String(item.status || '').toLowerCase().includes('atingido')
          ? 'critério atingido hoje'
          : 'dados insuficientes') as SessionReport['targetSummaries'][number]['masteryStatus']
      }));

  const frequencyGroups = new Map<string, any[]>();
  const durationGroups = new Map<string, any[]>();
  const intervalGroups = new Map<string, any[]>();
  for (const record of effectiveBehaviorRecords) {
    const measurementType = measurementTypeOf(record);
    const behaviorName = behaviorNameOf(record);
    if (measurementType === 'frequency' || measurementType === 'rate') {
      frequencyGroups.set(behaviorName, [...(frequencyGroups.get(behaviorName) || []), record]);
    } else if (measurementType === 'duration' && isCompletedDurationEvent(record)) {
      durationGroups.set(behaviorName, [...(durationGroups.get(behaviorName) || []), record]);
    } else if (intervalMethods.has(measurementType)) {
      const key = `${behaviorName}:${measurementType}`;
      intervalGroups.set(key, [...(intervalGroups.get(key) || []), record]);
    }
  }

  const frequency = frequencyGroups.size > 0
    ? Array.from(frequencyGroups.entries()).map(([behavior, events]) => ({
        behavior,
        totalOccurrences: events.reduce((sum, event) => sum + Math.max(1, safeNumber(valueOf(event, 'countDelta', 'count_delta'), 1)), 0),
        locations: uniqueStrings(events.map((event) => valueOf(event, 'location'))),
        averageSeverity: averageOrNull(events.map((event) => valueOf(event, 'severity'))),
        occurrenceTimes: uniqueStrings(events.map((event) => formatReportTime(valueOf(event, 'timestamp', 'occurredAt', 'occurred_at'))))
      }))
    : sessionSummary.frequencySummary.map((item) => ({
        behavior: item.behaviorName,
        totalOccurrences: item.occurrences,
        locations: [],
        averageSeverity: null,
        occurrenceTimes: []
      }));

  const duration = durationGroups.size > 0
    ? Array.from(durationGroups.entries()).map(([behavior, events]) => {
        const durations = events.map((event) => Math.max(0, safeNumber(valueOf(event, 'durationSeconds', 'duration_seconds'), 0)));
        const totalSeconds = durations.reduce((sum, value) => sum + value, 0);
        return {
          behavior,
          episodes: events.length,
          totalSeconds,
          averageSeconds: events.length > 0 ? Math.round(totalSeconds / events.length) : 0,
          maxSeconds: durations.length > 0 ? Math.max(...durations) : 0,
          locations: uniqueStrings(events.map((event) => valueOf(event, 'location'))),
          averageSeverity: averageOrNull(events.map((event) => valueOf(event, 'severity')))
        };
      })
    : sessionSummary.durationSummary.map((item) => ({
        behavior: item.behaviorName,
        episodes: item.episodes,
        totalSeconds: item.totalSeconds,
        averageSeconds: item.averageSeconds,
        maxSeconds: item.maxSeconds,
        locations: [],
        averageSeverity: null
      }));

  const interval = intervalGroups.size > 0
    ? Array.from(intervalGroups.entries()).map(([, events]) => {
        const first = events[0] || {};
        const method = measurementTypeOf(first);
        const aggregate = events.find((event) => isIntervalAggregate(event));
        const rawPayload = valueOf(aggregate || first, 'raw_payload', 'rawPayload') || {};
        const totalIntervals = aggregate
          ? Math.max(0, safeNumber(
              valueOf(aggregate, 'answeredIntervals', 'answered_intervals') ??
              valueOf(aggregate, 'totalIntervals', 'total_intervals') ??
              rawPayload.answeredIntervals ??
              rawPayload.totalIntervals,
              0
            ))
          : events.length;
        const plannedIntervals = aggregate
          ? Math.max(totalIntervals, safeNumber(
              valueOf(aggregate, 'plannedIntervals', 'planned_intervals') ??
              rawPayload.plannedIntervals ??
              rawPayload.plannedTotalIntervals ??
              totalIntervals,
              totalIntervals
            ))
          : totalIntervals;
        const yes = aggregate
          ? Math.max(0, safeNumber(
              valueOf(aggregate, 'yesCount', 'yes_count', 'occurredCount') ??
              rawPayload.yesCount ??
              rawPayload.occurredCount,
              0
            ))
          : events.filter((event) => Boolean(valueOf(event, 'intervalOccurred', 'interval_occurred', 'occurred'))).length;
        const no = Math.max(0, totalIntervals - yes);
        return {
          behavior: behaviorNameOf(first),
          method,
          totalIntervals,
          plannedIntervals,
          answeredIntervals: totalIntervals,
          yes,
          no,
          occurrencePercent: percent(yes, totalIntervals),
          intervalSeconds: safeNumber(valueOf(first, 'intervalSeconds') ?? rawPayload.intervalSeconds, NaN) || null,
          location: String(valueOf(first, 'location') || rawPayload.location || 'Não informado'),
          averageSeverity: averageOrNull(events.map((event) => valueOf(event, 'severity'))),
          status: aggregate ? intervalCollectionStatusOf(aggregate) || (totalIntervals < plannedIntervals ? 'PARTIALLY_COMPLETED' : 'COMPLETED') : undefined
        };
      })
    : sessionSummary.intervalSummary.map((item) => ({
        behavior: item.behaviorName,
        method: item.method,
        totalIntervals: item.totalIntervals,
        plannedIntervals: item.plannedIntervals,
        answeredIntervals: item.answeredIntervals,
        yes: item.occurredCount,
        no: item.notOccurredCount,
        occurrencePercent: item.occurrencePercent,
        intervalSeconds: null,
        location: 'Não informado',
        averageSeverity: null,
        status: item.status
      }));

  const hasAbc = hasAbcFields;
  const abcEvents = effectiveBehaviorRecords
    .filter((record) => measurementTypeOf(record) === 'abc' || hasAbc(record))
    .map((record) => ({
      antecedent: String(valueOf(record, 'antecedent') || ''),
      behavior: behaviorNameOf(record),
      consequence: String(valueOf(record, 'consequence') || ''),
      location: String(valueOf(record, 'location') || ''),
      severity: valueOf(record, 'severity') !== undefined ? safeNumber(valueOf(record, 'severity'), 0) : null,
      note: String(valueOf(record, 'notes', 'note') || '')
    }));
  const abcEventsWithFallback = abcEvents.length > 0
    ? abcEvents
    : (sessionSummary.abcSummary || [])
        .filter((item) => Number(item.completedEvents || 0) > 0)
        .map((item) => ({
          antecedent: '',
          behavior: item.behaviorName,
          consequence: '',
          location: item.locations.join(', '),
          severity: item.averageSeverity,
          note: `${item.completedEvents} ABC(s) preenchido(s)`
        }));
  const abcMissingFromRecords = effectiveBehaviorRecords.filter((record) => (
    measurementTypeOf(record) !== 'abc' &&
    !isIntervalAggregate(record) &&
    !hasAbc(record)
  )).length;
  const abcMissingFromSummary = (sessionSummary.abcSummary || [])
    .reduce((sum, item) => sum + Math.max(0, Number(item.missingEvents || 0)), 0);
  const abcMissingFromWarnings = (sessionSummary.warningItems || [])
    .filter((item) => String(item.key || '').includes('abc_missing'))
    .reduce((sum, item) => sum + Math.max(1, Number(item.count || 1)), 0);
  const abcPendingCount = abcMissingFromRecords || abcMissingFromSummary || abcMissingFromWarnings;
  const unsyncedCount = sourceRecords.filter((record) => {
    const status = String(valueOf(record, 'syncStatus', 'sync_status') || '').toLowerCase();
    return status === 'local' || status === 'syncing' || status === 'error';
  }).length || (sessionSummary.warningItems || [])
    .filter((item) => String(item.key || '').includes('sync'))
    .reduce((sum, item) => sum + Math.max(1, Number(item.count || 1)), 0);
  const guardianSignature = (sessionSummary.warningItems || []).some((item) => item.key === 'guardian_signature_pending')
    ? 'pending'
    : 'completed';
  const pendingItems = [
    ...(sessionSummary.blockingItems || []),
    ...(sessionSummary.warningItems || [])
  ];
  if (abcPendingCount > 0 && !pendingItems.some((item) => String(item.key || '').includes('abc_missing'))) {
    pendingItems.push({ key: 'abc_missing', label: `${abcPendingCount} ABC(s) pendente(s)`, category: 'warning', count: abcPendingCount });
  }

  return {
    header: {
      patient: formatPatientLabel({ name: sessionSummary.patientName, patientName: sessionSummary.patientName, id: sessionSummary.patientId }),
      therapist: formatTherapistLabel({ name: sessionSummary.therapistName, therapistName: sessionSummary.therapistName, id: sessionSummary.therapistId }),
      date: formatReportDate(sessionSummary.startedAt),
      startedAt: formatReportTime(sessionSummary.startedAt),
      endedAt: formatReportTime(sessionSummary.endedAt),
      duration: formatReportDuration(sessionSummary.durationSeconds),
      durationSeconds: sessionSummary.durationSeconds,
      status: 'concluida',
      syncStatus: sessionSummary.syncStatus
    },
    generalSummary: {
      totalTeachingTrials: sessionSummary.totalTrials,
      totalBehaviorRecords: sessionSummary.totalBehaviorEvents,
      totalFrequencyEvents: effectiveBehaviorRecords.length > 0
        ? effectiveBehaviorRecords.filter((record) => measurementTypeOf(record) === 'frequency' || measurementTypeOf(record) === 'rate').length
        : sessionSummary.frequencySummary.reduce((sum, item) => sum + item.occurrences, 0),
      totalDurationEvents: effectiveBehaviorRecords.length > 0
        ? effectiveBehaviorRecords.filter((record) => isCompletedDurationEvent(record)).length
        : sessionSummary.durationSummary.reduce((sum, item) => sum + item.episodes, 0),
      totalIntervalCollections: interval.length,
      sessionNote: sessionSummary.sessionNote || ''
    },
    teachingSummary: {
      ...teachingSummaryBase,
      correctTrials,
      typesUsed: Array.from(typeCounts.entries()).map(([key, count]) => ({
        key,
        label: collectionTypeLabels[key] || key,
        count
      })),
      promptsUsed: Array.from(promptCounts.entries())
        .filter(([key]) => key !== 'independent' && key !== 'error')
        .map(([key, count]) => ({
          key,
          label: String(promptLabelsByKey.get(key) || promptTypeLabels[key] || key),
          count
        }))
    },
    targetSummaries,
    behaviorSummaries: {
      frequency,
      duration,
      interval
    },
    abcEvents: abcEventsWithFallback,
    pendingComplements: {
      guardianSignature,
      sessionNote: sessionSummary.sessionNote?.trim() ? 'completed' : 'pending',
      abcPendingCount,
      unsyncedCount,
      items: pendingItems
    }
  };
};

export const canCloseAbaSession = (input: {
  openDurations?: any[];
  intervalRun?: any;
  unsavedLocalCount?: number;
  incompleteTrial?: boolean;
}) => ({
  canClose: !(
    input.openDurations?.length ||
    isActiveIntervalCollection(input.intervalRun) ||
    input.unsavedLocalCount ||
    input.incompleteTrial
  ),
  blockers: [
    ...(input.openDurations?.length ? [{ key: 'open_duration', label: 'Há eventos de duração em andamento', blocking: true, category: 'blocker' as const, count: input.openDurations.length }] : []),
    ...(isActiveIntervalCollection(input.intervalRun) ? [{ key: 'open_interval_collection', label: 'Há uma coleta por intervalo em andamento', blocking: true, category: 'blocker' as const, count: 1 }] : []),
    ...(input.unsavedLocalCount ? [{ key: 'unsaved_local_records', label: `${input.unsavedLocalCount} dado(s) não salvo(s) localmente`, blocking: true, category: 'blocker' as const, count: input.unsavedLocalCount }] : []),
    ...(input.incompleteTrial ? [{ key: 'incomplete_trial', label: 'Há uma tentativa de ensino incompleta', blocking: true, category: 'blocker' as const, count: 1 }] : [])
  ] as SessionSummaryPendingItem[]
});

export const canRecordInAbaSession = (input: {
  sessionCompleted?: boolean;
  status?: string | null;
}) => !input.sessionCompleted && String(input.status || '').toLowerCase() !== 'completed';
