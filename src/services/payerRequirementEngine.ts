export type PayerRequirementSource = 'SPECIFIC' | 'GENERAL' | 'DEFAULT';

export type PayerRequirementRule = {
  id?: string | null;
  payer_id?: string | null;
  service_type?: string | null;
  require_signature?: boolean | null;
  require_report?: boolean | null;
  require_actual_duration?: boolean | null;
  require_authorization?: boolean | null;
  require_guide?: boolean | null;
  require_professional_registry?: boolean | null;
  require_patient_document?: boolean | null;
  min_duration_minutes?: number | null;
  max_duration_variance_minutes?: number | null;
  allow_manual_override?: boolean | null;
  is_active?: boolean | null;
  updated_at?: string | null;
};

export type ResolvedPayerRequirements = {
  requireSignature: boolean;
  requireReport: boolean;
  requireActualDuration: boolean;
  requireAuthorization: boolean;
  requireGuide: boolean;
  requireProfessionalRegistry: boolean;
  requirePatientDocument: boolean;
  minDurationMinutes: number | null;
  maxDurationVarianceMinutes: number | null;
  allowManualOverride: boolean;
  appliedRuleId: string | null;
  source: PayerRequirementSource;
};

export type ResolvePayerRequirementsInput = {
  payerId?: string | null;
  serviceType?: string | null;
  rules?: PayerRequirementRule[] | null;
  fallback?: Partial<ResolvedPayerRequirements> | null;
};

export type PayerClosureContext = {
  hasSignature?: boolean;
  hasReport?: boolean;
  actualMinutes?: number | null;
  authorizationCode?: string | null;
  guideNumber?: string | null;
  professionalRegistryPresent?: boolean;
  patientDocumentPresent?: boolean;
};

export type PayerRequirementChecklistItem = {
  key: string;
  label: string;
  status: 'PASSED' | 'FAILED' | 'WARNING' | 'NOT_APPLICABLE';
  required: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  evidence: Record<string, any>;
};

export const DEFAULT_PAYER_REQUIREMENTS: ResolvedPayerRequirements = {
  requireSignature: true,
  requireReport: true,
  requireActualDuration: true,
  requireAuthorization: false,
  requireGuide: false,
  requireProfessionalRegistry: false,
  requirePatientDocument: false,
  minDurationMinutes: null,
  maxDurationVarianceMinutes: 10,
  allowManualOverride: true,
  appliedRuleId: null,
  source: 'DEFAULT'
};

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeServiceType(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function hasValue(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

function ruleToRequirements(
  rule: PayerRequirementRule | null,
  source: PayerRequirementSource,
  fallback: Partial<ResolvedPayerRequirements> = {}
): ResolvedPayerRequirements {
  const base = { ...DEFAULT_PAYER_REQUIREMENTS, ...fallback };
  if (!rule) {
    return {
      ...base,
      appliedRuleId: null,
      source
    };
  }
  return {
    requireSignature: toBool(rule.require_signature, base.requireSignature),
    requireReport: toBool(rule.require_report, base.requireReport),
    requireActualDuration: toBool(rule.require_actual_duration, base.requireActualDuration),
    requireAuthorization: toBool(rule.require_authorization, base.requireAuthorization),
    requireGuide: toBool(rule.require_guide, base.requireGuide),
    requireProfessionalRegistry: toBool(rule.require_professional_registry, base.requireProfessionalRegistry),
    requirePatientDocument: toBool(rule.require_patient_document, base.requirePatientDocument),
    minDurationMinutes: toPositiveInteger(rule.min_duration_minutes) ?? base.minDurationMinutes,
    maxDurationVarianceMinutes: toPositiveInteger(rule.max_duration_variance_minutes) ?? base.maxDurationVarianceMinutes,
    allowManualOverride: toBool(rule.allow_manual_override, base.allowManualOverride),
    appliedRuleId: normalizeText(rule.id) || null,
    source
  };
}

export function resolvePayerRequirements(input: ResolvePayerRequirementsInput): ResolvedPayerRequirements {
  const rules = (Array.isArray(input.rules) ? input.rules : [])
    .filter((rule) => rule && rule.is_active !== false);
  const serviceType = normalizeServiceType(input.serviceType);
  const fallback = input.fallback || {};
  const specific = serviceType
    ? rules.find((rule) => normalizeServiceType(rule.service_type) === serviceType)
    : null;
  if (specific) return ruleToRequirements(specific, 'SPECIFIC', fallback);
  const general = rules.find((rule) => !normalizeServiceType(rule.service_type));
  if (general) return ruleToRequirements(general, 'GENERAL', fallback);
  return ruleToRequirements(null, 'DEFAULT', fallback);
}

function item(
  key: string,
  label: string,
  status: PayerRequirementChecklistItem['status'],
  required: boolean,
  severity: PayerRequirementChecklistItem['severity'],
  message: string,
  evidence: Record<string, any> = {}
): PayerRequirementChecklistItem {
  return { key, label, status, required, severity, message, evidence };
}

export function evaluatePayerRequirementsForClosure(input: {
  requirements: ResolvedPayerRequirements;
  context: PayerClosureContext;
}) {
  const requirements = input.requirements;
  const context = input.context || {};
  const checklistItems: PayerRequirementChecklistItem[] = [];

  const authorizationPresent = hasValue(context.authorizationCode);
  const authorizationCode = normalizeText(context.authorizationCode);
  checklistItems.push(item(
    'payer_authorization_required',
    'Autorização do pagador',
    authorizationPresent ? 'PASSED' : requirements.requireAuthorization ? 'FAILED' : 'NOT_APPLICABLE',
    requirements.requireAuthorization,
    requirements.requireAuthorization ? 'CRITICAL' : 'LOW',
    authorizationPresent
      ? `Autorização ${authorizationCode || 'informada'} informada.`
      : requirements.requireAuthorization
        ? 'Este pagador exige autorização/senha.'
        : 'Autorização não exigida para este pagador.',
    { present: authorizationPresent, authorizationCode: authorizationCode || null }
  ));

  const guidePresent = hasValue(context.guideNumber);
  const guideNumber = normalizeText(context.guideNumber);
  checklistItems.push(item(
    'payer_guide_required',
    'Guia do pagador',
    guidePresent ? 'PASSED' : requirements.requireGuide ? 'FAILED' : 'NOT_APPLICABLE',
    requirements.requireGuide,
    requirements.requireGuide ? 'CRITICAL' : 'LOW',
    guidePresent
      ? `Guia ${guideNumber || 'informada'} informada.`
      : requirements.requireGuide
        ? 'Este pagador exige guia.'
        : 'Guia não exigida para este pagador.',
    { present: guidePresent, guideNumber: guideNumber || null }
  ));

  if (requirements.minDurationMinutes !== null && context.actualMinutes !== null && context.actualMinutes !== undefined) {
    const belowMinimum = Number(context.actualMinutes) < requirements.minDurationMinutes;
    checklistItems.push(item(
      'payer_min_duration',
      'Duração mínima do pagador',
      belowMinimum ? (requirements.allowManualOverride ? 'WARNING' : 'FAILED') : 'PASSED',
      !requirements.allowManualOverride,
      requirements.allowManualOverride ? 'MEDIUM' : 'HIGH',
      belowMinimum
        ? `Duração realizada abaixo do mínimo configurado para este pagador (${requirements.minDurationMinutes} min).`
        : `Duração mínima do pagador atendida (${requirements.minDurationMinutes} min).`,
      { actualMinutes: context.actualMinutes, minDurationMinutes: requirements.minDurationMinutes }
    ));
  }

  if (requirements.requireProfessionalRegistry) {
    checklistItems.push(item(
      'payer_professional_registry',
      'Registro profissional',
      context.professionalRegistryPresent ? 'PASSED' : 'FAILED',
      true,
      'HIGH',
      context.professionalRegistryPresent
        ? 'Registro profissional presente.'
        : 'Este pagador exige registro profissional.',
      { present: Boolean(context.professionalRegistryPresent) }
    ));
  }

  if (requirements.requirePatientDocument) {
    checklistItems.push(item(
      'payer_patient_document',
      'Documento do paciente',
      context.patientDocumentPresent ? 'PASSED' : 'FAILED',
      true,
      'HIGH',
      context.patientDocumentPresent
        ? 'Documento obrigatório do paciente fornecido.'
        : 'Este pagador exige documento do paciente.',
      { present: Boolean(context.patientDocumentPresent) }
    ));
  }

  return {
    checklistItems,
    blockingIssues: checklistItems.filter((entry) => entry.required && entry.status === 'FAILED'),
    warnings: checklistItems.filter((entry) => entry.status === 'WARNING')
  };
}
