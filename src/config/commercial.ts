export const PUBLIC_ACTIVE_PATIENT_PRICE = {
  currency: 'BRL',
  unitAmountCents: 7990,
  interval: 'month',
  billingUnit: 'active_patient'
} as const;

export const SALES_DISCOUNT_DURATION_MONTHS = [6, 12, 24] as const;
export const DISCOUNT_EXPIRY_NOTIFICATION_DAYS = [30, 7, 1] as const;

export type CouponDurationMonths = (typeof SALES_DISCOUNT_DURATION_MONTHS)[number];
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

export const SALES_OPERATION_TYPES = [
  'independent_professional',
  'clinic',
  'multidisciplinary_team'
] as const;

export type SalesLeadStatus = (typeof SALES_LEAD_STATUSES)[number];
export type SalesOfferStatus = (typeof SALES_OFFER_STATUSES)[number];
export type SalesOperationType = (typeof SALES_OPERATION_TYPES)[number];

export const formatPublicActivePatientPrice = () =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: PUBLIC_ACTIVE_PATIENT_PRICE.currency
  }).format(PUBLIC_ACTIVE_PATIENT_PRICE.unitAmountCents / 100);

export const isSalesDiscountDurationMonths = (value: unknown): value is CouponDurationMonths =>
  SALES_DISCOUNT_DURATION_MONTHS.includes(Number(value) as CouponDurationMonths);

export const isSalesLeadStatus = (value: unknown): value is SalesLeadStatus =>
  SALES_LEAD_STATUSES.includes(String(value || '') as SalesLeadStatus);

export const isSalesOfferStatus = (value: unknown): value is SalesOfferStatus =>
  SALES_OFFER_STATUSES.includes(String(value || '') as SalesOfferStatus);

export const isSalesOperationType = (value: unknown): value is SalesOperationType =>
  SALES_OPERATION_TYPES.includes(String(value || '') as SalesOperationType);
