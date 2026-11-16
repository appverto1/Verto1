/**
 * Verto partnerships — pure, fail-closed accrual policy.
 * No database I/O, Stripe calls, payouts, user/clinic authorization, or client trust.
 * Callers MUST source all flags and amounts from server-verified records.
 */
export const PARTNER_COMMISSION_BASIS_POINTS = 1000;
export const PARTNER_COMMISSION_TERM_MONTHS = 12;
const VALID_RECURRING_BILLING_REASONS = new Set(['subscription_create', 'subscription_cycle']);

function validNonnegativeCents(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function readTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Add twelve UTC calendar months, clamping 29/30/31 to the target month end. */
export function addUtcCalendarMonths(isoTime, months) {
  const ms = readTimestamp(isoTime);
  if (ms === null || !Number.isSafeInteger(months) || months < 0 || months > 120) return null;
  const value = new Date(ms);
  const targetYear = value.getUTCFullYear() + Math.floor((value.getUTCMonth() + months) / 12);
  const targetMonth = (value.getUTCMonth() + months) % 12;
  const targetDay = Math.min(
    value.getUTCDate(),
    new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate(),
  );
  return new Date(Date.UTC(targetYear, targetMonth, targetDay,
    value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds())).toISOString();
}

/**
 * Return the expected commission for ONE verified recurring invoice.
 * A returned amount is only an accounting candidate, not authorization to pay.
 * No referral attribution or partner identity may be taken from an HTTP payload.
 */
export function calculatePartnershipCommission(input = {}) {
  const reject = (reason) => ({ eligible: false, reason, basisCents: 0, commissionCents: 0 });
  if (input.programEnabled !== true || input.partnerApproved !== true || input.complianceApproved !== true) {
    return reject('PARTNER_NOT_APPROVED');
  }
  if (input.invoiceVerified !== true || input.recurringChargeVerified !== true) {
    return reject('PAYMENT_NOT_VERIFIED');
  }
  if (input.invoiceStatus !== 'paid' || !VALID_RECURRING_BILLING_REASONS.has(input.billingReason)) {
    return reject('NOT_A_PAID_RECURRING_INVOICE');
  }
  if (input.currency !== 'brl') return reject('CURRENCY_NOT_SUPPORTED');
  if (!validNonnegativeCents(input.paidCents) || !validNonnegativeCents(input.refundedCents ?? 0)
      || (input.refundedCents ?? 0) > input.paidCents) return reject('INVALID_PAYMENT_AMOUNT');
  const paidAt = readTimestamp(input.paidAt);
  const firstPaidAt = readTimestamp(input.firstPaidAt);
  const endAt = addUtcCalendarMonths(input.firstPaidAt, PARTNER_COMMISSION_TERM_MONTHS);
  if (paidAt === null || firstPaidAt === null || endAt === null || paidAt < firstPaidAt || paidAt >= Date.parse(endAt)) {
    return reject('OUTSIDE_COMMISSION_TERM');
  }
  const basisCents = input.paidCents - (input.refundedCents ?? 0);
  const commissionCents = Number((BigInt(basisCents) * BigInt(PARTNER_COMMISSION_BASIS_POINTS) + 5000n) / 10000n);
  return { eligible: true, reason: null, basisCents, commissionCents };
}

/** Compare a recomputed invoice entitlement with its already accrued amount. */
export function commissionAdjustmentCents(expectedCommissionCents, previouslyAccruedCents) {
  if (!validNonnegativeCents(expectedCommissionCents) || !validNonnegativeCents(previouslyAccruedCents)) {
    throw new RangeError('INVALID_COMMISSION_AMOUNT');
  }
  return expectedCommissionCents - previouslyAccruedCents;
}
