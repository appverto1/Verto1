export const PUBLIC_ACTIVE_PATIENT_PRICE = {
  currency: 'BRL',
  unitAmountCents: 7990,
  interval: 'month',
  billingUnit: 'active_patient'
} as const;

export const PUBLIC_ACTIVE_PATIENT_PRICE_LABEL = 'R$ 79,90 por paciente ativo/mês';
export const SALES_CONTACT_CONSENT_VERSION = 'sales-contact-v1';
export const SALES_ASSISTED_SIGNUP_ERROR = 'SALES_ASSISTED_SIGNUP_REQUIRED';
export const SALES_CONTACT_REQUIRED_ERROR = 'SALES_CONTACT_REQUIRED';
export const DISCOUNT_EXPIRY_NOTIFICATION_DAYS = [30, 7, 1] as const;
export const SALES_COUPON_DURATION_MONTHS = [6, 12, 24] as const;
export const SALES_ACTIVATION_TTL_DAYS = 14;

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

export const isCouponDurationMonths = (value: unknown): value is CouponDurationMonths =>
  SALES_COUPON_DURATION_MONTHS.includes(Number(value) as CouponDurationMonths);

export const isSalesLeadStatus = (value: unknown): value is SalesLeadStatus =>
  SALES_LEAD_STATUSES.includes(String(value) as SalesLeadStatus);
