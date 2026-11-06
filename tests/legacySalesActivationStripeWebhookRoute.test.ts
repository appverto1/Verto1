import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import type { Express } from 'express';
import type Stripe from 'stripe';
import { registerLegacySalesActivationStripeWebhookRoute } from '../services/legacySalesActivationStripeWebhookRoute';

const marker = '  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()\n';
const fnv32 = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

test('legacy webhook body is unchanged, uses raw middleware and stays before canonical webhook and JSON parser', () => {
  const module = fs.readFileSync('services/legacySalesActivationStripeWebhookRoute.ts', 'utf8');
  const server = fs.readFileSync('server.ts', 'utf8');
  assert.equal(fnv32(module.slice(module.indexOf(marker), -2)), 'a5fcfd4b');
  assert.match(module, /express\.raw\(\{ type: "application\/json" \}\)/);
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
  const emails: unknown[] = [];
  const marks: string[] = [];
  let raw = false;
  let route = '';
  let middleware: unknown;
  let handler: ((req: any, res: any) => Promise<unknown>) | undefined;
  const event = {
    id: 'evt_fixture',
    type: options.type || 'checkout.session.completed',
    data: { object: {
      id: 'cs_fixture',
      customer_email: options.missingEmail ? null : 'DIRECTOR@EXAMPLE.TEST',
      customer_details: null,
    } },
  } as unknown as Stripe.Event;
  const stripe = {
    webhooks: { constructEvent: (body: unknown, signature: string, secret: string) => {
      calls.push('verify');
      raw = Buffer.isBuffer(body);
      assert.equal(secret, 'whsec_fixture');
      if (options.badSignature || signature !== 'signed') throw new Error('invalid fixture signature');
      return event;
    } },
  } as unknown as Stripe;
  const app = {
    post: (path: string, rawMiddleware: unknown, routeHandler: typeof handler) => {
      route = path;
      middleware = rawMiddleware;
      handler = routeHandler;
    },
  } as unknown as Express;
  registerLegacySalesActivationStripeWebhookRoute(app, {
    getStripe: () => stripe,
    getResend: () => ({ emails: { send: async (value: unknown) => {
      emails.push(value);
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
    markStripeWebhookEventStatus: async (_event, status) => { marks.push(status); },
  });
  assert.equal(route, '/api/webhook/stripe');
  assert.equal(typeof middleware, 'function');
  assert.ok(handler);
  let status = 200;
  let payload: any;
  const res = {
    status: (code: number) => { status = code; return res; },
    json: (body: any) => { payload = body; return res; },
    send: (body: any) => { payload = body; return res; },
  };
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  try {
    await handler({ headers: { 'stripe-signature': 'signed' }, body: Buffer.from('{"id":"evt_fixture"}') }, res);
    return { status, payload, calls, writes, emails, marks, raw };
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previous;
  }
}

test('signed raw event reserves once, creates activation and sends mail', async () => {
  const r = await exercise();
  assert.equal(r.status, 200);
  assert.equal(r.raw, true);
  assert.deepEqual(r.calls, ['verify', 'classify', 'reserve']);
  assert.equal(r.writes.length, 1);
  assert.equal(r.emails.length, 1);
  assert.deepEqual(r.marks, ['processed']);
});

test('unrelated event is ignored before reservation and no activation occurs', async () => {
  const r = await exercise({ type: 'customer.subscription.updated' });
  assert.equal(r.status, 200);
  assert.equal(r.payload.ignored, true);
  assert.deepEqual(r.calls, ['verify', 'classify']);
  assert.equal(r.writes.length, 0);
});

test('duplicate event cannot create a second activation', async () => {
  const r = await exercise({ duplicate: true });
  assert.equal(r.status, 200);
  assert.equal(r.payload.duplicate, true);
  assert.equal(r.writes.length, 0);
  assert.equal(r.emails.length, 0);
});

test('assisted asynchronous payment uses original authoritative event processor', async () => {
  const r = await exercise({ type: 'checkout.session.async_payment_succeeded', assisted: true });
  assert.equal(r.status, 200);
  assert.equal(r.payload.delegated, true);
  assert.deepEqual(r.calls, ['verify', 'classify', 'reserve', 'process-assisted']);
  assert.deepEqual(r.marks, ['processed']);
  assert.equal(r.writes.length, 0);
});

test('invalid signature is rejected without database writes', async () => {
  const log = console.error;
  console.error = () => {};
  try {
    const r = await exercise({ badSignature: true });
    assert.equal(r.status, 400);
    assert.deepEqual(r.calls, ['verify']);
    assert.equal(r.writes.length, 0);
  } finally { console.error = log; }
});

test('checkout without email does not create pending activation', async () => {
  const log = console.error;
  console.error = () => {};
  try {
    const r = await exercise({ missingEmail: true });
    assert.equal(r.status, 400);
    assert.equal(r.writes.length, 0);
    assert.equal(r.emails.length, 0);
  } finally { console.error = log; }
});

test('database failure returns 500 and marks the event failed', async () => {
  const log = console.error;
  console.error = () => {};
  try {
    const r = await exercise({ dbFailure: true });
    assert.equal(r.status, 500);
    assert.deepEqual(r.marks, ['failed']);
    assert.equal(r.emails.length, 0);
  } finally { console.error = log; }
});
