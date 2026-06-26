import { evaluatePayerRequirementsForClosure, type ResolvedPayerRequirements } from './payerRequirementEngine';

export type ClosureReadinessStatus =
  | 'READY'
  | 'PENDING'
  | 'WARNING'
  | 'NOT_BILLABLE'
  | 'DRAFT'
  | 'UNKNOWN';

export type ClosureCheckStatus = 'PASSED' | 'FAILED' | 'WARNING' | 'NOT_APPLICABLE';
export type ClosureCheckSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AppointmentOperationalPhase =
  | 'scheduled_pre_session'
  | 'in_session'
  | 'completed_pending_closure'
  | 'closed_ready_for_prefacturing'
  | 'prefacturing_ready'
  | 'prefacturing_blocked'
  | 'cancelled';
export type ClosureChecklistSection = 'preSession' | 'postSession' | 'tissBilling';
export type ClosureOperationalStatus = 'blocking_now' | 'actionable_now' | 'future_check' | 'info' | 'passed';

export type ClosureChecklistItem = {
  key: string;
  label: string;
  status: ClosureCheckStatus;
  required: boolean;
  severity: ClosureCheckSeverity;
  message: string;
  evidence: Record<string, any>;
  section?: ClosureChecklistSection;
  operationalStatus?: ClosureOperationalStatus;
  operationalPhase?: AppointmentOperationalPhase;
};

export type ClosureRequirements = {
  requireSignature?: boolean;
  requireReport?: boolean;
  requireActualDuration?: boolean;
  requireRoomWhenClinic?: boolean;
  requireAuthorization?: boolean;
  requireGuide?: boolean;
  requireAuthorizationBeforeSession?: boolean;
  requireGuideBeforeSession?: boolean;
  requireProfessionalRegistry?: boolean;
  requirePatientDocument?: boolean;
  allowManualOverride?: boolean;
  minDurationMinutes?: number | null;
  maxDurationVarianceMinutes?: number | null;
  payerName?: string | null;
  payerId?: string | null;
  appliedPayerRequirementId?: string | null;
  payerRequirementSource?: 'SPECIFIC' | 'GENERAL' | 'DEFAULT' | string | null;
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
  phase: AppointmentOperationalPhase;
  phaseSummary: {
    title: string;
    message: string;
    status: 'ready' | 'open' | 'blocked' | 'info';
    actionableCount: number;
  };
  sections: {
    preSession: ClosureChecklistItem[];
    postSession: ClosureChecklistItem[];
    tissBilling: ClosureChecklistItem[];
  };
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
  requireAuthorization: false,
  requireGuide: false,
  requireAuthorizationBeforeSession: true,
  requireGuideBeforeSession: false,
  requireProfessionalRegistry: false,
  requirePatientDocument: false,
  allowManualOverride: true,
  minDurationMinutes: null,
  maxDurationVarianceMinutes: 10,
  payerName: null,
  payerId: null,
  appliedPayerRequirementId: null,
  payerRequirementSource: 'DEFAULT'
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
  'pending_confirmation',
  'confirmed',
  'reschedule',
  'reschedule_requested',
  'rescheduled',
  'cancel_requested',
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

function normalizeFinancialContextType(value: any): string {
  const normalized = asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const aliases: Record<string, string> = {
    CONVENIO: 'INSURANCE',
    INSURANCE: 'INSURANCE',
    PARTICULAR: 'PRIVATE',
    PRIVATE: 'PRIVATE',
    PACOTE: 'PACKAGE',
    PACKAGE: 'PACKAGE',
    MENSALIDADE: 'MONTHLY',
    MONTHLY: 'MONTHLY',
    CORTESIA: 'COURTESY',
    COURTESY: 'COURTESY',
    SEM_COBRANCA: 'NO_CHARGE',
    NO_CHARGE: 'NO_CHARGE',
    NAO_FATURAVEL: 'NOT_BILLABLE',
    NOT_BILLABLE: 'NOT_BILLABLE'
  };
  return aliases[normalized] || '';
}

const NON_INSURANCE_FINANCIAL_CONTEXTS = new Set(['PRIVATE', 'PACKAGE', 'MONTHLY', 'COURTESY', 'NO_CHARGE', 'NOT_BILLABLE']);
const NON_BILLABLE_FINANCIAL_CONTEXTS = new Set(['COURTESY', 'NO_CHARGE', 'NOT_BILLABLE']);

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

const PAYER_LINKED_CHECK_KEY = ['payer', 'linked'].join('_');

const PRE_SESSION_KEYS = new Set([
  'patient_linked',
  'professional_linked',
  'service_type_linked',
  'date_time_registered',
  'scheduled_duration_registered',
  'room_or_location_registered',
  PAYER_LINKED_CHECK_KEY,
  'payer_authorization_required',
  'payer_professional_registry',
  'payer_patient_document',
  'no_pending_reschedule_or_cancellation'
]);

const POST_SESSION_KEYS = new Set([
  'session_completed',
  'actual_duration_registered',
  'actual_duration_compatible',
  'report_present',
  'signature_present',
  'payer_signature',
  'payer_report',
  'payer_actual_duration',
  'payer_min_duration',
  'status_billable'
]);

function checklistSectionFor(
  item: ClosureChecklistItem,
  requireAuthorizationBeforeSession: boolean,
  requireGuideBeforeSession: boolean
): ClosureChecklistSection {
  if (item.key === 'payer_authorization_required') {
    return item.required && requireAuthorizationBeforeSession ? 'preSession' : 'tissBilling';
  }
  if (item.key === 'payer_guide_required') {
    return item.required && requireGuideBeforeSession ? 'preSession' : 'tissBilling';
  }
  if (PRE_SESSION_KEYS.has(item.key)) return 'preSession';
  if (POST_SESSION_KEYS.has(item.key)) return 'postSession';
  return 'tissBilling';
}

function operationalStatusFor(
  item: ClosureChecklistItem,
  section: ClosureChecklistSection,
  phase: AppointmentOperationalPhase
): ClosureOperationalStatus {
  if (item.status === 'PASSED') return 'passed';
  if (phase === 'cancelled') return 'info';
  if (
    section === 'postSession' &&
    (phase === 'scheduled_pre_session' || phase === 'in_session')
  ) {
    return 'future_check';
  }
  if (
    section === 'tissBilling' &&
    (phase === 'scheduled_pre_session' || phase === 'in_session')
  ) {
    return item.status === 'NOT_APPLICABLE' ? 'info' : 'future_check';
  }
  if (item.status === 'NOT_APPLICABLE') return 'info';
  if (item.status === 'FAILED' && item.required) return 'blocking_now';
  return 'actionable_now';
}

function buildPhaseSummary(
  phase: AppointmentOperationalPhase,
  checklist: ClosureChecklistItem[]
): AppointmentClosureOutput['phaseSummary'] {
  const actionableCount = checklist.filter((item) =>
    item.operationalStatus === 'blocking_now' || item.operationalStatus === 'actionable_now'
  ).length;
  if (phase === 'scheduled_pre_session') {
    return actionableCount > 0
      ? {
          title: 'Preparação do atendimento',
          message: `${actionableCount} pendência(s) antes da sessão.`,
          status: 'blocked',
          actionableCount
        }
      : {
          title: 'Preparação do atendimento',
          message: 'Pronto para receber o paciente.',
          status: 'ready',
          actionableCount: 0
        };
  }
  if (phase === 'in_session') {
    return {
      title: 'Sessão em aberto',
      message: actionableCount > 0
        ? `${actionableCount} item(ns) de preparação ainda precisam de atenção. Os itens de fechamento serão conferidos após a conclusão.`
        : 'Os itens de fechamento serão conferidos após a conclusão.',
      status: actionableCount > 0 ? 'blocked' : 'open',
      actionableCount
    };
  }
  if (phase === 'completed_pending_closure') {
    return {
      title: 'Fechamento da sessão',
      message: `${actionableCount} pendência(s) para concluir o fechamento.`,
      status: 'blocked',
      actionableCount
    };
  }
  if (phase === 'prefacturing_blocked') {
    return {
      title: 'Faturamento TISS',
      message: `${actionableCount} bloqueio(s) para Pré-guia TISS.`,
      status: 'blocked',
      actionableCount
    };
  }
  if (phase === 'prefacturing_ready' || phase === 'closed_ready_for_prefacturing') {
    return {
      title: 'Faturamento TISS',
      message: 'Pronto para Pré-guia TISS.',
      status: 'ready',
      actionableCount: 0
    };
  }
  return {
    title: 'Consulta cancelada',
    message: 'Esta consulta foi cancelada e não segue para fechamento ou faturamento.',
    status: 'info',
    actionableCount: 0
  };
}

export function buildAppointmentClosureOperationalView(
  checklistInput: ClosureChecklistItem[],
  phaseInput?: AppointmentOperationalPhase | null
) {
  const sourceChecklist = (Array.isArray(checklistInput) ? checklistInput : [])
    .filter((item) => item?.key !== 'authorization_linked');
  let phase =
    phaseInput ||
    sourceChecklist.find((item) => item?.operationalPhase)?.operationalPhase ||
    'scheduled_pre_session';
  const classify = (currentPhase: AppointmentOperationalPhase) => sourceChecklist.map((item) => {
    const section = item.section || checklistSectionFor(item, true, false);
    return {
      ...item,
      section,
      operationalStatus: item.operationalStatus || operationalStatusFor(item, section, currentPhase),
      operationalPhase: currentPhase
    };
  });
  let checklist = classify(phase);
  if (phase === 'completed_pending_closure') {
    const hasPostSessionIssues = checklist.some((item) =>
      item.section === 'postSession' &&
      (item.operationalStatus === 'blocking_now' || item.operationalStatus === 'actionable_now')
    );
    const hasTissIssues = checklist.some((item) =>
      item.section === 'tissBilling' &&
      (item.operationalStatus === 'blocking_now' || item.operationalStatus === 'actionable_now')
    );
    if (!hasPostSessionIssues) {
      phase = hasTissIssues ? 'prefacturing_blocked' : 'prefacturing_ready';
      checklist = classify(phase);
    }
  }
  const sections = phase === 'cancelled' ? {
    preSession: [],
    postSession: [],
    tissBilling: []
  } : {
    preSession: checklist.filter((item) => item.section === 'preSession'),
    postSession: checklist.filter((item) => item.section === 'postSession'),
    tissBilling: checklist.filter((item) =>
      item.section === 'tissBilling' ||
      item.key === 'payer_authorization_required' ||
      item.key === 'payer_guide_required'
    )
  };
  return {
    phase,
    phaseSummary: buildPhaseSummary(phase, checklist),
    sections
  };
}

export function evaluateAppointmentClosureReadiness(input: AppointmentClosureInput): AppointmentClosureOutput {
  const appointment = input.appointment || {};
  const abaSession = input.abaSession || {};
  const summary = input.sessionSummary || {};
  const requirements = { ...DEFAULT_REQUIREMENTS, ...(input.requirements || {}) };
  const payerRequirements: ResolvedPayerRequirements = {
    requireSignature: requirements.requireSignature,
    requireReport: requirements.requireReport,
    requireActualDuration: requirements.requireActualDuration,
    requireAuthorization: requirements.requireAuthorization,
    requireGuide: requirements.requireGuide,
    requireProfessionalRegistry: requirements.requireProfessionalRegistry,
    requirePatientDocument: requirements.requirePatientDocument,
    minDurationMinutes: requirements.minDurationMinutes,
    maxDurationVarianceMinutes: requirements.maxDurationVarianceMinutes,
    allowManualOverride: requirements.allowManualOverride,
    appliedRuleId: requirements.appliedPayerRequirementId || null,
    source: requirements.payerRequirementSource === 'SPECIFIC' || requirements.payerRequirementSource === 'GENERAL' || requirements.payerRequirementSource === 'DEFAULT'
      ? requirements.payerRequirementSource
      : 'DEFAULT'
  };
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
  const authorizationCode = asString(firstValue(
    appointment.authorization_code,
    appointment.authorizationCode,
    appointment.authorization_number,
    appointment.authorizationNumber,
    appointment.authorization_id,
    appointment.authorizationId,
    appointment.patient_tiss_authorization_id,
    appointment.patientTissAuthorizationId,
    appointment.patient_payer_authorization_id,
    appointment.patientPayerAuthorizationId
  ));
  const guideNumber = asString(firstValue(
    appointment.guide_number,
    appointment.guideNumber,
    appointment.guia,
    appointment.tiss_guide_number,
    appointment.tissGuideNumber
  ));
  const professionalName = asString(firstValue(
    input.professional?.full_name,
    input.professional?.fullName,
    input.professional?.name,
    appointment.therapist_name,
    appointment.therapistName
  )) || null;
  const professionalRegistryPresent = hasText(firstValue(
    input.professional?.registry,
    input.professional?.professional_registry,
    input.professional?.crp,
    input.professional?.councilNumber,
    input.professional?.council_number,
    input.professional?.document_number
  ));
  const patientDocumentPresent = hasText(firstValue(input.patient?.document, input.patient?.cpf, input.patient?.responsavelCpf, appointment.patient_document_present));
  const requiredDocuments = Array.isArray(appointment.required_documents) ? appointment.required_documents : [];
  const pendingRequiredDocuments = requiredDocuments.filter((doc: any) => ['REQUIRED', 'PENDING', 'EXPIRED'].includes(asString(doc?.status).toUpperCase()));
  const hasReport = hasText(input.report) ||
    hasText(summary.session_note) ||
    hasText(summary.sessionNote) ||
    hasText(appointment.report_id) ||
    boolLike(appointment.has_report || appointment.hasReport);
  const hasSignature = boolLike(input.signature) ||
    boolLike(summary.signature_present || summary.signaturePresent) ||
    boolLike(appointment.signature_present || appointment.signaturePresent) ||
    boolLike(appointment.has_signature || appointment.hasSignature);
  const hasPendingRescheduleOrCancellation = ['reschedule', 'reschedule_requested', 'cancel_requested'].includes(status) ||
    boolLike(appointment.pending_reschedule || appointment.pendingReschedule || appointment.pending_cancellation || appointment.pendingCancellation);
  const concluded = ['completed', 'concluida', 'concluída', 'concluido', 'concluído'].includes(status) ||
    boolLike(appointment.has_session_record || appointment.hasSessionRecord) ||
    asString(abaSession.status).toLowerCase() === 'completed' ||
    Boolean(actualEnd);
  const inSession = !concluded && (
    ['in_progress', 'active'].includes(status) ||
    Boolean(actualStart)
  );
  const futureOrOpen = (scheduledStart && new Date(scheduledStart).getTime() > now.getTime()) ||
    inSession ||
    (DRAFT_STATUSES.has(status) && !concluded);
  const financialContextType = normalizeFinancialContextType(firstValue(
    appointment.financial_context_type,
    appointment.financialContextType,
    appointment.billing_context_type,
    appointment.billingContextType,
    appointment.payer_type,
    appointment.payerType
  ));
  const nonInsuranceFinancialContext = NON_INSURANCE_FINANCIAL_CONTEXTS.has(financialContextType);
  const notBillable = Boolean(input.manualNotBillable) || NOT_BILLABLE_STATUSES.has(status) || NON_BILLABLE_FINANCIAL_CONTEXTS.has(financialContextType);
  const unknown = !patientId && !scheduledStart && !input.appointmentId && !input.abaSessionId;

  const durationVariance = scheduledMinutes !== null && actualMinutes !== null
    ? Math.abs(actualMinutes - scheduledMinutes)
    : null;
  const durationCompatible = durationVariance === null || requirements.maxDurationVarianceMinutes === null
    ? true
    : durationVariance <= requirements.maxDurationVarianceMinutes;

  const checklist: ClosureChecklistItem[] = [];
  const appointmentPayerId = asString(firstValue(
    requirements.payerId,
    appointment.payer_id,
    appointment.payerId
  ));
  const appointmentPayerName = asString(firstValue(
    appointment.payer_name_snapshot,
    appointment.payerNameSnapshot,
    appointment.payerName,
    requirements.payerName
  ));
  const suggestedPayerName = asString(firstValue(
    requirements.payerName,
    appointment.payer_name_snapshot,
    appointment.payerNameSnapshot,
    appointment.payerName
  ));
  const payerLinkedStatus: ClosureCheckStatus = appointmentPayerId || nonInsuranceFinancialContext ? 'PASSED' : 'FAILED';
  const payerLinkedMessage = appointmentPayerId
    ? `Pagador ${appointmentPayerName || 'informado'} aplicado ao atendimento.`
    : nonInsuranceFinancialContext
      ? `Contexto financeiro definido: ${financialContextType === 'PRIVATE' ? 'particular' : financialContextType === 'PACKAGE' || financialContextType === 'MONTHLY' ? 'pacote/mensalidade' : financialContextType === 'COURTESY' ? 'cortesia' : financialContextType === 'NO_CHARGE' ? 'sem cobrança' : 'não faturável'}.`
    : suggestedPayerName
      ? `Pagador sugerido pelo plano financeiro: ${suggestedPayerName}. Ainda não aplicado ao atendimento.`
      : 'Pagador não configurado para esta conferência.';
  const insuranceCardNumber = asString(firstValue(appointment.insurance_card_number, appointment.insuranceCardNumber, appointment.cardNumber));
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
    room || locationType ? 'PASSED' : requirements.requireRoomWhenClinic ? 'FAILED' : 'NOT_APPLICABLE',
    requirements.requireRoomWhenClinic,
    requirements.requireRoomWhenClinic ? 'HIGH' : 'LOW',
    room || locationType ? 'Sala ou local registrado.' : 'Defina a sala ou o local antes do atendimento.',
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
    payerLinkedStatus,
    !nonInsuranceFinancialContext,
    appointmentPayerId || nonInsuranceFinancialContext ? 'LOW' : 'HIGH',
    payerLinkedMessage,
    {
      present: Boolean(appointmentPayerId || nonInsuranceFinancialContext),
      financialContextType: financialContextType || null,
      suggested: Boolean(!appointmentPayerId && suggestedPayerName),
      suggestedPayerName: suggestedPayerName || null,
      payerName: appointmentPayerId ? appointmentPayerName || null : null,
      insuranceCardPresent: Boolean(insuranceCardNumber),
      source: requirements.payerRequirementSource || 'DEFAULT'
    }
  ));
  const payerEvaluation = evaluatePayerRequirementsForClosure({
    requirements: payerRequirements,
    context: {
      hasSignature,
      hasReport,
      actualMinutes,
      authorizationCode,
      guideNumber,
      professionalRegistryPresent,
      patientDocumentPresent
    }
  });
  payerEvaluation.checklistItems.forEach((payerItem) => {
    if (payerItem.key === 'payer_authorization_required' && payerItem.status === 'FAILED') {
      payerItem.message = 'Autorização do convênio pendente para esta consulta.';
    }
    if (payerItem.key === 'payer_guide_required' && payerItem.status === 'FAILED') {
      payerItem.message = requirements.requireGuideBeforeSession
        ? 'Número da guia pendente antes do atendimento.'
        : 'Guia será conferida na Pré-guia TISS após a sessão.';
    }
    if (payerItem.key === 'payer_professional_registry' && payerItem.status === 'FAILED') {
      payerItem.message = !professionalId
        ? 'Defina um profissional responsável para validar o registro exigido pelo pagador.'
        : `O profissional responsável ${professionalName || 'selecionado'} precisa ter registro profissional cadastrado para este pagador.`;
      payerItem.evidence = {
        ...payerItem.evidence,
        professionalId,
        professionalName
      };
    }
    if (!checklist.some((existing) => existing.key === payerItem.key)) {
      checklist.push(payerItem);
    }
  });
  checklist.push(buildCheck(
    'required_documents_status',
    'Documentos obrigatórios',
    pendingRequiredDocuments.length > 0 ? 'FAILED' : requiredDocuments.length > 0 ? 'PASSED' : 'NOT_APPLICABLE',
    pendingRequiredDocuments.length > 0,
    'HIGH',
    pendingRequiredDocuments.length > 0
      ? `${pendingRequiredDocuments.length} documento(s) obrigatório(s) pendente(s).`
      : requiredDocuments.length > 0
        ? 'Documentos obrigatórios conferidos.'
        : 'Sem documentos obrigatórios adicionais.',
    { pendingCount: pendingRequiredDocuments.length }
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

  let phase: AppointmentOperationalPhase = notBillable
    ? 'cancelled'
    : concluded
      ? 'completed_pending_closure'
      : inSession
        ? 'in_session'
        : 'scheduled_pre_session';
  const classifyChecklist = (currentPhase: AppointmentOperationalPhase) => checklist.map((item) => {
    const section = checklistSectionFor(
      item,
      requirements.requireAuthorizationBeforeSession,
      requirements.requireGuideBeforeSession
    );
    const operationalStatus = operationalStatusFor(item, section, currentPhase);
    return {
      ...item,
      section,
      operationalStatus,
      operationalPhase: currentPhase
    };
  });
  let operationalChecklist = classifyChecklist(phase);
  if (concluded && !notBillable) {
    const hasPostSessionIssues = operationalChecklist.some((item) =>
      item.section === 'postSession' &&
      (item.operationalStatus === 'blocking_now' || item.operationalStatus === 'actionable_now')
    );
    const hasTissIssues = operationalChecklist.some((item) =>
      item.section === 'tissBilling' &&
      (item.operationalStatus === 'blocking_now' || item.operationalStatus === 'actionable_now')
    );
    phase = hasPostSessionIssues
      ? 'completed_pending_closure'
      : hasTissIssues
        ? 'prefacturing_blocked'
        : nonInsuranceFinancialContext
          ? 'closed_ready_for_prefacturing'
          : 'prefacturing_ready';
    operationalChecklist = classifyChecklist(phase);
  }
  const blockingIssues = operationalChecklist.filter((item) => item.operationalStatus === 'blocking_now');
  const warningIssues = operationalChecklist.filter((item) => item.operationalStatus === 'actionable_now');
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
  const operationalView = buildAppointmentClosureOperationalView(operationalChecklist, phase);

  const contextHash = stableHash({
    engineVersion: 'operational-phases-v2-split-payer-documents',
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
    authorizationCode,
    guideNumber,
    payerId: requirements.payerId || appointment.payer_id || appointment.payerId || null,
    financialContextType: financialContextType || null,
    payerRequirementSource: requirements.payerRequirementSource || null,
    appliedPayerRequirementId: requirements.appliedPayerRequirementId || null,
    requireAuthorizationBeforeSession: requirements.requireAuthorizationBeforeSession,
    requireGuideBeforeSession: requirements.requireGuideBeforeSession,
    professionalId,
    professionalName,
    professionalRegistryPresent,
    serviceType,
    room,
    locationType,
    hasReport,
    hasSignature,
    pendingRequiredDocumentsCount: pendingRequiredDocuments.length,
    appointmentUpdatedAt: appointment.updated_at || appointment.updatedAt || null,
    sessionUpdatedAt: abaSession.updated_at || abaSession.updatedAt || null,
    summaryUpdatedAt: summary.updated_at || summary.updatedAt || null
  });

  return {
    readinessStatus,
    phase,
    phaseSummary: operationalView.phaseSummary,
    sections: operationalView.sections,
    checklist: operationalChecklist,
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
