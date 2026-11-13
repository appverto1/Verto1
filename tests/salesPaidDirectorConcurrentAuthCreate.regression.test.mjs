import assert from 'node:assert/strict';
import test from 'node:test';
import { createSalesPaidDirectorAccountProvisioning } from '../services/salesPaidDirectorAccountProvisioning.ts';

const email = 'checkout-test@example.invalid';
const offerId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const otherClinicId = '44444444-4444-4444-8444-444444444444';
const originalError = new Error('Database error creating new user');
const validAuth = { id: userId, email, user_metadata: { sales_activation_offer_id: offerId } };

function buildHarness({ foundAfterError = validAuth, profile = 'unreached', memberships = [], authCreateError = originalError } = {}) {
  let lookups = 0;
  let createAttempts = 0;
  let mutations = 0;
  let profileReads = 0;
  const deps = {
    sanitizeEmail: (value) => typeof value === 'string' ? value.trim().toLowerCase() : '',
    sanitizeString: (value, maxLength = 240) => String(value ?? '').slice(0, maxLength),
    isUuid: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
    findAuthUserByEmail: async () => ++lookups === 1 ? null : foundAfterError,
    fetchProfileWithSchemaFallback: async () => {
      ++profileReads;
      if (profile === 'unreached') throw new Error('RECOVERY_REACHED_COMPATIBILITY_CHECKS');
      return { data: profile, error: null };
    },
    supabase: {
      auth: { admin: {
        createUser: async () => { ++createAttempts; return { data: null, error: authCreateError }; },
        updateUserById: async () => { ++mutations; throw new Error('UNEXPECTED_AUTH_UPDATE'); },
      }},
      from: (table) => {
        if (table !== 'clinic_memberships') {
          ++mutations;
          throw new Error('UNEXPECTED_TABLE_WRITE');
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => ({ data: memberships, error: null }),
              }),
            }),
          }),
        };
      },
    },
  };
  const service = createSalesPaidDirectorAccountProvisioning(deps);
  const run = () => service.provisionPaidSalesDirectorAccount({
    email, offerId, leadId, checkoutSessionId: 'cs_test_race_1',
  });
  return { run, metrics: () => ({ lookups, createAttempts, mutations, profileReads }) };
}

test('generic GoTrue 500 for already-created Auth identity retries lookup, not signup', async () => {
  const h = buildHarness();
  await assert.rejects(h.run(), /RECOVERY_REACHED_COMPATIBILITY_CHECKS/);
  assert.deepEqual(h.metrics(), { lookups: 2, createAttempts: 1, mutations: 0, profileReads: 1 });
});
test('generic Auth 500 without a persisted identity stays a failure, never auto-provisions', async () => {
  const h = buildHarness({ foundAfterError: null });
  await assert.rejects(h.run(), /Database error creating new user/);
  assert.deepEqual(h.metrics(), { lookups: 2, createAttempts: 1, mutations: 0, profileReads: 0 });
});
test('an identity with another email cannot be reused after generic Auth 500', async () => {
  const h = buildHarness({ foundAfterError: { ...validAuth, email: 'other@example.invalid' } });
  await assert.rejects(h.run(), /Database error creating new user/);
  assert.equal(h.metrics().mutations, 0);
  assert.equal(h.metrics().profileReads, 0);
});
test('an Auth identity from another offer is blocked for manual review', async () => {
  const h = buildHarness({ foundAfterError: {
    ...validAuth, user_metadata: { sales_activation_offer_id: otherClinicId },
  } });
  await assert.rejects(h.run(), /SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED/);
  assert.equal(h.metrics().mutations, 0);
  assert.equal(h.metrics().profileReads, 0);
});
test('a different clinic/role membership remains denied even with matching offer', async () => {
  const h = buildHarness({ profile: null, memberships: [{ clinic_id: otherClinicId, role: 'patient', status: 'active' }] });
  await assert.rejects(h.run(), /SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED/);
  assert.equal(h.metrics().mutations, 0);
});
test('other Auth create failures are not masked as duplicate retries', async () => {
  const h = buildHarness({ authCreateError: new Error('Database timeout') });
  await assert.rejects(h.run(), /Database timeout/);
  assert.deepEqual(h.metrics(), { lookups: 1, createAttempts: 1, mutations: 0, profileReads: 0 });
});
