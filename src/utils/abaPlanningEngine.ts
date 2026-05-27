import {
  getNextMaintenanceProbeForTarget,
  isActiveMaintenanceSchedule,
  normalizeMaintenanceScheduleStatus
} from './abaMaintenanceScheduling';

export type AbaPlanningFocusType =
  | 'MAINTENANCE'
  | 'NEW_SKILLS'
  | 'BEHAVIOR_REDUCTION'
  | 'GENERALIZATION'
  | 'MASTERY_REVIEW'
  | 'BALANCED';

export type AbaRecommendationType =
  | 'MAINTENANCE_PROBE'
  | 'REGRESSION_ATTENTION'
  | 'MASTERY_REVIEW'
  | 'CONTINUE_TRAINING'
  | 'INTRODUCE_NEW_TARGET'
  | 'BEHAVIOR_MONITORING'
  | 'ABC_COLLECTION'
  | 'PROMPT_FADING'
  | 'GENERALIZATION';

export type AbaRecommendationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AbaRecommendationStatus = 'SUGGESTED' | 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'APPLIED_TO_NEXT_SESSION' | 'EXPIRED';

export type AbaClinicalRecommendation = {
  id?: string;
  organization_id: string;
  patient_id: string;
  source_session_id: string | null;
  next_session_focus_id?: string | null;
  recommendation_type: AbaRecommendationType;
  priority: AbaRecommendationPriority;
  title: string;
  summary: string;
  rationale: string;
  suggested_action: string;
  target_id?: string | null;
  behavior_id?: string | null;
  program_id?: string | null;
  domain?: string | null;
  metric_name?: string | null;
  previous_value?: number | null;
  current_value?: number | null;
  delta_value?: number | null;
  evidence: Record<string, any>;
  status: AbaRecommendationStatus;
  accepted_by?: string | null;
  accepted_at?: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  edited_from_id?: string | null;
  context_hash: string;
  created_at?: string;
  updated_at?: string;
};

export type AbaNextSessionPlanItem = {
  id?: string;
  organization_id: string;
  patient_id: string;
  source_session_id: string | null;
  source_recommendation_id: string | null;
  target_id?: string | null;
  behavior_id?: string | null;
  planned_trial_type?: string | null;
  planned_prompt?: string | null;
  priority: AbaRecommendationPriority;
  instructions: string;
  status: 'PLANNED' | 'USED_IN_SESSION' | 'SKIPPED' | 'CANCELLED';
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AbaClinicalRecommendationAuditLog = {
  id?: string;
  organization_id: string;
  patient_id: string;
  recommendation_id: string;
  action: 'GENERATED' | 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'APPLIED_TO_NEXT_SESSION' | 'EXPIRED';
  previous_status?: AbaRecommendationStatus | null;
  new_status?: AbaRecommendationStatus | null;
  performed_by: string | null;
  performed_at: string;
  metadata: Record<string, any>;
};

export type GenerateNextSessionRecommendationsInput = {
  organizationId: string;
  patientId: string;
  sourceSessionId?: string | null;
  focusType?: AbaPlanningFocusType | string | null;
  supervisorId?: string | null;
  sessionSummary?: any | null;
  metricSnapshots?: any[];
  masteryEvaluations?: any[];
  maintenanceSchedules?: any[];
  maintenanceProbeResults?: any[];
  regressionAlerts?: any[];
  targets?: any[];
  behaviorDailySummaries?: any[];
  existingRecommendations?: any[];
  now?: string;
  maxRecommendations?: number;
};

export type GenerateNextSessionRecommendationsResult = {
  focusType: AbaPlanningFocusType;
  contextHash: string;
  recommendations: AbaClinicalRecommendation[];
  reusedExisting: boolean;
};

const VALID_FOCUS_TYPES = new Set<AbaPlanningFocusType>([
  'MAINTENANCE',
  'NEW_SKILLS',
  'BEHAVIOR_REDUCTION',
  'GENERALIZATION',
  'MASTERY_REVIEW',
  'BALANCED'
]);

const VALID_EXISTING_STATUSES = new Set(['SUGGESTED', 'ACCEPTED', 'EDITED', 'APPLIED_TO_NEXT_SESSION']);

const PRIORITY_WEIGHT: Record<AbaRecommendationPriority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1
};

const FOCUS_TYPE_WEIGHT: Record<AbaPlanningFocusType, Partial<Record<AbaRecommendationType, number>>> = {
  MAINTENANCE: {
    MAINTENANCE_PROBE: 100,
    REGRESSION_ATTENTION: 90,
    MASTERY_REVIEW: 40
  },
  NEW_SKILLS: {
    INTRODUCE_NEW_TARGET: 100,
    CONTINUE_TRAINING: 80,
    PROMPT_FADING: 65,
    REGRESSION_ATTENTION: 20,
    MAINTENANCE_PROBE: 20
  },
  BEHAVIOR_REDUCTION: {
    BEHAVIOR_MONITORING: 100,
    ABC_COLLECTION: 90,
    REGRESSION_ATTENTION: 50
  },
  GENERALIZATION: {
    GENERALIZATION: 100,
    PROMPT_FADING: 55,
    CONTINUE_TRAINING: 40
  },
  MASTERY_REVIEW: {
    MASTERY_REVIEW: 100,
    MAINTENANCE_PROBE: 80,
    REGRESSION_ATTENTION: 50
  },
  BALANCED: {}
};

const safeString = (value: unknown, fallback = '') => {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return raw || fallback;
};

const safeNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const isoOrNow = (value: unknown) => {
  const date = new Date(typeof value === 'string' || typeof value === 'number' ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

export const normalizePlanningFocusType = (value: unknown): AbaPlanningFocusType => {
  const focus = String(value || '').trim().toUpperCase() as AbaPlanningFocusType;
  return VALID_FOCUS_TYPES.has(focus) ? focus : 'BALANCED';
};

const targetIdOf = (target: any) => safeString(target?.id || target?.target_id || target?.targetId);
const targetNameOf = (target: any) => safeString(target?.name || target?.title || target?.target_name || target?.targetName, 'Target do PEI');
const targetProgramOf = (target: any) => safeString(target?.program_id || target?.programId, '');
const targetDomainOf = (target: any) => safeString(target?.domain || target?.domain_name || target?.domainName, '');
const behaviorIdOf = (row: any) => safeString(row?.behavior_id || row?.behaviorId, '');
const targetStatusOf = (target: any) => safeString(target?.clinical_status || target?.clinicalStatus || target?.status || target?.phase, '').toUpperCase();

const metricValueOf = (snapshot: any) => safeNumber(
  snapshot?.metric_value ?? snapshot?.metricValue ?? snapshot?.current_value ?? snapshot?.currentValue,
  0
);

const previousValueOf = (snapshot: any) => {
  const value = snapshot?.previous_value ?? snapshot?.previousValue;
  return value === null || value === undefined || value === '' ? null : safeNumber(value, 0);
};

const deltaValueOf = (snapshot: any) => {
  const value = snapshot?.delta_value ?? snapshot?.deltaValue;
  if (value !== null && value !== undefined && value !== '') return safeNumber(value, 0);
  const previous = previousValueOf(snapshot);
  return previous === null ? null : metricValueOf(snapshot) - previous;
};

const metricNameOf = (snapshot: any) => safeString(snapshot?.metric_name || snapshot?.metricName || snapshot?.metric_label || snapshot?.metricLabel || snapshot?.metric_type || snapshot?.metricType);
const metricTypeOf = (snapshot: any) => safeString(snapshot?.metric_type || snapshot?.metricType || snapshot?.metric_name || snapshot?.metricName).toLowerCase();

const targetMatches = (row: any, targetId: string) => safeString(row?.target_id || row?.targetId) === targetId;

const evidenceBase = (evidence: Record<string, any>) => ({
  source: 'summary_driven',
  rawEventsFetched: false,
  ...evidence
});

const recommendationIdSeed = (recommendation: Pick<AbaClinicalRecommendation, 'organization_id' | 'patient_id' | 'source_session_id' | 'recommendation_type' | 'target_id' | 'behavior_id' | 'context_hash'>) => [
  recommendation.organization_id,
  recommendation.patient_id,
  recommendation.source_session_id || '',
  recommendation.recommendation_type,
  recommendation.target_id || '',
  recommendation.behavior_id || '',
  recommendation.context_hash
].join('|');

const stableJson = (value: any): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const stableHash = (value: any) => {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ctx_${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export function buildAbaPlanningContextHash(input: GenerateNextSessionRecommendationsInput, focusType = normalizePlanningFocusType(input.focusType)) {
  const snapshotKey = (row: any) => ({
    id: safeString(row?.id),
    target_id: safeString(row?.target_id || row?.targetId),
    behavior_id: safeString(row?.behavior_id || row?.behaviorId),
    metric_type: safeString(row?.metric_type || row?.metricType),
    metric_value: row?.metric_value ?? row?.metricValue ?? row?.current_value ?? row?.currentValue ?? null,
    previous_value: row?.previous_value ?? row?.previousValue ?? null,
    updated_at: safeString(row?.updated_at || row?.updatedAt || row?.changed_at || row?.changedAt || row?.created_at || row?.createdAt)
  });
  const statusKey = (row: any) => ({
    id: safeString(row?.id),
    target_id: safeString(row?.target_id || row?.targetId),
    status: safeString(row?.status || row?.clinical_status || row?.clinicalStatus || row?.evaluation_status || row?.evaluationStatus),
    updated_at: safeString(row?.updated_at || row?.updatedAt || row?.evaluated_at || row?.evaluatedAt || row?.created_at || row?.createdAt)
  });
  return stableHash({
    organization_id: safeString(input.organizationId),
    patient_id: safeString(input.patientId),
    source_session_id: safeString(input.sourceSessionId),
    focus_type: focusType,
    summary_updated_at: safeString(input.sessionSummary?.updated_at || input.sessionSummary?.updatedAt || input.sessionSummary?.ended_at || input.sessionSummary?.endedAt),
    metric_snapshots: (input.metricSnapshots || []).map(snapshotKey).sort((a, b) => stableJson(a).localeCompare(stableJson(b))).slice(0, 40),
    schedules: (input.maintenanceSchedules || []).map(statusKey).sort((a, b) => stableJson(a).localeCompare(stableJson(b))).slice(0, 40),
    alerts: (input.regressionAlerts || []).map((row) => ({
      id: safeString(row?.id),
      target_id: safeString(row?.target_id || row?.targetId),
      severity: safeString(row?.severity),
      resolved_at: safeString(row?.resolved_at || row?.resolvedAt)
    })).sort((a, b) => stableJson(a).localeCompare(stableJson(b))).slice(0, 40),
    mastery: (input.masteryEvaluations || []).map(statusKey).sort((a, b) => stableJson(a).localeCompare(stableJson(b))).slice(0, 40),
    targets: (input.targets || []).map(statusKey).sort((a, b) => stableJson(a).localeCompare(stableJson(b))).slice(0, 80)
  });
}

const makeRecommendation = (
  base: Omit<AbaClinicalRecommendation, 'id' | 'status' | 'context_hash' | 'created_at' | 'updated_at'>,
  contextHash: string,
  now: string
): AbaClinicalRecommendation => {
  const recommendation: AbaClinicalRecommendation = {
    ...base,
    status: 'SUGGESTED',
    context_hash: contextHash,
    created_at: now,
    updated_at: now
  };
  return {
    ...recommendation,
    id: `rec-${stableHash(recommendationIdSeed(recommendation)).replace(/^ctx_/, '')}`
  };
};

const hasCriticalBlocker = (alerts: any[], schedules: any[], now: Date) => {
  const hasCriticalAlert = alerts.some((alert) => !alert?.resolved_at && !alert?.resolvedAt && ['HIGH', 'CRITICAL'].includes(safeString(alert?.severity).toUpperCase()));
  const hasOverdueMaintenance = schedules.some((schedule) => {
    const status = normalizeMaintenanceScheduleStatus(schedule?.status);
    if (!['PENDING', 'SCHEDULED', 'UNSCHEDULED', 'MISSED'].includes(status)) return false;
    const due = new Date(schedule?.scheduled_for || schedule?.scheduledFor || schedule?.target_due_date || schedule?.targetDueDate || 0);
    return status === 'MISSED' || status === 'UNSCHEDULED' || (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime());
  });
  return hasCriticalAlert || hasOverdueMaintenance;
};

const buildSnapshotByTarget = (snapshots: any[]) => {
  const grouped = new Map<string, any[]>();
  for (const snapshot of snapshots) {
    const targetId = safeString(snapshot?.target_id || snapshot?.targetId);
    if (!targetId) continue;
    grouped.set(targetId, [...(grouped.get(targetId) || []), snapshot]);
  }
  return grouped;
};

const getTargetMetric = (snapshots: any[], namePart: string) => {
  const lowered = namePart.toLowerCase();
  return snapshots.find((snapshot) => metricTypeOf(snapshot).includes(lowered) || metricNameOf(snapshot).toLowerCase().includes(lowered));
};

const pushUnique = (recommendations: AbaClinicalRecommendation[], recommendation: AbaClinicalRecommendation) => {
  const duplicate = recommendations.some((existing) =>
    existing.recommendation_type === recommendation.recommendation_type &&
    safeString(existing.target_id) === safeString(recommendation.target_id) &&
    safeString(existing.behavior_id) === safeString(recommendation.behavior_id) &&
    existing.title === recommendation.title
  );
  if (!duplicate) recommendations.push(recommendation);
};

const sortForFocus = (recommendations: AbaClinicalRecommendation[], focusType: AbaPlanningFocusType) => {
  const focusWeights = FOCUS_TYPE_WEIGHT[focusType] || {};
  return [...recommendations].sort((a, b) => {
    const focusDelta = (focusWeights[b.recommendation_type] || 0) - (focusWeights[a.recommendation_type] || 0);
    if (focusDelta !== 0) return focusDelta;
    const priorityDelta = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return a.title.localeCompare(b.title);
  });
};

const limitBalanced = (recommendations: AbaClinicalRecommendation[], max = 6) => {
  const quotas: Array<{ types: AbaRecommendationType[]; max: number }> = [
    { types: ['MAINTENANCE_PROBE', 'REGRESSION_ATTENTION'], max: 2 },
    { types: ['CONTINUE_TRAINING', 'PROMPT_FADING', 'MASTERY_REVIEW', 'GENERALIZATION'], max: 2 },
    { types: ['BEHAVIOR_MONITORING', 'ABC_COLLECTION'], max: 1 },
    { types: ['INTRODUCE_NEW_TARGET'], max: 1 }
  ];
  const selected: AbaClinicalRecommendation[] = [];
  for (const quota of quotas) {
    for (const recommendation of recommendations.filter((item) => quota.types.includes(item.recommendation_type)).slice(0, quota.max)) {
      pushUnique(selected, recommendation);
    }
  }
  for (const recommendation of recommendations) {
    if (selected.length >= max) break;
    pushUnique(selected, recommendation);
  }
  return selected.slice(0, max);
};

export function generateNextSessionRecommendations(input: GenerateNextSessionRecommendationsInput): GenerateNextSessionRecommendationsResult {
  const focusType = normalizePlanningFocusType(input.focusType);
  const now = isoOrNow(input.now);
  const nowDate = new Date(now);
  const contextHash = buildAbaPlanningContextHash(input, focusType);
  const existing = (input.existingRecommendations || []).filter((recommendation) =>
    safeString(recommendation?.context_hash || recommendation?.contextHash) === contextHash &&
    VALID_EXISTING_STATUSES.has(safeString(recommendation?.status, 'SUGGESTED').toUpperCase())
  );
  if (existing.length > 0) {
    return {
      focusType,
      contextHash,
      recommendations: existing.map((recommendation) => ({ ...recommendation, context_hash: contextHash })) as AbaClinicalRecommendation[],
      reusedExisting: true
    };
  }

  const organizationId = safeString(input.organizationId);
  const patientId = safeString(input.patientId);
  const sourceSessionId = safeString(input.sourceSessionId) || null;
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const metricSnapshots = Array.isArray(input.metricSnapshots) ? input.metricSnapshots : [];
  const maintenanceSchedules = Array.isArray(input.maintenanceSchedules) ? input.maintenanceSchedules : [];
  const maintenanceResults = Array.isArray(input.maintenanceProbeResults) ? input.maintenanceProbeResults : [];
  const regressionAlerts = (Array.isArray(input.regressionAlerts) ? input.regressionAlerts : []).filter((alert) => !alert?.resolved_at && !alert?.resolvedAt);
  const masteryEvaluations = Array.isArray(input.masteryEvaluations) ? input.masteryEvaluations : [];
  const behaviorDailySummaries = Array.isArray(input.behaviorDailySummaries) ? input.behaviorDailySummaries : [];
  const snapshotsByTarget = buildSnapshotByTarget(metricSnapshots);
  const recommendations: AbaClinicalRecommendation[] = [];

  for (const target of targets) {
    const targetId = targetIdOf(target);
    if (!targetId) continue;
    const clinicalStatus = targetStatusOf(target);
    if (!['MAINTENANCE', 'MASTERED'].includes(clinicalStatus)) continue;
    const targetSchedules = maintenanceSchedules.filter((schedule) => targetMatches(schedule, targetId) && isActiveMaintenanceSchedule(schedule));
    const nextProbe = getNextMaintenanceProbeForTarget(targetSchedules, nowDate);
    const shouldSuggest = nextProbe.noSchedule || nextProbe.isOverdue || nextProbe.isToday || nextProbe.status === 'UNSCHEDULED' || nextProbe.status === 'MISSED';
    if (!shouldSuggest) continue;
    pushUnique(recommendations, makeRecommendation({
      organization_id: organizationId,
      patient_id: patientId,
      source_session_id: sourceSessionId,
      recommendation_type: 'MAINTENANCE_PROBE',
      priority: nextProbe.isOverdue || nextProbe.status === 'MISSED' ? 'HIGH' : 'MEDIUM',
      title: nextProbe.noSchedule ? `Agendar sondagem de manutencao: ${targetNameOf(target)}` : `Revisar manutencao: ${targetNameOf(target)}`,
      summary: nextProbe.label,
      rationale: 'Target em manutencao com sondagem pendente, vencida, sem agenda ou dentro da janela clinica.',
      suggested_action: nextProbe.noSchedule ? 'Agendar Maintenance Probe para a proxima sessao ou escolher uma data.' : 'Usar Maintenance Probe na proxima sessao, com validacao do supervisor.',
      target_id: targetId,
      program_id: targetProgramOf(target) || null,
      domain: targetDomainOf(target) || null,
      metric_name: 'maintenance_schedule',
      previous_value: null,
      current_value: null,
      delta_value: null,
      evidence: evidenceBase({
        targetClinicalStatus: clinicalStatus,
        nextProbe: {
          dueDate: nextProbe.dueDate,
          appointmentId: nextProbe.appointmentId,
          status: nextProbe.status,
          isOverdue: nextProbe.isOverdue,
          isToday: nextProbe.isToday,
          noSchedule: nextProbe.noSchedule
        }
      })
    }, contextHash, now));
  }

  for (const alert of regressionAlerts) {
    pushUnique(recommendations, makeRecommendation({
      organization_id: organizationId,
      patient_id: patientId,
      source_session_id: sourceSessionId,
      recommendation_type: 'REGRESSION_ATTENTION',
      priority: safeString(alert?.severity).toUpperCase() === 'HIGH' ? 'CRITICAL' : 'HIGH',
      title: 'Ponto de atencao para regressao',
      summary: safeString(alert?.message, 'Existe alerta ativo de regressao/manutencao.'),
      rationale: 'Ha alerta ativo summary-driven ainda nao resolvido.',
      suggested_action: 'Revisar dados recentes e considerar uma sondagem ou observacao focada na proxima sessao.',
      target_id: safeString(alert?.target_id || alert?.targetId) || null,
      metric_name: 'regression_alert',
      previous_value: null,
      current_value: null,
      delta_value: null,
      evidence: evidenceBase({
        alertId: safeString(alert?.id),
        severity: safeString(alert?.severity),
        createdAt: safeString(alert?.created_at || alert?.createdAt)
      })
    }, contextHash, now));
  }

  for (const snapshot of metricSnapshots) {
    const previous = previousValueOf(snapshot);
    const current = metricValueOf(snapshot);
    const metricType = metricTypeOf(snapshot);
    const targetId = safeString(snapshot?.target_id || snapshot?.targetId);
    if (!targetId || previous === null) continue;
    const drop = previous - current;
    const isHigherBetterMetric = ['accuracy', 'independence', 'communication', 'engagement'].some((part) => metricType.includes(part));
    if (isHigherBetterMetric && drop >= 10) {
      pushUnique(recommendations, makeRecommendation({
        organization_id: organizationId,
        patient_id: patientId,
        source_session_id: sourceSessionId,
        recommendation_type: 'REGRESSION_ATTENTION',
        priority: drop >= 20 ? 'HIGH' : 'MEDIUM',
        title: 'Queda relevante em indicador clinico',
        summary: `${metricNameOf(snapshot)} caiu ${Math.round(drop)} p.p.`,
        rationale: 'Queda igual ou superior a 10 pontos percentuais em metrica summary-driven.',
        suggested_action: 'Revisar o target na proxima sessao antes de ampliar demanda.',
        target_id: targetId,
        metric_name: metricNameOf(snapshot),
        previous_value: previous,
        current_value: current,
        delta_value: deltaValueOf(snapshot),
        evidence: evidenceBase({
          metricType,
          previousValue: previous,
          currentValue: current,
          dropPoints: drop,
          snapshotId: safeString(snapshot?.id)
        })
      }, contextHash, now));
    }
  }

  for (const [targetId, snapshots] of snapshotsByTarget.entries()) {
    const accuracy = getTargetMetric(snapshots, 'accuracy') || getTargetMetric(snapshots, 'acuracia');
    const independence = getTargetMetric(snapshots, 'independence') || getTargetMetric(snapshots, 'independencia');
    if (accuracy && independence) {
      const accuracyValue = metricValueOf(accuracy);
      const independenceValue = metricValueOf(independence);
      if (accuracyValue >= 80 && (independenceValue <= 65 || accuracyValue - independenceValue >= 20)) {
        pushUnique(recommendations, makeRecommendation({
          organization_id: organizationId,
          patient_id: patientId,
          source_session_id: sourceSessionId,
          recommendation_type: 'PROMPT_FADING',
          priority: 'MEDIUM',
          title: 'Revisar reducao gradual de ajuda',
          summary: 'Alta acuracia com independencia menor sugere ponto de revisao.',
          rationale: 'Metrica summary-driven indica acuracia alta e independencia mais baixa.',
          suggested_action: 'Pode ser util considerar reducao gradual de ajuda, com validacao do supervisor.',
          target_id: targetId,
          metric_name: 'accuracy_independence_gap',
          previous_value: metricValueOf(independence),
          current_value: metricValueOf(accuracy),
          delta_value: accuracyValue - independenceValue,
          evidence: evidenceBase({
            accuracyPercent: accuracyValue,
            independencePercent: independenceValue,
            accuracySnapshotId: safeString(accuracy?.id),
            independenceSnapshotId: safeString(independence?.id)
          })
        }, contextHash, now));
      }
    }
  }

  for (const evaluation of masteryEvaluations) {
    const status = safeString(evaluation?.status || evaluation?.evaluation_status || evaluation?.evaluationStatus).toUpperCase();
    if (!['READY_FOR_REVIEW', 'MET_TODAY', 'MET'].includes(status)) continue;
    pushUnique(recommendations, makeRecommendation({
      organization_id: organizationId,
      patient_id: patientId,
      source_session_id: sourceSessionId,
      recommendation_type: 'MASTERY_REVIEW',
      priority: 'MEDIUM',
      title: 'Revisar criterio de maestria',
      summary: 'Target atingiu criterio e aguarda revisao humana.',
      rationale: 'Avaliacao de maestria indica criterio atingido sem aprovacao automatica.',
      suggested_action: 'Supervisor deve validar se o target pode seguir para manutencao.',
      target_id: safeString(evaluation?.target_id || evaluation?.targetId) || null,
      metric_name: 'mastery_evaluation',
      previous_value: null,
      current_value: safeNumber(evaluation?.accuracy_percent ?? evaluation?.accuracyPercent, 0),
      delta_value: null,
      evidence: evidenceBase({
        evaluationId: safeString(evaluation?.id),
        status,
        accuracyPercent: evaluation?.accuracy_percent ?? evaluation?.accuracyPercent ?? null,
        independencePercent: evaluation?.independence_percent ?? evaluation?.independencePercent ?? null
      })
    }, contextHash, now));
  }

  for (const target of targets) {
    const targetId = targetIdOf(target);
    const status = targetStatusOf(target);
    if (!targetId || !['ACQUISITION', 'TEACHING', 'BASELINE'].includes(status)) continue;
    const snapshots = snapshotsByTarget.get(targetId) || [];
    const improvedSnapshot = snapshots.find((snapshot) => {
      const previous = previousValueOf(snapshot);
      if (previous === null) return false;
      const metricType = metricTypeOf(snapshot);
      const current = metricValueOf(snapshot);
      return ['accuracy', 'independence', 'acuracia', 'independencia'].some((part) => metricType.includes(part)) && current > previous && current < 90;
    });
    if (improvedSnapshot) {
      pushUnique(recommendations, makeRecommendation({
        organization_id: organizationId,
        patient_id: patientId,
        source_session_id: sourceSessionId,
        recommendation_type: 'CONTINUE_TRAINING',
        priority: 'LOW',
        title: `Continuar treino: ${targetNameOf(target)}`,
        summary: 'Houve melhora, mas o criterio ainda nao parece consolidado.',
        rationale: 'Snapshot recente mostra progresso sem evidencia de criterio final aprovado.',
        suggested_action: 'Manter treino na proxima sessao e revisar prompts conforme resposta.',
        target_id: targetId,
        program_id: targetProgramOf(target) || null,
        domain: targetDomainOf(target) || null,
        metric_name: metricNameOf(improvedSnapshot),
        previous_value: previousValueOf(improvedSnapshot),
        current_value: metricValueOf(improvedSnapshot),
        delta_value: deltaValueOf(improvedSnapshot),
        evidence: evidenceBase({
          targetClinicalStatus: status,
          snapshotId: safeString(improvedSnapshot?.id)
        })
      }, contextHash, now));
    }
  }

  const behaviorRows = [...metricSnapshots, ...behaviorDailySummaries];
  for (const row of behaviorRows) {
    const behaviorId = behaviorIdOf(row);
    const metricType = metricTypeOf(row);
    const previous = previousValueOf(row);
    const current = metricValueOf(row);
    const deltaPercent = row?.delta_percent ?? row?.deltaPercent;
    const increasedThirtyPercent = previous !== null && previous > 0
      ? ((current - previous) / previous) * 100 >= 30
      : safeNumber(deltaPercent, 0) >= 30;
    const isBehaviorMetric = Boolean(behaviorId) || ['behavior', 'frequency', 'duration', 'interval', 'comportamento'].some((part) => metricType.includes(part));
    if (!isBehaviorMetric || !increasedThirtyPercent) continue;
    pushUnique(recommendations, makeRecommendation({
      organization_id: organizationId,
      patient_id: patientId,
      source_session_id: sourceSessionId,
      recommendation_type: 'BEHAVIOR_MONITORING',
      priority: 'HIGH',
      title: 'Monitorar comportamento na proxima sessao',
      summary: 'Resumo recente indica aumento relevante de comportamento.',
      rationale: 'Aumento igual ou superior a 30% em metrica de comportamento.',
      suggested_action: 'Planejar monitoramento e revisar contexto antes da proxima sessao.',
      behavior_id: behaviorId || null,
      metric_name: metricNameOf(row),
      previous_value: previous,
      current_value: current,
      delta_value: deltaValueOf(row),
      evidence: evidenceBase({
        metricType,
        previousValue: previous,
        currentValue: current,
        deltaPercent: previous ? ((current - previous) / previous) * 100 : safeNumber(deltaPercent, 0),
        summaryId: safeString(row?.id)
      })
    }, contextHash, now));

    const abcCount = safeNumber(row?.abc_count ?? row?.abcCount ?? row?.abc_records_count ?? row?.abcRecordsCount, 0);
    if (abcCount <= 1) {
      pushUnique(recommendations, makeRecommendation({
        organization_id: organizationId,
        patient_id: patientId,
        source_session_id: sourceSessionId,
        recommendation_type: 'ABC_COLLECTION',
        priority: 'MEDIUM',
        title: 'Coletar ABC se houver nova ocorrencia',
        summary: 'Comportamento aumentou e ha poucos registros ABC associados.',
        rationale: 'Aumento de comportamento com baixa evidencia ABC nos resumos disponiveis.',
        suggested_action: 'Pode ser util coletar ABC na proxima ocorrencia para revisao do supervisor.',
        behavior_id: behaviorId || null,
        metric_name: 'abc_collection_gap',
        previous_value: previous,
        current_value: current,
        delta_value: deltaValueOf(row),
        evidence: evidenceBase({
          metricType,
          abcCount,
          behaviorSummaryId: safeString(row?.id)
        })
      }, contextHash, now));
    }
  }

  const blocker = hasCriticalBlocker(regressionAlerts, maintenanceSchedules, nowDate);
  if (!blocker) {
    const newTarget = targets.find((target) => {
      const status = targetStatusOf(target);
      const phase = safeString(target?.phase).toLowerCase();
      return ['NOT_STARTED', 'DRAFT', 'PLANNED'].includes(status) || ['draft', 'not_started', 'planned'].includes(phase);
    });
    if (newTarget) {
      pushUnique(recommendations, makeRecommendation({
        organization_id: organizationId,
        patient_id: patientId,
        source_session_id: sourceSessionId,
        recommendation_type: 'INTRODUCE_NEW_TARGET',
        priority: 'LOW',
        title: `Considerar novo target: ${targetNameOf(newTarget)}`,
        summary: 'Ha target do PEI ainda nao iniciado e sem bloqueador clinico critico ativo.',
        rationale: 'Sem alerta critico ativo, manutencao critica ou regressao relevante nos resumos usados.',
        suggested_action: 'Supervisor pode avaliar introduzir 1 novo target na proxima sessao.',
        target_id: targetIdOf(newTarget),
        program_id: targetProgramOf(newTarget) || null,
        domain: targetDomainOf(newTarget) || null,
        metric_name: 'pei_candidate_target',
        previous_value: null,
        current_value: null,
        delta_value: null,
        evidence: evidenceBase({
          targetClinicalStatus: targetStatusOf(newTarget),
          blockerPresent: false
        })
      }, contextHash, now));
    }
  }

  for (const [targetId, snapshots] of snapshotsByTarget.entries()) {
    const accuracy = getTargetMetric(snapshots, 'accuracy') || getTargetMetric(snapshots, 'acuracia');
    const independence = getTargetMetric(snapshots, 'independence') || getTargetMetric(snapshots, 'independencia');
    if (!accuracy || !independence) continue;
    const accuracyValue = metricValueOf(accuracy);
    const independenceValue = metricValueOf(independence);
    if (accuracyValue >= 80 && independenceValue >= 75) {
      pushUnique(recommendations, makeRecommendation({
        organization_id: organizationId,
        patient_id: patientId,
        source_session_id: sourceSessionId,
        recommendation_type: 'GENERALIZATION',
        priority: 'LOW',
        title: 'Considerar generalizacao',
        summary: 'Indicadores recentes estao altos para acuracia e independencia.',
        rationale: 'Snapshots summary-driven mostram desempenho alto, candidato a revisao de generalizacao.',
        suggested_action: 'Supervisor pode avaliar variar contexto, ambiente ou terapeuta na proxima sessao.',
        target_id: targetId,
        metric_name: 'generalization_candidate',
        previous_value: independenceValue,
        current_value: accuracyValue,
        delta_value: accuracyValue - independenceValue,
        evidence: evidenceBase({
          accuracyPercent: accuracyValue,
          independencePercent: independenceValue
        })
      }, contextHash, now));
    }
  }

  const sorted = sortForFocus(recommendations, focusType);
  const defaultMax = focusType === 'BALANCED' ? 6 : 8;
  const maxRecommendations = Math.min(12, Math.max(1, Math.round(Number(input.maxRecommendations || defaultMax) || defaultMax)));
  const limited = focusType === 'BALANCED'
    ? limitBalanced(sorted, Math.min(maxRecommendations, 6))
    : sorted.slice(0, Math.min(maxRecommendations, 8));

  return {
    focusType,
    contextHash,
    recommendations: limited,
    reusedExisting: false
  };
}

export function acceptRecommendationForNextSession(input: {
  recommendation: AbaClinicalRecommendation;
  acceptedBy: string;
  createPlanItem?: boolean;
  now?: string;
}): {
  recommendation: AbaClinicalRecommendation;
  planItem: AbaNextSessionPlanItem | null;
  auditLog: AbaClinicalRecommendationAuditLog;
} {
  const now = isoOrNow(input.now);
  const previousStatus = input.recommendation.status;
  const accepted: AbaClinicalRecommendation = {
    ...input.recommendation,
    status: input.createPlanItem ? 'APPLIED_TO_NEXT_SESSION' : 'ACCEPTED',
    accepted_by: input.acceptedBy,
    accepted_at: now,
    updated_at: now
  };
  const planItem: AbaNextSessionPlanItem | null = input.createPlanItem
    ? {
        id: `plan-${stableHash(`${accepted.id || ''}|${accepted.context_hash}`).replace(/^ctx_/, '')}`,
        organization_id: accepted.organization_id,
        patient_id: accepted.patient_id,
        source_session_id: accepted.source_session_id,
        source_recommendation_id: accepted.id || null,
        target_id: accepted.target_id || null,
        behavior_id: accepted.behavior_id || null,
        planned_trial_type: accepted.recommendation_type === 'MAINTENANCE_PROBE' ? 'maintenance_probe' : null,
        planned_prompt: null,
        priority: accepted.priority,
        instructions: accepted.suggested_action,
        status: 'PLANNED',
        created_by: input.acceptedBy,
        created_at: now,
        updated_at: now
      }
    : null;
  return {
    recommendation: accepted,
    planItem,
    auditLog: {
      id: `audit-${stableHash(`${accepted.id || ''}|accepted|${now}`).replace(/^ctx_/, '')}`,
      organization_id: accepted.organization_id,
      patient_id: accepted.patient_id,
      recommendation_id: accepted.id || '',
      action: input.createPlanItem ? 'APPLIED_TO_NEXT_SESSION' : 'ACCEPTED',
      previous_status: previousStatus,
      new_status: accepted.status,
      performed_by: input.acceptedBy,
      performed_at: now,
      metadata: evidenceBase({ createPlanItem: Boolean(input.createPlanItem) })
    }
  };
}

export function rejectRecommendation(input: {
  recommendation: AbaClinicalRecommendation;
  rejectedBy: string;
  reason?: string;
  now?: string;
}): {
  recommendation: AbaClinicalRecommendation;
  auditLog: AbaClinicalRecommendationAuditLog;
} {
  const now = isoOrNow(input.now);
  const previousStatus = input.recommendation.status;
  const rejected: AbaClinicalRecommendation = {
    ...input.recommendation,
    status: 'REJECTED',
    rejected_by: input.rejectedBy,
    rejected_at: now,
    updated_at: now
  };
  return {
    recommendation: rejected,
    auditLog: {
      id: `audit-${stableHash(`${rejected.id || ''}|rejected|${now}`).replace(/^ctx_/, '')}`,
      organization_id: rejected.organization_id,
      patient_id: rejected.patient_id,
      recommendation_id: rejected.id || '',
      action: 'REJECTED',
      previous_status: previousStatus,
      new_status: 'REJECTED',
      performed_by: input.rejectedBy,
      performed_at: now,
      metadata: evidenceBase({ reason: safeString(input.reason, '') })
    }
  };
}
