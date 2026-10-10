import {
  PATIENT_FINANCIAL_PAYMENT_METHOD_OPTIONS,
  PATIENT_FINANCIAL_SERVICE_OPTIONS,
  normalizePatientFinancialPaymentMethod,
} from './patientFinancialPlan';

// Display-only translations for the appointment detail card. Do not convert
// persisted billing/service codes: backend financial authority depends on them.
const serviceLabels: Record<string, string> = {
  ...Object.fromEntries(PATIENT_FINANCIAL_SERVICE_OPTIONS.map(({ value, label }) => [value, label])),
  NUTRITION: 'Nutrição',
  PSYCHOMOTRICITY: 'Psicomotricidade',
  ART_THERAPY: 'Arteterapia',
  MUSIC_THERAPY: 'Musicoterapia',
};

const alternativePaymentLabels: Record<string, string> = {
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  BANK_TRANSFER: 'Transferência bancária',
  WIRE_TRANSFER: 'Transferência bancária',
  BANK_SLIP: 'Boleto',
  MONEY: 'Dinheiro',
};

const priceSourceLabels: Record<string, string> = {
  PATIENT_AGREEMENT: 'Acordo específico do paciente',
  LEGACY_PATIENT_PLAN: 'Plano particular vigente do paciente',
  SERVICE_RULE: 'Preço cadastrado para o serviço',
  SPECIALTY_RULE: 'Preço padrão da especialidade',
  CLINIC_DEFAULT: 'Preço particular padrão da clínica',
  MANUAL_OVERRIDE: 'Valor manual autorizado',
};

export const appointmentCardServiceLabel = (value: unknown): string => {
  const original = String(value ?? '').trim();
  if (!original) return 'Não informado';
  if (original.toUpperCase() === 'CUSTOM') return 'Outro serviço';
  return serviceLabels[original.toUpperCase()] || original;
};

export const appointmentCardPaymentMethodLabel = (value: unknown): string => {
  const original = String(value ?? '').trim();
  if (!original) return 'Não informada';
  const canonical = normalizePatientFinancialPaymentMethod(original);
  const option = PATIENT_FINANCIAL_PAYMENT_METHOD_OPTIONS.find((item) => item.value === canonical);
  return option?.label || alternativePaymentLabels[original.toUpperCase().replace(/[\s-]+/g, '_')] || original;
};

export const appointmentCardPriceSourceLabel = (label: unknown, code: unknown): string => {
  const providedLabel = String(label ?? '').trim();
  if (providedLabel) return providedLabel;
  const originalCode = String(code ?? '').trim();
  return priceSourceLabels[originalCode.toUpperCase()] || (originalCode ? 'Origem não identificada' : 'Histórico anterior');
};
