export const PUBLIC_ACTIVE_PATIENT_PRICE = {
  currency: 'BRL',
  unitAmountCents: 7990,
  formattedUnitAmount: 'R$ 79,90',
  interval: 'month',
  billingUnit: 'active_patient'
} as const;

export const PUBLIC_ACTIVE_PATIENT_PRICE_LABEL =
  `${PUBLIC_ACTIVE_PATIENT_PRICE.formattedUnitAmount} por paciente ativo/mês`;
export const SALES_SPECIAL_CONDITIONS_TEXT =
  'Condições especiais podem ser disponibilizadas após uma apresentação da Verto.';
export const SALES_INTEREST_SUCCESS_TITLE = 'Recebemos seu interesse na Verto';
export const SALES_INTEREST_SUCCESS_MESSAGE =
  'Entraremos em contato para conhecer sua operação e agendar uma apresentação da plataforma.';
export const SALES_WHATSAPP_CTA_LABEL = 'Conversar agora pelo WhatsApp';
export const SALES_CONTACT_CONSENT_VERSION = 'sales-contact-v1';
export const SALES_ASSISTED_SIGNUP_ERROR = 'SALES_ASSISTED_SIGNUP_REQUIRED';
export const SALES_CONTACT_REQUIRED_ERROR = 'SALES_CONTACT_REQUIRED';
export const DISCOUNT_EXPIRY_NOTIFICATION_DAYS = [30, 7, 1] as const;
export const SALES_COUPON_DURATION_MONTHS = [6, 12, 24] as const;
export const SALES_ACTIVATION_TTL_DAYS = 14;

const DEFAULT_PUBLIC_SALES_WHATSAPP_NUMBER = '5511959348563';

export const normalizePublicSalesWhatsappNumber = (value: unknown) =>
  String(value || '').replace(/\D/g, '').slice(0, 15);

const configuredPublicSalesWhatsappNumber = normalizePublicSalesWhatsappNumber(
  import.meta.env?.VITE_SALES_WHATSAPP_NUMBER,
);

export const PUBLIC_SALES_WHATSAPP_NUMBER =
  configuredPublicSalesWhatsappNumber.length >= 10
    ? configuredPublicSalesWhatsappNumber
    : DEFAULT_PUBLIC_SALES_WHATSAPP_NUMBER;

export const PUBLIC_SALES_WHATSAPP_URL =
  `https://wa.me/${PUBLIC_SALES_WHATSAPP_NUMBER}`;

export const buildSalesWhatsappMessage = (leadName: string) => {
  const normalizedName = String(leadName || '').trim().replace(/\s+/g, ' ').slice(0, 180);
  return `Olá! Acabei de enviar meu interesse na Verto. Meu nome é ${normalizedName} e gostaria de agendar uma apresentação.`;
};

export const buildSalesWhatsappUrl = (leadName: string) =>
  `${PUBLIC_SALES_WHATSAPP_URL}?text=${encodeURIComponent(buildSalesWhatsappMessage(leadName))}`;

export type CouponDurationMonths = (typeof SALES_COUPON_DURATION_MONTHS)[number];
export type SalesDiscountOption =
  | { kind: 'none' }
  | { kind: 'coupon'; durationMonths: CouponDurationMonths };

export const SALES_LEAD_STATUSES = [
  'new',
  'contact_started',
  'demo_scheduled',
  'demo_completed',
  'proposal_preparing',
  'proposal_sent',
  'checkout_sent',
  'checkout_opened',
  'payment_pending',
  'converted',
  'lost',
  'archived'
] as const;

export type SalesLeadStatus = (typeof SALES_LEAD_STATUSES)[number];

export const SALES_LEAD_STATUS_LABELS: Record<SalesLeadStatus, string> = {
  new: 'Novo',
  contact_started: 'Contato iniciado',
  demo_scheduled: 'Apresentação agendada',
  demo_completed: 'Apresentação realizada',
  proposal_preparing: 'Proposta em preparação',
  proposal_sent: 'Proposta enviada',
  checkout_sent: 'Checkout enviado',
  checkout_opened: 'Checkout aberto',
  payment_pending: 'Pagamento pendente',
  converted: 'Convertido',
  lost: 'Perdido',
  archived: 'Arquivado'
};

export const SALES_LEAD_EVENT_TYPES = [
  'lead_created',
  'lead_updated',
  'google_interest_started',
  'contact_started',
  'demo_scheduled',
  'demo_completed',
  'proposal_created',
  'proposal_sent',
  'checkout_created',
  'checkout_opened',
  'checkout_expired',
  'payment_completed',
  'activation_sent',
  'activation_completed',
  'lead_lost'
] as const;

export type SalesLeadEventType = (typeof SALES_LEAD_EVENT_TYPES)[number];

export const SALES_OFFER_STATUSES = [
  'draft',
  'ready',
  'sent',
  'opened',
  'checkout_created',
  'payment_pending',
  'paid',
  'expired',
  'cancelled'
] as const;

export type SalesOfferStatus = (typeof SALES_OFFER_STATUSES)[number];

export const SALES_OPERATION_TYPES = [
  'independent_professional',
  'clinic',
  'multidisciplinary_team'
] as const;

export type SalesOperationType = (typeof SALES_OPERATION_TYPES)[number];

export const SALES_OPERATION_TYPE_LABELS: Record<SalesOperationType, string> = {
  independent_professional: 'Profissional autônomo',
  clinic: 'Clínica',
  multidisciplinary_team: 'Equipe multidisciplinar'
};

export const formatSalesCurrency = (unitAmountCents: number, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(unitAmountCents || 0) / 100);

export const formatPublicActivePatientPrice = () =>
  PUBLIC_ACTIVE_PATIENT_PRICE.formattedUnitAmount;

export const isCouponDurationMonths = (value: unknown): value is CouponDurationMonths =>
  SALES_COUPON_DURATION_MONTHS.includes(Number(value) as CouponDurationMonths);

export const isSalesLeadStatus = (value: unknown): value is SalesLeadStatus =>
  SALES_LEAD_STATUSES.includes(String(value) as SalesLeadStatus);

export const isSalesOfferStatus = (value: unknown): value is SalesOfferStatus =>
  SALES_OFFER_STATUSES.includes(String(value || '') as SalesOfferStatus);

export const isSalesOperationType = (value: unknown): value is SalesOperationType =>
  SALES_OPERATION_TYPES.includes(String(value || '') as SalesOperationType);
