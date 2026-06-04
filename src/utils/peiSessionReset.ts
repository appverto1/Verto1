const PRESERVED_NON_TRAINING_STATUSES = new Set(['archived', 'deleted', 'inactive', 'cancelled', 'canceled']);

const normalizePeiStatusAfterSessionReset = (status: unknown) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (PRESERVED_NON_TRAINING_STATUSES.has(normalized)) return status || 'not_started';
  if (normalized === 'not_started') return 'not_started';
  return 'in_progress';
};

export const buildPeiSessionProgressReset = (pei: any[], resetAt: number) => {
  const safeResetAt = Number.isFinite(Number(resetAt)) && Number(resetAt) > 0
    ? Math.floor(Number(resetAt))
    : Date.now();

  return (Array.isArray(pei) ? pei : []).map((goal: any) => ({
    ...goal,
    progress: 0,
    progressResetAt: safeResetAt,
    sessionProgressResetAt: safeResetAt,
    masteryResetAt: safeResetAt,
    sessionRestorePreviousStatus: goal?.status || null,
    sessionRestorePreviousProgress: Number.isFinite(Number(goal?.progress)) ? Number(goal.progress) : null,
    status: normalizePeiStatusAfterSessionReset(goal?.status)
  }));
};

export const getPeiProgressResetMarker = (goal: any) => {
  const explicitReset = Number(
    goal?.sessionProgressResetAt ??
    goal?.progressResetAt ??
    goal?.masteryResetAt ??
    goal?.progress_reset_at
  );
  if (Number.isFinite(explicitReset) && explicitReset > 0) return explicitReset;
  const legacyGoalId = Number(goal?.id);
  return Number.isFinite(legacyGoalId) ? legacyGoalId : 0;
};

export const getPeiHistoryProgressMarker = (entry: any) => {
  const numericId = Number(entry?.id);
  if (Number.isFinite(numericId) && numericId > 0) return numericId;
  const createdAt = new Date(
    entry?.created_at ||
    entry?.createdAt ||
    entry?.occurred_at ||
    entry?.occurredAt ||
    entry?.timestamp ||
    entry?.date ||
    entry?.time ||
    0
  ).getTime();
  return Number.isFinite(createdAt) ? createdAt : 0;
};
