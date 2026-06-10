const PRESERVED_NON_TRAINING_STATUSES = new Set(['archived', 'deleted', 'inactive', 'cancelled', 'canceled']);
const PEI_MAINTENANCE_STATUS_VALUES = new Set([
  'completed',
  'complete',
  'concluido',
  'concluído',
  'acquired',
  'adquirido',
  'mastered',
  'masterizado',
  'mastered_approved',
  'maintenance',
  'manutencao',
  'manutenção',
  'maintained',
  'ready_for_maintenance',
  'ready_for_review',
  'regression_risk',
  'met',
  'met_today'
]);

const PEI_MAINTENANCE_FIELDS_TO_DELETE = [
  'maintenanceScheduleId',
  'maintenance_schedule_id',
  'maintenanceSchedule',
  'maintenance_schedule',
  'maintenanceSchedules',
  'maintenance_schedules',
  'maintenanceProbe',
  'maintenance_probe',
  'maintenanceProbes',
  'maintenance_probes',
  'nextMaintenanceProbe',
  'next_maintenance_probe',
  'activeMaintenanceSchedule',
  'active_maintenance_schedule',
  'maintenanceStatus',
  'maintenance_status',
  'maintenanceDays',
  'maintenance_days',
  'maintenanceRequired',
  'maintenance_required',
  'eligibleForMaintenance',
  'eligible_for_maintenance',
  'readyForMaintenance',
  'ready_for_maintenance',
  'isMaintained',
  'is_maintained',
  'isMaintenance',
  'is_maintenance',
  'isMastered',
  'is_mastered',
  'isAcquired',
  'is_acquired',
  'criteriaMet',
  'criterionMet',
  'masteryCriterionMet',
  'masteryMet',
  'masteredAt',
  'mastered_at',
  'acquiredAt',
  'acquired_at'
];

const PEI_ACQUISITION_FIELDS_TO_DELETE = [
  'isMastered',
  'is_mastered',
  'isAcquired',
  'is_acquired',
  'criteriaMet',
  'criterionMet',
  'masteryCriterionMet',
  'masteryMet',
  'masteredAt',
  'mastered_at',
  'acquiredAt',
  'acquired_at'
];

type PeiSessionProgressResetOptions = {
  clearMaintenance?: boolean;
};

const normalizePeiStatusAfterSessionReset = (status: unknown) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (PRESERVED_NON_TRAINING_STATUSES.has(normalized)) return status || 'not_started';
  if (normalized === 'not_started') return 'not_started';
  return 'in_progress';
};

const normalizeMaintenanceStatusValue = (value: unknown) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const isMaintenanceStatusValue = (value: unknown) =>
  PEI_MAINTENANCE_STATUS_VALUES.has(normalizeMaintenanceStatusValue(value));

const clearPeiAcquisitionData = (goal: any, resetAt: number) => {
  const nextGoal = {
    ...goal,
    progress: 0,
    progressPercent: 0,
    progress_percent: 0,
    masteryProgressPercent: 0,
    mastery_progress_percent: 0,
    criterionProgressCount: 0,
    criterion_progress_count: 0,
    consecutive_successes: 0,
    consecutiveSuccesses: 0,
    sessionMasteryClearedAt: resetAt,
    masteryClearedAt: resetAt,
    sessionRestorePreviousClinicalStatus: goal?.clinical_status ?? goal?.clinicalStatus ?? null,
    sessionRestorePreviousMasteryStatus: goal?.mastery_status ?? goal?.masteryStatus ?? goal?.evaluation_status ?? goal?.evaluationStatus ?? null
  };

  PEI_ACQUISITION_FIELDS_TO_DELETE.forEach((field) => {
    delete nextGoal[field];
  });

  const shouldResetClinicalStatus = (
    isMaintenanceStatusValue(goal?.clinical_status) ||
    isMaintenanceStatusValue(goal?.clinicalStatus) ||
    isMaintenanceStatusValue(goal?.status) ||
    isMaintenanceStatusValue(goal?.phase)
  );
  if (shouldResetClinicalStatus || 'clinical_status' in nextGoal) nextGoal.clinical_status = 'ACQUISITION';
  if (shouldResetClinicalStatus || 'clinicalStatus' in nextGoal) nextGoal.clinicalStatus = 'ACQUISITION';
  if (isMaintenanceStatusValue(goal?.phase)) nextGoal.phase = 'teaching';

  if (isMaintenanceStatusValue(goal?.mastery_status) || 'mastery_status' in nextGoal) nextGoal.mastery_status = null;
  if (isMaintenanceStatusValue(goal?.masteryStatus) || 'masteryStatus' in nextGoal) nextGoal.masteryStatus = null;
  if (isMaintenanceStatusValue(goal?.evaluation_status) || 'evaluation_status' in nextGoal) nextGoal.evaluation_status = null;
  if (isMaintenanceStatusValue(goal?.evaluationStatus) || 'evaluationStatus' in nextGoal) nextGoal.evaluationStatus = null;

  return nextGoal;
};

const clearPeiMaintenanceData = (goal: any, resetAt: number) => {
  const nextGoal = clearPeiAcquisitionData({
    ...goal,
    sessionMaintenanceClearedAt: resetAt,
    maintenanceClearedAt: resetAt,
    sessionRestorePreviousClinicalStatus: goal?.clinical_status ?? goal?.clinicalStatus ?? null,
    sessionRestorePreviousMasteryStatus: goal?.mastery_status ?? goal?.masteryStatus ?? goal?.evaluation_status ?? goal?.evaluationStatus ?? null
  }, resetAt);

  PEI_MAINTENANCE_FIELDS_TO_DELETE.forEach((field) => {
    delete nextGoal[field];
  });

  return nextGoal;
};

export const buildPeiSessionProgressReset = (
  pei: any[],
  resetAt: number,
  options: PeiSessionProgressResetOptions = {}
) => {
  const safeResetAt = Number.isFinite(Number(resetAt)) && Number(resetAt) > 0
    ? Math.floor(Number(resetAt))
    : Date.now();

  return (Array.isArray(pei) ? pei : []).map((goal: any) => {
    const resetGoal = clearPeiAcquisitionData({
      ...goal,
      progress: 0,
      progressResetAt: safeResetAt,
      sessionProgressResetAt: safeResetAt,
      masteryResetAt: safeResetAt,
      sessionRestorePreviousStatus: goal?.status || null,
      sessionRestorePreviousProgress: Number.isFinite(Number(goal?.progress)) ? Number(goal.progress) : null,
      status: normalizePeiStatusAfterSessionReset(goal?.status)
    }, safeResetAt);
    return options.clearMaintenance ? clearPeiMaintenanceData(resetGoal, safeResetAt) : resetGoal;
  });
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

export const getPeiClinicalRowMarker = (entry: any) => {
  const createdAt = new Date(
    entry?.created_at ||
    entry?.createdAt ||
    entry?.updated_at ||
    entry?.updatedAt ||
    entry?.occurred_at ||
    entry?.occurredAt ||
    entry?.evaluated_at ||
    entry?.evaluatedAt ||
    entry?.completed_at ||
    entry?.completedAt ||
    entry?.scheduled_for ||
    entry?.scheduledFor ||
    entry?.target_due_date ||
    entry?.targetDueDate ||
    entry?.date ||
    0
  ).getTime();
  return Number.isFinite(createdAt) ? createdAt : 0;
};

export const isPeiClinicalRowAfterProgressReset = (goal: any, row: any) => {
  const resetMarker = getPeiProgressResetMarker(goal);
  if (!resetMarker) return true;
  return getPeiClinicalRowMarker(row) > resetMarker;
};
