import {
  deriveMaintenanceScheduleStatus,
  formatMaintenanceScheduleDueLabel,
  getNextMaintenanceProbeForTarget,
} from './abaMaintenanceScheduling';
import {
  debugMapperInput,
  debugMapperOutput,
} from './debugPeiMaintenance';

export type PeiPlanSubtab = 'assessment' | 'teaching' | 'maintenance' | 'generalization' | 'history';

export type PeiMaintenanceGroupKey =
  | 'today'
  | 'overdue'
  | 'unlinked'
  | 'confirmation'
  | 'activeCycle'
  | 'completed';

export type PeiMaintenanceTargetFirstGroupKey =
  | 'eligibleSkills'
  | 'maintenanceSkills'
  | 'scheduled'
  | 'waitingNextSession'
  | 'overdue'
  | 'regressionRisk'
  | 'technical';

export type PeiMaintenanceTargetFirstSections = Record<PeiMaintenanceTargetFirstGroupKey, any[]>;

export type PeiMaintenancePanelMappedState = {
  source: 'maintenance-panel-target-first';
  requestId: number;
  loadedFor: string;
  loadedAt: number;
  summary: Record<PeiMaintenanceTargetFirstGroupKey, number>;
  sections: PeiMaintenanceTargetFirstSections;
  raw: any;
  eligibleSkills: any[];
  maintenanceSkills: any[];
  scheduledProbes: any[];
  waitingNextSession: any[];
  overdueProbes: any[];
  regressionRisk: any[];
  technicalIssues: any[];
};

export type PeiMaintenanceEligibleSkill = {
  key: string;
  targetId: string;
  goalId: string;
  name: string;
  description: string;
  protocol: string;
  domain: string;
  statusLabel: 'Adquirido';
  progressPercent: number | null;
  source: any;
};

export const PEI_PLAN_SUBTABS: Array<{ id: PeiPlanSubtab; label: string }> = [
  { id: 'assessment', label: 'Avaliação' },
  { id: 'teaching', label: 'Ensino' },
  { id: 'maintenance', label: 'Manutencao' },
  { id: 'generalization', label: 'Generalizacao' },
  { id: 'history', label: 'Historico' },
];

export const createEmptyPeiMaintenanceTargetFirstSections = (): PeiMaintenanceTargetFirstSections => ({
  eligibleSkills: [],
  maintenanceSkills: [],
  scheduled: [],
  waitingNextSession: [],
  overdue: [],
  regressionRisk: [],
  technical: [],
});

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_LINKLESS_STATUSES = new Set(['PENDING_NEXT_SESSION', 'PENDING_LINK', 'PENDING_SCHEDULING', 'UNSCHEDULED', 'PENDING']);
const COMPLETED_STATUSES = new Set(['COMPLETED', 'MAINTAINED', 'MAINTENANCE_COMPLETED']);
const REGRESSION_STATUSES = new Set(['WATCH', 'REGRESSION_RISK']);
const ACTIVE_MAINTENANCE_PANEL_SCHEDULE_STATUSES = new Set([
  'PENDING',
  'PENDING_NEXT_SESSION',
  'PENDING_CONFIRMATION',
  'PENDING_LINK',
  'PENDING_SCHEDULING',
  'SCHEDULED',
  'SCHEDULED_BY_DATE',
  'UNSCHEDULED',
  'DUE_TODAY',
  'OVERDUE',
  'IN_MAINTENANCE',
  'AVAILABLE_IN_SESSION',
  'NEEDS_REVIEW',
  'WATCH',
  'REGRESSION_RISK',
  'MISSED',
]);
const FINAL_MAINTENANCE_PANEL_SCHEDULE_STATUSES = new Set([
  'CANCELLED',
  'CANCELED',
  'ARCHIVED',
  'COMPLETED',
  'DELETED',
  'REMOVED',
  'FAILED',
  'FAILED_FINAL',
  'MAINTAINED',
  'MAINTENANCE_COMPLETED',
]);
const PEI_MAINTENANCE_ACQUIRED_STATUSES = new Set([
  'COMPLETED',
  'COMPLETE',
  'CONCLUIDO',
  'CONCLUÍDO',
  'ACQUIRED',
  'ADQUIRIDO',
  'MASTERED',
  'MASTERIZADO',
  'MASTERED_APPROVED',
  'MAINTENANCE',
  'MANUTENCAO',
  'MANUTENÇÃO',
  'MAINTAINED',
  'READY_FOR_MAINTENANCE'
]);
const PEI_MAINTENANCE_MASTERY_STATUSES = new Set([
  'MASTERED',
  'MASTERIZADO',
  'MASTERED_APPROVED',
  'READY_FOR_MAINTENANCE',
  'MET',
  'MET_TODAY'
]);
const PEI_MAINTENANCE_ACQUIRED_LABELS = new Set(['ADQUIRIDO', 'ACQUIRED', 'MASTERED', 'MASTERIZADO']);

const normalizeText = (value: any) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeStatus = (value: any) => normalizeText(value).toUpperCase();

const readObjectPayload = (...values: any[]) => {
  const merged: Record<string, any> = {};
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(merged, value);
      continue;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(merged, parsed);
      } catch {
        // Ignore malformed legacy payloads; display falls through to safe fallback.
      }
    }
  }
  return merged;
};

const firstDisplayText = (...values: any[]) => {
  for (const value of values) {
    const label = normalizeText(value);
    if (label && !UUID_LIKE.test(label)) return label;
  }
  return '';
};

const safeTargetName = (value: any, fallback = 'Habilidade sem nome') => {
  const label = normalizeText(value);
  if (!label || UUID_LIKE.test(label)) return fallback;
  return label;
};

const isPersistedUuid = (value: any) => UUID_LIKE.test(normalizeText(value));
const isPersistedMaintenanceScheduleId = (value: any) => {
  const id = normalizeText(value);
  if (isPersistedUuid(id)) return true;
  return /^maintenance-[a-z0-9][a-z0-9-]{7,}$/i.test(id) && !/(^|-)local-|(^|-)temp-|(^|-)tmp-|(^|-)offline-/i.test(id);
};

const getMaintenancePanelScheduleObject = (row: any) =>
  row?.nextSchedule || row?.activeSchedule || row?.schedule || row?.nextProbe?.schedule || null;

export const isActivePeiMaintenanceScheduleRow = (row: any, now = new Date()) => {
  const schedule = getMaintenancePanelScheduleObject(row) || {};
  const scheduleId = normalizeText(
    row?.scheduleId ||
      row?.schedule_id ||
      schedule?.id ||
      schedule?.schedule_id ||
      schedule?.scheduleId ||
      ''
  );
  const targetId = normalizeText(
    row?.targetId ||
      row?.target_id ||
      row?.aba_target_id ||
      row?.abaTargetId ||
      schedule?.target_id ||
      schedule?.targetId ||
      ''
  );
  if (!isPersistedMaintenanceScheduleId(scheduleId) || !isPersistedUuid(targetId)) return false;
  const rawStatus = normalizeStatus(schedule?.status || row?.status || row?.nextProbe?.status);
  if (!rawStatus || FINAL_MAINTENANCE_PANEL_SCHEDULE_STATUSES.has(rawStatus)) return false;
  if (ACTIVE_MAINTENANCE_PANEL_SCHEDULE_STATUSES.has(rawStatus)) return true;
  const derivedStatus = normalizeStatus(deriveMaintenanceScheduleStatus(schedule, now));
  return Boolean(
    derivedStatus &&
      ACTIVE_MAINTENANCE_PANEL_SCHEDULE_STATUSES.has(derivedStatus) &&
      !FINAL_MAINTENANCE_PANEL_SCHEDULE_STATUSES.has(derivedStatus)
  );
};

const getTargetKey = (...values: any[]) => {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized.toLowerCase();
  }
  return '';
};

const isMaintenanceRelevantGoal = (goal: any) => {
  const status = String(goal?.status || goal?.clinical_status || goal?.clinicalStatus || goal?.phase || goal?.mastery_status || goal?.masteryStatus || '').toLowerCase();
  const clinicalStatus = normalizeStatus(goal?.clinical_status || goal?.clinicalStatus || goal?.status || goal?.phase);
  const masteryStatus = normalizeStatus(goal?.mastery_status || goal?.masteryStatus || goal?.evaluation_status || goal?.evaluationStatus);
  const progress = Number(goal?.progress ?? goal?.progressPercent ?? goal?.progress_percent ?? goal?.masteryProgressPercent ?? goal?.mastery_progress_percent);
  return (
    [
      'completed',
      'complete',
      'concluido',
      'concluído',
      'acquired',
      'adquirido',
      'maintenance',
      'manutencao',
      'manutenção',
      'maintained',
      'mastered',
      'masterizado',
      'ready_for_maintenance'
    ].includes(status) ||
    ['MASTERED', 'MASTERED_APPROVED', 'MAINTENANCE', 'MAINTAINED', 'ACQUIRED', 'ADQUIRIDO', 'READY_FOR_MAINTENANCE'].includes(clinicalStatus) ||
    ['MASTERED', 'MASTERED_APPROVED', 'READY_FOR_MAINTENANCE', 'MET', 'MET_TODAY'].includes(masteryStatus) ||
    (Number.isFinite(progress) && progress >= 100)
  );
};

const normalizeMaintenanceMatchKey = (value: any) =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

const firstFiniteNumber = (...values: any[]) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = typeof value === 'number'
      ? value
      : Number(String(value).replace('%', '').replace(',', '.').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const getPeiMaintenanceProgressPercent = (goal: any) => {
  const status = normalizeStatus(goal?.status || goal?.phase);
  const clinicalStatus = normalizeStatus(goal?.clinical_status || goal?.clinicalStatus);
  const masteryStatus = normalizeStatus(goal?.mastery_status || goal?.masteryStatus || goal?.evaluation_status || goal?.evaluationStatus);
  const badgeLabel = normalizeStatus(goal?.badge || goal?.label || goal?.badgeLabel || goal?.statusLabel || goal?.teachingBadge || goal?.teachingStatusLabel);
  if (
    PEI_MAINTENANCE_ACQUIRED_STATUSES.has(status) ||
    PEI_MAINTENANCE_ACQUIRED_STATUSES.has(clinicalStatus) ||
    PEI_MAINTENANCE_MASTERY_STATUSES.has(masteryStatus) ||
    PEI_MAINTENANCE_ACQUIRED_LABELS.has(badgeLabel) ||
    Boolean(goal?.criteriaMet || goal?.criterionMet || goal?.masteryCriterionMet || goal?.masteryMet || goal?.isAcquired || goal?.isMastered)
  ) {
    return 100;
  }
  const progress = firstFiniteNumber(
    goal?.progressPercent,
    goal?.progress_percent,
    goal?.masteryProgressPercent,
    goal?.mastery_progress_percent,
    goal?.completionPercent,
    goal?.completion_percent,
    goal?.progress
  );
  if (progress === null) return null;
  return Math.max(0, Math.min(100, Math.round(progress)));
};

export const isPeiMaintenanceEligibleSkill = (goal: any) => {
  const status = normalizeStatus(goal?.status || goal?.phase);
  const clinicalStatus = normalizeStatus(goal?.clinical_status || goal?.clinicalStatus);
  const masteryStatus = normalizeStatus(goal?.mastery_status || goal?.masteryStatus || goal?.evaluation_status || goal?.evaluationStatus);
  const badgeLabel = normalizeStatus(goal?.badge || goal?.label || goal?.badgeLabel || goal?.statusLabel || goal?.teachingBadge || goal?.teachingStatusLabel);
  const progress = getPeiMaintenanceProgressPercent(goal);
  return (
    PEI_MAINTENANCE_ACQUIRED_STATUSES.has(status) ||
    PEI_MAINTENANCE_ACQUIRED_STATUSES.has(clinicalStatus) ||
    PEI_MAINTENANCE_MASTERY_STATUSES.has(masteryStatus) ||
    PEI_MAINTENANCE_ACQUIRED_LABELS.has(badgeLabel) ||
    Boolean(goal?.criteriaMet || goal?.criterionMet || goal?.masteryCriterionMet || goal?.masteryMet || goal?.isAcquired || goal?.isMastered) ||
    progress === 100
  );
};

export function buildPeiMaintenanceEligibleSkills(goals: any[] = []): PeiMaintenanceEligibleSkill[] {
  const rowsByKey = new Map<string, PeiMaintenanceEligibleSkill>();
  (Array.isArray(goals) ? goals : [])
    .filter((goal) => goal && typeof goal === 'object')
    .filter(isPeiMaintenanceEligibleSkill)
    .forEach((goal) => {
      const explicitTargetId = normalizeText(goal?.target_id || goal?.targetId || goal?.aba_target_id || goal?.abaTargetId);
      const targetId = isPersistedUuid(explicitTargetId) ? explicitTargetId : '';
      const goalId = normalizeText(goal?.goal_id || goal?.goalId || goal?.id || '');
      const name = firstDisplayText(goal?.name, goal?.title, goal?.target_name, goal?.targetName, goal?.skill_name, goal?.skillName, goal?.objective) || 'Habilidade sem nome';
      const protocol = firstDisplayText(goal?.protocolTitle, goal?.protocol_title, goal?.protocolName, goal?.protocol_name, goal?.protocol?.name) || 'Sem protocolo informado';
      const domain = firstDisplayText(goal?.domainName, goal?.domain_name, goal?.programName, goal?.program_name, goal?.domain?.name, goal?.program?.name) || 'Sem dominio informado';
      const description = firstDisplayText(goal?.description, goal?.objective, goal?.criteria);
      const compositeKey = [name, protocol, domain].map(normalizeMaintenanceMatchKey).filter(Boolean).join('|');
      const key = targetId
        ? `target:${targetId}`
        : goalId
          ? `goal:${goalId}`
          : `skill:${compositeKey}`;
      if (!key || rowsByKey.has(key)) return;
      rowsByKey.set(key, {
        key,
        targetId,
        goalId,
        name,
        description,
        protocol,
        domain,
        statusLabel: 'Adquirido',
        progressPercent: getPeiMaintenanceProgressPercent(goal),
        source: goal,
      });
    });
  return Array.from(rowsByKey.values());
}

const getScheduleReferenceDate = (schedule: any) =>
  schedule?.scheduled_for ||
  schedule?.scheduledFor ||
  schedule?.due_date ||
  schedule?.dueDate ||
  schedule?.target_due_date ||
  schedule?.targetDueDate ||
  null;

const getResultReferenceDate = (result: any) =>
  result?.occurred_at || result?.occurredAt || result?.created_at || result?.createdAt || null;

const formatShortDateTime = (value: any) => {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${day} as ${time}`;
};

const statusLabelForMaintenance = (scheduleOrProbe: any, now = new Date()) => {
  const status = normalizeStatus(scheduleOrProbe?.status || scheduleOrProbe?.probeStatus || scheduleOrProbe?.result_status);
  if (status === 'MAINTAINED') return 'Habilidade mantida';
  if (status === 'REGRESSION_RISK') return 'Risco de regressao';
  if (status === 'WATCH') return 'Atencao';
  if (status === 'PENDING_CONFIRMATION') return 'Pendente de confirmacao';
  if (status === 'PENDING_NEXT_SESSION') return 'Aguardando futura sessão';
  if (status === 'PENDING_LINK' || status === 'PENDING_SCHEDULING' || status === 'UNSCHEDULED') return 'Sem sessao vinculada';
  if (status === 'COMPLETED') return 'Concluida';
  if (status === 'SCHEDULED') return 'Agendada';
  const derived = scheduleOrProbe ? deriveMaintenanceScheduleStatus(scheduleOrProbe, now) : '';
  if (derived === 'DUE_TODAY') return 'Para hoje';
  if (derived === 'OVERDUE') return 'Atrasada';
  return status || 'Pendente';
};

export function resolveMaintenanceTargetDisplay(input: {
  schedule?: any;
  probe?: any;
  target?: any;
  appointment?: any;
  recentResult?: any;
  now?: Date;
} | any = {}) {
  const source = input?.schedule || input?.probe || input || {};
  const probe = input?.probe || source;
  const target = input?.target || source?.target || source?.aba_target || source?.targets || {};
  const metadata = readObjectPayload(source?.metadata, source?.raw_payload, source?.rawPayload);
  const probeMetadata = readObjectPayload(probe?.metadata, probe?.raw_payload, probe?.rawPayload);
  const targetId = normalizeText(source?.target_id || source?.targetId || probe?.target_id || probe?.targetId || target?.id);
  const hasExplicitMissingTarget = Boolean(targetId && source?.target_missing === true);
  const targetLabel = firstDisplayText(
    target?.name,
    target?.title,
    target?.target_name,
    target?.targetName,
    target?.skill_name,
    target?.skillName,
    target?.objective
  );
  const sourceLabel = targetId
    ? firstDisplayText(
        source?.target_name,
        source?.targetName,
        source?.name,
        source?.title,
        source?.skill_name,
        source?.skillName,
        source?.objective,
        metadata?.target_name,
        metadata?.targetName,
        probe?.target_name,
        probe?.targetName,
        probe?.objective,
        probeMetadata?.target_name,
        probeMetadata?.targetName
      )
    : '';
  const hasResolvedTarget = Boolean(normalizeText(target?.id || target?.target_id || target?.targetId));
  const targetDisplayName =
    targetLabel ||
    sourceLabel ||
    (!targetId ? 'Habilidade nao vinculada' : hasExplicitMissingTarget ? 'Habilidade nao encontrada' : hasResolvedTarget ? 'Habilidade sem nome' : 'Habilidade nao encontrada');
  const protocolDisplayName =
    firstDisplayText(
      target?.protocol?.name,
      target?.protocol_name,
      target?.protocolName,
      target?.protocol_title,
      target?.protocolTitle,
      source?.protocol_name,
      source?.protocolName,
      source?.protocol_title,
      source?.protocolTitle,
      metadata?.protocol_name,
      metadata?.protocolName,
      metadata?.protocol_title,
      metadata?.protocolTitle,
      probeMetadata?.protocol_name,
      probeMetadata?.protocolName
    ) || 'Sem protocolo informado';
  const domainDisplayName =
    firstDisplayText(
      target?.domain?.name,
      target?.domain_name,
      target?.domainName,
      target?.program?.name,
      target?.program_name,
      target?.programName,
      source?.domain_name,
      source?.domainName,
      source?.program_name,
      source?.programName,
      metadata?.domain_name,
      metadata?.domainName,
      metadata?.program_name,
      metadata?.programName,
      probeMetadata?.domain_name,
      probeMetadata?.domainName
    ) || 'Sem dominio informado';
  const now = input?.now || new Date();
  const recentResult = input?.recentResult || probe || null;
  const schedule = input?.schedule || source;
  const scheduleDay = Number(schedule?.schedule_day ?? schedule?.scheduleDay);
  const clinicalMilestoneLabel =
    Number.isFinite(scheduleDay) && scheduleDay > 0
      ? `${Math.round(scheduleDay)} dias`
      : schedule?.interval_label || schedule?.intervalLabel || formatPeiMaintenanceScheduleLabel(schedule, now);
  const linkedSessionLabel = schedule?.appointment_id || schedule?.appointmentId
    ? formatPeiMaintenanceScheduleLabel(schedule, now)
    : '';
  const accuracy = recentResult?.accuracy_percent ?? recentResult?.accuracyPercent;
  const independence = recentResult?.independence_percent ?? recentResult?.independencePercent;
  const recentResultLabel = accuracy !== undefined || independence !== undefined
    ? `${accuracy ?? 0}% acuracia - ${independence ?? 0}% independencia`
    : '';
  const statusLabel = statusLabelForMaintenance(schedule, now);
  return {
    targetDisplayName,
    protocolDisplayName,
    domainDisplayName,
    contextLabel: `${protocolDisplayName} - ${domainDisplayName}`,
    statusLabel,
    clinicalMilestoneLabel,
    linkedSessionLabel,
    recentResultLabel,
    badgeLabel: statusLabel,
    targetId,
    hasTargetId: Boolean(targetId),
    targetMissing: hasExplicitMissingTarget,
    hasResolvedTarget,
    hasRealTarget: Boolean(isPersistedUuid(targetId) && hasResolvedTarget && !hasExplicitMissingTarget),
    needsTargetReview: !targetId || hasExplicitMissingTarget || !hasResolvedTarget,
    reviewBadgeLabel: !targetId ? 'Revisar vinculo' : hasExplicitMissingTarget ? 'Revisar dados' : '',
  };
}

export const formatPeiMaintenanceAppointmentLabel = (appointment: any) => {
  const when = formatShortDateTime(
    appointment?.scheduled_at ||
    appointment?.scheduledAt ||
    appointment?.scheduledStartAt ||
    appointment?.date
  );
  const type = safeTargetName(appointment?.service_type || appointment?.serviceType || appointment?.approach || appointment?.type, 'Sessao');
  const durationMinutes = Number(
    appointment?.durationMinutes ||
      appointment?.duration_minutes ||
      appointment?.scheduledDurationMinutes ||
      appointment?.scheduled_duration_minutes ||
      0
  );
  const duration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? `${Math.round(durationMinutes)} min` : '';
  const professional = safeTargetName(
    appointment?.therapistName ||
      appointment?.therapist_name ||
      appointment?.professionalName ||
      appointment?.professional_name,
    'Equipe'
  );
  const location = safeTargetName(
    appointment?.roomName ||
      appointment?.room_name ||
      appointment?.location ||
      appointment?.local,
    'Local a definir'
  );
  return [when || 'Data a definir', duration, type, professional, location].filter(Boolean).join(' - ');
};

export const formatPeiMaintenanceScheduleLabel = (schedule: any, now = new Date()) => {
  if (!schedule) return 'Sem sondagem agendada';
  const status = deriveMaintenanceScheduleStatus(schedule, now);
  if (status === 'PENDING_NEXT_SESSION') return 'Aguardando futura sessão';
  if (status === 'PENDING_CONFIRMATION') return 'Pendente de confirmacao';
  if (status === 'OVERDUE') {
    const reference = getScheduleReferenceDate(schedule);
    const due = reference ? new Date(reference) : null;
    const diffDays = due && !Number.isNaN(due.getTime())
      ? Math.max(1, Math.ceil((now.getTime() - due.getTime()) / 86_400_000))
      : 1;
    return `Atrasada ha ${diffDays} dia(s)`;
  }
  if (status === 'DUE_TODAY') return 'Para hoje';
  if (schedule?.appointment_id || schedule?.appointmentId) {
    const when = formatShortDateTime(schedule?.scheduled_for || schedule?.scheduledFor || schedule?.due_date || schedule?.dueDate);
    return when ? `Vinculada à sessão agendada de ${when}` : 'Vinculada à sessão agendada';
  }
  return formatMaintenanceScheduleDueLabel(schedule, now);
};

export function mapMaintenancePanelResponse(
  response: any,
  meta: { patientId?: any; requestId?: number; loadedAt?: number } = {}
): PeiMaintenancePanelMappedState {
  const panel = response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : response && typeof response === 'object' && !Array.isArray(response)
      ? response
      : {};

  // Log input state
  debugMapperInput(
    Array.isArray(panel.eligibleSkills) ? panel.eligibleSkills.length : 0,
    Array.isArray(panel.scheduledProbes) ? panel.scheduledProbes.length : 0,
    {
      maintenanceSkills: Array.isArray(panel.maintenanceSkills) ? panel.maintenanceSkills.length : 0,
      waitingNextSession: Array.isArray(panel.waitingNextSession) ? panel.waitingNextSession.length : 0,
      overdueProbes: Array.isArray(panel.overdueProbes) ? panel.overdueProbes.length : 0,
      regressionRisk: Array.isArray(panel.regressionRisk) ? panel.regressionRisk.length : 0,
      technicalIssues: Array.isArray(panel.technicalIssues) ? panel.technicalIssues.length : 0,
    }
  );

  const sections = createEmptyPeiMaintenanceTargetFirstSections();
  const clinicalLinkIdsFor = (row: any) => {
    const schedule = row?.nextSchedule || row?.activeSchedule || row?.schedule || null;
    const raw = readObjectPayload(schedule?.raw_payload, schedule?.rawPayload, row?.raw_payload, row?.rawPayload);
    return [
      row?.peiGoalId,
      row?.goalId,
      row?.goal_id,
      row?.skillId,
      row?.skill_id,
      row?.localTargetRef,
      row?.local_target_ref,
      row?.source?.peiGoalId,
      row?.source?.goalId,
      row?.source?.goal_id,
      row?.source?.skillId,
      row?.source?.skill_id,
      row?.source?.localTargetRef,
      schedule?.peiGoalId,
      schedule?.goalId,
      schedule?.goal_id,
      schedule?.skillId,
      schedule?.skill_id,
      schedule?.localTargetRef,
      schedule?.local_target_ref,
      raw?.peiGoalId,
      raw?.pei_goal_id,
      raw?.goalId,
      raw?.goal_id,
      raw?.skillId,
      raw?.skill_id,
      raw?.localTargetRef,
      raw?.local_target_ref,
    ].map((value: any) => normalizeText(value)).filter(Boolean);
  };
  const isPeiMaterializedScheduleSource = (row: any) => {
    const schedule = row?.nextSchedule || row?.activeSchedule || row?.schedule || null;
    const raw = readObjectPayload(schedule?.raw_payload, schedule?.rawPayload, row?.raw_payload, row?.rawPayload);
    const sourceLabel = normalizeText(
      row?.clinicalIdentitySource ||
        schedule?.clinicalIdentitySource ||
        raw?.clinicalIdentitySource ||
        raw?.source
    );
    return ['patient_pei_materialized', 'patient_pei_request', 'patient_pei'].includes(sourceLabel) || raw?.materializedForMaintenance === true;
  };
  const normalizePanelRow = (row: any, group: PeiMaintenanceTargetFirstGroupKey) => {
    const schedule = row?.nextSchedule || row?.activeSchedule || row?.schedule || null;
    const raw = readObjectPayload(schedule?.raw_payload, schedule?.rawPayload, row?.raw_payload, row?.rawPayload);
    const latestResult = row?.lastResult || row?.latestResult || null;
    const rowIdCanBeTarget = Boolean(row?.hasRealTarget === true && !group.startsWith('technical') && isPersistedUuid(row?.id));
    const rawTargetId =
      row?.targetId ||
      row?.target_id ||
      row?.aba_target_id ||
      row?.abaTargetId ||
      schedule?.target_id ||
      schedule?.targetId ||
      (rowIdCanBeTarget ? row.id : '');
    const rawScheduleId =
      row?.scheduleId ||
      row?.schedule_id ||
      schedule?.id ||
      schedule?.schedule_id ||
      schedule?.scheduleId ||
      '';
    const targetId = normalizeText(rawTargetId);
    const scheduleId = normalizeText(rawScheduleId);
    const peiGoalId = normalizeText(row?.peiGoalId || row?.goalId || row?.goal_id || schedule?.peiGoalId || schedule?.goalId || schedule?.goal_id || raw?.peiGoalId || raw?.pei_goal_id || raw?.goalId || raw?.goal_id);
    const skillId = normalizeText(row?.skillId || row?.skill_id || schedule?.skillId || schedule?.skill_id || raw?.skillId || raw?.skill_id);
    const localTargetRef = normalizeText(row?.localTargetRef || row?.local_target_ref || schedule?.localTargetRef || schedule?.local_target_ref || raw?.localTargetRef || raw?.local_target_ref || peiGoalId);
    const isTechnicalIssue = group === 'technical';
    const targetName = safeTargetName(
      row?.targetName ||
        row?.target_name ||
        row?.name ||
        row?.title ||
        row?.skillName ||
        row?.skill_name,
      isTechnicalIssue ? 'Sondagem sem habilidade vinculada' : 'Habilidade sem nome'
    );
    const protocol = safeTargetName(row?.protocol || row?.protocolName || row?.protocol_name || row?.protocolTitle || row?.protocol_title, 'Sem protocolo informado');
    const domain = safeTargetName(row?.domain || row?.domainName || row?.domain_name || row?.programName || row?.program_name, 'Sem dominio informado');
    const hasRealTarget = Boolean(!isTechnicalIssue && isPersistedUuid(targetId) && row?.hasRealTarget !== false);
    const needsTargetReview = Boolean(
      isTechnicalIssue ||
        row?.needsTargetReview ||
        row?.targetMissing ||
        schedule?.target_missing ||
        !hasRealTarget
    );
    const availableActions = needsTargetReview
      ? ['REVIEW_TARGET']
      : Array.isArray(row?.availableActions) && row.availableActions.length > 0
        ? row.availableActions
        : ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT'];
    const groupName = group === 'waitingNextSession'
      ? 'unlinked'
      : group === 'overdue'
        ? 'overdue'
        : group === 'technical'
          ? 'unlinked'
          : row?.group || 'activeCycle';

    return {
      ...(row || {}),
      key: String(row?.key || row?.cardId || scheduleId || targetId || targetName || group),
      kind: row?.kind || row?.cardKind || (isTechnicalIssue ? 'SCHEDULE_ORFAO' : scheduleId ? 'SCHEDULE_VALIDO' : 'TARGET_REAL_SEM_SCHEDULE'),
      cardKind: row?.cardKind || row?.kind || (isTechnicalIssue ? 'SCHEDULE_ORFAO' : scheduleId ? 'SCHEDULE_VALIDO' : 'TARGET_REAL_SEM_SCHEDULE'),
      targetId,
      scheduleId,
      peiGoalId: peiGoalId || null,
      goalId: peiGoalId || null,
      goal_id: peiGoalId || null,
      skillId: skillId || null,
      skill_id: skillId || null,
      localTargetRef: localTargetRef || null,
      targetName,
      protocol,
      domain,
      nextSchedule: schedule,
      activeSchedule: schedule,
      schedules: Array.isArray(row?.schedules) ? row.schedules : schedule ? [schedule] : [],
      lastResult: latestResult,
      latestResult,
      group: groupName,
      isTechnicalIssue,
      needsTargetReview,
      hasRealTarget,
      hasRealSchedule: isPersistedMaintenanceScheduleId(scheduleId),
      canScheduleMaintenance: hasRealTarget && !needsTargetReview,
      canWaitNextSession: hasRealTarget && !needsTargetReview,
      canAssignAppointment: hasRealTarget && !needsTargetReview,
      canReviewLink: needsTargetReview,
      availableActions,
      isRegressionRisk: group === 'regressionRisk' || Boolean(row?.isRegressionRisk),
      statusLabel:
        row?.statusLabel ||
        (group === 'eligibleSkills'
          ? 'Sem sondagem agendada'
          : group === 'regressionRisk'
            ? 'Risco de regressao'
            : formatPeiMaintenanceScheduleLabel(schedule)),
    };
  };

  sections.eligibleSkills = (Array.isArray(panel.eligibleSkills) ? panel.eligibleSkills : []).map((row: any) => normalizePanelRow(row, 'eligibleSkills'));
  sections.maintenanceSkills = (Array.isArray(panel.maintenanceSkills) ? panel.maintenanceSkills : []).map((row: any) => normalizePanelRow(row, 'maintenanceSkills'));
  sections.scheduled = (Array.isArray(panel.scheduledProbes) ? panel.scheduledProbes : []).map((row: any) => normalizePanelRow(row, 'scheduled'));
  sections.waitingNextSession = (Array.isArray(panel.waitingNextSession) ? panel.waitingNextSession : []).map((row: any) => normalizePanelRow(row, 'waitingNextSession'));
  sections.overdue = (Array.isArray(panel.overdueProbes) ? panel.overdueProbes : []).map((row: any) => normalizePanelRow(row, 'overdue'));
  sections.regressionRisk = (Array.isArray(panel.regressionRisk) ? panel.regressionRisk : []).map((row: any) => normalizePanelRow(row, 'regressionRisk'));
  sections.technical = (Array.isArray(panel.technicalIssues) ? panel.technicalIssues : []).map((row: any) => normalizePanelRow(row, 'technical'));

  const eligibleKeyFor = (row: any) => {
    const targetId = normalizeText(row?.targetId || row?.target_id);
    if (isPersistedUuid(targetId)) return `target:${targetId}`;
    const clinicalId = clinicalLinkIdsFor(row)[0];
    if (clinicalId) return `clinical:${clinicalId}`;
    return normalizeText(row?.key || row?.goalId || row?.goal_id || row?.name || row?.targetName);
  };
  const eligibleRowsByKey = new Map<string, any>();
  sections.eligibleSkills.forEach((row: any, index: number) => {
    eligibleRowsByKey.set(eligibleKeyFor(row) || `eligible:${index}`, row);
  });
  const moveInactiveOperationalRowsToEligible = (group: PeiMaintenanceTargetFirstGroupKey) => {
    const rows = sections[group] || [];
    const inactiveRows = rows.filter((row: any) => !isActivePeiMaintenanceScheduleRow(row));
    sections[group] = rows.filter((row: any) => isActivePeiMaintenanceScheduleRow(row));
    inactiveRows.forEach((row: any, index: number) => {
      const targetId = normalizeText(row?.targetId || row?.target_id);
      if (!isPersistedUuid(targetId)) return;
      const key = eligibleKeyFor(row) || `${group}-without-active-schedule:${index}`;
      if (eligibleRowsByKey.has(key)) return;
      eligibleRowsByKey.set(key, {
        ...row,
        key: row?.key || key,
        kind: 'TARGET_REAL_SEM_SCHEDULE',
        cardKind: 'TARGET_REAL_SEM_SCHEDULE',
        nextSchedule: null,
        activeSchedule: null,
        schedule: null,
        schedules: [],
        scheduleId: '',
        schedule_id: null,
        hasRealSchedule: false,
        group: 'activeCycle',
        statusLabel: 'Sem sondagem agendada',
        availableActions: ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT'],
      });
    });
  };
  (['maintenanceSkills', 'scheduled', 'waitingNextSession', 'overdue', 'regressionRisk'] as PeiMaintenanceTargetFirstGroupKey[]).forEach(moveInactiveOperationalRowsToEligible);
  sections.eligibleSkills = Array.from(eligibleRowsByKey.values());

  const operationalTargetIds = new Set(
    [
      ...sections.maintenanceSkills,
      ...sections.scheduled,
      ...sections.waitingNextSession,
      ...sections.overdue,
      ...sections.regressionRisk,
    ]
      .filter((row: any) => isActivePeiMaintenanceScheduleRow(row))
      .map((row: any) => normalizeText(row?.targetId || row?.target_id))
      .filter((targetId: string) => isPersistedUuid(targetId))
  );
  const operationalPeiSourceIds = new Set(
    [
      ...sections.maintenanceSkills,
      ...sections.scheduled,
      ...sections.waitingNextSession,
      ...sections.overdue,
      ...sections.regressionRisk,
    ]
      .filter((row: any) => isActivePeiMaintenanceScheduleRow(row) && isPeiMaterializedScheduleSource(row))
      .flatMap((row: any) => clinicalLinkIdsFor(row))
  );
  if (operationalTargetIds.size > 0 || operationalPeiSourceIds.size > 0) {
    sections.eligibleSkills = sections.eligibleSkills.filter((row: any) => {
      const targetId = normalizeText(row?.targetId || row?.target_id);
      if (isPersistedUuid(targetId) && operationalTargetIds.has(targetId)) return false;
      const rowSourceIds = clinicalLinkIdsFor(row);
      if (rowSourceIds.some((sourceId: string) => operationalPeiSourceIds.has(sourceId))) return false;
      return true;
    });
  }

  const summary = {
    eligibleSkills: sections.eligibleSkills.length,
    maintenanceSkills: sections.maintenanceSkills.length,
    scheduled: sections.scheduled.length,
    waitingNextSession: sections.waitingNextSession.length,
    overdue: sections.overdue.length,
    regressionRisk: sections.regressionRisk.length,
    technical: sections.technical.length,
  };

  // Log output state
  debugMapperOutput(
    sections.eligibleSkills.length,
    sections.scheduled.length,
    {
      maintenanceSkills: sections.maintenanceSkills.length,
      waitingNextSession: sections.waitingNextSession.length,
      overdue: sections.overdue.length,
      regressionRisk: sections.regressionRisk.length,
      technical: sections.technical.length,
    }
  );

  return {
    ...panel,
    source: 'maintenance-panel-target-first',
    requestId: Number(meta.requestId || 0),
    loadedFor: normalizeText(meta.patientId),
    loadedAt: Number(meta.loadedAt || Date.now()),
    summary,
    sections,
    raw: panel,
    eligibleSkills: sections.eligibleSkills,
    maintenanceSkills: sections.maintenanceSkills,
    scheduledProbes: sections.scheduled,
    waitingNextSession: sections.waitingNextSession,
    overdueProbes: sections.overdue,
    regressionRisk: sections.regressionRisk,
    technicalIssues: sections.technical,
  };
}

export function buildPeiMaintenanceRows(input: {
  goals?: any[];
  schedules?: any[];
  probeResults?: any[];
  alerts?: any[];
  now?: Date;
}) {
  const now = input.now || new Date();
  const rowsByKey = new Map<string, any>();

  const ensureRow = (seed: any = {}) => {
    const explicitTargetId = normalizeText(seed.target_id || seed.targetId || seed.aba_target_id || seed.abaTargetId || '');
    const clinicalSourceId = normalizeText(seed.peiGoalId || seed.goalId || seed.goal_id || seed.skillId || seed.skill_id || (seed.goal ? seed.id : ''));
    const display = resolveMaintenanceTargetDisplay(seed.goal
      ? {
        target: explicitTargetId ? { ...seed, id: explicitTargetId } : {},
        schedule: {
          ...seed,
          id: explicitTargetId || '',
          target_id: explicitTargetId || undefined,
          targetId: explicitTargetId || undefined
        }
      }
      : seed);
    const key =
      (explicitTargetId ? `target:${explicitTargetId}` : '') ||
      (clinicalSourceId ? `clinical:${clinicalSourceId}` : '') ||
      `row-${rowsByKey.size + 1}`;
    const existing = rowsByKey.get(key);
    if (existing) return existing;
    const targetId = explicitTargetId;
    const hasPeiClinicalSource = Boolean(seed.goal && isMaintenanceRelevantGoal(seed));
    const row = {
      key,
      targetId,
      targetName: seed.goal
        ? safeTargetName(seed.name || seed.target_name || seed.targetName, display.targetDisplayName)
        : display.targetDisplayName,
      protocol: display.protocolDisplayName,
      domain: display.domainDisplayName,
      clinicalStatus: normalizeStatus(seed.status || seed.clinical_status || seed.clinicalStatus || ''),
      hasPeiClinicalSource,
      hasRealTarget: Boolean(display.hasRealTarget && isPersistedUuid(targetId)),
      needsTargetReview: Boolean(display.needsTargetReview && !hasPeiClinicalSource),
      targetMissing: display.targetMissing,
      goal: seed.goal || seed,
      schedules: [] as any[],
      probeResults: [] as any[],
      alerts: [] as any[],
    };
    rowsByKey.set(key, row);
    return row;
  };

  (Array.isArray(input.goals) ? input.goals : [])
    .filter(isMaintenanceRelevantGoal)
    .forEach((goal) => ensureRow({ ...goal, goal }));

  (Array.isArray(input.schedules) ? input.schedules : []).forEach((schedule) => {
    const raw = readObjectPayload(schedule?.raw_payload, schedule?.rawPayload);
    const row = ensureRow({
      ...schedule,
      name: schedule?.target_name || schedule?.targetName || raw.targetName,
      protocolTitle: schedule?.protocol_title || schedule?.protocolTitle || raw.protocolTitle,
      domainName: schedule?.domain_name || schedule?.domainName || raw.domainName,
    });
    row.schedules.push(schedule);
  });

  (Array.isArray(input.probeResults) ? input.probeResults : []).forEach((result) => {
    const raw = readObjectPayload(result?.raw_payload, result?.rawPayload);
    const row = ensureRow({
      ...result,
      name: result?.target_name || result?.targetName || raw.targetName,
    });
    row.probeResults.push(result);
  });

  (Array.isArray(input.alerts) ? input.alerts : []).forEach((alert) => {
    const row = ensureRow(alert);
    row.alerts.push(alert);
  });

  return Array.from(rowsByKey.values()).map((row) => {
    const sortedSchedules = row.schedules
      .slice()
      .sort((a: any, b: any) => new Date(getScheduleReferenceDate(a) || 0).getTime() - new Date(getScheduleReferenceDate(b) || 0).getTime());
    const nextProbe = getNextMaintenanceProbeForTarget(sortedSchedules, now);
    const sortedResults = row.probeResults
      .slice()
      .sort((a: any, b: any) => new Date(getResultReferenceDate(b) || 0).getTime() - new Date(getResultReferenceDate(a) || 0).getTime());
    const lastResult = sortedResults[0] || null;
    const activeAlert = row.alerts.find((alert: any) => !(alert?.resolved_at || alert?.resolvedAt)) || null;
    const completedCount = sortedSchedules.filter((schedule: any) => COMPLETED_STATUSES.has(normalizeStatus(schedule?.status))).length;
    const cycleDays = sortedSchedules
      .map((schedule: any) => Number(schedule?.schedule_day ?? schedule?.scheduleDay))
      .filter((day: number) => Number.isFinite(day) && day > 0);
    const hasCycle = cycleDays.some((day: number) => [7, 14, 30, 60].includes(day)) || sortedSchedules.length >= 4;
    const allCycleCompleted = hasCycle && sortedSchedules.length > 0 && completedCount >= sortedSchedules.length;
    const resultStatus = normalizeStatus(lastResult?.status);
    const derivedStatus = nextProbe.schedule ? deriveMaintenanceScheduleStatus(nextProbe.schedule, now) : 'NO_SCHEDULE';
    const nextScheduleId = normalizeText(nextProbe.schedule?.id || nextProbe.schedule?.schedule_id || nextProbe.schedule?.scheduleId);
    const hasRealSchedule = isPersistedMaintenanceScheduleId(nextScheduleId);
    const hasSyntheticSchedule = sortedSchedules.some((schedule: any) => {
      const id = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
      return id && !isPersistedMaintenanceScheduleId(id);
    });
    const hasMissingTargetLabel = /habilidade\s+(nao|não)\s+(vinculada|encontrada)/i.test(String(row.targetName || ''));
    const hasRealTarget = Boolean(isPersistedUuid(row.targetId) && !row.targetMissing && !nextProbe.schedule?.target_missing && !hasMissingTargetLabel && row.hasRealTarget !== false);
    const hasPeiClinicalSource = Boolean(row.hasPeiClinicalSource);
    const needsTargetReview = (!hasRealTarget && !hasPeiClinicalSource) || Boolean(row.targetMissing || nextProbe.schedule?.target_missing) || hasMissingTargetLabel;
    const cardKind = hasSyntheticSchedule && !hasRealSchedule
      ? 'ITEM_SINTETICO_LOCAL'
      : needsTargetReview && hasRealSchedule
        ? 'SCHEDULE_ORFAO'
        : hasRealTarget && hasRealSchedule
          ? 'SCHEDULE_VALIDO'
          : hasRealTarget
            ? 'TARGET_REAL_SEM_SCHEDULE'
            : hasPeiClinicalSource
              ? 'TARGET_REAL_SEM_SCHEDULE'
              : 'SCHEDULE_ORFAO';
    const canOperateOnTarget = hasRealTarget && cardKind !== 'ITEM_SINTETICO_LOCAL';
    const group: PeiMaintenanceGroupKey =
      allCycleCompleted || (!nextProbe.schedule && COMPLETED_STATUSES.has(resultStatus))
        ? 'completed'
        : derivedStatus === 'DUE_TODAY'
          ? 'today'
          : derivedStatus === 'OVERDUE'
            ? 'overdue'
            : derivedStatus === 'PENDING_CONFIRMATION'
              ? 'confirmation'
              : ACTIVE_LINKLESS_STATUSES.has(String(derivedStatus))
                ? 'unlinked'
                : 'activeCycle';

    return {
      ...row,
      schedules: sortedSchedules,
      probeResults: sortedResults,
      activeAlert,
      lastResult,
      nextSchedule: nextProbe.schedule,
      nextProbe,
      cardKind,
      cardId: hasRealSchedule ? nextScheduleId : row.targetId || row.key,
      scheduleId: hasRealSchedule ? nextScheduleId : '',
      hasRealTarget,
      hasPeiClinicalSource,
      hasRealSchedule,
      needsTargetReview,
      canScheduleMaintenance: canOperateOnTarget,
      canWaitNextSession: canOperateOnTarget,
      canAssignAppointment: canOperateOnTarget && (hasRealSchedule || derivedStatus === 'NO_SCHEDULE'),
      canReviewLink: (needsTargetReview || (!hasRealTarget && hasPeiClinicalSource)) && cardKind !== 'ITEM_SINTETICO_LOCAL',
      availableActions: needsTargetReview
        ? ['REVIEW_TARGET']
        : ['SCHEDULE_MAINTENANCE', 'WAIT_NEXT_SESSION', 'ASSIGN_APPOINTMENT'],
      group,
      hasCycle,
      completedCount,
      totalCycleCount: sortedSchedules.length,
      isMaintained: allCycleCompleted || COMPLETED_STATUSES.has(resultStatus),
      isRegressionRisk: REGRESSION_STATUSES.has(resultStatus) || Boolean(activeAlert),
      statusLabel:
        allCycleCompleted || COMPLETED_STATUSES.has(resultStatus)
          ? 'Habilidade mantida'
          : resultStatus === 'REGRESSION_RISK'
            ? 'Risco de regressao'
            : resultStatus === 'WATCH'
              ? 'Atencao'
              : formatPeiMaintenanceScheduleLabel(nextProbe.schedule, now),
    };
  });
}

export function summarizePeiMaintenanceRows(rows: any[]) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    pending: safeRows.filter((row) => row.group !== 'completed').length,
    today: safeRows.filter((row) => row.group === 'today').length,
    overdue: safeRows.filter((row) => row.group === 'overdue').length,
    unlinked: safeRows.filter((row) => row.group === 'unlinked').length,
    pendingConfirmation: safeRows.filter((row) => row.group === 'confirmation').length,
    completedCycles: safeRows.filter((row) => row.group === 'completed').length,
  };
}

export function groupPeiMaintenanceRows(rows: any[]) {
  const groups: Record<PeiMaintenanceGroupKey, any[]> = {
    today: [],
    overdue: [],
    unlinked: [],
    confirmation: [],
    activeCycle: [],
    completed: [],
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = (row?.group || 'activeCycle') as PeiMaintenanceGroupKey;
    groups[key]?.push(row);
  });
  return groups;
}

export function groupPeiMaintenanceRowsTargetFirst(rows: any[]) {
  const groups: Record<PeiMaintenanceTargetFirstGroupKey, any[]> = {
    eligibleSkills: [],
    maintenanceSkills: [],
    scheduled: [],
    waitingNextSession: [],
    overdue: [],
    regressionRisk: [],
    technical: [],
  };
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const status = normalizeStatus(row?.nextSchedule?.status || row?.status || row?.nextProbe?.status);
    const clinicalStatus = normalizeStatus(row?.clinicalStatus || row?.goal?.clinical_status || row?.goal?.clinicalStatus || row?.goal?.status || row?.goal?.phase);
    const hasActiveSchedule = isActivePeiMaintenanceScheduleRow(row);
    const hasPeiClinicalSource = Boolean(row?.hasPeiClinicalSource);
    const needsTargetReview = Boolean(
      row?.needsTargetReview ||
      row?.targetMissing ||
      row?.nextSchedule?.target_missing ||
      row?.cardKind === 'SCHEDULE_ORFAO' ||
      row?.cardKind === 'ITEM_SINTETICO_LOCAL' ||
      (!row?.hasRealTarget && !hasPeiClinicalSource)
    );
    if (needsTargetReview) {
      groups.technical.push(row);
      return;
    }
    if (row?.isRegressionRisk && hasActiveSchedule) {
      groups.regressionRisk.push(row);
      return;
    }
    if (row?.group === 'overdue' && hasActiveSchedule) {
      groups.overdue.push(row);
      return;
    }
    if (hasActiveSchedule && (row?.group === 'unlinked' || status === 'PENDING_NEXT_SESSION')) {
      groups.waitingNextSession.push(row);
      return;
    }
    if (hasActiveSchedule && row?.group !== 'completed') {
      groups.scheduled.push(row);
      return;
    }
    if (hasActiveSchedule && (['MAINTENANCE', 'MAINTAINED'].includes(clinicalStatus) || row?.hasCycle || row?.isMaintained)) {
      groups.maintenanceSkills.push(row);
      return;
    }
    groups.eligibleSkills.push(row);
  });
  return groups;
}

export function buildPeiPlanHistoryEvents(input: {
  goals?: any[];
  masteryEvaluations?: any[];
  schedules?: any[];
  probeResults?: any[];
  alerts?: any[];
  history?: any[];
}) {
  const events: any[] = [];
  (Array.isArray(input.goals) ? input.goals : []).forEach((goal) => {
    const createdAt = goal?.created_at || goal?.createdAt || goal?.date || null;
    if (!createdAt && !goal?.status) return;
    events.push({
      id: `goal-${normalizeText(goal?.id || goal?.name)}`,
      date: createdAt,
      title: safeTargetName(goal?.name, 'Meta do PEI'),
      detail: goal?.status === 'completed' ? 'Meta adquirida' : 'Meta no plano de ensino',
      source: 'PEI',
    });
  });
  (Array.isArray(input.masteryEvaluations) ? input.masteryEvaluations : []).forEach((evaluation) => {
    const status = normalizeStatus(evaluation?.evaluation_status || evaluation?.evaluationStatus);
    events.push({
      id: `mastery-${normalizeText(evaluation?.id || evaluation?.target_id || evaluation?.targetName)}`,
      date: evaluation?.evaluated_at || evaluation?.evaluatedAt || evaluation?.created_at || evaluation?.createdAt,
      title: safeTargetName(evaluation?.target_name || evaluation?.targetName, 'Meta avaliada'),
      detail: status === 'MASTERED' || status === 'MET' ? 'Maestria pronta para revisao' : 'Avaliacao de maestria registrada',
      source: 'Maestria',
    });
  });
  (Array.isArray(input.schedules) ? input.schedules : []).forEach((schedule) => {
    const status = deriveMaintenanceScheduleStatus(schedule);
    events.push({
      id: `schedule-${normalizeText(schedule?.id || schedule?.target_id || schedule?.targetId)}`,
      date: schedule?.confirmed_at || schedule?.confirmedAt || schedule?.created_at || schedule?.createdAt || getScheduleReferenceDate(schedule),
      title: resolveMaintenanceTargetDisplay({ schedule }).targetDisplayName,
      detail:
        status === 'PENDING_CONFIRMATION'
          ? 'Probe pendente de confirmacao'
          : schedule?.appointment_id || schedule?.appointmentId
            ? 'Probe vinculada a sessao'
            : 'Probe agendada',
      source: 'Manutencao',
    });
  });
  (Array.isArray(input.probeResults) ? input.probeResults : []).forEach((result) => {
    const status = normalizeStatus(result?.status);
    events.push({
      id: `probe-${normalizeText(result?.id || result?.target_id || result?.targetId)}`,
      date: getResultReferenceDate(result),
      title: resolveMaintenanceTargetDisplay({ probe: result }).targetDisplayName,
      detail: status === 'MAINTAINED' ? 'Probe concluida com habilidade mantida' : `Probe concluida: ${status || 'registrada'}`,
      source: 'Resultado',
    });
  });
  (Array.isArray(input.alerts) ? input.alerts : []).forEach((alert) => {
    events.push({
      id: `alert-${normalizeText(alert?.id || alert?.target_id || alert?.targetId)}`,
      date: alert?.created_at || alert?.createdAt,
      title: resolveMaintenanceTargetDisplay({ probe: alert }).targetDisplayName,
      detail: safeTargetName(alert?.message, 'Risco de regressao'),
      source: 'Alerta',
    });
  });
  (Array.isArray(input.history) ? input.history : [])
    .filter((item) => String(item?.type || '').toLowerCase().includes('pei') || String(item?.subject || '').toLowerCase().includes('pei'))
    .forEach((item) => {
      events.push({
        id: `history-${normalizeText(item?.id || item?.date || item?.created_at)}`,
        date: item?.created_at || item?.date,
        title: safeTargetName(item?.title || item?.subject, 'Evento do PEI'),
        detail: safeTargetName(item?.note || item?.text || item?.description, 'Registro persistido'),
        source: 'Historico',
      });
    });
  return events
    .filter((event) => event.title || event.detail)
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 80);
}
