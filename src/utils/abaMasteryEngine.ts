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
  requiredIndependentCorrectTrials?: number | null;
  requiredConsecutiveIndependentCorrectTrials?: number | null;
  requiredCorrectTrials?: number | null;
  minAccuracyPercent?: number | null;
  minIndependencePercent?: number | null;
  minTrialsPerSession?: number | null;
  minTrialsPerSessionImplicit?: boolean;
  minConsecutiveDays: number;
  minConsecutiveDaysExplicit?: boolean;
  requireFirstTrialIndependent: boolean;
  coldProbeOnly: boolean;
  minDistinctTherapists: number;
  minDistinctTherapistsExplicit?: boolean;
  maintenanceRequired: boolean;
  maintenanceDays?: any;
  isActive: boolean;
  source?: string | null;
  sourceLabel?: string | null;
  masteryCriterionMode?: 'total_independent' | 'consecutive_independent' | 'custom';
  requiresConsecutiveSuccesses?: boolean;
  measure?: 'accuracy_percent' | 'independent_responses' | 'frequency' | 'duration_seconds' | 'latency_seconds' | 'steps_percent' | string | null;
  operator?: 'gte' | 'gt' | 'eq' | 'lte' | string | null;
  value?: number | null;
  requiredSessions?: number | null;
  sessionMode?: 'consecutive' | 'cumulative';
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
  consecutiveIndependentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  firstTrialIndependent: boolean | null;
  coldProbeTrialsCount: number;
  distinctTherapistsCount: number;
  consecutiveSuccessfulDays: number;
  successfulSessions: number;
  criterionProgressCount: number;
  criterionRequiredCount: number;
  criterionProgressLabel: string;
  criterionProgressKind: 'none' | 'total_independent' | 'consecutive_independent' | 'correct' | 'days' | 'sessions' | 'measurement';
  sequenceBrokenByLastTrial: boolean;
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
  consecutiveIndependentTrials: number;
  promptedTrials: number;
  errorTrials: number;
  accuracyPercent: number;
  independencePercent: number;
  minAccuracyPercent: number;
  minIndependencePercent: number;
  status: AbaMaintenanceProbeStatus;
  consecutiveFailureCount: number;
  criterionRequiredCount: number;
  criterionProgressLabel: string;
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

const positiveIntegerOrNull = (value: any, min = 1, max = 100000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < min) return null;
  return Math.min(max, rounded);
};

const boundedNumberOrNull = (value: any, min = 0, max = 100000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
};

const hasConfiguredValue = (row: any, ...keys: string[]) =>
  keys.some((key) => row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '');

const normalizeCriterionMode = (row: any): 'total_independent' | 'consecutive_independent' | 'custom' | null => {
  const raw = String(readValue(
    row,
    'mastery_criterion_mode',
    'masteryCriterionMode',
    'criterion_mode',
    'criterionMode',
    'type',
    'mode'
  ) || '').trim().toLowerCase();
  if (!raw) return null;
  const compact = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
  if (compact.includes('consecutive') || compact.includes('streak') || compact.includes('sequencia')) return 'consecutive_independent';
  if (compact.includes('total') || compact.includes('count') || compact.includes('independent_correct')) return 'total_independent';
  return 'custom';
};

const criterionRequiresConsecutiveSuccesses = (row: any) => {
  const explicit = readValue(
    row,
    'requires_consecutive_successes',
    'requiresConsecutiveSuccesses',
    'consecutive_required',
    'consecutiveRequired',
    'require_consecutive_successes',
    'requireConsecutiveSuccesses'
  );
  if (explicit !== undefined) return safeBoolean(explicit, false);
  return normalizeCriterionMode(row) === 'consecutive_independent';
};

const isConsecutiveIndependentCriterion = (criterion: AbaMasteryCriterion | null | undefined) =>
  Boolean(criterion?.requiredConsecutiveIndependentCorrectTrials);

export const abaMasteryCriterionSourceLabel = (criterion: any | null | undefined) => {
  if (!criterion) return 'Criterio de maestria nao configurado';
  const explicit = String(readValue(criterion, 'sourceLabel', 'source_label', 'originLabel', 'origin_label') || '').trim();
  if (explicit) return explicit;
  const source = String(readValue(criterion, 'source', 'criterionSource', 'criterion_source', 'origin') || '').trim().toLowerCase();
  if (['skill', 'target', 'target_specific', 'patient_pei', 'patient_pei_materialized', 'manual', 'individual'].includes(source)) {
    return 'Criterio da habilidade';
  }
  if (['protocol', 'program', 'program_inherited', 'protocol_inherited', 'inherited_protocol'].includes(source)) {
    return 'Criterio herdado do protocolo';
  }
  if (['clinic', 'clinic_default', 'default_clinic', 'organization_default'].includes(source)) {
    return 'Criterio padrao da clinica';
  }
  if (readValue(criterion, 'target_id', 'targetId')) return 'Criterio da habilidade';
  if (readValue(criterion, 'program_id', 'programId')) return 'Criterio herdado do protocolo';
  return 'Criterio da habilidade';
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
  if (normalized) {
    return {
      ...normalized,
      minAccuracyPercent: normalized.minAccuracyPercent ?? 80,
      minIndependencePercent: normalized.minIndependencePercent ?? 80,
      minTrialsPerSession: normalized.minTrialsPerSession ?? 1
    };
  }
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
  const masteryCriterionMode = normalizeCriterionMode(row);
  const requiredIndependentCorrectTrials = positiveIntegerOrNull(readValue(
    row,
    'required_independent_correct_trials',
    'requiredIndependentCorrectTrials',
    'min_independent_correct_trials',
    'minIndependentCorrectTrials',
    'independent_correct_trials_required',
    'independentCorrectTrialsRequired'
  ));
  const explicitConsecutiveIndependentCorrectTrials = positiveIntegerOrNull(readValue(
    row,
    'required_consecutive_independent_correct_trials',
    'requiredConsecutiveIndependentCorrectTrials',
    'min_consecutive_independent_correct_trials',
    'minConsecutiveIndependentCorrectTrials',
    'consecutive_independent_correct_trials_required',
    'consecutiveIndependentCorrectTrialsRequired'
  ));
  const legacyConsecutiveSuccessTarget = positiveIntegerOrNull(readValue(
    row,
    'min_consecutive_successes',
    'minConsecutiveSuccesses',
    'meta_sucessos',
    'metaSucessos',
    'mastery_target',
    'masteryTarget'
  ));
  const requiresConsecutiveSuccesses = Boolean(
    explicitConsecutiveIndependentCorrectTrials ||
      legacyConsecutiveSuccessTarget ||
      criterionRequiresConsecutiveSuccesses(row)
  );
  const requiredConsecutiveIndependentCorrectTrials =
    explicitConsecutiveIndependentCorrectTrials ||
    legacyConsecutiveSuccessTarget ||
    (requiresConsecutiveSuccesses ? requiredIndependentCorrectTrials : null);
  const requiredCorrectTrials = positiveIntegerOrNull(readValue(
    row,
    'required_correct_trials',
    'requiredCorrectTrials',
    'correct_trials_required',
    'correctTrialsRequired',
    'required_successes',
    'requiredSuccesses',
    'success_threshold',
    'successThreshold'
  ));
  const minAccuracyPercent = boundedNumberOrNull(readValue(
    row,
    'min_accuracy_percent',
    'minAccuracyPercent',
    'required_accuracy',
    'requiredAccuracy',
    'required_accuracy_percent',
    'requiredAccuracyPercent'
  ), 0, 100);
  const minIndependencePercent = boundedNumberOrNull(readValue(
    row,
    'min_independence_percent',
    'minIndependencePercent',
    'required_independence',
    'requiredIndependence',
    'required_independence_percent',
    'requiredIndependencePercent'
  ), 0, 100);

  const measure = String(readValue(row, 'measure', 'custom_measure', 'customMeasure') || '').trim().toLowerCase() || null;
  const operatorRaw = String(readValue(row, 'operator', 'comparison_operator', 'comparisonOperator') || 'gte').trim().toLowerCase();
  const operator = ['gte', 'gt', 'eq', 'lte'].includes(operatorRaw) ? operatorRaw : 'gte';
  const value = boundedNumberOrNull(readValue(row, 'value', 'criterion_value', 'criterionValue'), -100000, 100000);
  const requiredSessions = positiveIntegerOrNull(readValue(row, 'required_sessions', 'requiredSessions'), 1, 3650);
  const sessionMode = String(readValue(row, 'session_mode', 'sessionMode') || 'consecutive').trim().toLowerCase() === 'cumulative'
    ? 'cumulative'
    : 'consecutive';
  const explicitMinTrials = positiveIntegerOrNull(readValue(
    row,
    'min_trials_per_session',
    'minTrialsPerSession',
    'minimum_trials',
    'minimumTrials',
    'required_trials',
    'requiredTrials',
    'trials_required',
    'trialsRequired'
  ));
  const minTrialsPerSession = explicitMinTrials ?? requiredConsecutiveIndependentCorrectTrials ?? requiredIndependentCorrectTrials ?? requiredCorrectTrials ?? null;
  const minConsecutiveDays = positiveIntegerOrNull(readValue(row, 'min_consecutive_days', 'minConsecutiveDays'), 1, 3650) ?? 1;
  const minDistinctTherapists = positiveIntegerOrNull(readValue(row, 'min_distinct_therapists', 'minDistinctTherapists'), 1, 1000) ?? 1;
  const requireFirstTrialIndependent = safeBoolean(readValue(row, 'require_first_trial_independent', 'requireFirstTrialIndependent'), false);
  const coldProbeOnly = safeBoolean(readValue(row, 'cold_probe_only', 'coldProbeOnly'), false);
  const hasAnyCriterionConfig = Boolean(
    requiredConsecutiveIndependentCorrectTrials ||
      requiredIndependentCorrectTrials ||
      requiredCorrectTrials ||
      minAccuracyPercent !== null ||
      minIndependencePercent !== null ||
      (Boolean(measure) && value !== null) ||
      requiredSessions ||
      explicitMinTrials ||
      hasConfiguredValue(row, 'min_consecutive_days', 'minConsecutiveDays') ||
      requireFirstTrialIndependent ||
      coldProbeOnly ||
      (hasConfiguredValue(row, 'min_distinct_therapists', 'minDistinctTherapists') && minDistinctTherapists > 1)
  );
  if (!hasAnyCriterionConfig) return null;
  const source = String(readValue(row, 'source', 'criterionSource', 'criterion_source', 'origin') || '').trim() || null;
  const sourceLabel = abaMasteryCriterionSourceLabel({ ...row, source });
  return {
    id: String(readValue(row, 'id') || '').trim() || null,
    organizationId: String(readValue(row, 'organization_id', 'organizationId') || '').trim() || null,
    programId: String(readValue(row, 'program_id', 'programId') || '').trim() || null,
    targetId: String(readValue(row, 'target_id', 'targetId') || '').trim() || null,
    name,
    requiredIndependentCorrectTrials,
    requiredConsecutiveIndependentCorrectTrials,
    requiredCorrectTrials,
    minAccuracyPercent,
    minIndependencePercent,
    minTrialsPerSession,
    minTrialsPerSessionImplicit: explicitMinTrials === null && Boolean(minTrialsPerSession),
    minConsecutiveDays,
    minConsecutiveDaysExplicit: hasConfiguredValue(row, 'min_consecutive_days', 'minConsecutiveDays'),
    requireFirstTrialIndependent,
    coldProbeOnly,
    minDistinctTherapists,
    minDistinctTherapistsExplicit: hasConfiguredValue(row, 'min_distinct_therapists', 'minDistinctTherapists'),
    maintenanceRequired: safeBoolean(readValue(row, 'maintenance_required', 'maintenanceRequired'), false),
    maintenanceDays: readValue(row, 'maintenance_days', 'maintenanceDays') ?? null,
    isActive,
    source,
    sourceLabel,
    masteryCriterionMode: requiredConsecutiveIndependentCorrectTrials
      ? 'consecutive_independent'
      : requiredIndependentCorrectTrials
        ? 'total_independent'
        : masteryCriterionMode || 'custom',
    requiresConsecutiveSuccesses,
    measure,
    operator,
    value,
    requiredSessions,
    sessionMode
  };
}

export function formatAbaMasteryCriterion(criterion: AbaMasteryCriterion | null): string {
  if (!criterion) return 'Criterio nao configurado';
  if (criterion.measure && criterion.value !== null && criterion.value !== undefined) {
    const measureLabels: Record<string, string> = {
      accuracy_percent: 'acurácia',
      independent_responses: 'respostas independentes',
      frequency: 'ocorrências',
      duration_seconds: 'segundos de duração',
      latency_seconds: 'segundos de latência',
      steps_percent: 'etapas concluídas'
    };
    const operatorLabels: Record<string, string> = { gte: '≥', gt: '>', eq: '=', lte: '≤' };
    const valueLabel = ['accuracy_percent', 'steps_percent'].includes(String(criterion.measure))
      ? `${criterion.value}%`
      : String(criterion.value);
    const sessionsLabel = criterion.requiredSessions && criterion.requiredSessions > 1
      ? ` em ${criterion.requiredSessions} sessões ${criterion.sessionMode === 'cumulative' ? 'acumuladas' : 'consecutivas'}`
      : '';
    return `${operatorLabels[String(criterion.operator || 'gte')] || '≥'} ${valueLabel} ${measureLabels[String(criterion.measure)] || criterion.measure}${sessionsLabel}`;
  }
  const parts = [];
  if (criterion.requiredConsecutiveIndependentCorrectTrials) {
    parts.push(`${criterion.requiredConsecutiveIndependentCorrectTrials} ${criterion.requiredConsecutiveIndependentCorrectTrials === 1 ? 'acerto independente consecutivo' : 'acertos independentes consecutivos'}`);
  } else if (criterion.requiredIndependentCorrectTrials) {
    parts.push(`${criterion.requiredIndependentCorrectTrials} ${criterion.requiredIndependentCorrectTrials === 1 ? 'acerto independente' : 'acertos independentes'}`);
  }
  if (criterion.requiredCorrectTrials) {
    parts.push(`${criterion.requiredCorrectTrials} ${criterion.requiredCorrectTrials === 1 ? 'acerto' : 'acertos'}`);
  }
  if (criterion.minAccuracyPercent !== null && criterion.minAccuracyPercent !== undefined) {
    parts.push(`${criterion.minAccuracyPercent}% acuracia`);
  }
  if (criterion.minIndependencePercent !== null && criterion.minIndependencePercent !== undefined) {
    parts.push(`${criterion.minIndependencePercent}% independencia`);
  }
  if (criterion.minTrialsPerSession && !criterion.minTrialsPerSessionImplicit) {
    parts.push(`${criterion.minTrialsPerSession} tentativa(s)/sessao`);
  }
  if (criterion.requiredSessions && criterion.requiredSessions > 1) {
    parts.push(`${criterion.requiredSessions} sessão(ões) ${criterion.sessionMode === 'cumulative' ? 'acumuladas' : 'consecutivas'}`);
  }
  const usesTrialCountCriterion = Boolean(criterion.requiredConsecutiveIndependentCorrectTrials || criterion.requiredIndependentCorrectTrials || criterion.requiredCorrectTrials);
  if ((!usesTrialCountCriterion && criterion.minConsecutiveDaysExplicit) || criterion.minConsecutiveDays > 1) {
    parts.push(`${criterion.minConsecutiveDays} dia(s)`);
  }
  if (criterion.requireFirstTrialIndependent) parts.push('1a tentativa independente');
  if (criterion.coldProbeOnly) parts.push('Cold Probe');
  if (criterion.minDistinctTherapists > 1) parts.push(`${criterion.minDistinctTherapists} terapeutas`);
  return parts.length > 0 ? parts.join(' - ') : 'Criterio nao configurado';
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

const normalizeTargetToken = (value: any) => String(value || '').trim().toLowerCase();

const trialBelongsToTarget = (trial: any, targetId: string, targetName: string) => {
  const trialTargetId = normalizeTargetToken(readValue(trial, 'target_id', 'targetId'));
  const trialTargetName = normalizeTargetToken(readValue(trial, 'target_name', 'targetName', 'title', 'name'));
  const expectedTargetId = normalizeTargetToken(targetId);
  const expectedTargetName = normalizeTargetToken(targetName);

  if (trialTargetId && expectedTargetId) return trialTargetId === expectedTargetId;
  if (trialTargetName && expectedTargetName) return trialTargetName === expectedTargetName;
  if (trialTargetId || trialTargetName) return false;
  return true;
};

const isSuccessfulEvaluation = (evaluation: any) => {
  const status = String(readValue(evaluation, 'status', 'evaluationStatus', 'evaluation_status') || '').trim();
  return SUCCESSFUL_STATUSES.has(status);
};


const evaluationSessionId = (evaluation: any) => String(readValue(evaluation, 'session_id', 'sessionId') || '').trim();

const countPriorSuccessfulSessions = (previousEvaluations: any[], mode: 'consecutive' | 'cumulative' = 'consecutive') => {
  const sorted = (Array.isArray(previousEvaluations) ? previousEvaluations : [])
    .slice()
    .sort((a, b) => new Date(readValue(b, 'evaluated_at', 'evaluatedAt', 'created_at', 'createdAt') || 0).getTime() - new Date(readValue(a, 'evaluated_at', 'evaluatedAt', 'created_at', 'createdAt') || 0).getTime());
  const seenSessions = new Set<string>();
  let count = 0;
  for (const evaluation of sorted) {
    const key = evaluationSessionId(evaluation) || String(readValue(evaluation, 'id') || '').trim();
    if (!key || seenSessions.has(key)) continue;
    seenSessions.add(key);
    if (isSuccessfulEvaluation(evaluation)) {
      count += 1;
      continue;
    }
    if (mode === 'consecutive') break;
  }
  return count;
};

const countSuccessfulSessions = (metCurrentSession: boolean, previousEvaluations: any[], mode: 'consecutive' | 'cumulative' = 'consecutive') => {
  if (!metCurrentSession) return 0;
  return 1 + countPriorSuccessfulSessions(previousEvaluations, mode);
};

const therapeuticMeasurementPayload = (trial: any) => {
  const raw = readValue(trial, 'raw_payload', 'rawPayload');
  return raw && typeof raw === 'object' ? raw : {};
};

const therapeuticMeasurementTypeOf = (trial: any) => String(
  readValue(therapeuticMeasurementPayload(trial), 'measurementType', 'measurement_type') || ''
).trim().toLowerCase();

const therapeuticMeasurementValueOf = (trial: any) => {
  const raw = therapeuticMeasurementPayload(trial);
  const direct = readValue(raw, 'measurementValue', 'measurement_value', 'value');
  const parsed = Number(direct ?? readValue(trial, 'response_score', 'responseScore', 'score'));
  return Number.isFinite(parsed) ? parsed : null;
};

const criterionMeasureCompatibleWithMeasurementType = (measure: string | null | undefined, measurementType: string) => {
  if (!measure || !measurementType) return true;
  const map: Record<string, string[]> = {
    accuracy_percent: ['independent_prompted_no_response', 'correct_incorrect', 'percentage'],
    independent_responses: ['independent_prompted_no_response'],
    frequency: ['frequency'],
    duration_seconds: ['duration'],
    latency_seconds: ['latency'],
    steps_percent: ['task_analysis']
  };
  return !map[measure] || map[measure].includes(measurementType);
};

const compareCriterionValue = (actual: number, operator: string | null | undefined, expected: number) => {
  if (operator === 'gt') return actual > expected;
  if (operator === 'eq') return Math.abs(actual - expected) < 0.0001;
  if (operator === 'lte') return actual <= expected;
  return actual >= expected;
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

const countConsecutiveIndependentCorrectTrials = (trials: any[]) => {
  let count = 0;
  for (const trial of Array.isArray(trials) ? trials : []) {
    if (isTrialCorrect(trial) && isTrialIndependent(trial)) {
      count += 1;
    } else {
      count = 0;
    }
  }
  return count;
};

const buildCriterionProgressSummary = (
  criterion: AbaMasteryCriterion,
  independentTrials: number,
  correctTrials: number,
  consecutiveIndependentTrials: number,
  consecutiveSuccessfulDays: number,
  successfulSessions = 0
) => {
  if (criterion.requiredSessions && criterion.requiredSessions > 1) {
    return {
      kind: 'sessions' as const,
      count: successfulSessions,
      required: criterion.requiredSessions,
      label: `${successfulSessions}/${criterion.requiredSessions} sessões ${criterion.sessionMode === 'cumulative' ? 'acumuladas' : 'consecutivas'}`
    };
  }
  if (criterion.requiredConsecutiveIndependentCorrectTrials) {
    return {
      kind: 'consecutive_independent' as const,
      count: consecutiveIndependentTrials,
      required: criterion.requiredConsecutiveIndependentCorrectTrials,
      label: `${consecutiveIndependentTrials}/${criterion.requiredConsecutiveIndependentCorrectTrials} acertos independentes consecutivos`
    };
  }
  if (criterion.requiredIndependentCorrectTrials) {
    return {
      kind: 'total_independent' as const,
      count: independentTrials,
      required: criterion.requiredIndependentCorrectTrials,
      label: `${independentTrials}/${criterion.requiredIndependentCorrectTrials} acertos independentes`
    };
  }
  if (criterion.requiredCorrectTrials) {
    return {
      kind: 'correct' as const,
      count: correctTrials,
      required: criterion.requiredCorrectTrials,
      label: `${correctTrials}/${criterion.requiredCorrectTrials} acertos`
    };
  }
  return {
    kind: 'days' as const,
    count: consecutiveSuccessfulDays,
    required: criterion.minConsecutiveDays,
    label: `${consecutiveSuccessfulDays}/${criterion.minConsecutiveDays} dias consecutivos`
  };
};

const buildPerformanceText = (
  criterion: AbaMasteryCriterion,
  progressLabel: string,
  correctTrials: number,
  totalTrials: number,
  independencePercent: number
) => {
  if (criterion.requiredConsecutiveIndependentCorrectTrials || criterion.requiredIndependentCorrectTrials || criterion.requiredCorrectTrials) {
    return `${progressLabel} - ${independencePercent}% independencia`;
  }
  return `${correctTrials}/${totalTrials} acertos - ${independencePercent}% independencia`;
};

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
      consecutiveIndependentTrials: 0,
      promptedTrials: 0,
      errorTrials: 0,
      accuracyPercent: 0,
      independencePercent: 0,
      firstTrialIndependent: null,
      coldProbeTrialsCount: 0,
      distinctTherapistsCount: 0,
      consecutiveSuccessfulDays: 0,
      successfulSessions: 0,
      criterionProgressCount: 0,
      criterionRequiredCount: 0,
      criterionProgressLabel: 'Critério não configurado',
      criterionProgressKind: 'none',
      sequenceBrokenByLastTrial: false,
      status: 'INSUFFICIENT_DATA',
      reasons: [{ code: 'NO_CRITERIA', message: 'Nenhum criterio ativo encontrado para esta meta ou programa.' }],
      suggestedPhase: 'teaching',
      criterionLabel: 'Criterio nao configurado',
      performanceText: 'Critério não configurado'
    };
  }

  const allTrials = (Array.isArray(input.trials) ? input.trials : []).filter((trial) => trialBelongsToTarget(trial, input.targetId, targetName));
  const coldProbeTrialsCount = allTrials.filter((trial) => normalizeCollectionType(trial) === 'cold_probe').length;
  const consideredTrials = (criterion.coldProbeOnly
    ? allTrials.filter((trial) => normalizeCollectionType(trial) === 'cold_probe')
    : allTrials
  ).sort((a, b) => new Date(trialTimestamp(a)).getTime() - new Date(trialTimestamp(b)).getTime());

  const totalTrials = consideredTrials.length;
  const independentTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && isTrialIndependent(trial)).length;
  const consecutiveIndependentTrials = countConsecutiveIndependentCorrectTrials(consideredTrials);
  const promptedTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && !isTrialIndependent(trial)).length;
  const correctTrials = independentTrials + promptedTrials;
  const errorTrials = consideredTrials.filter((trial) => !isTrialCorrect(trial)).length;
  const accuracyPercent = percent(correctTrials, totalTrials);
  const independencePercent = percent(independentTrials, totalTrials);
  const firstTrialIndependent = totalTrials > 0 ? isTrialCorrect(consideredTrials[0]) && isTrialIndependent(consideredTrials[0]) : null;
  const therapistIds = new Set([
    ...consideredTrials.map(trialTherapist),
    ...(Array.isArray(input.previousEvaluations) ? input.previousEvaluations.filter(isSuccessfulEvaluation).map((evaluation) => String(readValue(evaluation, 'therapist_id', 'therapistId') || '').trim()) : [])
  ].filter(Boolean));
  const distinctTherapistsCount = therapistIds.size;
  const lastTrial = consideredTrials[consideredTrials.length - 1] || null;
  const sequenceBrokenByLastTrial = Boolean(lastTrial && (!isTrialCorrect(lastTrial) || !isTrialIndependent(lastTrial)));
  const reasons: AbaMasteryReason[] = [];

  const measurementTypes = Array.from(new Set(consideredTrials.map(therapeuticMeasurementTypeOf).filter(Boolean)));
  const observedMeasurementType = measurementTypes.length === 1 ? measurementTypes[0] : '';
  const standardCriterionCompatibleWithObservedMeasurement = !observedMeasurementType || (
    criterion.measure
      ? criterionMeasureCompatibleWithMeasurementType(criterion.measure, observedMeasurementType)
      : criterion.requiredIndependentCorrectTrials || criterion.requiredConsecutiveIndependentCorrectTrials
        ? observedMeasurementType === 'independent_prompted_no_response'
        : criterion.minAccuracyPercent !== null && criterion.minAccuracyPercent !== undefined
          ? ['independent_prompted_no_response', 'correct_incorrect', 'percentage'].includes(observedMeasurementType)
          : true
  );
  if (!standardCriterionCompatibleWithObservedMeasurement) {
    return {
      ...base,
      totalTrials,
      independentTrials,
      consecutiveIndependentTrials,
      promptedTrials,
      errorTrials,
      accuracyPercent,
      independencePercent,
      firstTrialIndependent,
      coldProbeTrialsCount,
      distinctTherapistsCount,
      consecutiveSuccessfulDays: 0,
      successfulSessions: 0,
      criterionProgressCount: 0,
      criterionRequiredCount: criterion.requiredSessions || 1,
      criterionProgressLabel: 'Critério incompatível com a medida coletada',
      criterionProgressKind: 'measurement',
      sequenceBrokenByLastTrial,
      status: 'INSUFFICIENT_DATA',
      reasons: [{ code: 'MEASUREMENT_CRITERION_MISMATCH', message: 'O critério configurado mede uma variável diferente da forma de coleta do programa.' }],
      suggestedPhase: 'teaching',
      criterionLabel: formatAbaMasteryCriterion(criterion),
      performanceText: 'Revise o critério de domínio do programa.'
    };
  }

  if (criterion.measure && criterion.value !== null && criterion.value !== undefined) {
    const numericValues = consideredTrials
      .map((trial) => ({ trial, value: therapeuticMeasurementValueOf(trial) }))
      .filter((item) => item.value !== null) as Array<{ trial: any; value: number }>;
    let currentMetric: number | null = null;
    if (criterion.measure === 'accuracy_percent' && observedMeasurementType === 'percentage' && numericValues.length > 0) {
      currentMetric = numericValues[numericValues.length - 1].value;
    } else if (criterion.measure === 'accuracy_percent') currentMetric = accuracyPercent;
    else if (criterion.measure === 'independent_responses') currentMetric = independentTrials;
    else if (criterion.measure === 'frequency') currentMetric = numericValues.reduce((sum, item) => sum + item.value, 0);
    else if (numericValues.length > 0) currentMetric = numericValues[numericValues.length - 1].value;

    if (currentMetric === null) {
      const priorSuccessfulSessions = criterion.requiredSessions && criterion.requiredSessions > 1
        ? countPriorSuccessfulSessions(input.previousEvaluations || [], criterion.sessionMode || 'consecutive')
        : 0;
      return {
        ...base,
        totalTrials,
        independentTrials,
        consecutiveIndependentTrials,
        promptedTrials,
        errorTrials,
        accuracyPercent,
        independencePercent,
        firstTrialIndependent,
        coldProbeTrialsCount,
        distinctTherapistsCount,
        consecutiveSuccessfulDays: 0,
        successfulSessions: priorSuccessfulSessions,
        criterionProgressCount: criterion.requiredSessions && criterion.requiredSessions > 1 ? priorSuccessfulSessions : 0,
        criterionRequiredCount: criterion.requiredSessions || 1,
        criterionProgressLabel: criterion.requiredSessions && criterion.requiredSessions > 1
          ? `${priorSuccessfulSessions}/${criterion.requiredSessions} sessões ${criterion.sessionMode === 'cumulative' ? 'acumuladas' : 'consecutivas'}`
          : 'Nenhuma medida válida registrada nesta sessão',
        criterionProgressKind: criterion.requiredSessions && criterion.requiredSessions > 1 ? 'sessions' : 'measurement',
        sequenceBrokenByLastTrial,
        status: 'INSUFFICIENT_DATA',
        reasons: [{ code: 'NO_VALID_MEASUREMENT', message: 'Nenhuma medida compatível foi registrada para avaliar este critério.' }],
        suggestedPhase: 'teaching',
        criterionLabel: formatAbaMasteryCriterion(criterion),
        performanceText: 'Aguardando coleta compatível.'
      };
    }

    const metCurrentSession = compareCriterionValue(currentMetric, criterion.operator, Number(criterion.value));
    const successfulSessions = countSuccessfulSessions(metCurrentSession, input.previousEvaluations || [], criterion.sessionMode || 'consecutive');
    const requiredSessions = criterion.requiredSessions || 1;
    const readyForReview = metCurrentSession && successfulSessions >= requiredSessions;
    if (!metCurrentSession) reasons.push({ code: 'MEASUREMENT_BELOW_CRITERION', message: `Medida atual ${currentMetric}; critério ${formatAbaMasteryCriterion(criterion)}.` });
    if (metCurrentSession && successfulSessions < requiredSessions) reasons.push({ code: 'REQUIRED_SESSIONS_PENDING', message: `${successfulSessions}/${requiredSessions} sessões válidas.` });
    const valueLabel = ['accuracy_percent', 'steps_percent'].includes(String(criterion.measure)) ? `${Math.round(currentMetric * 100) / 100}%` : `${Math.round(currentMetric * 100) / 100}`;
    return {
      ...base,
      totalTrials,
      independentTrials,
      consecutiveIndependentTrials,
      promptedTrials,
      errorTrials,
      accuracyPercent,
      independencePercent,
      firstTrialIndependent,
      coldProbeTrialsCount,
      distinctTherapistsCount,
      consecutiveSuccessfulDays: 0,
      successfulSessions,
      criterionProgressCount: criterion.requiredSessions && criterion.requiredSessions > 1 ? successfulSessions : (metCurrentSession ? 1 : 0),
      criterionRequiredCount: criterion.requiredSessions || 1,
      criterionProgressLabel: criterion.requiredSessions && criterion.requiredSessions > 1
        ? `${successfulSessions}/${criterion.requiredSessions} sessões ${criterion.sessionMode === 'cumulative' ? 'acumuladas' : 'consecutivas'}`
        : `${valueLabel} nesta sessão`,
      criterionProgressKind: criterion.requiredSessions && criterion.requiredSessions > 1 ? 'sessions' : 'measurement',
      sequenceBrokenByLastTrial: false,
      status: readyForReview ? 'READY_FOR_REVIEW' : metCurrentSession ? 'MET_TODAY' : 'NOT_MET',
      reasons,
      suggestedPhase: readyForReview ? 'maintenance' : 'teaching',
      criterionLabel: formatAbaMasteryCriterion(criterion),
      performanceText: `${valueLabel} nesta sessão`
    };
  }

  if (totalTrials === 0) {
    reasons.push({ code: criterion.coldProbeOnly ? 'NO_COLD_PROBE_TRIALS' : 'NO_VALID_TRIALS', message: criterion.coldProbeOnly ? 'Nenhuma tentativa Cold Probe valida foi registrada.' : 'Nenhuma tentativa valida foi registrada para esta meta.' });
  }
  if (criterion.minTrialsPerSession && totalTrials < criterion.minTrialsPerSession) {
    reasons.push({ code: 'MIN_TRIALS_NOT_MET', message: `${totalTrials}/${criterion.minTrialsPerSession} tentativas minimas na sessao.` });
  }
  if (criterion.coldProbeOnly && criterion.minTrialsPerSession && coldProbeTrialsCount < criterion.minTrialsPerSession) {
    reasons.push({ code: 'COLD_PROBE_MIN_TRIALS_NOT_MET', message: `${coldProbeTrialsCount}/${criterion.minTrialsPerSession} tentativas Cold Probe.` });
  }

  if (reasons.length > 0) {
    const priorSuccessfulSessions = criterion.requiredSessions && criterion.requiredSessions > 1
      ? countPriorSuccessfulSessions(input.previousEvaluations || [], criterion.sessionMode || 'consecutive')
      : 0;
    const progressSummary = buildCriterionProgressSummary(criterion, independentTrials, correctTrials, consecutiveIndependentTrials, 0, priorSuccessfulSessions);
    return {
      ...base,
      totalTrials,
      independentTrials,
      consecutiveIndependentTrials,
      promptedTrials,
      errorTrials,
      accuracyPercent,
      independencePercent,
      firstTrialIndependent,
      coldProbeTrialsCount,
      distinctTherapistsCount,
      consecutiveSuccessfulDays: 0,
      successfulSessions: priorSuccessfulSessions,
      criterionProgressCount: progressSummary.count,
      criterionRequiredCount: progressSummary.required,
      criterionProgressLabel: progressSummary.label,
      criterionProgressKind: progressSummary.kind,
      sequenceBrokenByLastTrial,
      status: 'INSUFFICIENT_DATA',
      reasons,
      suggestedPhase: 'teaching',
      criterionLabel: formatAbaMasteryCriterion(criterion),
      performanceText: buildPerformanceText(criterion, progressSummary.label, correctTrials, totalTrials, independencePercent)
    };
  }

  if (criterion.minAccuracyPercent !== null && criterion.minAccuracyPercent !== undefined && accuracyPercent < criterion.minAccuracyPercent) {
    reasons.push({ code: 'ACCURACY_BELOW_CRITERION', message: `${accuracyPercent}% acuracia; criterio ${criterion.minAccuracyPercent}%.` });
  }
  if (criterion.minIndependencePercent !== null && criterion.minIndependencePercent !== undefined && independencePercent < criterion.minIndependencePercent) {
    reasons.push({ code: 'INDEPENDENCE_BELOW_CRITERION', message: `${independencePercent}% independencia; criterio ${criterion.minIndependencePercent}%.` });
  }
  if (criterion.requireFirstTrialIndependent && !firstTrialIndependent) {
    reasons.push({ code: 'FIRST_TRIAL_NOT_INDEPENDENT', message: 'A primeira tentativa da sessao nao foi independente.' });
  }
  if (criterion.requiredConsecutiveIndependentCorrectTrials && consecutiveIndependentTrials < criterion.requiredConsecutiveIndependentCorrectTrials) {
    reasons.push({
      code: 'CONSECUTIVE_INDEPENDENT_CORRECT_TRIALS_NOT_MET',
      message: `${consecutiveIndependentTrials}/${criterion.requiredConsecutiveIndependentCorrectTrials} acertos independentes consecutivos.`
    });
  } else if (criterion.requiredIndependentCorrectTrials && independentTrials < criterion.requiredIndependentCorrectTrials) {
    reasons.push({ code: 'INDEPENDENT_CORRECT_TRIALS_NOT_MET', message: `${independentTrials}/${criterion.requiredIndependentCorrectTrials} acertos independentes.` });
  }
  if (criterion.requiredCorrectTrials && correctTrials < criterion.requiredCorrectTrials) {
    reasons.push({ code: 'CORRECT_TRIALS_NOT_MET', message: `${correctTrials}/${criterion.requiredCorrectTrials} acertos.` });
  }

  const metToday = reasons.length === 0;
  const successfulSessions = countSuccessfulSessions(metToday, input.previousEvaluations || [], criterion.sessionMode || 'consecutive');
  const consecutiveSuccessfulDays = countConsecutiveSuccessfulDays(evaluatedAt, metToday, input.previousEvaluations || []);
  if (metToday && criterion.requiredSessions && successfulSessions < criterion.requiredSessions) {
    reasons.push({ code: 'REQUIRED_SESSIONS_PENDING', message: `${successfulSessions}/${criterion.requiredSessions} sessão(ões) ${criterion.sessionMode === 'cumulative' ? 'acumuladas' : 'consecutivas'}.` });
  }
  if (metToday && consecutiveSuccessfulDays < criterion.minConsecutiveDays) {
    reasons.push({ code: 'CONSECUTIVE_DAYS_PENDING', message: `${consecutiveSuccessfulDays}/${criterion.minConsecutiveDays} dia(s) consecutivo(s).` });
  }
  if (metToday && distinctTherapistsCount < criterion.minDistinctTherapists) {
    reasons.push({ code: 'DISTINCT_THERAPISTS_PENDING', message: `${distinctTherapistsCount}/${criterion.minDistinctTherapists} terapeuta(s) distintos.` });
  }

  const readyForReview =
    metToday &&
    consecutiveSuccessfulDays >= criterion.minConsecutiveDays &&
    (!criterion.requiredSessions || successfulSessions >= criterion.requiredSessions) &&
    distinctTherapistsCount >= criterion.minDistinctTherapists;
  const status: AbaMasteryStatus = !metToday ? 'NOT_MET' : readyForReview ? 'READY_FOR_REVIEW' : 'MET_TODAY';
  const progressSummary = buildCriterionProgressSummary(criterion, independentTrials, correctTrials, consecutiveIndependentTrials, consecutiveSuccessfulDays, successfulSessions);

  return {
    ...base,
    totalTrials,
    independentTrials,
    consecutiveIndependentTrials,
    promptedTrials,
    errorTrials,
    accuracyPercent,
    independencePercent,
    firstTrialIndependent,
    coldProbeTrialsCount,
    distinctTherapistsCount,
    consecutiveSuccessfulDays,
    successfulSessions,
    criterionProgressCount: progressSummary.count,
    criterionRequiredCount: progressSummary.required,
    criterionProgressLabel: progressSummary.label,
    criterionProgressKind: progressSummary.kind,
    sequenceBrokenByLastTrial,
    status,
    reasons,
    suggestedPhase: status === 'READY_FOR_REVIEW' ? 'maintenance' : 'teaching',
    criterionLabel: formatAbaMasteryCriterion(criterion),
    performanceText: buildPerformanceText(criterion, progressSummary.label, correctTrials, totalTrials, independencePercent)
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
  const consecutiveIndependentTrials = countConsecutiveIndependentCorrectTrials(consideredTrials);
  const promptedTrials = consideredTrials.filter((trial) => isTrialCorrect(trial) && !isTrialIndependent(trial)).length;
  const errorTrials = consideredTrials.filter((trial) => !isTrialCorrect(trial)).length;
  const accuracyPercent = percent(independentTrials + promptedTrials, totalTrials);
  const independencePercent = percent(independentTrials, totalTrials);
  const minTrialsPerSession = criterion.minTrialsPerSession ?? 1;
  const reasons: AbaMasteryReason[] = [];

  if (totalTrials === 0) {
    reasons.push({
      code: 'NO_MAINTENANCE_PROBES',
      message: 'Nenhuma tentativa Maintenance Probe valida foi registrada.'
    });
  }
  if (totalTrials < minTrialsPerSession) {
    reasons.push({
      code: 'MIN_MAINTENANCE_TRIALS_NOT_MET',
      message: `${totalTrials}/${minTrialsPerSession} maintenance probe(s) minimas.`
    });
  }

  const minAccuracyPercent = criterion.minAccuracyPercent ?? 80;
  const minIndependencePercent = criterion.minIndependencePercent ?? 80;
  const accuracyDrop = minAccuracyPercent - accuracyPercent;
  const independenceDrop = minIndependencePercent - independencePercent;
  if (accuracyDrop > 0) {
    reasons.push({
      code: 'MAINTENANCE_ACCURACY_BELOW_CRITERION',
      message: `${accuracyPercent}% acuracia; criterio ${minAccuracyPercent}%.`
    });
  }
  if (independenceDrop > 0) {
    reasons.push({
      code: 'MAINTENANCE_INDEPENDENCE_BELOW_CRITERION',
      message: `${independencePercent}% independencia; criterio ${minIndependencePercent}%.`
    });
  }
  const requiredConsecutiveIndependentTrials = criterion.requiredConsecutiveIndependentCorrectTrials || 0;
  const consecutiveSequenceBelowCriterion = requiredConsecutiveIndependentTrials > 0 && consecutiveIndependentTrials < requiredConsecutiveIndependentTrials;
  if (consecutiveSequenceBelowCriterion) {
    reasons.push({
      code: 'MAINTENANCE_CONSECUTIVE_INDEPENDENT_TRIALS_NOT_MET',
      message: `${consecutiveIndependentTrials}/${requiredConsecutiveIndependentTrials} acertos independentes consecutivos.`
    });
  }

  const severeDrop = accuracyDrop >= 20 || independenceDrop >= 20;
  const belowCriterion = accuracyDrop > 0 || independenceDrop > 0 || consecutiveSequenceBelowCriterion;
  const status: AbaMaintenanceProbeStatus =
    totalTrials === 0 || totalTrials < minTrialsPerSession
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
    consecutiveIndependentTrials,
    promptedTrials,
    errorTrials,
    accuracyPercent,
    independencePercent,
    minAccuracyPercent,
    minIndependencePercent,
    status,
    consecutiveFailureCount,
    criterionRequiredCount: requiredConsecutiveIndependentTrials || minTrialsPerSession,
    criterionProgressLabel: requiredConsecutiveIndependentTrials
      ? `${consecutiveIndependentTrials}/${requiredConsecutiveIndependentTrials} acertos independentes consecutivos`
      : `${independentTrials}/${minTrialsPerSession} acertos independentes`,
    reasons,
    performanceText: requiredConsecutiveIndependentTrials
      ? `Sequencia: ${consecutiveIndependentTrials}/${requiredConsecutiveIndependentTrials} acertos independentes consecutivos - ${independencePercent}% independencia`
      : `${independentTrials + promptedTrials}/${totalTrials} acertos - ${independencePercent}% independencia`,
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
    ? `${result.consecutiveFailureCount} sondagens consecutivas abaixo do criterio`
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
