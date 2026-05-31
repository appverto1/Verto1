export type AbaMasteryStatus =
  | 'INSUFFICIENT_DATA'
  | 'NOT_MET'
  | 'MET_TODAY'
  | 'READY_FOR_REVIEW'
  | 'MASTERED_APPROVED'
  | 'REGRESSION_RISK';

export type AbaTargetClinicalStatus =
  | 'ACQUISITION'
  | 'READY_FOR_REVIEW'
  | 'MASTERED'
  | 'MAINTENANCE'
  | 'REGRESSION_RISK'
  | 'REGRESSION_CONFIRMED';

export type AbaMaintenanceScheduleStatus =
  | 'PENDING'
  | 'PENDING_NEXT_SESSION'
  | 'PENDING_CONFIRMATION'
  | 'PENDING_LINK'
  | 'PENDING_SCHEDULING'
  | 'SCHEDULED'
  | 'UNSCHEDULED'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'MISSED'
  | 'CANCELLED';

export type AbaMaintenanceProbeStatus = 'MAINTAINED' | 'WATCH' | 'REGRESSION_RISK';

export type AbaMasteryReason = {
  code: string;
  message: string;
};

export type AbaMasteryCriterion = {
  id?: string | null;
  organizationId?: string | null;
  programId?: string | null;
  targetId?: string | null;
  name: string;
  minAccuracyPercent: number;
  minIndependencePercent: number;
  minTrialsPerSession: number;
  minConsecutiveDays: number;
  requireFirstTrialIndependent: boolean;
  coldProbeOnly: boolean;
  minDistinctTherapists: number;
  maintenanceRequired: boolean;
  maintenanceDays?: any;
  isActive: boolean;
};

export type AbaMasteryEvaluationResult = {
  id?: string;
  organizationId: string;
  patientId: string;
  sessionId: string;
  targetId: string;
  targetName: string;
  criteriaId: string | null;
  criteriaName: string;
  evaluatedAt: string;
  totalTrials: number;
  independentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  firstTrialIndependent: boolean | null;
  coldProbeTrialsCount: number;
  distinctTherapistsCount: number;
  consecutiveSuccessfulDays: number;
  status: AbaMasteryStatus;
  reasons: AbaMasteryReason[];
  suggestedPhase: 'teaching' | 'maintenance' | 'mastered';
  criterionLabel: string;
  performanceText: string;
};

export type EvaluateTargetMasteryInput = {
  organizationId: string;
  patientId: string;
  targetId: string;
  targetName?: string;
  sessionId: string;
  criteria?: any | null;
  trials?: any[];
  previousEvaluations?: any[];
  evaluatedAt?: string;
};

export type AbaMaintenanceSchedule = {
  id: string;
  organization_id: string;
  clinic_id?: string | null;
  patient_id: string;
  target_id: string;
  mastery_evaluation_id: string;
  schedule_day: number;
  target_due_date: string;
  scheduled_for: string | null;
  appointment_id?: string | null;
  schedule_mode?: 'DEFAULT_SEQUENCE' | 'CUSTOM_DATE' | 'NEXT_PATIENT_SESSION' | 'NEXT_AVAILABLE_SESSION';
  window_start?: string | null;
  window_end?: string | null;
  status: AbaMaintenanceScheduleStatus;
  completed_at: string | null;
  created_at: string;
  updated_at?: string;
};

export type AbaMaintenanceEvaluationResult = {
  id?: string;
  organizationId: string;
  patientId: string;
  sessionId: string | null;
  targetId: string;
  targetName: string;
  maintenanceScheduleId: string | null;
  occurredAt: string;
  totalTrials: number;
  independentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  minAccuracyPercent: number;
  minIndependencePercent: number;
  status: AbaMaintenanceProbeStatus;
  consecutiveFailureCount: number;
  reasons: AbaMasteryReason[];
  performanceText: string;
  shouldCreateRegressionAlert: boolean;
  suggestedClinicalStatus: AbaTargetClinicalStatus;
};

export type EvaluateMaintenanceStatusInput = {
  organizationId: string;
  patientId: string;
  targetId: string;
  targetName?: string;
  sessionId?: string | null;
  maintenanceScheduleId?: string | null;
  criteria?: any | null;
  trials?: any[];
  previousProbeResults?: any[];
  occurredAt?: string;
};

const SUCCESSFUL_STATUSES = new Set<AbaMasteryStatus | string>([
  'MET_TODAY',
  'READY_FOR_REVIEW',
  'MASTERED_APPROVED',
  'met',
  'mastered'
]);

const MAINTENANCE_FAILURE_STATUSES = new Set<string>(['WATCH', 'REGRESSION_RISK']);
export const DEFAULT_ABA_MAINTENANCE_DAYS = [7, 14, 30, 60];

const readValue = (row: any, ...keys: string[]) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  }
  return undefined;
};

const safeNumber = (value: any, fallback: number, min = 0, max = 100000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const safeBoolean = (value: any, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'sim'].includes(value.toLowerCase());
  if (typeof value === 'number') return value === 1;
  return fallback;
};

const isoOrNow = (value: any) => {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const dayKey = (value: any) => isoOrNow(value).slice(0, 10);

const previousDay = (dateKey: string) => {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

const addDaysIso = (value: any, days: number) => {
  const date = new Date(isoOrNow(value));
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.round(Number(days) || 0)));
  return date.toISOString();
};

const normalizeMaintenanceDayList = (value: any): number[] => {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(',').map((item) => item.trim());
    }
  }
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    raw = readValue(raw, 'days', 'maintenanceDays', 'maintenance_days', 'scheduleDays');
  }
  const days = (Array.isArray(raw) ? raw : DEFAULT_ABA_MAINTENANCE_DAYS)
    .map((item) => Math.round(safeNumber(item, 0, 1, 3650)))
    .filter((item) => item > 0);
  return Array.from(new Set(days)).sort((a, b) => a - b);
};

const maintenanceCriterionOrDefault = (criteria: any | null | undefined): AbaMasteryCriterion => {
  const normalized = normalizeAbaMasteryCriterion(criteria);
  if (normalized) return normalized;
  return {
    id: null,
    organizationId: null,
    programId: null,
    targetId: null,
    name: 'Criterio de manutencao',
    minAccuracyPercent: 80,
    minIndependencePercent: 80,
    minTrialsPerSession: 1,
    minConsecutiveDays: 1,
    requireFirstTrialIndependent: false,
    coldProbeOnly: false,
    minDistinctTherapists: 1,
    maintenanceRequired: true,
    maintenanceDays: DEFAULT_ABA_MAINTENANCE_DAYS,
    isActive: true
  };
};

const countConsecutiveMaintenanceFailures = (currentStatus: AbaMaintenanceProbeStatus, previousProbeResults: any[]) => {
  if (!MAINTENANCE_FAILURE_STATUSES.has(currentStatus)) return 0;
  const sorted = (Array.isArray(previousProbeResults) ? previousProbeResults : [])
    .slice()
    .sort((a, b) => new Date(readValue(b, 'occurred_at', 'occurredAt', 'created_at', 'createdAt') || 0).getTime() - new Date(readValue(a, 'occurred_at', 'occurredAt', 'created_at', 'createdAt') || 0).getTime());
  let count = 1;
  for (const result of sorted) {
    const status = String(readValue(result, 'status') || '').toUpperCase();
    if (!MAINTENANCE_FAILURE_STATUSES.has(status)) break;
    count += 1;
  }
  return count;
};

export function normalizeAbaMasteryCriterion(row: any | null | undefined): AbaMasteryCriterion | null {
  if (!row) return null;
  const isActive = safeBoolean(readValue(row, 'is_active', 'isActive'), true);
  if (!isActive) return null;
  const name = String(readValue(row, 'name') || 'Criterio de maestria').trim();
  return {
    id: String(readValue(row, 'id') || '').trim() || null,
    organizationId: String(readValue(row, 'organization_id', 'organizationId') || '').trim() || null,
    programId: String(readValue(row, 'program_id', 'programId') || '').trim() || null,
    targetId: String(readValue(row, 'target_id', 'targetId') || '').trim() || null,
    name,
    minAccuracyPercent: safeNumber(readValue(row, 'min_accuracy_percent', 'minAccuracyPercent'), 80, 0, 100),
    minIndependencePercent: safeNumber(readValue(row, 'min_independence_percent', 'minIndependencePercent'), 80, 0, 100),
    minTrialsPerSession: Math.max(1, Math.round(safeNumber(readValue(row, 'min_trials_per_session', 'minTrialsPerSession'), 3, 1, 100000))),
    minConsecutiveDays: Math.max(1, Math.round(safeNumber(readValue(row, 'min_consecutive_days', 'minConsecutiveDays'), 1, 1, 3650))),
    requireFirstTrialIndependent: safeBoolean(readValue(row, 'require_first_trial_independent', 'requireFirstTrialIndependent'), false),
    coldProbeOnly: safeBoolean(readValue(row, 'cold_probe_only', 'coldProbeOnly'), false),
    minDistinctTherapists: Math.max(1, Math.round(safeNumber(readValue(row, 'min_distinct_therapists', 'minDistinctTherapists'), 1, 1, 1000))),
    maintenanceRequired: safeBoolean(readValue(row, 'maintenance_required', 'maintenanceRequired'), false),
    maintenanceDays: readValue(row, 'maintenance_days', 'maintenanceDays') ?? null,
    isActive
  };
}

export function formatAbaMasteryCriterion(criterion: AbaMasteryCriterion | null): string {
  if (!criterion) return 'Criterio nao configurado';
  const parts = [
    `${criterion.minAccuracyPercent}% acuracia`,
    `${criterion.minIndependencePercent}% independencia`,
    `${criterion.minTrialsPerSession} tentativa(s)/sessao`,
    `${criterion.minConsecutiveDays} dia(s)`
  ];
  if (criterion.requireFirstTrialIndependent) parts.push('1a tentativa independente');
  if (criterion.coldProbeOnly) parts.push('Cold Probe');
  if (criterion.minDistinctTherapists > 1) parts.push(`${criterion.minDistinctTherapists} terapeutas`);
  return parts.join(' - ');
}

const normalizeCollectionType = (trial: any) =>
  String(readValue(trial, 'collection_type', 'collectionType', 'trial_type', 'trialType') || 'dtt').toLowerCase();

const isTrialIndependent = (trial: any) => {
  const outcome = String(readValue(trial, 'trialOutcome', 'trial_outcome') || '').toLowerCase();
  const prompt = String(readValue(trial, 'prompt_level_key', 'promptLevelKey', 'promptLevel') || '').toLowerCase();
  return Boolean(readValue(trial, 'independent', 'isIndependent')) || outcome === 'independent' || prompt === 'independent';
};

const isTrialCorrect = (trial: any) => {
  if (typeof readValue(trial, 'correct', 'isCorrect') === 'boolean') return Boolean(readValue(trial, 'correct', 'isCorrect'));
  const outcome = String(readValue(trial, 'trialOutcome', 'trial_outcome') || '').toLowerCase();
  if (outcome === 'independent' || outcome === 'prompted') return true;
  if (outcome === 'error') return false;
  return safeNumber(readValue(trial, 'response_score', 'responseScore', 'score'), 0, -100000, 100000) > 0;
};

const trialTimestamp = (trial: any) => isoOrNow(readValue(trial, 'occurred_at', 'occurredAt', 'timestamp', 'created_at', 'createdAt'));

const trialTherapist = (trial: any) => String(readValue(trial, 'therapist_id', 'therapistId') || '').trim();

const isSuccessfulEvaluation = (evaluation: any) => {
  const status = String(readValue(evaluation, 'status', 'evaluationStatus', 'evaluation_status') || '').trim();
  return SUCCESSFUL_STATUSES.has(status);
};

function countConsecutiveSuccessfulDays(evaluatedAt: string, metToday: boolean, previousEvaluations: any[]) {
  if (!metToday) return 0;
  const successfulDays = new Set(
    previousEvaluations
      .filter(isSuccessfulEvaluation)
      .map((evaluation) => dayKey(readValue(evaluation, 'evaluated_at', 'evaluatedAt', 'created_at', 'createdAt')))
  );

  let count = 1;
  let cursor = previousDay(dayKey(evaluatedAt));
  while (successfulDays.has(cursor)) {
    count += 1;
    cursor = previousDay(cursor);
  }
  return count;
}

export function evaluateTargetMastery(input: EvaluateTargetMasteryInput): AbaMasteryEvaluationResult {
  const evaluatedAt = isoOrNow(input.evaluatedAt);
  const targetName = String(input.targetName || input.targetId || 'Meta').trim();
  const criterion = normalizeAbaMasteryCriterion(input.criteria);
  const base = {
    organizationId: input.organizationId,
    patientId: input.patientId,
    sessionId: input.sessionId,
    targetId: input.targetId,
    targetName,
    criteriaId: criterion?.id || null,
    criteriaName: criterion?.name || '',
    evaluatedAt
  };

  if (!criterion) {
    return {
      ...base,
      totalTrials: 0,
      independentTrials: 0,
      promptedTrials: 0,
      errorTrials: 0,
      accuracyPercent: 0,
      independencePercent: 0,
      firstTrialIndependent: null,
      coldProbeTrialsCount: 0,
      distinctTherapistsCount: 0,
      consecutiveSuccessfulDays: 0,
      status: 'INSUFFICIENT_DATA',
      reasons: [{ code: 'NO_CRITERIA', message: 'Nenhum criterio ativo encontrado para esta meta ou programa.' }],
      suggestedPhase: 'teaching',
      criterionLabel: 'Criterio nao configurado',
      performanceText: '0/0 tentativas'
    };
  }

  const allTrials = Array.isArray(input.trials) ? input.trials : [];
  const coldProbeTrialsCount = allTrials.filter((trial) => normalizeCollectionType(trial) === 'cold_probe').length;
  const consideredTrials = (criterion.coldProbeOnly
    ? allTrials.filter((trial) => normalizeCollectionType(trial) === 'cold_probe')
    : allTrials
  ).sort((a, b) => new Date(trialTimestamp(a)).getTime() - new Date(trialTimestamp(b)).getTime());

  const totalTrials = consideredTrials.length;
  const independentTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && isTrialIndependent(trial)).length;
  const promptedTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && !isTrialIndependent(trial)).length;
  const errorTrials = consideredTrials.filter((trial) => !isTrialCorrect(trial)).length;
  const accuracyPercent = percent(independentTrials + promptedTrials, totalTrials);
  const independencePercent = percent(independentTrials, totalTrials);
  const firstTrialIndependent = totalTrials > 0 ? isTrialCorrect(consideredTrials[0]) && isTrialIndependent(consideredTrials[0]) : null;
  const therapistIds = new Set([
    ...consideredTrials.map(trialTherapist),
    ...(Array.isArray(input.previousEvaluations) ? input.previousEvaluations.filter(isSuccessfulEvaluation).map((evaluation) => String(readValue(evaluation, 'therapist_id', 'therapistId') || '').trim()) : [])
  ].filter(Boolean));
  const distinctTherapistsCount = therapistIds.size;
  const reasons: AbaMasteryReason[] = [];

  if (totalTrials === 0) {
    reasons.push({ code: criterion.coldProbeOnly ? 'NO_COLD_PROBE_TRIALS' : 'NO_VALID_TRIALS', message: criterion.coldProbeOnly ? 'Nenhuma tentativa Cold Probe valida foi registrada.' : 'Nenhuma tentativa valida foi registrada para esta meta.' });
  }
  if (totalTrials < criterion.minTrialsPerSession) {
    reasons.push({ code: 'MIN_TRIALS_NOT_MET', message: `${totalTrials}/${criterion.minTrialsPerSession} tentativas minimas na sessao.` });
  }
  if (criterion.coldProbeOnly && coldProbeTrialsCount < criterion.minTrialsPerSession) {
    reasons.push({ code: 'COLD_PROBE_MIN_TRIALS_NOT_MET', message: `${coldProbeTrialsCount}/${criterion.minTrialsPerSession} tentativas Cold Probe.` });
  }

  if (reasons.length > 0) {
    return {
      ...base,
      totalTrials,
      independentTrials,
      promptedTrials,
      errorTrials,
      accuracyPercent,
      independencePercent,
      firstTrialIndependent,
      coldProbeTrialsCount,
      distinctTherapistsCount,
      consecutiveSuccessfulDays: 0,
      status: 'INSUFFICIENT_DATA',
      reasons,
      suggestedPhase: 'teaching',
      criterionLabel: formatAbaMasteryCriterion(criterion),
      performanceText: `${independentTrials + promptedTrials}/${totalTrials} acertos`
    };
  }

  if (accuracyPercent < criterion.minAccuracyPercent) {
    reasons.push({ code: 'ACCURACY_BELOW_CRITERION', message: `${accuracyPercent}% acuracia; criterio ${criterion.minAccuracyPercent}%.` });
  }
  if (independencePercent < criterion.minIndependencePercent) {
    reasons.push({ code: 'INDEPENDENCE_BELOW_CRITERION', message: `${independencePercent}% independencia; criterio ${criterion.minIndependencePercent}%.` });
  }
  if (criterion.requireFirstTrialIndependent && !firstTrialIndependent) {
    reasons.push({ code: 'FIRST_TRIAL_NOT_INDEPENDENT', message: 'A primeira tentativa da sessao nao foi independente.' });
  }

  const metToday = reasons.length === 0;
  const consecutiveSuccessfulDays = countConsecutiveSuccessfulDays(evaluatedAt, metToday, input.previousEvaluations || []);
  if (metToday && consecutiveSuccessfulDays < criterion.minConsecutiveDays) {
    reasons.push({ code: 'CONSECUTIVE_DAYS_PENDING', message: `${consecutiveSuccessfulDays}/${criterion.minConsecutiveDays} dia(s) consecutivo(s).` });
  }
  if (metToday && distinctTherapistsCount < criterion.minDistinctTherapists) {
    reasons.push({ code: 'DISTINCT_THERAPISTS_PENDING', message: `${distinctTherapistsCount}/${criterion.minDistinctTherapists} terapeuta(s) distintos.` });
  }

  const readyForReview =
    metToday &&
    consecutiveSuccessfulDays >= criterion.minConsecutiveDays &&
    distinctTherapistsCount >= criterion.minDistinctTherapists;
  const status: AbaMasteryStatus = !metToday ? 'NOT_MET' : readyForReview ? 'READY_FOR_REVIEW' : 'MET_TODAY';

  return {
    ...base,
    totalTrials,
    independentTrials,
    promptedTrials,
    errorTrials,
    accuracyPercent,
    independencePercent,
    firstTrialIndependent,
    coldProbeTrialsCount,
    distinctTherapistsCount,
    consecutiveSuccessfulDays,
    status,
    reasons,
    suggestedPhase: status === 'READY_FOR_REVIEW' ? 'maintenance' : 'teaching',
    criterionLabel: formatAbaMasteryCriterion(criterion),
    performanceText: `${independentTrials + promptedTrials}/${totalTrials} acertos - ${independencePercent}% independencia`
  };
}

export function buildMaintenanceSchedulesForMasteryApproval(input: {
  organizationId: string;
  clinicId?: string | null;
  patientId: string;
  targetId: string;
  masteryEvaluationId: string;
  approvedAt?: string;
  maintenanceDays?: any;
  createdAt?: string;
}): AbaMaintenanceSchedule[] {
  const masteryEvaluationId = String(input.masteryEvaluationId || '').trim();
  if (!masteryEvaluationId) {
    throw new Error('A criacao de manutencao exige masteryEvaluationId para auditoria.');
  }
  const approvedAt = isoOrNow(input.approvedAt);
  const createdAt = isoOrNow(input.createdAt);
  const days = normalizeMaintenanceDayList(input.maintenanceDays);
  return days.map((day) => {
    const targetDueDate = addDaysIso(approvedAt, day);
    return {
      id: `maintenance-${input.targetId}-${masteryEvaluationId}-${day}`,
      organization_id: input.organizationId,
      clinic_id: input.clinicId || input.organizationId || null,
      patient_id: input.patientId,
      target_id: input.targetId,
      mastery_evaluation_id: masteryEvaluationId,
      schedule_day: day,
      target_due_date: targetDueDate,
      scheduled_for: null,
      appointment_id: null,
      schedule_mode: 'DEFAULT_SEQUENCE',
      window_start: null,
      window_end: null,
      status: 'PENDING_LINK',
      completed_at: null,
      created_at: createdAt,
      updated_at: createdAt
    };
  });
}

export function evaluateMaintenanceStatus(input: EvaluateMaintenanceStatusInput): AbaMaintenanceEvaluationResult {
  const occurredAt = isoOrNow(input.occurredAt);
  const targetName = String(input.targetName || input.targetId || 'Meta').trim();
  const criterion = maintenanceCriterionOrDefault(input.criteria);
  const allTrials = Array.isArray(input.trials) ? input.trials : [];
  const consideredTrials = allTrials
    .filter((trial) => normalizeCollectionType(trial) === 'maintenance_probe')
    .sort((a, b) => new Date(trialTimestamp(a)).getTime() - new Date(trialTimestamp(b)).getTime());

  const totalTrials = consideredTrials.length;
  const independentTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && isTrialIndependent(trial)).length;
  const promptedTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && !isTrialIndependent(trial)).length;
  const errorTrials = consideredTrials.filter((trial) => !isTrialCorrect(trial)).length;
  const accuracyPercent = percent(independentTrials + promptedTrials, totalTrials);
  const independencePercent = percent(independentTrials, totalTrials);
  const reasons: AbaMasteryReason[] = [];

  if (totalTrials === 0) {
    reasons.push({
      code: 'NO_MAINTENANCE_PROBES',
      message: 'Nenhuma tentativa Maintenance Probe valida foi registrada.'
    });
  }
  if (totalTrials < criterion.minTrialsPerSession) {
    reasons.push({
      code: 'MIN_MAINTENANCE_TRIALS_NOT_MET',
      message: `${totalTrials}/${criterion.minTrialsPerSession} maintenance probe(s) minimas.`
    });
  }

  const accuracyDrop = criterion.minAccuracyPercent - accuracyPercent;
  const independenceDrop = criterion.minIndependencePercent - independencePercent;
  if (accuracyDrop > 0) {
    reasons.push({
      code: 'MAINTENANCE_ACCURACY_BELOW_CRITERION',
      message: `${accuracyPercent}% acuracia; criterio ${criterion.minAccuracyPercent}%.`
    });
  }
  if (independenceDrop > 0) {
    reasons.push({
      code: 'MAINTENANCE_INDEPENDENCE_BELOW_CRITERION',
      message: `${independencePercent}% independencia; criterio ${criterion.minIndependencePercent}%.`
    });
  }

  const severeDrop = accuracyDrop >= 20 || independenceDrop >= 20;
  const belowCriterion = accuracyDrop > 0 || independenceDrop > 0;
  const status: AbaMaintenanceProbeStatus =
    totalTrials === 0 || totalTrials < criterion.minTrialsPerSession
      ? 'WATCH'
      : severeDrop
        ? 'REGRESSION_RISK'
        : belowCriterion
          ? 'WATCH'
          : 'MAINTAINED';
  const consecutiveFailureCount = countConsecutiveMaintenanceFailures(status, input.previousProbeResults || []);
  const shouldCreateRegressionAlert = status === 'REGRESSION_RISK' || consecutiveFailureCount >= 2;

  return {
    organizationId: input.organizationId,
    patientId: input.patientId,
    sessionId: input.sessionId || null,
    targetId: input.targetId,
    targetName,
    maintenanceScheduleId: input.maintenanceScheduleId || null,
    occurredAt,
    totalTrials,
    independentTrials,
    promptedTrials,
    errorTrials,
    accuracyPercent,
    independencePercent,
    minAccuracyPercent: criterion.minAccuracyPercent,
    minIndependencePercent: criterion.minIndependencePercent,
    status,
    consecutiveFailureCount,
    reasons,
    performanceText: `${independentTrials + promptedTrials}/${totalTrials} acertos - ${independencePercent}% independencia`,
    shouldCreateRegressionAlert,
    suggestedClinicalStatus: status === 'REGRESSION_RISK' ? 'REGRESSION_RISK' : 'MAINTENANCE'
  };
}

export function buildRegressionAlertFromMaintenanceResult(input: {
  result: AbaMaintenanceEvaluationResult;
  alertId?: string;
  createdAt?: string;
}) {
  const result = input.result;
  if (!result.shouldCreateRegressionAlert) return null;
  const severity =
    result.status === 'REGRESSION_RISK' && result.consecutiveFailureCount >= 2
      ? 'HIGH'
      : result.status === 'REGRESSION_RISK'
        ? 'MEDIUM'
        : 'LOW';
  const consecutiveText = result.consecutiveFailureCount >= 2
    ? `${result.consecutiveFailureCount} probes consecutivos abaixo do criterio`
    : 'Risco de regressao';
  return {
    id: input.alertId || `regression-alert-${result.targetId}-${result.occurredAt}`,
    organization_id: result.organizationId,
    patient_id: result.patientId,
    target_id: result.targetId,
    maintenance_probe_result_id: result.id || null,
    severity,
    message: `${consecutiveText}. Sugerir revisao humana antes de retorno para aquisicao.`,
    created_at: isoOrNow(input.createdAt),
    resolved_at: null,
    resolved_by: null
  };
}

export function buildTargetStatusAuditLog(input: {
  organizationId: string;
  patientId: string;
  targetId: string;
  previousStatus: string;
  newStatus: string;
  evaluationId: string;
  changedBy: string;
  reason: string;
  changedAt?: string;
}) {
  if (!input.evaluationId) {
    throw new Error('A aprovacao de maestria exige evaluationId para auditoria.');
  }
  return {
    id: `audit-${input.targetId}-${input.evaluationId}`,
    organization_id: input.organizationId,
    patient_id: input.patientId,
    target_id: input.targetId,
    previous_status: input.previousStatus,
    new_status: input.newStatus,
    evaluation_id: input.evaluationId,
    changed_by: input.changedBy,
    changed_at: isoOrNow(input.changedAt),
    reason: input.reason,
    created_at: new Date().toISOString()
  };
}
