export type TissPreGuideStatus = 'draft' | 'valid' | 'pending_data' | 'not_applicable' | 'cancelled';

export type TissPreGuideIssue = {
  code: string;
  field: string;
  message: string;
  section: 'appointment' | 'beneficiary' | 'provider' | 'payer' | 'professional' | 'procedure' | 'authorization';
  entity?: 'appointment' | 'beneficiary' | 'provider' | 'payer' | 'professional' | 'procedure' | 'authorization';
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
  clinic?: Record<string, any> | null;
  clinicProfile?: Record<string, any> | null;
  payerProfile?: Record<string, any> | null;
  professionalProfile?: Record<string, any> | null;
  professional?: Record<string, any> | null;
  authorization?: Record<string, any> | null;
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
  const professionalId = text(
    appointment.professional_id ||
      appointment.therapist_id ||
      appointment.professionalId ||
      appointment.therapistId,
  );

  if (!appointmentId) return { eligible: false, reason: 'appointment_missing', financialContext, payerId };
  if (!patientId) return { eligible: false, reason: 'patient_missing', financialContext, payerId };
  if (!professionalId) return { eligible: false, reason: 'professional_missing', financialContext, payerId };
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

const issueLabelOverrides: Record<string, string> = {
  APPOINTMENT_MISSING: 'Atendimento não encontrado',
  PATIENT_MISSING: 'Paciente não vinculado',
  PATIENT_NAME_MISSING: 'Nome do beneficiário não informado',
  PROFESSIONAL_MISSING: 'Profissional executante não vinculado',
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
  PAYER_ANS_REGISTRATION_MISSING: 'Registro ANS do pagador não informado',
  PAYER_CONTRACTED_PROVIDER_CODE_MISSING: 'Código do contratado na operadora não informado',
  PAYER_CID_REQUIRED: 'Convênio exige CID para a pré-guia',
  TISS_VERSION_MISSING: 'Versão TISS do pagador não configurada',
  PROFESSIONAL_BILLING_PROFILE_MISSING: 'Perfil faturável do profissional não configurado',
  PROFESSIONAL_REGISTRY_MISSING: 'Registro profissional não informado',
  PROFESSIONAL_COUNCIL_STATE_MISSING: 'UF do conselho não informada',
  CBO_MISSING: 'CBO não informado',
  PROCEDURE_MISSING: 'Procedimento interno não resolvido',
  TUSS_CODE_MISSING: 'Código TUSS não resolvido',
  TUSS_DESCRIPTION_MISSING: 'Descrição TUSS não informada',
  QUANTITY_MISSING: 'Quantidade não informada',
  BILLING_UNIT_MISSING: 'Unidade de cobrança não informada',
  AMOUNT_MISSING: 'Valor previsto não informado',
  GUIDE_MISSING: 'Guia não informada',
  AUTHORIZATION_MISSING: 'Convênio exige autorização, mas nenhuma autorização ativa foi encontrada para este paciente/procedimento',
  AUTHORIZATION_INACTIVE: 'Autorização encontrada não está ativa',
  AUTHORIZATION_NOT_STARTED: 'Autorização ainda não está vigente na data do atendimento',
  AUTHORIZATION_EXPIRED: 'Autorização vencida para a data do atendimento',
  AUTHORIZATION_PROCEDURE_MISMATCH: 'Autorização não cobre o procedimento/TUSS do atendimento',
  RESPONSIBLE_SIGNATURE_REQUIRED: 'Assinatura do responsável exigida pelo convênio',
};

export function tissPreGuideIssueLabel(code: unknown) {
  if (issueLabelOverrides[text(code)]) return issueLabelOverrides[text(code)];
  const labels: Record<string, string> = {
    APPOINTMENT_MISSING: 'Atendimento não encontrado',
    PATIENT_MISSING: 'Paciente não vinculado',
    PATIENT_NAME_MISSING: 'Nome do beneficiário não informado',
    PROFESSIONAL_MISSING: 'Profissional executante não vinculado',
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
    PAYER_ANS_REGISTRATION_MISSING: 'Registro ANS do pagador não informado',
    TISS_VERSION_MISSING: 'Versão TISS do pagador não configurada',
    PROFESSIONAL_BILLING_PROFILE_MISSING: 'Perfil faturável do profissional não configurado',
    PROFESSIONAL_REGISTRY_MISSING: 'Registro profissional não informado',
    PROFESSIONAL_COUNCIL_STATE_MISSING: 'UF do conselho não informada',
    CBO_MISSING: 'CBO não informado',
    PROCEDURE_MISSING: 'Procedimento interno não resolvido',
    TUSS_CODE_MISSING: 'Código TUSS não resolvido',
    TUSS_DESCRIPTION_MISSING: 'Descrição TUSS não informada',
    QUANTITY_MISSING: 'Quantidade não informada',
    BILLING_UNIT_MISSING: 'Unidade de cobrança não informada',
    AMOUNT_MISSING: 'Valor previsto não informado',
    GUIDE_MISSING: 'Guia não informada',
    AUTHORIZATION_MISSING: 'Autorização não informada',
    AUTHORIZATION_EXPIRED: 'Autorização vencida',
  };
  return labels[text(code)] || text(code) || 'Pendência TISS';
}

export function tissPreGuideIssueAction(code: unknown, section?: TissPreGuideIssue['section']) {
  const normalized = text(code);
  if (normalized.includes('PAYER') || section === 'payer') return 'Corrigir pagador';
  if (normalized.includes('BENEFICIARY') || section === 'beneficiary') return 'Corrigir paciente';
  if (normalized.includes('PROFESSIONAL') || normalized === 'CBO_MISSING' || section === 'professional') return 'Corrigir profissional';
  if (normalized.includes('PROCEDURE') || normalized.includes('TUSS') || normalized.includes('AMOUNT') || section === 'procedure') return 'Corrigir procedimento/TUSS';
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
  const clinic = input.clinic || {};
  const clinicProfile = input.clinicProfile || {};
  const payerProfile = input.payerProfile || {};
  const professionalProfile = input.professionalProfile || {};
  const professional = input.professional || {};
  const authorization = input.authorization || {};
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
    appointment.professional_id ||
      appointment.therapist_id ||
      billingItem.professional_id ||
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
    return {
      status: 'not_applicable',
      guideType,
      errors: [],
      warnings: [],
      errorCodes: [],
      warningCodes: [],
      snapshot: {
        financialContext,
        payerType: payerType || null,
        notApplicableReason: 'Contexto financeiro fora de convênio/TISS.',
      },
    };
  }

  if (!appointmentId) addIssue(errors, 'APPOINTMENT_MISSING', 'appointment_id', tissPreGuideIssueLabel('APPOINTMENT_MISSING'), 'appointment');
  if (!patientId) addIssue(errors, 'PATIENT_MISSING', 'patient_id', tissPreGuideIssueLabel('PATIENT_MISSING'), 'beneficiary');
  if (!text(patient.name || appointment.patient_name)) addIssue(errors, 'PATIENT_NAME_MISSING', 'patient_name', tissPreGuideIssueLabel('PATIENT_NAME_MISSING'), 'beneficiary');
  if (!professionalId) addIssue(errors, 'PROFESSIONAL_MISSING', 'professional_id', tissPreGuideIssueLabel('PROFESSIONAL_MISSING'), 'professional');
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
    if (!text(payerProfile.tiss_version)) {
      addIssue(warnings, 'TISS_VERSION_MISSING', 'tiss_version', tissPreGuideIssueLabel('TISS_VERSION_MISSING'), 'payer', 'warning');
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
  const unitAmountCents = Number(billingItem.unit_amount_cents ?? mapping.amount_cents ?? service.default_amount_cents ?? 0);
  const totalAmountCents = Number(billingItem.amount_cents ?? (positiveNumber(quantity) && unitAmountCents > 0 ? quantity * unitAmountCents : 0));
  const executorName = text(professionalProfile.display_name || professional.name);

  if (!procedureCode && !procedureName) addIssue(errors, 'PROCEDURE_MISSING', 'internal_procedure', tissPreGuideIssueLabel('PROCEDURE_MISSING'), 'procedure');
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
  const guideNumber = text(billingContext.guide_number || billingItem.guide_number || authorization.guide_number);
  const authorizationCode = text(
    billingContext.authorization_code ||
      billingItem.authorization_number ||
      authorization.authorization_code ||
      authorization.password ||
      authorization.code,
  );
  const authorizationStatus = normalizeContext(authorization.status || (authorization.active === false ? 'cancelled' : 'active'));
  const authorizationValidFrom = text(authorization.valid_from || billingContext.authorization_valid_from || appointment.authorization_valid_from);
  const authorizationValidUntil = text(
    billingContext.authorization_valid_until ||
      billingContext.metadata?.authorization_valid_until ||
      appointment.authorization_valid_until ||
      authorization.valid_until,
  );
  const authorizationProcedureTussCode = text(authorization.procedure_tuss_code || authorization.tuss_code);
  const requiresGuide = Boolean(mapping.requires_guide || payerProfile.requires_guide_number);
  const requiresAuthorization = Boolean(
    payerProfile.requires_authorization ||
      payerProfile.requires_authorization_password ||
      mapping.requires_authorization,
  );
  if (requiresGuide && !guideNumber) addIssue(errors, 'GUIDE_MISSING', 'guide_number', tissPreGuideIssueLabel('GUIDE_MISSING'), 'authorization');
  if (requiresAuthorization && !authorizationCode) addIssue(errors, 'AUTHORIZATION_MISSING', 'authorization_code', tissPreGuideIssueLabel('AUTHORIZATION_MISSING'), 'authorization');
  if (text(authorization.id) && authorizationStatus && authorizationStatus !== 'ACTIVE') {
    addIssue(errors, 'AUTHORIZATION_INACTIVE', 'authorization_status', tissPreGuideIssueLabel('AUTHORIZATION_INACTIVE'), 'authorization');
  }
  if (authorizationValidFrom && scheduledStart && isAfterDate(authorizationValidFrom, scheduledStart)) {
    addIssue(errors, 'AUTHORIZATION_NOT_STARTED', 'authorization_valid_from', tissPreGuideIssueLabel('AUTHORIZATION_NOT_STARTED'), 'authorization');
  }
  if (authorizationValidUntil && scheduledStart && isBeforeDate(authorizationValidUntil, scheduledStart)) {
    addIssue(errors, 'AUTHORIZATION_EXPIRED', 'authorization_valid_until', tissPreGuideIssueLabel('AUTHORIZATION_EXPIRED'), 'authorization');
  }
  if (authorizationProcedureTussCode && resolvedTussCode && authorizationProcedureTussCode !== resolvedTussCode) {
    addIssue(errors, 'AUTHORIZATION_PROCEDURE_MISMATCH', 'authorization_procedure_tuss_code', tissPreGuideIssueLabel('AUTHORIZATION_PROCEDURE_MISMATCH'), 'authorization');
  }
  if (payerProfile.requires_responsible_signature && !Boolean(billingContext.responsible_signature_present || billingContext.signature_present || appointment.responsible_signature_present)) {
    addIssue(warnings, 'RESPONSIBLE_SIGNATURE_REQUIRED', 'responsible_signature', tissPreGuideIssueLabel('RESPONSIBLE_SIGNATURE_REQUIRED'), 'authorization', 'warning');
  }

  const providerTradeName = resolveProviderTradeName({
    clinicProfile,
    clinic,
    professionalProfile,
    professional,
  });

  return {
    status: errors.length === 0 ? 'valid' : 'pending_data',
    guideType,
    errors,
    warnings,
    errorCodes: errors.map((item) => item.code),
    warningCodes: warnings.map((item) => item.code),
    snapshot: {
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
        defaultAttendanceType: text(payerProfile.default_attendance_type) || null,
        defaultAttendanceRegime: text(payerProfile.default_attendance_regime) || null,
        defaultAttendanceCharacter: text(payerProfile.default_attendance_character) || null,
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
        internalCode: procedureCode || null,
        name: procedureName || null,
        tussCode: resolvedTussCode || null,
        tussDescription: tussDescription || null,
        tussVersion: text(tussCode.version || payerProfile.tiss_version) || null,
        quantity: positiveNumber(quantity) ? quantity : null,
        unit: unit || null,
        unitAmountCents: unitAmountCents > 0 ? unitAmountCents : null,
        totalAmountCents: totalAmountCents > 0 ? totalAmountCents : null,
      },
      authorization: {
        guideNumber: guideNumber || null,
        authorizationCode: authorizationCode || null,
        authorizationId: text(authorization.id) || null,
        authorizationStatus: authorizationStatus || null,
        authorizationValidFrom: authorizationValidFrom || null,
        authorizationValidUntil: authorizationValidUntil || null,
        authorizedQuantity: positiveNumber(authorization.authorized_quantity) ? Number(authorization.authorized_quantity) : null,
        authorizedUnit: text(authorization.authorized_unit) || null,
        procedureTussCode: authorizationProcedureTussCode || null,
      },
    },
  };
}
