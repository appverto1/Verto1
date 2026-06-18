import { buildTissAntiGlosaChecklist } from './tissAntiGlosaChecklist';
import { deriveTissRevenueCycleStateFromPreGuide } from './tissRevenueCycleStateMachine';
import {
  isSupportedAttendanceCharacter040300,
  isSupportedAttendanceRegime040300,
  isSupportedAttendanceType040300,
  normalizeAttendanceCharacter040300,
  normalizeAttendanceRegime040300,
  normalizeAttendanceType040300
} from './tissOfficial/versions/communication040300/domains';

export type TissPreGuideStatus = 'draft' | 'valid' | 'pending_data' | 'not_applicable' | 'cancelled';

export type TissPreGuideIssue = {
  code: string;
  field: string;
  message: string;
  section: 'appointment' | 'beneficiary' | 'provider' | 'payer' | 'professional' | 'procedure' | 'authorization' | 'signature';
  entity?: 'appointment' | 'beneficiary' | 'provider' | 'payer' | 'professional' | 'procedure' | 'authorization' | 'signature';
  severity?: 'blocking' | 'warning';
  action?: string;
};

export type TissPreGuideValidationInput = {
  appointment?: Record<string, any> | null;
  patient?: Record<string, any> | null;
  payer?: Record<string, any> | null;
  billingContext?: Record<string, any> | null;
  billingItem?: Record<string, any> | null;
  service?: Record<string, any> | null;
  tussCode?: Record<string, any> | null;
  mapping?: Record<string, any> | null;
  price?: Record<string, any> | null;
  clinic?: Record<string, any> | null;
  clinicProfile?: Record<string, any> | null;
  payerProfile?: Record<string, any> | null;
  professionalProfile?: Record<string, any> | null;
  professional?: Record<string, any> | null;
  authorization?: Record<string, any> | null;
  signature?: Record<string, any> | null;
};

export type TissPreGuideValidationResult = {
  status: TissPreGuideStatus;
  guideType: 'consulta' | 'sp_sadt' | 'other';
  errors: TissPreGuideIssue[];
  warnings: TissPreGuideIssue[];
  errorCodes: string[];
  warningCodes: string[];
  snapshot: Record<string, any>;
};

export type TissPreGuideEligibilityResult = {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'appointment_missing'
    | 'patient_missing'
    | 'professional_missing'
    | 'missing_financial_context'
    | 'missing_payer'
    | 'not_applicable';
  financialContext: string | null;
  payerId: string | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const positiveNumber = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const amountCentsOrNull = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
};
const normalizedIdentity = (value: unknown) =>
  text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const isLikelyProfessionalNameFallback = (candidate: unknown, professionalName: unknown) => {
  const clinicName = normalizedIdentity(candidate);
  const executorName = normalizedIdentity(professionalName);
  if (!clinicName || !executorName) return false;
  if (clinicName === executorName) return true;
  const clinicTokens = clinicName.split(/\s+/).filter(Boolean);
  return clinicTokens.length === 1 && executorName.split(/\s+/).includes(clinicTokens[0]);
};

const isPlaceholderExecutorName = (value: unknown) => {
  const normalized = normalizedIdentity(value);
  return ['equipe', 'team', 'profissional a definir', 'profissional indefinido'].includes(normalized);
};

const resolveProviderTradeName = (input: {
  clinicProfile: Record<string, any>;
  clinic: Record<string, any>;
  professionalProfile: Record<string, any>;
  professional: Record<string, any>;
}) => {
  const profileTradeName = text(input.clinicProfile.trade_name);
  if (profileTradeName) {
    return {
      value: profileTradeName,
      source: 'clinic_tiss_profiles.trade_name',
      didUseProfessionalAsClinicFallback: false,
    };
  }

  const clinicName = text(
    input.clinic.trade_name ||
      input.clinic.tradeName ||
      input.clinic.display_name ||
      input.clinic.displayName ||
      input.clinic.name ||
      input.clinic.clinic_name ||
      input.clinic.clinicName,
  );
  const professionalName = text(input.professionalProfile.display_name || input.professional.name);
  if (clinicName && !isLikelyProfessionalNameFallback(clinicName, professionalName)) {
    return {
      value: clinicName,
      source: 'clinics.name',
      didUseProfessionalAsClinicFallback: false,
    };
  }

  return {
    value: '',
    source: clinicName ? 'blocked_professional_name_match' : null,
    didUseProfessionalAsClinicFallback: false,
  };
};

const normalizeContext = (value: unknown) =>
  text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const NON_TISS_CONTEXTS = new Set([
  'PRIVATE',
  'PARTICULAR',
  'PACKAGE',
  'PACOTE',
  'MONTHLY',
  'MONTHLY_PACKAGE',
  'MENSALIDADE',
  'COURTESY',
  'CORTESIA',
  'NO_CHARGE',
  'SEM_COBRANCA',
  'NOT_BILLABLE',
  'NON_BILLABLE',
  'NAO_FATURAVEL',
]);

const dateOnly = (value: unknown) => text(value).slice(0, 10);
const isBeforeDate = (left: unknown, right: unknown) => {
  const leftDate = dateOnly(left);
  const rightDate = dateOnly(right);
  return Boolean(leftDate && rightDate && leftDate < rightDate);
};
const isAfterDate = (left: unknown, right: unknown) => {
  const leftDate = dateOnly(left);
  const rightDate = dateOnly(right);
  return Boolean(leftDate && rightDate && leftDate > rightDate);
};

export function evaluateTissPreGuideEligibility(input: {
  appointment?: Record<string, any> | null;
  billingContext?: Record<string, any> | null;
}): TissPreGuideEligibilityResult {
  const appointment = input.appointment || {};
  const billingContext = input.billingContext || {};
  const financialContext = normalizeContext(
    billingContext.payer_type ||
      billingContext.financial_context_type ||
      appointment.financial_context_type ||
      appointment.payer_type,
  ) || null;
  const payerId = text(billingContext.payer_id || appointment.payer_id || appointment.payerId) || null;
  const appointmentId = text(appointment.id || appointment.appointment_id);
  const patientId = text(appointment.patient_id || appointment.patientId);

  if (!appointmentId) return { eligible: false, reason: 'appointment_missing', financialContext, payerId };
  if (!patientId) return { eligible: false, reason: 'patient_missing', financialContext, payerId };
  if (financialContext && NON_TISS_CONTEXTS.has(financialContext)) {
    return { eligible: false, reason: 'not_applicable', financialContext, payerId };
  }
  if (financialContext !== 'INSURANCE') {
    return { eligible: false, reason: 'missing_financial_context', financialContext, payerId };
  }
  if (!payerId) return { eligible: false, reason: 'missing_payer', financialContext, payerId };
  return { eligible: true, reason: 'eligible', financialContext, payerId };
}

const addIssue = (
  target: TissPreGuideIssue[],
  code: string,
  field: string,
  message: string,
  section: TissPreGuideIssue['section'],
  severity: TissPreGuideIssue['severity'] = 'blocking',
) => {
  if (!target.some((item) => item.code === code)) {
    target.push({
      code,
      field,
      message,
      section,
      entity: section,
      severity,
      action: tissPreGuideIssueAction(code, section),
    });
  }
};

const normalizeGuideType = (value: unknown): TissPreGuideValidationResult['guideType'] => {
  const normalized = normalizeContext(value).toLowerCase();
  if (normalized === 'consulta') return 'consulta';
  if (normalized === 'other' || normalized === 'outro') return 'other';
  return 'sp_sadt';
};

const VALID_RESPONSIBLE_SIGNATURE_STATUSES = new Set(['SIGNED', 'ACTIVE', 'COMPLETED', 'CONCLUIDA', 'CONCLUIDO']);

const issueLabelOverrides: Record<string, string> = {
  APPOINTMENT_MISSING: 'Atendimento não encontrado',
  PATIENT_MISSING: 'Paciente não vinculado',
  PATIENT_NAME_MISSING: 'Nome do beneficiário não informado',
  PROFESSIONAL_MISSING: 'Profissional executante não definido para este agendamento',
  PROFESSIONAL_NOT_DEFINED: 'Profissional executante não definido para este agendamento',
  SCHEDULE_MISSING: 'Data e horário não informados',
  DURATION_MISSING: 'Duração não informada',
  FINANCIAL_CONTEXT_MISSING: 'Contexto financeiro não informado',
  PAYER_MISSING: 'Pagador não aplicado ao atendimento',
  BENEFICIARY_CARD_MISSING: 'Carteirinha do beneficiário não informada',
  BENEFICIARY_CARD_VALIDITY_MISSING: 'Validade da carteirinha não informada',
  BENEFICIARY_CARD_EXPIRED: 'Carteirinha vencida na data do atendimento',
  CLINIC_TISS_PROFILE_MISSING: 'Dados do prestador não configurados',
  PROVIDER_DOCUMENT_MISSING: 'CPF/CNPJ do prestador não informado',
  PROVIDER_CODE_MISSING: 'Código do prestador não informado',
  CNES_MISSING: 'CNES não informado',
  PAYER_TISS_PROFILE_MISSING: 'Dados TISS do pagador não configurados',
  PAYER_CONFIGURATION_INCOMPLETE: 'Configuração do convênio incompleta',
  PAYER_TISS_VERSION_MISSING: 'Configuração legada de versão TISS do pagador não configurada',
  PAYER_ATTENDANCE_TYPE_INVALID: 'Tipo de atendimento TISS oficial não configurado',
  PAYER_ATTENDANCE_REGIME_INVALID: 'Regime de atendimento TISS oficial não configurado',
  PAYER_ATTENDANCE_CHARACTER_INVALID: 'Caráter de atendimento TISS oficial não configurado',
  PAYER_ANS_REGISTRATION_MISSING: 'Registro ANS do pagador não informado',
  PAYER_CONTRACTED_PROVIDER_CODE_MISSING: 'Código do contratado na operadora não informado',
  PAYER_CID_REQUIRED: 'Convênio exige CID para a pré-guia',
  TISS_VERSION_MISSING: 'Configuração legada de versão TISS do pagador não configurada',
  PROFESSIONAL_BILLING_PROFILE_MISSING: 'Perfil faturável do profissional não configurado',
  PROFESSIONAL_REGISTRY_MISSING: 'Registro profissional não informado',
  PROFESSIONAL_COUNCIL_STATE_MISSING: 'UF do conselho não informada',
  CBO_MISSING: 'CBO não informado',
  PAYER_TUSS_MAPPING_MISSING: 'Procedimento sem mapeamento TUSS para este convênio',
  PAYER_TUSS_MAPPING_EXPIRED: 'Mapeamento TUSS do convênio vencido para a data do atendimento',
  PAYER_PROCEDURE_PRICE_MISSING: 'Procedimento sem valor negociado vigente para este convênio',
  PAYER_PROCEDURE_PRICE_CONFLICT: 'Mais de um valor negociado vigente foi encontrado para este procedimento',
  PAYER_PROCEDURE_PRICE_UNRESOLVED_SNAPSHOT_PRESERVED: 'O valor histórico foi preservado, mas a configuração vigente precisa ser revisada',
  PROCEDURE_INACTIVE_HISTORICAL_SNAPSHOT: 'Procedimento inativo mantido apenas para preservar o histórico deste atendimento',
  PROCEDURE_MISSING: 'Procedimento interno não resolvido',
  TUSS_CODE_MISSING: 'Código TUSS não resolvido',
  TUSS_DESCRIPTION_MISSING: 'Descrição TUSS não informada',
  QUANTITY_MISSING: 'Quantidade não informada',
  BILLING_UNIT_MISSING: 'Unidade de cobrança não informada',
  AMOUNT_MISSING: 'Valor previsto não informado',
  GUIDE_MISSING: 'Guia não informada',
  AUTHORIZATION_REQUIRED: 'Convênio exige autorização, mas nenhuma autorização ativa foi encontrada para este paciente/procedimento',
  AUTHORIZATION_MISSING: 'Convênio exige autorização, mas nenhuma autorização ativa foi encontrada para este paciente/procedimento',
  AUTHORIZATION_INACTIVE: 'Autorização encontrada não está ativa',
  AUTHORIZATION_NOT_STARTED: 'Autorização ainda não está vigente na data do atendimento',
  AUTHORIZATION_EXPIRED: 'Autorização vencida para a data do atendimento',
  AUTHORIZATION_PROCEDURE_MISMATCH: 'Autorização não cobre o procedimento/TUSS do atendimento',
  AUTHORIZED_PROCEDURE_NOT_INFORMED: 'Procedimento autorizado não informado',
  AUTHORIZATION_EXHAUSTED: 'Autorização esgotada',
  RESPONSIBLE_SIGNATURE_REQUIRED: 'Assinatura do responsável exigida pelo convênio',
};

export function tissPreGuideIssueLabel(code: unknown) {
  if (issueLabelOverrides[text(code)]) return issueLabelOverrides[text(code)];
  const labels: Record<string, string> = {
    APPOINTMENT_MISSING: 'Atendimento não encontrado',
    PATIENT_MISSING: 'Paciente não vinculado',
    PATIENT_NAME_MISSING: 'Nome do beneficiário não informado',
    PROFESSIONAL_MISSING: 'Profissional executante não definido para este agendamento',
    PROFESSIONAL_NOT_DEFINED: 'Profissional executante não definido para este agendamento',
    SCHEDULE_MISSING: 'Data e horário não informados',
    DURATION_MISSING: 'Duração não informada',
    FINANCIAL_CONTEXT_MISSING: 'Contexto financeiro não informado',
    PAYER_MISSING: 'Pagador não aplicado ao atendimento',
    BENEFICIARY_CARD_MISSING: 'Carteirinha do beneficiário não informada',
    CLINIC_TISS_PROFILE_MISSING: 'Dados do prestador não configurados',
    PROVIDER_DOCUMENT_MISSING: 'CPF/CNPJ do prestador não informado',
    PROVIDER_CODE_MISSING: 'Código do prestador não informado',
    CNES_MISSING: 'CNES não informado',
    PAYER_TISS_PROFILE_MISSING: 'Dados TISS do pagador não configurados',
    PAYER_CONFIGURATION_INCOMPLETE: 'Configuração do convênio incompleta',
    PAYER_TISS_VERSION_MISSING: 'Configuração legada de versão TISS do pagador não configurada',
    PAYER_ATTENDANCE_TYPE_INVALID: 'Tipo de atendimento TISS oficial não configurado',
    PAYER_ATTENDANCE_REGIME_INVALID: 'Regime de atendimento TISS oficial não configurado',
    PAYER_ATTENDANCE_CHARACTER_INVALID: 'Caráter de atendimento TISS oficial não configurado',
    PAYER_ANS_REGISTRATION_MISSING: 'Registro ANS do pagador não informado',
    TISS_VERSION_MISSING: 'Configuração legada de versão TISS do pagador não configurada',
    PROFESSIONAL_BILLING_PROFILE_MISSING: 'Perfil faturável do profissional não configurado',
    PROFESSIONAL_REGISTRY_MISSING: 'Registro profissional não informado',
    PROFESSIONAL_COUNCIL_STATE_MISSING: 'UF do conselho não informada',
    CBO_MISSING: 'CBO não informado',
    PAYER_TUSS_MAPPING_MISSING: 'Procedimento sem mapeamento TUSS para este convênio',
    PAYER_TUSS_MAPPING_EXPIRED: 'Mapeamento TUSS vencido',
    PAYER_PROCEDURE_PRICE_MISSING: 'Valor negociado ausente',
    PAYER_PROCEDURE_PRICE_CONFLICT: 'Conflito de valores negociados',
    PAYER_PROCEDURE_PRICE_UNRESOLVED_SNAPSHOT_PRESERVED: 'Valor histórico preservado; revise a configuração vigente',
    PROCEDURE_INACTIVE_HISTORICAL_SNAPSHOT: 'Procedimento histórico inativo',
    PROCEDURE_MISSING: 'Procedimento interno não resolvido',
    TUSS_CODE_MISSING: 'Código TUSS não resolvido',
    TUSS_DESCRIPTION_MISSING: 'Descrição TUSS não informada',
    QUANTITY_MISSING: 'Quantidade não informada',
    BILLING_UNIT_MISSING: 'Unidade de cobrança não informada',
    AMOUNT_MISSING: 'Valor previsto não informado',
    GUIDE_MISSING: 'Guia não informada',
    AUTHORIZATION_REQUIRED: 'Autorização não informada',
    AUTHORIZATION_MISSING: 'Autorização não informada',
    AUTHORIZATION_EXPIRED: 'Autorização vencida',
    AUTHORIZATION_EXHAUSTED: 'Autorização esgotada',
    AUTHORIZED_PROCEDURE_NOT_INFORMED: 'Procedimento autorizado não informado',
  };
  return labels[text(code)] || text(code) || 'Pendência TISS';
}

export function tissPreGuideIssueAction(code: unknown, section?: TissPreGuideIssue['section']) {
  const normalized = text(code);
  if (normalized === 'PROFESSIONAL_NOT_DEFINED') return 'Vincular profissional executante ao agendamento ou item faturável';
  if (normalized === 'RESPONSIBLE_SIGNATURE_REQUIRED' || section === 'signature') return 'Coletar assinatura';
  if (normalized === 'PAYER_TUSS_MAPPING_MISSING' || normalized === 'PAYER_TUSS_MAPPING_EXPIRED') return 'Configurar convênio';
  if (normalized === 'PAYER_PROCEDURE_PRICE_MISSING' || normalized === 'PAYER_PROCEDURE_PRICE_CONFLICT') return 'Configurar convênio';
  if (normalized.includes('PAYER') || section === 'payer') return 'Configurar convênio';
  if (normalized.includes('BENEFICIARY') || section === 'beneficiary') return 'Corrigir paciente';
  if (normalized.includes('PROFESSIONAL') || normalized === 'CBO_MISSING' || section === 'professional') return 'Corrigir profissional';
  if (normalized.includes('PROCEDURE') || normalized.includes('TUSS') || normalized.includes('AMOUNT') || section === 'procedure') return 'Corrigir procedimento/TUSS';
  if (['AUTHORIZATION_EXPIRED', 'AUTHORIZATION_EXHAUSTED', 'AUTHORIZATION_PROCEDURE_MISMATCH', 'AUTHORIZED_PROCEDURE_NOT_INFORMED'].includes(normalized)) return 'Atualizar autorização';
  if (normalized.includes('AUTHORIZATION') || normalized.includes('GUIDE') || section === 'authorization') return 'Adicionar autorização';
  if (normalized.includes('PROVIDER') || normalized.includes('CNES') || section === 'provider') return 'Corrigir prestador';
  return 'Revisar pendência';
}

export function validateTissPreGuide(input: TissPreGuideValidationInput): TissPreGuideValidationResult {
  const appointment = input.appointment || {};
  const patient = input.patient || {};
  const payer = input.payer || {};
  const billingContext = input.billingContext || {};
  const billingItem = input.billingItem || {};
  const service = input.service || {};
  const tussCode = input.tussCode || {};
  const mapping = input.mapping || {};
  const price = input.price || {};
  const clinic = input.clinic || {};
  const clinicProfile = input.clinicProfile || {};
  const payerProfile = input.payerProfile || {};
  const professionalProfile = input.professionalProfile || {};
  const professional = input.professional || {};
  const authorization = input.authorization || {};
  const signature = input.signature || {};
  const errors: TissPreGuideIssue[] = [];
  const warnings: TissPreGuideIssue[] = [];

  const financialContext = normalizeContext(
    billingContext.payer_type ||
      billingContext.financial_context_type ||
      appointment.financial_context_type ||
      appointment.payer_type,
  );
  const payerId = text(billingContext.payer_id || billingItem.payer_id || payer.id);
  const payerType = normalizeContext(payer.payer_type || payer.payerType || payer.type);
  const appointmentId = text(appointment.id || appointment.appointment_id || billingItem.appointment_id);
  const patientId = text(appointment.patient_id || billingItem.patient_id || patient.id);
  const professionalId = text(
    billingItem.professional_id ||
      appointment.professional_id ||
      appointment.therapist_id ||
      professionalProfile.professional_id ||
      professional.id,
  );
  const scheduledStart = text(
    appointment.scheduled_start ||
      appointment.scheduled_start_at ||
      appointment.scheduled_at ||
      appointment.date,
  );
  const durationMinutes = Number(
    appointment.actual_minutes ||
      appointment.actual_duration_minutes ||
      billingItem.duration_minutes ||
      appointment.scheduled_minutes ||
      appointment.scheduled_duration_minutes ||
      appointment.duration_minutes ||
      0,
  );
  const guideType = normalizeGuideType(billingItem.guide_type || mapping.guide_type || payerProfile.default_guide_type);

  if (NON_TISS_CONTEXTS.has(financialContext) || NON_TISS_CONTEXTS.has(payerType)) {
    const status: TissPreGuideStatus = 'not_applicable';
    const snapshot: Record<string, any> = {
      financialContext,
      payerType: payerType || null,
      notApplicableReason: 'Contexto financeiro fora de convênio/TISS.',
    };
    snapshot.antiGlosaChecklist = buildTissAntiGlosaChecklist({
      status,
      errors: [],
      warnings: [],
      errorCodes: [],
      warningCodes: [],
      snapshot,
    });
    const revenueCycle = deriveTissRevenueCycleStateFromPreGuide({
      status,
      validationErrorCodes: [],
      snapshot,
    });
    snapshot.revenueCycle = {
      state: revenueCycle.state,
      reason: revenueCycle.reason,
      canAdvanceToBilling: false,
    };
    return {
      status,
      guideType,
      errors: [],
      warnings: [],
      errorCodes: [],
      warningCodes: [],
      snapshot,
    };
  }

  if (!appointmentId) addIssue(errors, 'APPOINTMENT_MISSING', 'appointment_id', tissPreGuideIssueLabel('APPOINTMENT_MISSING'), 'appointment');
  if (!patientId) addIssue(errors, 'PATIENT_MISSING', 'patient_id', tissPreGuideIssueLabel('PATIENT_MISSING'), 'beneficiary');
  if (!text(patient.name || appointment.patient_name)) addIssue(errors, 'PATIENT_NAME_MISSING', 'patient_name', tissPreGuideIssueLabel('PATIENT_NAME_MISSING'), 'beneficiary');
  if (!professionalId) addIssue(errors, 'PROFESSIONAL_NOT_DEFINED', 'professional_id', tissPreGuideIssueLabel('PROFESSIONAL_NOT_DEFINED'), 'professional');
  if (!scheduledStart) addIssue(errors, 'SCHEDULE_MISSING', 'scheduled_start', tissPreGuideIssueLabel('SCHEDULE_MISSING'), 'appointment');
  if (!positiveNumber(durationMinutes)) addIssue(errors, 'DURATION_MISSING', 'duration_minutes', tissPreGuideIssueLabel('DURATION_MISSING'), 'appointment');
  if (!financialContext && !payerId) addIssue(errors, 'FINANCIAL_CONTEXT_MISSING', 'financial_context_type', tissPreGuideIssueLabel('FINANCIAL_CONTEXT_MISSING'), 'appointment');
  if (!payerId) addIssue(errors, 'PAYER_MISSING', 'payer_id', tissPreGuideIssueLabel('PAYER_MISSING'), 'payer');

  if (!text(clinicProfile.id)) {
    addIssue(errors, 'CLINIC_TISS_PROFILE_MISSING', 'provider_profile_id', tissPreGuideIssueLabel('CLINIC_TISS_PROFILE_MISSING'), 'provider');
  } else {
    if (!text(clinicProfile.document_type) || !text(clinicProfile.document_number)) {
      addIssue(errors, 'PROVIDER_DOCUMENT_MISSING', 'provider_document', tissPreGuideIssueLabel('PROVIDER_DOCUMENT_MISSING'), 'provider');
    }
    if (payerProfile.requires_provider_code && !text(clinicProfile.provider_code || clinicProfile.ans_provider_code)) {
      addIssue(errors, 'PROVIDER_CODE_MISSING', 'provider_code', tissPreGuideIssueLabel('PROVIDER_CODE_MISSING'), 'provider');
    }
    if (payerProfile.requires_cnes && !text(clinicProfile.cnes_code)) {
      addIssue(errors, 'CNES_MISSING', 'cnes_code', tissPreGuideIssueLabel('CNES_MISSING'), 'provider');
    }
  }

  if (payerId && !text(payerProfile.id)) {
    addIssue(errors, 'PAYER_TISS_PROFILE_MISSING', 'payer_tiss_profile_id', tissPreGuideIssueLabel('PAYER_TISS_PROFILE_MISSING'), 'payer');
  } else if (payerId) {
    if (!text(payerProfile.ans_registration)) {
      addIssue(errors, 'PAYER_ANS_REGISTRATION_MISSING', 'ans_registration', tissPreGuideIssueLabel('PAYER_ANS_REGISTRATION_MISSING'), 'payer');
    }
    if (payerProfile.requires_provider_code && !text(payerProfile.contracted_provider_code || payerProfile.operator_provider_code || payerProfile.operator_code)) {
      addIssue(errors, 'PAYER_CONTRACTED_PROVIDER_CODE_MISSING', 'contracted_provider_code', tissPreGuideIssueLabel('PAYER_CONTRACTED_PROVIDER_CODE_MISSING'), 'payer');
    }
    const attendanceType = normalizeAttendanceType040300(payerProfile.default_attendance_type);
    const attendanceRegime = normalizeAttendanceRegime040300(payerProfile.default_attendance_regime);
    const attendanceCharacter = normalizeAttendanceCharacter040300(payerProfile.default_attendance_character);
    if (!attendanceType || !isSupportedAttendanceType040300(attendanceType)) {
      addIssue(errors, 'PAYER_ATTENDANCE_TYPE_INVALID', 'default_attendance_type', tissPreGuideIssueLabel('PAYER_ATTENDANCE_TYPE_INVALID'), 'payer');
    }
    if (!attendanceRegime || !isSupportedAttendanceRegime040300(attendanceRegime)) {
      addIssue(errors, 'PAYER_ATTENDANCE_REGIME_INVALID', 'default_attendance_regime', tissPreGuideIssueLabel('PAYER_ATTENDANCE_REGIME_INVALID'), 'payer');
    }
    if (!attendanceCharacter || !isSupportedAttendanceCharacter040300(attendanceCharacter)) {
      addIssue(errors, 'PAYER_ATTENDANCE_CHARACTER_INVALID', 'default_attendance_character', tissPreGuideIssueLabel('PAYER_ATTENDANCE_CHARACTER_INVALID'), 'payer');
    }
    if (payerProfile.requires_cid && !text(billingContext.cid_code || billingContext.cid || appointment.cid_code || appointment.cid)) {
      addIssue(errors, 'PAYER_CID_REQUIRED', 'cid_code', tissPreGuideIssueLabel('PAYER_CID_REQUIRED'), 'payer');
    }
  }

  const requiresRegistry = Boolean(
    payerProfile.requires_executant_registry ||
      mapping.requires_professional_registry,
  );
  if (!text(professionalProfile.id) && (requiresRegistry || payerProfile.requires_cbo)) {
    addIssue(errors, 'PROFESSIONAL_BILLING_PROFILE_MISSING', 'professional_billing_profile_id', tissPreGuideIssueLabel('PROFESSIONAL_BILLING_PROFILE_MISSING'), 'professional');
  }
  const councilNumber = text(
    professionalProfile.council_number ||
      professional.council_number ||
      professional.professional_registry ||
      professional.registry ||
      professional.crp,
  );
  const councilType = text(professionalProfile.council_type || professional.council || professional.council_type);
  if (requiresRegistry && (!councilNumber || !councilType)) {
    addIssue(errors, 'PROFESSIONAL_REGISTRY_MISSING', 'professional_registry', tissPreGuideIssueLabel('PROFESSIONAL_REGISTRY_MISSING'), 'professional');
  }
  if (requiresRegistry && !text(professionalProfile.council_state || professional.council_state)) {
    addIssue(errors, 'PROFESSIONAL_COUNCIL_STATE_MISSING', 'council_state', tissPreGuideIssueLabel('PROFESSIONAL_COUNCIL_STATE_MISSING'), 'professional');
  }
  if (payerProfile.requires_cbo && !text(professionalProfile.cbo_code)) {
    addIssue(errors, 'CBO_MISSING', 'cbo_code', tissPreGuideIssueLabel('CBO_MISSING'), 'professional');
  }

  const procedureCode = text(service.internal_code || billingItem.internal_procedure_code);
  const procedureName = text(service.name || billingItem.internal_procedure_name);
  const resolvedTussCode = text(tussCode.code || billingItem.tuss_code);
  const tussDescription = text(tussCode.description || billingItem.tuss_description);
  const quantity = Number(billingItem.quantity || service.default_quantity || mapping.default_quantity || 0);
  const unit = text(billingItem.billing_unit || mapping.billing_unit || service.billing_unit);
  const unitAmountCents = amountCentsOrNull(
    price.amount_cents ??
      billingItem.unit_amount_cents ??
      service.default_amount_cents,
  );
  const explicitPriceAmountCents = amountCentsOrNull(price.amount_cents);
  const persistedTotalAmountCents = amountCentsOrNull(billingItem.amount_cents);
  const totalAmountCents = explicitPriceAmountCents !== null && positiveNumber(quantity)
    ? explicitPriceAmountCents * Number(quantity)
    : persistedTotalAmountCents ?? (positiveNumber(quantity) && unitAmountCents !== null ? quantity * unitAmountCents : null);
  const executorName = text(professionalProfile.display_name || professional.name);
  const mappingId = text(mapping.id || billingItem.payer_tuss_mapping_id);
  const mappingExpiredForAppointment = Boolean(
    mappingId &&
      scheduledStart &&
      ((mapping.valid_from && isAfterDate(mapping.valid_from, scheduledStart)) ||
        (mapping.valid_to && isBeforeDate(mapping.valid_to, scheduledStart))),
  );
  const hasNegotiatedPrice = Boolean(
    text(price.id) ||
      positiveNumber(price.amount_cents) ||
      positiveNumber(billingItem.unit_amount_cents) ||
      positiveNumber(billingItem.amount_cents),
  );

  if (!procedureCode && !procedureName) addIssue(errors, 'PROCEDURE_MISSING', 'internal_procedure', tissPreGuideIssueLabel('PROCEDURE_MISSING'), 'procedure');
  if (payerId && (procedureCode || procedureName || text(service.id || billingItem.service_catalog_id)) && !mappingId) {
    addIssue(errors, 'PAYER_TUSS_MAPPING_MISSING', 'payer_tuss_mapping_id', tissPreGuideIssueLabel('PAYER_TUSS_MAPPING_MISSING'), 'procedure');
  }
  if (mappingExpiredForAppointment) {
    addIssue(errors, 'PAYER_TUSS_MAPPING_EXPIRED', 'payer_tuss_mapping_id', tissPreGuideIssueLabel('PAYER_TUSS_MAPPING_EXPIRED'), 'procedure');
  }
  if (price.conflict) {
    addIssue(errors, 'PAYER_PROCEDURE_PRICE_CONFLICT', 'payer_procedure_price_id', tissPreGuideIssueLabel('PAYER_PROCEDURE_PRICE_CONFLICT'), 'procedure');
  }
  if (mappingId && !hasNegotiatedPrice) {
    addIssue(errors, 'PAYER_PROCEDURE_PRICE_MISSING', 'payer_procedure_price_id', tissPreGuideIssueLabel('PAYER_PROCEDURE_PRICE_MISSING'), 'procedure');
  }
  if (
    service.id && service.active === false &&
    (positiveNumber(billingItem.unit_amount_cents) || positiveNumber(billingItem.amount_cents))
  ) {
    addIssue(warnings, 'PROCEDURE_INACTIVE_HISTORICAL_SNAPSHOT', 'service_catalog_id', tissPreGuideIssueLabel('PROCEDURE_INACTIVE_HISTORICAL_SNAPSHOT'), 'procedure', 'warning');
  }
  if (
    mappingId && !text(price.id) &&
    (positiveNumber(billingItem.unit_amount_cents) || positiveNumber(billingItem.amount_cents))
  ) {
    addIssue(warnings, 'PAYER_PROCEDURE_PRICE_UNRESOLVED_SNAPSHOT_PRESERVED', 'payer_procedure_price_id', tissPreGuideIssueLabel('PAYER_PROCEDURE_PRICE_UNRESOLVED_SNAPSHOT_PRESERVED'), 'procedure', 'warning');
  }
  if (!resolvedTussCode) addIssue(errors, 'TUSS_CODE_MISSING', 'tuss_code', tissPreGuideIssueLabel('TUSS_CODE_MISSING'), 'procedure');
  if (resolvedTussCode && !tussDescription) addIssue(errors, 'TUSS_DESCRIPTION_MISSING', 'tuss_description', tissPreGuideIssueLabel('TUSS_DESCRIPTION_MISSING'), 'procedure');
  if (!positiveNumber(quantity)) addIssue(errors, 'QUANTITY_MISSING', 'quantity', tissPreGuideIssueLabel('QUANTITY_MISSING'), 'procedure');
  if (!unit) addIssue(errors, 'BILLING_UNIT_MISSING', 'unit', tissPreGuideIssueLabel('BILLING_UNIT_MISSING'), 'procedure');
  if (!positiveNumber(totalAmountCents)) addIssue(errors, 'AMOUNT_MISSING', 'total_amount_cents', tissPreGuideIssueLabel('AMOUNT_MISSING'), 'procedure');

  const cardNumber = text(billingContext.insurance_card_number || billingItem.card_number || patient.insurance_card_number);
  const cardValidUntil = text(
    billingContext.insurance_card_valid_until ||
      billingContext.card_valid_until ||
      billingContext.metadata?.insurance_card_valid_until ||
      patient.insurance_card_valid_until ||
      patient.insurance_card_validity,
  );
  if (payerProfile.requires_beneficiary_card && !cardNumber) {
    addIssue(errors, 'BENEFICIARY_CARD_MISSING', 'beneficiary_card_number', tissPreGuideIssueLabel('BENEFICIARY_CARD_MISSING'), 'beneficiary');
  }
  if (payerProfile.requires_beneficiary_card_validity && !cardValidUntil) {
    addIssue(errors, 'BENEFICIARY_CARD_VALIDITY_MISSING', 'beneficiary_card_valid_until', tissPreGuideIssueLabel('BENEFICIARY_CARD_VALIDITY_MISSING'), 'beneficiary');
  }
  if (payerProfile.requires_beneficiary_card_validity && cardValidUntil && scheduledStart && isBeforeDate(cardValidUntil, scheduledStart)) {
    addIssue(errors, 'BENEFICIARY_CARD_EXPIRED', 'beneficiary_card_valid_until', tissPreGuideIssueLabel('BENEFICIARY_CARD_EXPIRED'), 'beneficiary');
  }
  const guideNumber = text(authorization.guide_number || billingContext.guide_number || billingItem.guide_number);
  const authorizationCode = text(
    authorization.authorization_number ||
      authorization.authorization_code ||
      authorization.password ||
      authorization.code ||
      billingContext.authorization_code ||
      billingItem.authorization_number ||
      billingItem.authorization_code,
  );
  const authorizationStatus = normalizeContext(authorization.status || (authorization.active === false ? 'cancelled' : 'active'));
  const authorizationValidFrom = text(authorization.valid_from || authorization.issue_date || authorization.issued_at || billingContext.authorization_valid_from || appointment.authorization_valid_from);
  const authorizationValidUntil = text(
    authorization.valid_until ||
      billingContext.authorization_valid_until ||
      billingContext.metadata?.authorization_valid_until ||
      appointment.authorization_valid_until,
  );
  const authorizationProcedureTussCode = text(authorization.procedure_tuss_code || authorization.tuss_code || authorization.tuss_code_snapshot);
  const authorizationProcedureCode = text(authorization.procedure_code || authorization.procedure_code_snapshot);
  const authorizationProcedureName = text(authorization.procedure_name_snapshot || authorization.procedure_name);
  const authorizationId = text(authorization.id);
  const requiresAuthorizedProcedure = Boolean(
    payerProfile.requires_authorized_procedure ||
      payerProfile.requires_authorized_procedure_match ||
      payerProfile.requires_authorization_procedure ||
      mapping.requires_authorized_procedure,
  );
  const authorizedQuantity = Number(authorization.authorized_quantity || 0);
  const usedQuantity = Number(authorization.used_quantity || 0);
  const requiresGuide = Boolean(mapping.requires_guide || payerProfile.requires_guide_number);
  const requiresAuthorization = Boolean(
    payerProfile.requires_authorization ||
      payerProfile.requires_authorization_password ||
      mapping.requires_authorization,
  );
  if (requiresGuide && !guideNumber) addIssue(errors, 'GUIDE_MISSING', 'guide_number', tissPreGuideIssueLabel('GUIDE_MISSING'), 'authorization');
  if (requiresAuthorization && (!authorizationId || !authorizationCode)) {
    addIssue(errors, 'AUTHORIZATION_REQUIRED', 'authorization_code', tissPreGuideIssueLabel('AUTHORIZATION_REQUIRED'), 'authorization');
  }
  if (authorizationId && authorizationStatus === 'EXHAUSTED') {
    addIssue(errors, 'AUTHORIZATION_EXHAUSTED', 'authorization_status', tissPreGuideIssueLabel('AUTHORIZATION_EXHAUSTED'), 'authorization');
  } else if (authorizationId && authorizationStatus === 'EXPIRED') {
    addIssue(errors, 'AUTHORIZATION_EXPIRED', 'authorization_status', tissPreGuideIssueLabel('AUTHORIZATION_EXPIRED'), 'authorization');
  } else if (authorizationId && authorizationStatus && authorizationStatus !== 'ACTIVE') {
    addIssue(errors, 'AUTHORIZATION_INACTIVE', 'authorization_status', tissPreGuideIssueLabel('AUTHORIZATION_INACTIVE'), 'authorization');
  }
  if (authorizationValidFrom && scheduledStart && isAfterDate(authorizationValidFrom, scheduledStart)) {
    addIssue(errors, 'AUTHORIZATION_NOT_STARTED', 'authorization_valid_from', tissPreGuideIssueLabel('AUTHORIZATION_NOT_STARTED'), 'authorization');
  }
  if (authorizationValidUntil && scheduledStart && isBeforeDate(authorizationValidUntil, scheduledStart)) {
    addIssue(errors, 'AUTHORIZATION_EXPIRED', 'authorization_valid_until', tissPreGuideIssueLabel('AUTHORIZATION_EXPIRED'), 'authorization');
  }
  if (authorizationId && positiveNumber(authorizedQuantity) && Number.isFinite(usedQuantity) && usedQuantity >= authorizedQuantity) {
    addIssue(errors, 'AUTHORIZATION_EXHAUSTED', 'authorization_usage', tissPreGuideIssueLabel('AUTHORIZATION_EXHAUSTED'), 'authorization');
  }
  if (authorizationId && requiresAuthorizedProcedure && !authorizationProcedureTussCode && !authorizationProcedureCode) {
    addIssue(errors, 'AUTHORIZED_PROCEDURE_NOT_INFORMED', 'authorization_procedure', tissPreGuideIssueLabel('AUTHORIZED_PROCEDURE_NOT_INFORMED'), 'authorization');
  }
  if (
    (authorizationProcedureTussCode && resolvedTussCode && authorizationProcedureTussCode !== resolvedTussCode) ||
    (authorizationProcedureCode && procedureCode && authorizationProcedureCode !== procedureCode)
  ) {
    addIssue(errors, 'AUTHORIZATION_PROCEDURE_MISMATCH', 'authorization_procedure_tuss_code', tissPreGuideIssueLabel('AUTHORIZATION_PROCEDURE_MISMATCH'), 'authorization');
  }
  const signatureStatus = normalizeContext(signature.status || (signature.id ? 'SIGNED' : ''));
  const hasResponsibleSignature = Boolean(
    text(signature.id) && (!signatureStatus || VALID_RESPONSIBLE_SIGNATURE_STATUSES.has(signatureStatus))
  ) || Boolean(billingContext.responsible_signature_present || billingContext.signature_present || appointment.responsible_signature_present);
  if (payerProfile.requires_responsible_signature && !hasResponsibleSignature) {
    addIssue(errors, 'RESPONSIBLE_SIGNATURE_REQUIRED', 'responsible_signature', tissPreGuideIssueLabel('RESPONSIBLE_SIGNATURE_REQUIRED'), 'signature');
  }

  const providerTradeName = resolveProviderTradeName({
    clinicProfile,
    clinic,
    professionalProfile,
    professional,
  });

  const status: TissPreGuideStatus = errors.length === 0 ? 'valid' : 'pending_data';
  const errorCodes = errors.map((item) => item.code);
  const warningCodes = warnings.map((item) => item.code);
  const snapshot: Record<string, any> = {
      appointment: {
        id: appointmentId || null,
        scheduledStart: scheduledStart || null,
        durationMinutes: positiveNumber(durationMinutes) ? durationMinutes : null,
        financialContext: financialContext || null,
      },
      beneficiary: {
        id: patientId || null,
        name: text(patient.name || appointment.patient_name) || null,
        cardNumber: cardNumber || null,
        cardValidUntil: cardValidUntil || null,
        documentNumber: text(patient.document_number || patient.cpf) || null,
        planCategory: text(patient.insurance_plan_category || billingContext.plan_name) || null,
        holderName: text(patient.insurance_holder_name) || null,
        holderDocument: text(patient.insurance_holder_cpf) || null,
        holderRelationship: text(patient.insurance_holder_relationship) || null,
        eligibilityNotes: text(patient.eligibility_notes) || null,
      },
      provider: {
        profileId: text(clinicProfile.id) || null,
        legalName: text(clinicProfile.legal_name) || null,
        tradeName: providerTradeName.value || null,
        tradeNameSource: providerTradeName.source,
        didUseProfessionalAsClinicFallback: providerTradeName.didUseProfessionalAsClinicFallback,
        documentType: text(clinicProfile.document_type) || null,
        documentNumber: text(clinicProfile.document_number) || null,
        cnesCode: text(clinicProfile.cnes_code) || null,
        providerCode: text(clinicProfile.provider_code || clinicProfile.ans_provider_code) || null,
      },
      payer: {
        id: payerId || null,
        name: text(payer.name) || null,
        profileId: text(payerProfile.id) || null,
        ansRegistration: text(payerProfile.ans_registration) || null,
        operatorCode: text(payerProfile.operator_code) || null,
        tissVersion: text(payerProfile.tiss_version) || null,
        guideType,
        beneficiaryIdentificationType: text(payerProfile.beneficiary_identification_type) || null,
        contractedExecutant: text(payerProfile.contracted_executant) || null,
        contractedProviderCode: text(payerProfile.contracted_provider_code) || null,
        operatorProviderCode: text(payerProfile.operator_provider_code) || null,
        defaultAttendanceType: normalizeAttendanceType040300(payerProfile.default_attendance_type) || null,
        defaultAttendanceRegime: normalizeAttendanceRegime040300(payerProfile.default_attendance_regime) || null,
        defaultAttendanceCharacter: normalizeAttendanceCharacter040300(payerProfile.default_attendance_character) || null,
        specificRules: text(payerProfile.specific_rules) || null,
        requirements: {
          requiresAuthorization: Boolean(payerProfile.requires_authorization),
          requiresAuthorizationPassword: Boolean(payerProfile.requires_authorization_password),
          requiresGuideNumber: Boolean(payerProfile.requires_guide_number),
          requiresCid: Boolean(payerProfile.requires_cid),
          requiresProviderCode: Boolean(payerProfile.requires_provider_code),
          requiresCnes: Boolean(payerProfile.requires_cnes),
          requiresCbo: Boolean(payerProfile.requires_cbo),
          requiresExecutantRegistry: Boolean(payerProfile.requires_executant_registry),
          requiresBeneficiaryCard: Boolean(payerProfile.requires_beneficiary_card),
          requiresBeneficiaryCardValidity: Boolean(payerProfile.requires_beneficiary_card_validity),
          requiresResponsibleSignature: Boolean(payerProfile.requires_responsible_signature),
          requiresPhysicalGuide: Boolean(payerProfile.requires_physical_guide),
          requiresSignedGuide: Boolean(payerProfile.requires_signed_guide),
          requiresStampedDatedGuide: Boolean(payerProfile.requires_stamped_dated_guide),
          requiresAdministrativeReport: Boolean(payerProfile.requires_administrative_report),
          allowsMixedMultidisciplinaryGuide: Boolean(payerProfile.allows_mixed_multidisciplinary_guide),
          requiresSeparateGuideBySpecialty: Boolean(payerProfile.requires_separate_guide_by_specialty),
        },
      },
      professional: {
        id: professionalId || null,
        profileId: text(professionalProfile.id) || null,
        name: executorName && !isPlaceholderExecutorName(executorName) ? executorName : null,
        councilType: councilType || null,
        councilNumber: councilNumber || null,
        councilState: text(professionalProfile.council_state || professional.council_state) || null,
        cboCode: text(professionalProfile.cbo_code) || null,
      },
      procedure: {
        serviceCatalogId: text(service.id || billingItem.service_catalog_id) || null,
        tussCodeId: text(tussCode.id || billingItem.tuss_code_id) || null,
        payerTussMappingId: mappingId || null,
        payerProcedurePriceId: text(price.id) || null,
        payerProcedurePriceSource: text(price.source || mapping.source) || null,
        payerProcedurePriceValidFrom: text(price.valid_from || mapping.valid_from) || null,
        payerProcedurePriceValidUntil: text(price.valid_until || mapping.valid_to) || null,
        payerProcedurePriceConflict: Boolean(price.conflict),
        contractCode: text(mapping.contract_code) || null,
        contractDescription: text(mapping.contract_description || mapping.payer_specific_description || mapping.description || mapping.payer_description || mapping.procedure_description) || null,
        payerSpecificDescription: text(mapping.payer_specific_description || mapping.contract_description || mapping.description || mapping.payer_description || mapping.procedure_description) || null,
        payerNegotiatedAmountCents: Number.isFinite(Number(price.amount_cents)) ? Number(price.amount_cents) : null,
        specialty: text(mapping.specialty || service.specialty) || null,
        standardDurationMinutes: positiveNumber(mapping.standard_duration_minutes || service.default_duration_minutes) ? Number(mapping.standard_duration_minutes || service.default_duration_minutes) : null,
        mappingValidFrom: text(mapping.valid_from) || null,
        mappingValidTo: text(mapping.valid_to) || null,
        mappingSource: text(mapping.source) || null,
        tussCodeSource: text(tussCode.source || mapping.source || (resolvedTussCode ? 'manual' : '')) || null,
        internalCode: procedureCode || null,
        name: procedureName || null,
        tussCode: resolvedTussCode || null,
        tussDescription: tussDescription || null,
        tussVersion: text(tussCode.version || payerProfile.tiss_version) || null,
        quantity: positiveNumber(quantity) ? quantity : null,
        unit: unit || null,
        unitAmountCents: unitAmountCents !== null && unitAmountCents > 0 ? unitAmountCents : null,
        totalAmountCents: totalAmountCents !== null && totalAmountCents > 0 ? totalAmountCents : null,
      },
      authorization: {
        guideNumber: guideNumber || null,
        authorizationCode: authorizationCode || null,
        authorizationId: text(authorization.id) || null,
        authorizationStatus: authorizationStatus || null,
        serviceCatalogId: text(authorization.service_catalog_id || service.id || billingItem.service_catalog_id) || null,
        tussCodeId: text(authorization.tuss_code_id) || null,
        payerTussMappingId: text(authorization.payer_tuss_mapping_id) || null,
        tussSource: text(authorization.tuss_source) || null,
        manualTussOverride: Boolean(authorization.manual_tuss_override),
        overrideReason: text(authorization.override_reason) || null,
        authorizationValidFrom: authorizationValidFrom || null,
        authorizationValidUntil: authorizationValidUntil || null,
        authorizedQuantity: positiveNumber(authorization.authorized_quantity) ? Number(authorization.authorized_quantity) : null,
        authorizedUnit: text(authorization.authorized_unit) || null,
        usedQuantity: Number.isFinite(usedQuantity) ? usedQuantity : null,
        procedureCode: authorizationProcedureCode || null,
        procedureName: authorizationProcedureName || null,
        procedureTussCode: authorizationProcedureTussCode || null,
      },
      signature: {
        present: hasResponsibleSignature,
        id: text(signature.id) || null,
        appointmentId: text(signature.appointment_id || signature.appointmentId || appointmentId) || null,
        abaSessionId: text(signature.aba_session_id || signature.abaSessionId || appointment.aba_session_id || appointment.abaSessionId || billingContext.aba_session_id || billingContext.abaSessionId) || null,
        signedByName: text(signature.signed_by_name || signature.signedByName) || null,
        signedByRole: text(signature.signed_by_role || signature.signedByRole) || null,
        signedAt: text(signature.signed_at || signature.signedAt) || null,
        signatureType: text(signature.signature_type || signature.signatureType) || null,
        status: signatureStatus || null,
      },
    };
  const antiGlosaChecklist = buildTissAntiGlosaChecklist({
    status,
    errors,
    warnings,
    errorCodes,
    warningCodes,
    snapshot,
  });
  const revenueCycle = deriveTissRevenueCycleStateFromPreGuide({
    status,
    validationErrorCodes: errorCodes,
    snapshot,
  });
  snapshot.antiGlosaChecklist = antiGlosaChecklist;
  snapshot.revenueCycle = {
    state: revenueCycle.state,
    reason: revenueCycle.reason,
    canAdvanceToBilling: revenueCycle.state === 'ready_for_billing',
  };

  return {
    status,
    guideType,
    errors,
    warnings,
    errorCodes,
    warningCodes,
    snapshot,
  };
}
