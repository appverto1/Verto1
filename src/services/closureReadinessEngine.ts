export type ClosureReadinessStatus =
  | 'READY'
  | 'PENDING'
  | 'WARNING'
  | 'NOT_BILLABLE'
  | 'DRAFT'
  | 'UNKNOWN';

export type ClosureCheckStatus = 'PASSED' | 'FAILED' | 'WARNING' | 'NOT_APPLICABLE';
export type ClosureCheckSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ClosureChecklistItem = {
  key: string;
  label: string;
  status: ClosureCheckStatus;
  required: boolean;
  severity: ClosureCheckSeverity;
  message: string;
  evidence: Record<string, any>;
};

export type ClosureRequirements = {
  requireSignature?: boolean;
  requireReport?: boolean;
  requireActualDuration?: boolean;
  requireRoomWhenClinic?: boolean;
  minDurationMinutes?: number | null;
  maxDurationVarianceMinutes?: number | null;
};

export type AppointmentClosureInput = {
  organizationId: string;
  appointmentId?: string | null;
  abaSessionId?: string | null;
  patientId?: string | null;
  triggeredBy?: string | null;
  appointment?: Record<string, any> | null;
  abaSession?: Record<string, any> | null;
  sessionSummary?: Record<string, any> | null;
  report?: Record<string, any> | string | null;
  signature?: Record<string, any> | string | boolean | null;
  patient?: Record<string, any> | null;
  professional?: Record<string, any> | null;
  requirements?: ClosureRequirements | null;
  manualNotBillable?: boolean;
  now?: string | Date;
};

export type AppointmentClosureOutput = {
  readinessStatus: ClosureReadinessStatus;
  checklist: ClosureChecklistItem[];
  blockingIssuesCount: number;
  warningIssuesCount: number;
  missingRequiredCount: number;
  summary: {
    mainIssues: string[];
    patientId: string | null;
    professionalId: string | null;
    serviceType: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    scheduledMinutes: number | null;
    actualMinutes: number | null;
  };
  contextHash: string;
};

const DEFAULT_REQUIREMENTS: Required<ClosureRequirements> = {
  requireSignature: true,
  requireReport: true,
  requireActualDuration: true,
  requireRoomWhenClinic: true,
  minDurationMinutes: null,
  maxDurationVarianceMinutes: 10
};

const NOT_BILLABLE_STATUSES = new Set([
  'canceled',
  'cancelled',
  'cancelada',
  'cancelado',
  'no_show',
  'missed',
  'falta',
  'faltou',
  'deleted'
]);

const DRAFT_STATUSES = new Set([
  'scheduled',
  'pending',
  'confirmed',
  'reschedule',
  'rescheduled',
  'in_progress',
  'active'
]);

function firstValue(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function asString(value: any): string {
  return String(value ?? '').trim();
}

function asIso(value: any): string | null {
  const raw = firstValue(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asNumber(value: any): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.round(number));
}

function diffMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function boolLike(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'sim', 'signed', 'assinado', 'ready'].includes(value.toLowerCase());
  return Boolean(value);
}

function hasText(value: any): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function stableHash(input: any): string {
  const seen = new WeakSet<object>();
  const stableStringify = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (seen.has(value)) return '"[Circular]"';
    seen.add(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  };
  const text = stableStringify(input);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildCheck(
  key: string,
  label: string,
  status: ClosureCheckStatus,
  required: boolean,
  severity: ClosureCheckSeverity,
  message: string,
  evidence: Record<string, any> = {}
): ClosureChecklistItem {
  return { key, label, status, required, severity, message, evidence };
}

function failed(required: boolean, severity: ClosureCheckSeverity) {
  return required ? severity : 'LOW';
}

export function evaluateAppointmentClosureReadiness(input: AppointmentClosureInput): AppointmentClosureOutput {
  const appointment = input.appointment || {};
  const abaSession = input.abaSession || {};
  const summary = input.sessionSummary || {};
  const requirements = { ...DEFAULT_REQUIREMENTS, ...(input.requirements || {}) };
  const now = input.now ? new Date(input.now) : new Date();
  const patientId = asString(firstValue(input.patientId, appointment.patient_id, appointment.patientId, abaSession.patient_id, abaSession.patientId, input.patient?.id)) || null;
  const professionalId = asString(firstValue(appointment.therapist_id, appointment.professional_id, appointment.professionalId, abaSession.therapist_id, abaSession.therapistId, input.professional?.id)) || null;
  const serviceType = asString(firstValue(appointment.service_type, appointment.serviceType, appointment.approach, appointment.type, abaSession.service_type, abaSession.collection_type)) || null;
  const status = asString(firstValue(appointment.status, abaSession.status)).toLowerCase();
  const scheduledStart = asIso(firstValue(appointment.scheduled_start_at, appointment.scheduled_start, appointment.scheduledAt, appointment.scheduled_at, abaSession.scheduled_start_at, abaSession.scheduledStartAt, abaSession.started_at));
  const scheduledEnd = asIso(firstValue(appointment.scheduled_end_at, appointment.scheduled_end, abaSession.scheduled_end_at, abaSession.scheduledEndAt));
  const actualStart = asIso(firstValue(appointment.actual_start_at, appointment.actual_start, abaSession.actual_start_at, abaSession.actualStartAt, abaSession.started_at, summary.started_at));
  const actualEnd = asIso(firstValue(appointment.actual_end_at, appointment.actual_end, abaSession.actual_end_at, abaSession.actualEndAt, abaSession.ended_at, summary.ended_at));
  const scheduledMinutes = asNumber(firstValue(appointment.scheduled_duration_minutes, appointment.duration_minutes, appointment.durationMinutes, abaSession.scheduled_duration_minutes)) ?? diffMinutes(scheduledStart, scheduledEnd);
  const actualMinutes = asNumber(firstValue(appointment.actual_duration_minutes, abaSession.actual_duration_minutes, abaSession.duration_minutes, summary.duration_minutes)) ?? (
    asNumber(firstValue(abaSession.duration_seconds, summary.duration_seconds)) !== null
      ? Math.round((asNumber(firstValue(abaSession.duration_seconds, summary.duration_seconds)) || 0) / 60)
      : diffMinutes(actualStart, actualEnd)
  );
  const locationType = asString(firstValue(appointment.location_type, appointment.locationType, abaSession.location_type)).toLowerCase();
  const room = asString(firstValue(appointment.room_name, appointment.roomName, appointment.room_id, appointment.roomId, abaSession.room_name, abaSession.room_id));
  const hasReport = hasText(input.report) ||
    hasText(summary.session_note) ||
    hasText(summary.sessionNote) ||
    hasText(appointment.report_id) ||
    boolLike(appointment.has_report || appointment.hasReport);
  const hasSignature = boolLike(input.signature) ||
    boolLike(summary.signature_present || summary.signaturePresent) ||
    boolLike(appointment.signature_present || appointment.signaturePresent) ||
    boolLike(appointment.has_signature || appointment.hasSignature);
  const hasPendingRescheduleOrCancellation = ['reschedule', 'rescheduled'].includes(status) ||
    boolLike(appointment.pending_reschedule || appointment.pendingReschedule || appointment.pending_cancellation || appointment.pendingCancellation);
  const concluded = ['completed', 'concluida', 'concluída', 'concluido', 'concluído'].includes(status) ||
    boolLike(appointment.has_session_record || appointment.hasSessionRecord) ||
    asString(abaSession.status).toLowerCase() === 'completed' ||
    Boolean(actualEnd);
  const futureOrOpen = (scheduledStart && new Date(scheduledStart).getTime() > now.getTime()) ||
    ['in_progress', 'active'].includes(status) ||
    (DRAFT_STATUSES.has(status) && !concluded);
  const notBillable = Boolean(input.manualNotBillable) || NOT_BILLABLE_STATUSES.has(status);
  const unknown = !patientId && !scheduledStart && !input.appointmentId && !input.abaSessionId;

  const durationVariance = scheduledMinutes !== null && actualMinutes !== null
    ? Math.abs(actualMinutes - scheduledMinutes)
    : null;
  const durationCompatible = durationVariance === null || requirements.maxDurationVarianceMinutes === null
    ? true
    : durationVariance <= requirements.maxDurationVarianceMinutes;

  const checklist: ClosureChecklistItem[] = [];
  checklist.push(buildCheck(
    'session_completed',
    'Sessão concluída',
    notBillable ? 'NOT_APPLICABLE' : concluded ? 'PASSED' : futureOrOpen ? 'NOT_APPLICABLE' : 'FAILED',
    true,
    'CRITICAL',
    notBillable ? 'Sessão não faturável.' : concluded ? 'Sessão concluída.' : futureOrOpen ? 'Sessão ainda em aberto.' : 'Sessão ainda não consta como concluída.',
    { status }
  ));
  checklist.push(buildCheck(
    'patient_linked',
    'Paciente vinculado',
    patientId ? 'PASSED' : 'FAILED',
    true,
    'CRITICAL',
    patientId ? 'Paciente vinculado à sessão.' : 'Paciente não vinculado à sessão.',
    { present: Boolean(patientId) }
  ));
  checklist.push(buildCheck(
    'professional_linked',
    'Profissional vinculado',
    professionalId ? 'PASSED' : 'FAILED',
    true,
    failed(true, 'HIGH') as ClosureCheckSeverity,
    professionalId ? 'Profissional vinculado à sessão.' : 'Profissional não vinculado à sessão.',
    { present: Boolean(professionalId) }
  ));
  checklist.push(buildCheck(
    'service_type_linked',
    'Tipo de sessão vinculado',
    serviceType ? 'PASSED' : 'FAILED',
    true,
    'HIGH',
    serviceType ? 'Tipo de sessão informado.' : 'Tipo de sessão ou especialidade não informado.',
    { serviceType }
  ));
  checklist.push(buildCheck(
    'date_time_registered',
    'Data e horário registrados',
    scheduledStart ? 'PASSED' : 'FAILED',
    true,
    'HIGH',
    scheduledStart ? 'Data e horário registrados.' : 'Data e horário da sessão não informados.',
    { scheduledStart, scheduledEnd }
  ));
  checklist.push(buildCheck(
    'scheduled_duration_registered',
    'Duração planejada registrada',
    scheduledMinutes !== null ? 'PASSED' : 'FAILED',
    true,
    'HIGH',
    scheduledMinutes !== null ? `Duração planejada: ${scheduledMinutes} min.` : 'Duração planejada não registrada.',
    { scheduledMinutes }
  ));
  checklist.push(buildCheck(
    'actual_duration_registered',
    'Duração real registrada',
    !requirements.requireActualDuration && actualMinutes === null ? 'NOT_APPLICABLE' : actualMinutes !== null ? 'PASSED' : futureOrOpen ? 'NOT_APPLICABLE' : 'FAILED',
    requirements.requireActualDuration,
    'HIGH',
    actualMinutes !== null ? `Duração realizada: ${actualMinutes} min.` : futureOrOpen ? 'Duração real será conferida após a sessão.' : 'Duração real não registrada.',
    { actualMinutes }
  ));
  checklist.push(buildCheck(
    'actual_duration_compatible',
    'Duração real compatível',
    scheduledMinutes === null || actualMinutes === null ? 'NOT_APPLICABLE' : durationCompatible ? 'PASSED' : 'WARNING',
    false,
    'MEDIUM',
    scheduledMinutes === null || actualMinutes === null
      ? 'Duração insuficiente para comparação.'
      : durationCompatible
        ? 'Duração realizada compatível com o planejado.'
        : `Sessão realizada com ${actualMinutes} min, diferente dos ${scheduledMinutes} min planejados.`,
    { scheduledMinutes, actualMinutes, maxVariance: requirements.maxDurationVarianceMinutes }
  ));
  checklist.push(buildCheck(
    'room_or_location_registered',
    'Sala/local registrado',
    requirements.requireRoomWhenClinic && (locationType.includes('clinic') || locationType.includes('clinica') || locationType.includes('sala')) && !room ? 'WARNING' : room || locationType ? 'PASSED' : 'NOT_APPLICABLE',
    false,
    'LOW',
    room || locationType ? 'Sala ou local registrado.' : 'Sala/local não informado para conferência.',
    { room: Boolean(room), locationType }
  ));
  checklist.push(buildCheck(
    'report_present',
    'Relatório/evolução presente',
    !requirements.requireReport && !hasReport ? 'NOT_APPLICABLE' : hasReport ? 'PASSED' : futureOrOpen ? 'NOT_APPLICABLE' : 'FAILED',
    requirements.requireReport,
    'CRITICAL',
    hasReport ? 'Relatório da sessão preenchido.' : futureOrOpen ? 'Relatório será conferido após a sessão.' : 'Relatório da sessão ainda não foi preenchido.',
    { present: hasReport }
  ));
  checklist.push(buildCheck(
    'signature_present',
    'Assinatura presente',
    !requirements.requireSignature && !hasSignature ? 'NOT_APPLICABLE' : hasSignature ? 'PASSED' : futureOrOpen ? 'NOT_APPLICABLE' : 'FAILED',
    requirements.requireSignature,
    'CRITICAL',
    hasSignature ? 'Assinatura registrada.' : futureOrOpen ? 'Assinatura será conferida após a sessão.' : 'Assinatura pendente para fechamento da sessão.',
    { present: hasSignature }
  ));
  checklist.push(buildCheck(
    'payer_linked',
    'Convênio/pagador vinculado',
    firstValue(input.patient?.insuranceType, input.patient?.payerType, input.patient?.financialPlans, appointment.payer_type, appointment.payerType) ? 'PASSED' : 'NOT_APPLICABLE',
    false,
    'LOW',
    firstValue(input.patient?.insuranceType, input.patient?.payerType, input.patient?.financialPlans, appointment.payer_type, appointment.payerType)
      ? 'Pagador informado no cadastro.'
      : 'Pagador não configurado para esta conferência.',
    { present: Boolean(firstValue(input.patient?.insuranceType, input.patient?.payerType, input.patient?.financialPlans, appointment.payer_type, appointment.payerType)) }
  ));
  checklist.push(buildCheck(
    'authorization_linked',
    'Guia/autorização vinculada',
    firstValue(appointment.authorization_id, appointment.authorizationCode, appointment.guide_number, appointment.guideNumber) ? 'PASSED' : 'NOT_APPLICABLE',
    false,
    'MEDIUM',
    firstValue(appointment.authorization_id, appointment.authorizationCode, appointment.guide_number, appointment.guideNumber)
      ? 'Guia ou autorização vinculada.'
      : 'Guia ou autorização não configurada para esta conferência.',
    { present: Boolean(firstValue(appointment.authorization_id, appointment.authorizationCode, appointment.guide_number, appointment.guideNumber)) }
  ));
  checklist.push(buildCheck(
    'status_billable',
    'Status compatível com faturamento',
    notBillable ? 'FAILED' : concluded ? 'PASSED' : futureOrOpen ? 'NOT_APPLICABLE' : 'WARNING',
    true,
    notBillable ? 'CRITICAL' : 'MEDIUM',
    notBillable ? 'Sessão cancelada ou falta: não faturável.' : concluded ? 'Status compatível com conferência.' : futureOrOpen ? 'Sessão em aberto.' : 'Status da consulta exige conferência.',
    { status }
  ));
  checklist.push(buildCheck(
    'no_pending_reschedule_or_cancellation',
    'Sem remarcação/cancelamento pendente',
    hasPendingRescheduleOrCancellation ? 'FAILED' : 'PASSED',
    true,
    'HIGH',
    hasPendingRescheduleOrCancellation ? 'Há remarcação ou cancelamento pendente.' : 'Sem remarcação ou cancelamento pendente.',
    { present: hasPendingRescheduleOrCancellation }
  ));

  const blockingIssues = checklist.filter((item) => item.required && item.status === 'FAILED');
  const warningIssues = checklist.filter((item) => item.status === 'WARNING');
  const missingRequiredCount = blockingIssues.length;
  let readinessStatus: ClosureReadinessStatus = 'READY';
  if (unknown) readinessStatus = 'UNKNOWN';
  else if (notBillable) readinessStatus = 'NOT_BILLABLE';
  else if (futureOrOpen) readinessStatus = 'DRAFT';
  else if (blockingIssues.length > 0) readinessStatus = 'PENDING';
  else if (warningIssues.length > 0) readinessStatus = 'WARNING';

  const mainIssues = [
    ...blockingIssues.map((item) => item.message),
    ...warningIssues.map((item) => item.message)
  ].filter(Boolean).slice(0, 4);

  const contextHash = stableHash({
    organizationId: input.organizationId,
    appointmentId: input.appointmentId,
    abaSessionId: input.abaSessionId,
    patientId,
    status,
    scheduledStart,
    scheduledEnd,
    actualStart,
    actualEnd,
    scheduledMinutes,
    actualMinutes,
    professionalId,
    serviceType,
    room,
    locationType,
    hasReport,
    hasSignature,
    appointmentUpdatedAt: appointment.updated_at || appointment.updatedAt || null,
    sessionUpdatedAt: abaSession.updated_at || abaSession.updatedAt || null,
    summaryUpdatedAt: summary.updated_at || summary.updatedAt || null
  });

  return {
    readinessStatus,
    checklist,
    blockingIssuesCount: blockingIssues.length,
    warningIssuesCount: warningIssues.length,
    missingRequiredCount,
    summary: {
      mainIssues,
      patientId,
      professionalId,
      serviceType,
      scheduledStart,
      scheduledEnd,
      actualStart,
      actualEnd,
      scheduledMinutes,
      actualMinutes
    },
    contextHash
  };
}
