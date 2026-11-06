import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import express from 'express';
import type Stripe from 'stripe';
import { registerLegacySalesActivationStripeWebhookRoute } from '../services/legacySalesActivationStripeWebhookRoute';

const marker = '  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()\n';
const fnv32 = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

test('original legacy Stripe webhook body and Express middleware order are preserved', () => {
  const mod = fs.readFileSync('services/legacySalesActivationStripeWebhookRoute.ts', 'utf8');
  const server = fs.readFileSync('server.ts', 'utf8');
  assert.equal(fnv32(mod.slice(mod.indexOf(marker), -2)), 'a5fcfd4b');
  const legacy = server.indexOf('registerLegacySalesActivationStripeWebhookRoute(app, {');
  const canonical = server.indexOf('"/api/stripe/webhook"');
  const json = server.indexOf('app.use(express.json({');
  assert.ok(legacy >= 0 && canonical > legacy && json > canonical);
  assert.doesNotMatch(server, /  app.post\(\n    "\/api\/webhook\/stripe"/);
});

type Options = {
  type?: string;
  assisted?: boolean;
  duplicate?: boolean;
  badSignature?: boolean;
  missingEmail?: boolean;
  dbFailure?: boolean;
};
async function exercise(options: Options = {}) {
  const calls: string[] = [];
  const writes: unknown[] = [];
  const mail: unknown[] = [];
  const marks: string[] = [];
  let raw = false;
  const event = {
    id: 'evt_fixture',
    type: options.type || 'checkout.session.completed',
    data: { object: {
      id: 'cs_fixture', customer_email: options.missingEmail ? null : 'DIRECTOR@EXAMPLE.TEST',
      customer_details: null,
    } },
  } as unknown as Stripe.Event;
  const stripe = { webhooks: { constructEvent: (body: unknown, signature: string, key: string) => {
    calls.push('verify');
    raw = Buffer.isBuffer(body);
    assert.equal(key, 'whsec_fixture');
    if (options.badSignature || signature !== 'signed') throw new Error('invalid fixture signature');
    return event;
  } } } as unknown as Stripe;
  const app = express();
  registerLegacySalesActivationStripeWebhookRoute(app, {
    getStripe: () => stripe,
    getResend: () => ({ emails: { send: async (value: unknown) => {
      mail.push(value);
      return { data: { id: 'mail_fixture' }, error: null };
    } } } as any),
    supabase: { from: (table: string) => {
      assert.equal(table, 'pending_activations');
      return { insert: async (rows: unknown) => {
        writes.push(rows);
        return { error: options.dbFailure ? new Error('DB_FIXTURE') : null };
      } };
    } },
    sanitizeString: (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max),
    sanitizeEmail: (value: unknown) => {
      const email = String(value ?? '').trim().toLowerCase();
      return email.includes('@') ? email : null;
    },
    maskEmail: () => 'masked@example.test',
    OFFICIAL_FROM_NOREPLY: 'Verto <test@example.test>',
    buildPostPaymentActivationEmail: (token: string) => 'activation:' + token,
    isSalesAssistedStripeEvent: async () => {
      calls.push('classify');
      return options.assisted === true;
    },
    reserveStripeWebhookEvent: async () => {
      calls.push('reserve');
      return options.duplicate !== true;
    },
    processSalesAssistedStripeEvent: async () => {
      calls.push('process-assisted');
      return { handled: true, result: { delegated: true } };
    },
    markStripeWebhookEventStatus: async (_e, status) => { marks.push(status); },
  });
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  try {
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/webhook/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'signed' },
      body: JSON.stringify(event),
    });
    const text = await response.text();
    let payload: any = text;
    try { payload = JSON.parse(text); } catch {}
    return { status: response.status, payload, writes, mail, marks, calls, raw };
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('signed checkout with raw body reserves event once, writes activation and sends email', async () => {
  const r = await exercise();
  assert.equal(r.status, 200);
  assert.equal(r.raw, true);
  assert.deepEqual(r.calls, ['verify', 'classify', 'reserve']);
  assert.equal(r.writes.length, 1);
  assert.equal(r.mail.length, 1);
  assert.deepEqual(r.marks, ['processed']);
});

test('unrelated Stripe event is ignored without writing or reserving', async () => {
  const r = await exercise({ type: 'customer.subscription.updated' });
  assert.equal(r.status, 200);
  assert.equal(r.payload.ignored, true);
  assert.deepEqual(r.calls, ['verify', 'classify']);
  assert.equal(r.writes.length, 0);
});

test('replayed event cannot duplicate activation', async () => {
  const r = await exercise({ duplicate: true });
  assert.equal(r.status, 200);
  assert.equal(r.payload.duplicate, true);
  assert.equal(r.writes.length, 0);
  assert.equal(r.mail.length, 0);
});

test('assisted async payment is dispatched to the original authoritative processor', async () => {
  const r = await exercise({ type: 'checkout.session.async_payment_succeeded', assisted: true });
  assert.equal(r.status, 200);
  assert.equal(r.payload.delegated, true);
  assert.deepEqual(r.calls, ['verify', 'classify', 'reserve', 'process-assisted']);
  assert.deepEqual(r.marks, ['processed']);
  assert.equal(r.writes.length, 0);
});

test('invalid webhook signature rejects before any database access', async () => {
  const r = await exercise({ badSignature: true });
  assert.equal(r.status, 400);
  assert.deepEqual(r.calls, ['verify']);
  assert.equal(r.writes.length, 0);
});

test('checkout without email does not create an activation', async () => {
  const previous = console.error;
  console.error = () => {};
  try {
    const r = await exercise({ missingEmail: true });
    assert.equal(r.status, 400);
    assert.equal(r.writes.length, 0);
    assert.equal(r.mail.length, 0);
  } finally { console.error = previous; }
});

test('database error returns 500 and marks Stripe event as failed', async () => {
  const previous = console.error;
  console.error = () => {};
  try {
    const r = await exercise({ dbFailure: true });
    assert.equal(r.status, 500);
    assert.deepEqual(r.marks, ['failed']);
    assert.equal(r.mail.length, 0);
  } finally { console.error = previous; }
});
