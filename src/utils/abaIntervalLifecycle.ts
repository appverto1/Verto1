export const abaIntervalCollectionStatuses = [
  'RUNNING',
  'AWAITING_RESPONSE',
  'PAUSED',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED'
] as const;

export type AbaIntervalCollectionStatus = typeof abaIntervalCollectionStatuses[number];

export type AbaIntervalRunLike = {
  id?: string;
  behaviorName?: string;
  behaviorId?: string | null;
  measurementType?: string;
  method?: string;
  status?: string;
  collectionStatus?: string;
  startedAt?: string;
  intervalStartedAt?: string;
  intervalEndsAt?: string;
  intervalSeconds?: number;
  intervalIndex?: number;
  totalIntervals?: number;
  plannedIntervals?: number;
  completedCount?: number;
  answeredIntervals?: number;
  occurredCount?: number;
  yesCount?: number;
  awaitingResponse?: boolean;
  paused?: boolean;
  completed?: boolean;
  cancelledAt?: string | null;
  pausedAt?: string | null;
  resumedAt?: string | null;
  endedEarlyAt?: string | null;
  pauseRemainingMs?: number | null;
  [key: string]: any;
};

export type AbaIntervalAggregateLifecycleSummary = {
  status: AbaIntervalCollectionStatus;
  collectionStatus: AbaIntervalCollectionStatus;
  plannedIntervals: number;
  answeredIntervals: number;
  totalIntervals: number;
  yesCount: number;
  noCount: number;
  occurredCount: number;
  notOccurredCount: number;
  occurrencePercent: number;
  endedAt: string;
  endedEarlyAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string;
  endReason?: string;
};

const normalizeStatus = (value: any): AbaIntervalCollectionStatus | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'FINISHED_EARLY' || normalized === 'ENDED_EARLY') return 'PARTIALLY_COMPLETED';
  if (normalized === 'CANCELED') return 'CANCELLED';
  return abaIntervalCollectionStatuses.includes(normalized as AbaIntervalCollectionStatus)
    ? normalized as AbaIntervalCollectionStatus
    : null;
};

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const plannedIntervalsOf = (run: AbaIntervalRunLike) => Math.max(
  1,
  Math.floor(safeNumber(run.plannedIntervals ?? run.totalIntervals, 1))
);

const answeredIntervalsOf = (run: AbaIntervalRunLike) => Math.max(
  0,
  Math.floor(safeNumber(run.answeredIntervals ?? run.completedCount, 0))
);

const yesCountOf = (run: AbaIntervalRunLike) => Math.max(
  0,
  Math.floor(safeNumber(run.yesCount ?? run.occurredCount, 0))
);

export const getIntervalRunStatus = (run?: AbaIntervalRunLike | null): AbaIntervalCollectionStatus | null => {
  if (!run) return null;
  const explicit = normalizeStatus(run.status) || normalizeStatus(run.collectionStatus);
  if (explicit) return explicit;
  if (run.cancelledAt) return 'CANCELLED';
  if (run.completed) return answeredIntervalsOf(run) >= plannedIntervalsOf(run) ? 'COMPLETED' : 'PARTIALLY_COMPLETED';
  if (run.paused) return 'PAUSED';
  if (run.awaitingResponse) return 'AWAITING_RESPONSE';
  return 'RUNNING';
};

export const isActiveIntervalCollection = (run?: AbaIntervalRunLike | null) => {
  const status = getIntervalRunStatus(run);
  return status === 'RUNNING' || status === 'AWAITING_RESPONSE' || status === 'PAUSED';
};

export const pauseIntervalRunState = (
  run: AbaIntervalRunLike,
  options: { nowMs?: number; pausedAt?: string } = {}
) => {
  const currentStatus = getIntervalRunStatus(run);
  if (!run || currentStatus === 'COMPLETED' || currentStatus === 'PARTIALLY_COMPLETED' || currentStatus === 'CANCELLED') return run;
  const nowMs = options.nowMs ?? Date.now();
  const pausedAt = options.pausedAt || new Date(nowMs).toISOString();
  const endMs = Date.parse(String(run.intervalEndsAt || ''));
  const remainingMs = currentStatus === 'AWAITING_RESPONSE'
    ? 0
    : Math.max(0, (Number.isFinite(endMs) ? endMs : nowMs) - nowMs);
  return {
    ...run,
    status: 'PAUSED' as AbaIntervalCollectionStatus,
    collectionStatus: 'PAUSED' as AbaIntervalCollectionStatus,
    paused: true,
    awaitingResponse: false,
    pausedAt,
    pauseRemainingMs: remainingMs,
    pausedFromStatus: currentStatus
  };
};

export const resumeIntervalRunState = (
  run: AbaIntervalRunLike,
  options: { resumedAt?: string } = {}
) => {
  if (getIntervalRunStatus(run) !== 'PAUSED') return run;
  const resumedAt = options.resumedAt || new Date().toISOString();
  const fallbackMs = Math.max(1000, safeNumber(run.intervalSeconds, 1) * 1000);
  const remainingMs = Math.max(1000, safeNumber(run.pauseRemainingMs, fallbackMs));
  return {
    ...run,
    status: 'RUNNING' as AbaIntervalCollectionStatus,
    collectionStatus: 'RUNNING' as AbaIntervalCollectionStatus,
    paused: false,
    awaitingResponse: false,
    resumedAt,
    intervalEndsAt: new Date(new Date(resumedAt).getTime() + remainingMs).toISOString(),
    pauseRemainingMs: null
  };
};

export const buildIntervalAggregateSummary = (
  run: AbaIntervalRunLike,
  options: {
    answeredIntervals?: number;
    yesCount?: number;
    endedAt?: string;
    status?: AbaIntervalCollectionStatus;
    endReason?: string;
  } = {}
): AbaIntervalAggregateLifecycleSummary => {
  const plannedIntervals = plannedIntervalsOf(run);
  const answeredIntervals = Math.min(
    plannedIntervals,
    Math.max(0, Math.floor(safeNumber(options.answeredIntervals ?? run.answeredIntervals ?? run.completedCount, 0)))
  );
  const yesCount = Math.min(
    answeredIntervals,
    Math.max(0, Math.floor(safeNumber(options.yesCount ?? run.yesCount ?? run.occurredCount, 0)))
  );
  const noCount = Math.max(0, answeredIntervals - yesCount);
  const occurrencePercent = answeredIntervals > 0 ? Math.round((yesCount / answeredIntervals) * 100) : 0;
  const status = options.status || (answeredIntervals >= plannedIntervals ? 'COMPLETED' : 'PARTIALLY_COMPLETED');
  const endedAt = options.endedAt || new Date().toISOString();

  return {
    status,
    collectionStatus: status,
    plannedIntervals,
    answeredIntervals,
    totalIntervals: answeredIntervals,
    yesCount,
    noCount,
    occurredCount: yesCount,
    notOccurredCount: noCount,
    occurrencePercent,
    endedAt,
    endedEarlyAt: status === 'PARTIALLY_COMPLETED' ? endedAt : null,
    endReason: options.endReason
  };
};

export const buildIntervalCancelAudit = (
  run: AbaIntervalRunLike,
  options: {
    cancelledAt?: string;
    cancelledBy?: string | null;
    cancelReason?: string;
  } = {}
) => {
  const cancelledAt = options.cancelledAt || new Date().toISOString();
  const answeredIntervals = Math.min(plannedIntervalsOf(run), answeredIntervalsOf(run));
  const yesCount = Math.min(answeredIntervals, yesCountOf(run));
  const noCount = Math.max(0, answeredIntervals - yesCount);

  return {
    status: 'CANCELLED' as AbaIntervalCollectionStatus,
    collectionStatus: 'CANCELLED' as AbaIntervalCollectionStatus,
    plannedIntervals: plannedIntervalsOf(run),
    answeredIntervals,
    totalIntervals: answeredIntervals,
    yesCount,
    noCount,
    occurredCount: yesCount,
    notOccurredCount: noCount,
    occurrencePercent: answeredIntervals > 0 ? Math.round((yesCount / answeredIntervals) * 100) : 0,
    cancelledAt,
    cancelledBy: options.cancelledBy || null,
    cancelReason: options.cancelReason || ''
  };
};
