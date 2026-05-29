export const PATIENT_FINANCIAL_SERVICE_OPTIONS = [
  { value: 'PSYCHOLOGY', label: 'Psicologia' },
  { value: 'SPEECH_THERAPY', label: 'Fonoaudiologia' },
  { value: 'OCCUPATIONAL_THERAPY', label: 'Terapia ocupacional' },
  { value: 'ABA', label: 'ABA' },
  { value: 'PSYCHOPEDAGOGY', label: 'Psicopedagogia' },
  { value: 'PHYSIOTHERAPY', label: 'Fisioterapia' },
  { value: 'THERAPY', label: 'Terapia' },
  { value: 'CUSTOM', label: 'Outro' },
] as const;

export const PATIENT_FINANCIAL_BILLING_MODE_OPTIONS = [
  { value: 'PRIVATE', label: 'Particular' },
  { value: 'INSURANCE', label: 'Convênio' },
  { value: 'PACKAGE', label: 'Pacote' },
  { value: 'MONTHLY', label: 'Mensalidade' },
  { value: 'COURTESY', label: 'Cortesia' },
  { value: 'OTHER', label: 'Outro' },
] as const;

export const PATIENT_FINANCIAL_PAYMENT_METHOD_OPTIONS = [
  { value: 'pix', label: 'PIX' },
  { value: 'card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transfer', label: 'Transferência' },
] as const;

export const PATIENT_FINANCIAL_QUANTITY_PERIOD_OPTIONS = [
  { value: 'SESSION', label: 'por sessão' },
  { value: 'WEEK', label: 'por semana' },
  { value: 'MONTH', label: 'por mês' },
  { value: 'PACKAGE', label: 'no pacote' },
  { value: 'AUTHORIZATION', label: 'autorizadas' },
] as const;

export type PatientFinancialBillingMode =
  (typeof PATIENT_FINANCIAL_BILLING_MODE_OPTIONS)[number]['value'];

const SERVICE_ALIASES: Record<string, string> = {
  psicologia: 'PSYCHOLOGY',
  fonoaudiologia: 'SPEECH_THERAPY',
  fono: 'SPEECH_THERAPY',
  terapia_ocupacional: 'OCCUPATIONAL_THERAPY',
  'terapia ocupacional': 'OCCUPATIONAL_THERAPY',
  to: 'OCCUPATIONAL_THERAPY',
  aba: 'ABA',
  psicopedagogia: 'PSYCHOPEDAGOGY',
  fisioterapia: 'PHYSIOTHERAPY',
  terapia: 'THERAPY',
  outro: 'CUSTOM',
  custom: 'CUSTOM',
};

const BILLING_MODE_ALIASES: Record<string, PatientFinancialBillingMode> = {
  particular: 'PRIVATE',
  private: 'PRIVATE',
  convenio: 'INSURANCE',
  convênio: 'INSURANCE',
  insurance: 'INSURANCE',
  pacote: 'PACKAGE',
  package: 'PACKAGE',
  mensalidade: 'MONTHLY',
  monthly: 'MONTHLY',
  cortesia: 'COURTESY',
  courtesy: 'COURTESY',
  outro: 'OTHER',
  other: 'OTHER',
};

const PAYMENT_METHOD_ALIASES: Record<string, string> = {
  pix: 'pix',
  card: 'card',
  cartao: 'card',
  'cartão': 'card',
  cash: 'cash',
  dinheiro: 'cash',
  boleto: 'boleto',
  transfer: 'transfer',
  transferencia: 'transfer',
  'transferência': 'transfer',
};

const cleanText = (value: any, maxLength = 240) =>
  String(value ?? '').trim().slice(0, maxLength);

const cleanKey = (value: any) =>
  cleanText(value, 80).toLowerCase().replace(/\s+/g, '_');

const numberOrNull = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export const amountToCents = (value: any): number => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value * 100));
  }
  const normalized = String(value)
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
};

export const centsToAmountInput = (value: any): string => {
  const cents = Math.max(0, Math.round(Number(value) || 0));
  if (!cents) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
};

export const normalizePatientFinancialServiceType = (value: any, fallback = '') => {
  const raw = cleanText(value || fallback, 120);
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (PATIENT_FINANCIAL_SERVICE_OPTIONS.some((option) => option.value === upper)) return upper;
  return SERVICE_ALIASES[cleanKey(raw)] || 'CUSTOM';
};

export const normalizePatientFinancialBillingMode = (value: any): PatientFinancialBillingMode => {
  const raw = cleanText(value, 80);
  const upper = raw.toUpperCase();
  if (PATIENT_FINANCIAL_BILLING_MODE_OPTIONS.some((option) => option.value === upper)) {
    return upper as PatientFinancialBillingMode;
  }
  return BILLING_MODE_ALIASES[cleanKey(raw)] || 'PRIVATE';
};

export const normalizePatientFinancialPaymentMethod = (value: any) => {
  const raw = cleanKey(value);
  return PAYMENT_METHOD_ALIASES[raw] || '';
};

export const getPatientFinancialServiceLabel = (plan: any) => {
  const serviceType = normalizePatientFinancialServiceType(plan?.serviceType || plan?.service_type);
  if (serviceType === 'CUSTOM') {
    return cleanText(plan?.customServiceName || plan?.custom_service_name || plan?.specialty, 120);
  }
  return PATIENT_FINANCIAL_SERVICE_OPTIONS.find((option) => option.value === serviceType)?.label || '';
};

export const createPatientFinancialPlan = (overrides: any = {}) => {
  const legacyPayerType = cleanKey(overrides.payerType || overrides.payer_type);
  const billingMode = normalizePatientFinancialBillingMode(
    overrides.billingMode ||
      overrides.billing_mode ||
      (legacyPayerType === 'convenio' ? 'INSURANCE' : undefined),
  );
  const serviceType = normalizePatientFinancialServiceType(
    overrides.serviceType || overrides.service_type,
    overrides.specialty,
  );
  const customServiceName =
    serviceType === 'CUSTOM'
      ? cleanText(overrides.customServiceName || overrides.custom_service_name || overrides.specialty, 120)
      : cleanText(overrides.customServiceName || overrides.custom_service_name, 120);
  const payerNameSnapshot = cleanText(
    overrides.payerNameSnapshot ||
      overrides.payer_name_snapshot ||
      overrides.insuranceName ||
      overrides.insurance_name ||
      overrides.convenioNome,
    160,
  );
  const amountCents =
    overrides.amount !== undefined || overrides.monthlyFee !== undefined || overrides.monthly_fee !== undefined
      ? amountToCents(overrides.amount ?? overrides.monthlyFee ?? overrides.monthly_fee)
      : Math.max(0, Math.round(Number(overrides.amountCents ?? overrides.amount_cents) || 0));
  const copaymentAmountCents =
    overrides.copaymentAmount !== undefined || overrides.copayment_amount !== undefined
      ? amountToCents(overrides.copaymentAmount ?? overrides.copayment_amount)
      : Math.max(0, Math.round(Number(overrides.copaymentAmountCents ?? overrides.copayment_amount_cents) || 0));
  const sessionsQuantity = numberOrNull(
    overrides.sessionsQuantity || overrides.sessions_quantity || overrides.authorizedQuantity || overrides.authorized_quantity,
  );
  const quantityPeriod = cleanText(overrides.quantityPeriod || overrides.quantity_period, 40).toUpperCase();
  const dueDayRaw = numberOrNull(overrides.dueDay || overrides.due_day);
  const dueDay = dueDayRaw ? String(Math.min(31, Math.max(1, Math.round(dueDayRaw)))) : '';
  const paymentMethod = normalizePatientFinancialPaymentMethod(
    overrides.paymentMethod || overrides.payment_method || overrides.billingMethod || overrides.billing_method,
  );

  return {
    id:
      cleanText(overrides.id, 120) ||
      `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    serviceType,
    customServiceName,
    billingMode,
    payerId: cleanText(overrides.payerId || overrides.payer_id, 120),
    payerNameSnapshot,
    insurancePlanName: cleanText(overrides.insurancePlanName || overrides.insurance_plan_name, 160),
    authorizationCode: cleanText(overrides.authorizationCode || overrides.authorization_code, 120),
    authorizationValidUntil: cleanText(
      overrides.authorizationValidUntil || overrides.authorization_valid_until,
      40,
    ),
    sessionsQuantity: sessionsQuantity ? String(Math.max(1, Math.round(sessionsQuantity))) : '',
    quantityPeriod:
      PATIENT_FINANCIAL_QUANTITY_PERIOD_OPTIONS.some((option) => option.value === quantityPeriod)
        ? quantityPeriod
        : billingMode === 'INSURANCE'
          ? 'AUTHORIZATION'
          : billingMode === 'PACKAGE'
            ? 'PACKAGE'
            : billingMode === 'MONTHLY'
              ? 'MONTH'
              : 'SESSION',
    amountCents,
    amount:
      overrides.amount !== undefined
        ? String(overrides.amount)
        : centsToAmountInput(amountCents),
    copaymentAmountCents,
    copaymentAmount:
      overrides.copaymentAmount !== undefined
        ? String(overrides.copaymentAmount)
        : centsToAmountInput(copaymentAmountCents),
    paymentMethod,
    dueDay,
    packageValidUntil: cleanText(overrides.packageValidUntil || overrides.package_valid_until, 40),
    status: cleanText(overrides.status, 40).toUpperCase() || 'ACTIVE',
    notes: cleanText(overrides.notes || overrides.observations, 1000),
    specialty:
      getPatientFinancialServiceLabel({ serviceType, customServiceName, specialty: overrides.specialty }) ||
      cleanText(overrides.specialty, 120),
    payerType: billingMode === 'INSURANCE' ? 'convenio' : 'particular',
    insuranceName: payerNameSnapshot,
    billingMethod: paymentMethod,
  };
};

export const normalizePatientFinancialPlans = (plans: any, fallback: any = {}) => {
  const list = Array.isArray(plans) ? plans : [];
  if (list.length) return list.map((plan) => createPatientFinancialPlan(plan));

  const legacyAmount = fallback.monthlyTreatmentValue ?? fallback.monthlyFee ?? fallback.monthly_fee ?? '';
  const legacyAmountCents = amountToCents(legacyAmount);
  const legacyInsuranceName = cleanText(fallback.convenioNome || fallback.insuranceName || fallback.insurance_name, 160);
  const hasLegacyFinancialData =
    legacyAmountCents > 0 ||
    Boolean(legacyInsuranceName) ||
    Boolean(cleanText(fallback.billingDueDay || fallback.billing_due_day || fallback.billingMethod || fallback.billing_method));

  if (!hasLegacyFinancialData) return [];

  const legacyMode =
    cleanKey(fallback.convenioTipo || fallback.insuranceType || fallback.insurance_type) === 'convenio'
      ? 'INSURANCE'
      : 'MONTHLY';
  return [
    createPatientFinancialPlan({
      serviceType: 'CUSTOM',
      customServiceName: cleanText(fallback.specialty || fallback.specialtyName, 120),
      billingMode: legacyMode,
      amount: legacyAmount,
      dueDay: fallback.billingDueDay || fallback.billing_due_day || '',
      paymentMethod: fallback.billingMethod || fallback.billing_method || '',
      payerNameSnapshot: legacyInsuranceName,
      insuranceName: legacyInsuranceName,
    }),
  ];
};

export const financialPlanRequiresPaymentMethod = (plan: any) => {
  const normalized = createPatientFinancialPlan(plan);
  if (normalized.billingMode === 'INSURANCE') return normalized.copaymentAmountCents > 0;
  return normalized.billingMode !== 'COURTESY';
};

export const isPatientFinancialPlanComplete = (plan: any) => {
  const normalized = createPatientFinancialPlan(plan);
  return Boolean(
    normalized.serviceType ||
      normalized.customServiceName ||
      normalized.amountCents > 0 ||
      normalized.copaymentAmountCents > 0 ||
      normalized.payerId ||
      normalized.payerNameSnapshot ||
      normalized.authorizationCode ||
      normalized.authorizationValidUntil ||
      normalized.sessionsQuantity ||
      normalized.packageValidUntil ||
      normalized.notes,
  );
};

export const getFinancialPlanMonthlyProjectionValue = (plan: any) => {
  const normalized = createPatientFinancialPlan(plan);
  if (normalized.billingMode !== 'MONTHLY') return 0;
  return normalized.amountCents / 100;
};

export const getFinancialPlanPrimaryBillingMethod = (plan: any) => {
  const normalized = createPatientFinancialPlan(plan);
  if (!financialPlanRequiresPaymentMethod(normalized)) return '';
  return normalized.paymentMethod || '';
};

export const serializePatientFinancialPlanForPayload = (plan: any) => {
  const normalized = createPatientFinancialPlan(plan);
  const serviceNameSnapshot = getPatientFinancialServiceLabel(normalized);
  return {
    id: normalized.id,
    serviceType: normalized.serviceType || 'CUSTOM',
    customServiceName: normalized.customServiceName,
    serviceNameSnapshot,
    billingMode: normalized.billingMode,
    payerId: normalized.payerId || null,
    payerNameSnapshot: normalized.payerNameSnapshot || null,
    insurancePlanName: normalized.insurancePlanName || null,
    authorizationCode: normalized.authorizationCode || null,
    authorizationValidUntil: normalized.authorizationValidUntil || null,
    sessionsQuantity: normalized.sessionsQuantity ? Number(normalized.sessionsQuantity) : null,
    quantityPeriod: normalized.quantityPeriod,
    amountCents: normalized.amountCents,
    copaymentAmountCents: normalized.copaymentAmountCents,
    paymentMethod: financialPlanRequiresPaymentMethod(normalized)
      ? normalized.paymentMethod || null
      : null,
    dueDay: normalized.dueDay ? Number(normalized.dueDay) : null,
    packageValidUntil: normalized.packageValidUntil || null,
    status: normalized.status || 'ACTIVE',
    notes: normalized.notes || null,
    specialty: serviceNameSnapshot,
    amount: normalized.amountCents / 100,
    payerType: normalized.payerType,
    insuranceName: normalized.insuranceName || null,
    billingMethod: financialPlanRequiresPaymentMethod(normalized)
      ? normalized.paymentMethod || null
      : null,
  };
};
