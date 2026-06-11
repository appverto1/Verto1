export type TussBillingUnit = 'session' | 'hour' | 'minute' | 'unit' | 'package';
export type TussGuideType = 'consulta' | 'sp_sadt' | 'other';
export type TussQuantityRule = 'fixed' | 'duration_based' | 'per_session' | 'per_hour';

export type TussBillingPendingReason =
  | 'missing_payer'
  | 'missing_financial_plan'
  | 'missing_service_catalog'
  | 'missing_tuss_mapping'
  | 'missing_tuss_code'
  | 'missing_authorization'
  | 'missing_guide'
  | 'missing_professional_registry'
  | 'missing_card_number'
  | 'missing_duration'
  | 'missing_amount';

export type TussBillingResolutionInput = {
  appointment?: any;
  billingContext?: any;
  patientFinancialPlan?: any;
  payer?: any;
  serviceCatalog?: any;
  mapping?: any;
  tussCode?: any;
  professional?: any;
};

export type TussBillingResolution = {
  ready: boolean;
  serviceCatalogId: string | null;
  internalProcedureCode: string | null;
  internalProcedureName: string | null;
  tussCodeId: string | null;
  tussCode: string | null;
  tussDescription: string | null;
  tussVersion: string | null;
  guideType: TussGuideType | null;
  billingUnit: TussBillingUnit | null;
  quantity: number;
  durationMinutes: number | null;
  unitAmountCents: number | null;
  amountCents: number | null;
  pendingReasons: TussBillingPendingReason[];
  readinessReason: string;
  mappingStatus: 'configured' | 'pending_configuration';
};

const billingUnits = new Set(['session', 'hour', 'minute', 'unit', 'package']);
const guideTypes = new Set(['consulta', 'sp_sadt', 'other']);
const quantityRules = new Set(['fixed', 'duration_based', 'per_session', 'per_hour']);

const normalizeText = (value: any) => String(value ?? '').trim();

export function normalizeTussBillingUnit(value: any): TussBillingUnit {
  const normalized = normalizeText(value).toLowerCase();
  return billingUnits.has(normalized) ? (normalized as TussBillingUnit) : 'session';
}

export function normalizeTussGuideType(value: any): TussGuideType {
  const normalized = normalizeText(value).toLowerCase();
  return guideTypes.has(normalized) ? (normalized as TussGuideType) : 'sp_sadt';
}

export function normalizeTussQuantityRule(value: any): TussQuantityRule {
  const normalized = normalizeText(value).toLowerCase();
  return quantityRules.has(normalized) ? (normalized as TussQuantityRule) : 'per_session';
}

function positiveNumber(value: any): number | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

function nonNegativeInteger(value: any): number | null {
  const numberValue = Math.round(Number(value));
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;
  return numberValue;
}

function calculateQuantity(params: {
  rule: TussQuantityRule;
  defaultQuantity?: any;
  durationMinutes?: number | null;
}) {
  const defaultQuantity = positiveNumber(params.defaultQuantity) || 1;
  if (params.rule === 'fixed' || params.rule === 'per_session') return defaultQuantity;
  if (params.durationMinutes === null || params.durationMinutes === undefined) return defaultQuantity;
  if (params.rule === 'per_hour') return Math.max(0.01, Math.round((params.durationMinutes / 60) * 100) / 100);
  if (params.rule === 'duration_based') return Math.max(0.01, Math.round(params.durationMinutes * 100) / 100);
  return defaultQuantity;
}

export function humanizeTussPendingReason(reason: TussBillingPendingReason): string {
  const labels: Record<TussBillingPendingReason, string> = {
    missing_payer: 'Pagador não informado.',
    missing_financial_plan: 'Plano financeiro do paciente não configurado.',
    missing_service_catalog: 'Procedimento interno não configurado.',
    missing_tuss_mapping: 'Procedimento/TUSS não configurado para este pagador.',
    missing_tuss_code: 'Código TUSS não configurado para o procedimento.',
    missing_authorization: 'Autorização/senha pendente.',
    missing_guide: 'Guia pendente.',
    missing_professional_registry: 'Registro profissional pendente.',
    missing_card_number: 'Carteirinha do paciente pendente.',
    missing_duration: 'Duração necessária para calcular cobrança.',
    missing_amount: 'Valor previsto não configurado.'
  };
  return labels[reason] || 'Pendência de configuração TUSS-ready.';
}

function addReason(reasons: TussBillingPendingReason[], reason: TussBillingPendingReason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function hasValue(value: any) {
  return normalizeText(value).length > 0;
}

export function resolveTussBillingItem(input: TussBillingResolutionInput): TussBillingResolution {
  const appointment = input.appointment || {};
  const billingContext = input.billingContext || {};
  const mapping = input.mapping || null;
  const serviceCatalog = input.serviceCatalog || null;
  const tussCode = input.tussCode || null;
  const patientFinancialPlan = input.patientFinancialPlan || null;
  const professional = input.professional || {};
  const pendingReasons: TussBillingPendingReason[] = [];

  if (!hasValue(billingContext.payer_id || appointment.payer_id || input.payer?.id)) addReason(pendingReasons, 'missing_payer');
  if (!patientFinancialPlan?.id) addReason(pendingReasons, 'missing_financial_plan');
  if (!serviceCatalog?.id) addReason(pendingReasons, 'missing_service_catalog');
  if (!mapping?.id) addReason(pendingReasons, 'missing_tuss_mapping');
  if (mapping?.id && !tussCode?.id) addReason(pendingReasons, 'missing_tuss_code');

  const guideType = mapping?.id ? normalizeTussGuideType(mapping.guide_type) : null;
  const billingUnit = mapping?.id
    ? normalizeTussBillingUnit(mapping.billing_unit || serviceCatalog?.billing_unit)
    : serviceCatalog?.id
      ? normalizeTussBillingUnit(serviceCatalog.billing_unit)
      : null;
  const quantityRule = normalizeTussQuantityRule(mapping?.quantity_rule);
  const useActualDuration = mapping?.use_actual_duration === true;
  const durationMinutes = useActualDuration
    ? nonNegativeInteger(appointment.actual_minutes ?? appointment.actual_duration_minutes ?? billingContext.actual_minutes)
    : nonNegativeInteger(
        appointment.scheduled_minutes ??
          appointment.scheduled_duration_minutes ??
          appointment.duration_minutes ??
          serviceCatalog?.default_duration_minutes
      );

  if ((quantityRule === 'duration_based' || quantityRule === 'per_hour' || useActualDuration) && durationMinutes === null) {
    addReason(pendingReasons, 'missing_duration');
  }

  if (mapping?.requires_authorization && !hasValue(billingContext.authorization_code || billingContext.authorizationNumber)) {
    addReason(pendingReasons, 'missing_authorization');
  }
  if (mapping?.requires_guide && !hasValue(billingContext.guide_number || billingContext.guideNumber)) {
    addReason(pendingReasons, 'missing_guide');
  }
  if (mapping?.requires_professional_registry && !hasValue(
    professional.crp ||
      professional.council_number ||
      professional.professional_registry ||
      professional.registry
  )) {
    addReason(pendingReasons, 'missing_professional_registry');
  }
  if (mapping?.requires_patient_document && !hasValue(billingContext.insurance_card_number || billingContext.card_number || patientFinancialPlan?.insurance_card_number)) {
    addReason(pendingReasons, 'missing_card_number');
  }

  const quantity = calculateQuantity({
    rule: quantityRule,
    defaultQuantity: mapping?.default_quantity || serviceCatalog?.default_quantity,
    durationMinutes
  });
  const unitAmountCents =
    nonNegativeInteger(mapping?.amount_cents) ??
    nonNegativeInteger(serviceCatalog?.default_amount_cents) ??
    nonNegativeInteger(patientFinancialPlan?.amount_cents);
  const amountCents = unitAmountCents === null ? null : Math.round(unitAmountCents * quantity);
  if (amountCents === null) addReason(pendingReasons, 'missing_amount');

  const readinessReason = pendingReasons.map(humanizeTussPendingReason).join(' ');

  return {
    ready: pendingReasons.length === 0,
    serviceCatalogId: serviceCatalog?.id || null,
    internalProcedureCode: serviceCatalog?.internal_code || null,
    internalProcedureName: serviceCatalog?.name || null,
    tussCodeId: tussCode?.id || null,
    tussCode: tussCode?.code || null,
    tussDescription: tussCode?.description || null,
    tussVersion: tussCode?.version || null,
    guideType,
    billingUnit,
    quantity,
    durationMinutes,
    unitAmountCents,
    amountCents,
    pendingReasons,
    readinessReason,
    mappingStatus: mapping?.id ? 'configured' : 'pending_configuration'
  };
}
