import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import type Stripe from 'stripe';
import type { Express } from 'express';
import { registerStripeCanonicalWebhookRoute } from '../services/stripeCanonicalWebhookRoute';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const marker = '  // Stripe Webhook - MUST BE BEFORE express.json()\n';
function fnv(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
type Fixture = {
  signatureInvalid?: boolean;
  duplicate?: boolean;
  eventType?: string;
  salesAssisted?: boolean;
  noMetadata?: boolean;
  reserveError?: boolean;
  missingSecret?: boolean;
};

async function exercise(input: Fixture = {}) {
  const calls: string[] = [];
  const statuses: string[] = [];
  let routePath: string | undefined;
  let rawMiddleware: unknown;
  let handler: ((req: any, res: any) => Promise<unknown>) | undefined;
  const stripeEvent = {
    id: 'evt_canonical_fixture',
    type: input.eventType || 'product.updated',
    data: {
      object: {
        id: 'prod_fixture',
        metadata: input.noMetadata ? {} : { userId: 'user_fixture', clinicId: 'clinic_fixture' },
        customer_email: 'director@example.test',
      },
    },
  } as unknown as Stripe.Event;
  const stripe = {
    webhooks: {
      constructEvent: (body: unknown, signature: unknown, secret: unknown) => {
        calls.push('signature');
        assert.ok(Buffer.isBuffer(body), 'Stripe receives original raw Buffer');
        assert.equal(secret, 'whsec_fixture');
        if (input.signatureInvalid || signature !== 'fixture_signed') throw new Error('invalid fixture signature');
        return stripeEvent;
      },
    },
  } as unknown as Stripe;
  const app = {
    post: (path: string, raw: unknown, handlerFn: typeof handler) => {
      routePath = path;
      rawMiddleware = raw;
      handler = handlerFn;
    },
  } as unknown as Express;
  registerStripeCanonicalWebhookRoute(app, {
    getStripe: () => stripe,
    reserveStripeWebhookEvent: async () => {
      calls.push('reserve');
      if (input.reserveError) throw new Error('fixture reserve failure');
      return !input.duplicate;
    },
    processSalesAssistedStripeEvent: async () => {
      calls.push('assisted');
      return input.salesAssisted ? { handled: true, result: { delegated: true } } : { handled: false };
    },
    markStripeWebhookEventStatus: async (_e, state) => { statuses.push(state); },
    sanitizeString: (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max),
    sanitizeEmail: (value: unknown) => {
      const s = String(value ?? '').trim().toLowerCase();
      return s.includes('@') ? s : null;
    },
    maskEmail: () => 'masked@example.test',
    checkoutSessionUsesActivePatientPrice: async () => false,
    ACTIVE_PATIENT_BILLING_MODEL: 'active_patients',
    updateClinicSubscriptionStatus: async () => { calls.push('update-status'); },
    resolveActivePatientPriceId: () => '',
    queueActivePatientSync: async () => { calls.push('sync-patients'); },
    persistStripeCustomerReference: async () => { calls.push('persist-customer'); },
    persistStripeSubscriptionReference: async () => { calls.push('persist-subscription'); },
    supabase: {
      from: () => { throw new Error('Unexpected database write'); },
      auth: { admin: { getUserById: async () => { throw new Error('Unexpected Auth call'); } } },
    },
    generateSupabaseActionLink: async () => 'https://test.example.test/activation',
    getActivationRedirectUrl: () => 'https://test.example.test/register',
    buildActivationEmailTemplate: () => ({ subject: 'Activate', html: '<p>Activate</p>' }),
    sendTransactionalEmailSafe: async () => true,
    OFFICIAL_FROM_CONTACT: 'Verto <contact@example.test>',
    OFFICIAL_TRANSACTIONAL_REPLY_TO: 'contact@example.test',
    trackProfessionalSignupCheckoutCancellation: async () => { calls.push('track-cancellation'); },
    isUuid: () => false,
    markClinicPaymentFailed: async () => { calls.push('payment-failed'); },
    clearClinicPaymentFailure: async () => { calls.push('clear-payment-failed'); },
    normalizeSubscriptionStatusFromStripe: () => 'pending',
    syncSalesSubscriptionDiscount: async () => { calls.push('sync-discounts'); },
    syncStripeBillingPlanSnapshots: async () => { calls.push('sync-snapshots'); },
  });
  assert.equal(routePath, '/api/stripe/webhook');
  assert.equal(typeof rawMiddleware, 'function');
  assert.ok(handler);
  let code = 200;
  let payload: any;
  const response = {
    status: (status: number) => { code = status; return response; },
    json: (data: unknown) => { payload = data; return response; },
    send: (data: unknown) => { payload = data; return response; },
  };
  const was = process.env.STRIPE_WEBHOOK_SECRET;
  if (input.missingSecret) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  try {
    await handler({ headers: { 'stripe-signature': 'fixture_signed' }, body: Buffer.from('{}') }, response);
    return { code, payload, calls, statuses };
  } finally {
    if (was === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = was;
  }
}

test('canonical webhook source is identical and executes before the JSON body parser', () => {
  const moved = fs.readFileSync('services/stripeCanonicalWebhookRoute.ts', 'utf8');
  const server = fs.readFileSync('server.ts', 'utf8');
  assert.equal(fnv(moved.slice(moved.indexOf(marker), -2)), '1f85f092');
  assert.match(moved, /express\.raw\(\{ type: "application\/json" \}\)/);
  const legacy = server.indexOf('registerLegacySalesActivationStripeWebhookRoute(app, {');
  const canonical = server.indexOf('registerStripeCanonicalWebhookRoute(app, {');
  const parser = server.indexOf('app.use(express.json({');
  assert.ok(legacy !== -1 && canonical > legacy && parser > canonical);
  assert.match(server, /trackProfessionalSignupCheckoutCancellation: \(params\) =>\s+trackProfessionalSignupCheckoutCancellation\(params\)/);
  assert.doesNotMatch(server, /  app.post\(\s*"\/api\/stripe\/webhook"/);
});
test('signed unhandled product event writes status and syncs only the Stripe plan snapshots', async () => {
  const result = await exercise();
  assert.equal(result.code, 200);
  assert.deepEqual(result.calls, ['signature','reserve','assisted','sync-snapshots']);
  assert.deepEqual(result.statuses, ['processed']);
  assert.deepEqual(result.payload, { received: true });
});
test('duplicate event never dispatches or repeats side-effects', async () => {
  const result = await exercise({ duplicate: true });
  assert.equal(result.code, 200);
  assert.equal(result.payload.duplicate, true);
  assert.deepEqual(result.calls, ['signature','reserve']);
  assert.deepEqual(result.statuses, []);
});
test('sales-assisted processing remains authoritative and exits before canonical event switch', async () => {
  const result = await exercise({ salesAssisted: true });
  assert.equal(result.code, 200);
  assert.equal(result.payload.delegated, true);
  assert.deepEqual(result.calls, ['signature','reserve','assisted']);
  assert.deepEqual(result.statuses, ['processed']);
});
test('unrelated event has no financial writes but still records processed state', async () => {
  const result = await exercise({ eventType: 'customer.created' });
  assert.equal(result.code, 200);
  assert.deepEqual(result.calls, ['signature','reserve','assisted']);
  assert.deepEqual(result.statuses, ['processed']);
});
test('invalid Stripe signature is rejected before reserve or any database writes', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await exercise({ signatureInvalid: true });
    assert.equal(result.code, 400);
    assert.deepEqual(result.calls, ['signature']);
    assert.deepEqual(result.statuses, []);
  } finally { console.error = original; }
});
test('missing Stripe webhook secret is rejected before event reservation', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await exercise({ missingSecret: true });
    assert.equal(result.code, 400);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.statuses, []);
  } finally { console.error = original; }
});
test('failed reservation marks the event failed and returns original error response', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const result = await exercise({ reserveError: true });
    assert.equal(result.code, 500);
    assert.equal(result.payload.error, 'STRIPE_WEBHOOK_PROCESSING_FAILED');
    assert.deepEqual(result.calls, ['signature','reserve']);
    assert.deepEqual(result.statuses, ['failed']);
  } finally { console.error = original; }
});
