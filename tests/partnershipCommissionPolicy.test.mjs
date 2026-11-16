import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTNER_COMMISSION_BASIS_POINTS,
  PARTNER_COMMISSION_TERM_MONTHS,
  addUtcCalendarMonths,
  calculatePartnershipCommission,
  commissionAdjustmentCents,
} from '../services/partnerships/commissionPolicy.mjs';

const valid = Object.freeze({
  programEnabled: true,
  partnerApproved: true,
  complianceApproved: true,
  invoiceVerified: true,
  recurringChargeVerified: true,
  invoiceStatus: 'paid',
  billingReason: 'subscription_cycle',
  currency: 'brl',
  paidCents: 24999,
  refundedCents: 0,
  firstPaidAt: '2026-11-10T15:00:00.000Z',
  paidAt: '2027-01-10T15:00:00.000Z',
});

test('10% for 12 months, correctly rounded in integer cents', () => {
  assert.equal(PARTNER_COMMISSION_BASIS_POINTS, 1000);
  assert.equal(PARTNER_COMMISSION_TERM_MONTHS, 12);
  assert.deepEqual(calculatePartnershipCommission(valid), {
    eligible: true, reason: null, basisCents: 24999, commissionCents: 2500,
  });
});

test('fails closed without program, partner, legal or invoice verification', () => {
  for (const key of ['programEnabled', 'partnerApproved', 'complianceApproved', 'invoiceVerified', 'recurringChargeVerified']) {
    const result = calculatePartnershipCommission({ ...valid, [key]: false });
    assert.equal(result.eligible, false, key);
    assert.equal(result.commissionCents, 0, key);
  }
  assert.equal(calculatePartnershipCommission().commissionCents, 0);
});

test('does not pay on unpaid, nonrecurring, invalid currencies or out-of-term invoices', () => {
  for (const patch of [
    { invoiceStatus: 'open' }, { billingReason: 'manual' }, { billingReason: 'subscription_update' },
    { currency: 'usd' }, { paidAt: '2027-11-10T15:00:00.000Z' },
    { paidAt: '2026-11-10T14:59:59.999Z' }, { paidAt: 'not-a-date' },
  ]) assert.equal(calculatePartnershipCommission({ ...valid, ...patch }).commissionCents, 0);
});

test('refund reduces entitlement and adjustment can reverse overaccrual', () => {
  const afterRefund = calculatePartnershipCommission({ ...valid, refundedCents: 9999 });
  assert.equal(afterRefund.basisCents, 15000);
  assert.equal(afterRefund.commissionCents, 1500);
  assert.equal(commissionAdjustmentCents(1500, 2500), -1000);
  assert.equal(commissionAdjustmentCents(2500, 2500), 0);
});

test('rejects fractional, negative, overrefunded or unsafe amounts', () => {
  for (const patch of [
    { paidCents: -1 }, { paidCents: 100.1 }, { paidCents: Number.MAX_SAFE_INTEGER + 1 },
    { refundedCents: -1 }, { refundedCents: 25000 },
  ]) assert.equal(calculatePartnershipCommission({ ...valid, ...patch }).eligible, false);
  assert.throws(() => commissionAdjustmentCents(-1, 0), RangeError);
});

test('calendar month addition clamps leap day correctly', () => {
  assert.equal(addUtcCalendarMonths('2024-02-29T12:34:56.000Z', 12), '2025-02-28T12:34:56.000Z');
  assert.equal(addUtcCalendarMonths('2026-11-30T00:00:00.000Z', 12), '2027-11-30T00:00:00.000Z');
});
