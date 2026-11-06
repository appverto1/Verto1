import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import express from 'express';
import {
  registerPublicSalesPaymentStatusRoute,
  type PublicSalesPaymentStatusDependencies,
} from '../services/publicSalesPaymentStatusRoute';

const token = 'test-offer-token-'.repeat(3);
const sessionId = 'cs_test_status_route';
const offerId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';
const clinicId = '33333333-3333-4333-8333-333333333333';
const otherClinicId = '44444444-4444-4444-8444-444444444444';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const activationToken = 'test-only-bootstrap-token';
const sanitizeString = (value: unknown, max = 5000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isUuid = (value: string | null | undefined) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value || '');

function fixture() {
  const rows: Record<string, any[]> = {
    sales_offers: [{ id: offerId, lead_id: leadId, stripe_checkout_session_id: sessionId,
      status: 'paid', payment_confirmed_at: '2026-01-01T00:00:00Z', provisioning_status: 'completed',
      provisioning_error_code: null }],
    sales_leads: [{ id: leadId, converted_user_id: clinicId, converted_clinic_id: clinicId, deleted_at: null }],
    pending_activations: [{ source: 'sales_assisted_signup', sales_offer_id: offerId, sales_lead_id: leadId,
      stripe_checkout_session_id: sessionId, token: hash(activationToken), used: false,
      expires_at: '2099-01-01T00:00:00Z' }],
  };
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const errors: Record<string, unknown> = {};
  const stats = { resolved: 0, derived: 0, limited: false };
  const supabase = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]> };
      queries.push(query);
      // Only read methods are available: an accidental write fails the test.
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder; },
        is: (key: string, value: unknown) => { query.filters.push([key, value]); return builder; },
        limit: () => builder,
        maybeSingle: async () => ({
          data: rows[table].find(row => query.filters.every(([key, value]) => row[key] === value)) || null,
          error: errors[table] || null,
        }),
      };
      return builder;
    },
  };
  const deps: PublicSalesPaymentStatusDependencies = {
    supabase: supabase as unknown as PublicSalesPaymentStatusDependencies['supabase'],
    publicSalesPaymentStatusLimiter: (_req, res, next) => {
      if (stats.limited) { res.setHeader('Retry-After', '9'); res.status(429).json({ error: 'RATE_LIMIT' }); }
      else next();
    },
    sanitizeString, isUuid,
    resolveSalesPostPaymentContextToken: async (value, session) => {
      stats.resolved++;
      return value === token && session === sessionId ? { offerId, leadId } : null;
    },
    deriveSalesActivationToken: () => { stats.derived++; return activationToken; },
    hashSalesOfferToken: hash,
  };
  return { rows, queries, errors, stats, deps };
}

async function request(f: ReturnType<typeof fixture>, query = `session_id=${sessionId}`, routeToken = token) {
  const app = express();
  registerPublicSalesPaymentStatusRoute(app, f.deps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/public/sales-offers/${encodeURIComponent(routeToken)}/payment-status?${query}`);
    return { status: response.status, headers: response.headers, body: await response.json() };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('extraction preserves the original route bytes and wires the existing dependencies once', () => {
  const source = readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
  const block = source.slice(source.indexOf('  app.get('), source.lastIndexOf('\n}') + 1);
  // SHA256 of the route at staging@444e13f3 (full base recorded in the delivery report).
  assert.equal(hash(block), 'b20cd9fa08c5be74fd9942829c989a51a7772069c46dc5b7f425ed8a863c7136');
  const server = readFileSync('server.ts', 'utf8');
  assert.equal(server.match(/registerPublicSalesPaymentStatusRoute\(app, \{/g)?.length, 1);
  assert.ok(!server.includes('"/api/public/sales-offers/:token/payment-status"'));
  const registration = server.match(/registerPublicSalesPaymentStatusRoute\(app, \{[^]*?\n  \}\);/)?.[0] || '';
  for (const dependency of Object.keys(fixture().deps)) assert.ok(registration.includes(`    ${dependency},`), dependency);
});

test('pending boleto remains 202 even with a pre-existing bootstrap and forged paid query parameters', async () => {
  const f = fixture();
  Object.assign(f.rows.sales_offers[0], { status: 'checkout_created', payment_confirmed_at: null });
  const result = await request(f, `session_id=${sessionId}&payment_status=paid&paymentConfirmed=true&clinic_id=${otherClinicId}`);
  assert.equal(result.status, 202);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body, { success: true, state: 'payment_pending', paymentConfirmed: false,
    accountProvisioned: false, directorSessionReady: false, sessionClaimed: false, accountActivated: false,
    reviewRequired: false, provisioningErrorCode: null, retryAfterMs: 1500 });
  assert.equal(f.stats.derived, 0);
  assert.equal(f.queries.length, 3);
});

for (const [name, change, state, status] of [
  ['paid without confirmation timestamp', { payment_confirmed_at: null }, 'payment_pending', 202],
  ['timestamp without paid status', { status: 'checkout_created' }, 'payment_pending', 202],
  ['confirmed but provisioning incomplete', { provisioning_status: 'pending' }, 'provisioning', 202],
  ['review required', { provisioning_status: 'review_required', provisioning_error_code: 'REVIEW' }, 'review_required', 200],
] as const) {
  test(name, async () => {
    const f = fixture(); Object.assign(f.rows.sales_offers[0], change);
    const result = await request(f);
    assert.equal(result.status, status); assert.equal(result.body.state, state);
    assert.equal(result.body.accountProvisioned, false);
    assert.equal(result.body.directorSessionReady, false);
    assert.equal(result.body.accountActivated, false);
  });
}

test('confirmed payment becomes director_ready, then account_activated on later reads without writes', async () => {
  const f = fixture();
  const before = structuredClone(f.rows);
  const ready = await request(f);
  assert.equal(ready.status, 200); assert.equal(ready.body.state, 'director_ready');
  assert.equal(ready.body.paymentConfirmed, true); assert.equal(ready.body.accountProvisioned, true);
  assert.equal(ready.body.directorSessionReady, true); assert.equal(ready.body.accountActivated, false);
  assert.equal(ready.body.retryAfterMs, null);
  assert.deepEqual(f.rows, before);
  assert.deepEqual((await request(f)).body, ready.body);
  f.rows.pending_activations[0].used = true;
  const claimed = await request(f);
  assert.equal(claimed.body.state, 'account_activated');
  assert.equal(claimed.body.sessionClaimed, true); assert.equal(claimed.body.accountActivated, true);
  assert.equal(claimed.body.directorSessionReady, false);
  assert.deepEqual((await request(f)).body, claimed.body);
  for (const value of [token, sessionId, activationToken, hash(activationToken), clinicId, leadId, offerId]) {
    assert.ok(!JSON.stringify(ready.body).includes(value), 'status must not expose identifiers or bootstrap tokens');
  }
});

for (const [name, change] of [
  ['expired bootstrap', { expires_at: '2000-01-01T00:00:00Z' }],
  ['invalid expiry', { expires_at: 'invalid' }],
  ['incorrect bootstrap token', { token: 'wrong-hash' }],
  ['bootstrap from another offer', { sales_offer_id: otherClinicId }],
  ['bootstrap from another lead', { sales_lead_id: otherClinicId }],
  ['bootstrap from another session', { stripe_checkout_session_id: 'cs_test_other' }],
  ['bootstrap from another source', { source: 'other' }],
] as const) {
  test(name + ' cannot release a director session', async () => {
    const f = fixture(); Object.assign(f.rows.pending_activations[0], change);
    const result = await request(f);
    assert.equal(result.status, 202); assert.equal(result.body.state, 'provisioning');
    assert.equal(result.body.directorSessionReady, false); assert.equal(result.body.sessionClaimed, false);
  });
}

for (const [name, change] of [
  ['different clinic', { converted_clinic_id: otherClinicId }],
  ['invalid user', { converted_user_id: 'invalid' }],
  ['deleted lead', { deleted_at: '2026-01-01T00:00:00Z' }],
] as const) {
  test(name + ' cannot be treated as provisioned', async () => {
    const f = fixture(); Object.assign(f.rows.sales_leads[0], change);
    const result = await request(f);
    assert.equal(result.body.state, 'provisioning'); assert.equal(result.body.accountProvisioned, false);
    assert.equal(result.body.directorSessionReady, false);
  });
}

for (const field of ['id', 'lead_id', 'stripe_checkout_session_id']) {
  test(`offer must match resolved ${field}`, async () => {
    const f = fixture(); f.rows.sales_offers[0][field] = 'other';
    const result = await request(f);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { success: false, error: 'PAYMENT_STATUS_NOT_FOUND' });
    assert.equal(f.queries.length, 1);
  });
}

test('invalid context is 400; unknown token or session is 404 before reading offer data', async () => {
  const f = fixture();
  assert.equal((await request(f, '')).status, 400);
  assert.equal((await request(f, `session_id=${sessionId}`, 'short')).status, 400);
  assert.equal((await request(f, 'session_id[]=bad')).status, 400);
  assert.equal(f.stats.resolved, 0);
  assert.equal((await request(f, `session_id=${sessionId}`, 'unknown-'.repeat(6))).status, 404);
  assert.equal((await request(f, 'session_id=cs_test_other')).status, 404);
  assert.equal(f.queries.length, 0);
});

for (const table of ['sales_offers', 'sales_leads', 'pending_activations']) {
  test(`${table} read failure returns 503 without exposing the database error`, async () => {
    const f = fixture(); f.errors[table] = new Error('database unavailable');
    const result = await request(f);
    assert.equal(result.status, 503); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(result.body, { success: false, error: 'PAYMENT_STATUS_UNAVAILABLE' });
  });
}

test('resolver failure is unavailable; existing rate limiter runs before any context or database access', async () => {
  const f = fixture();
  f.deps.resolveSalesPostPaymentContextToken = async () => { throw new Error('context unavailable'); };
  assert.equal((await request(f)).status, 503);
  f.stats.limited = true;
  const result = await request(f);
  assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '9');
  assert.equal(f.queries.length, 0);
});
