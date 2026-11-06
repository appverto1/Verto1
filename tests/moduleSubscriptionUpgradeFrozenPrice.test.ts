import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type Stripe from 'stripe';
import { createFrozenPrice } from '../services/moduleSubscriptionUpgradeFrozenPrice';

function fnv32(source: string) {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

test('original frozen-price body, idempotency and call sites remain unchanged after extraction', () => {
  const mod = readFileSync('services/moduleSubscriptionUpgradeFrozenPrice.ts', 'utf8');
  const block = mod.match(/async function createFrozenPrice\([^]*?\n}\n\n/)?.[0] || '';
  assert.equal(fnv32(block), '858d848e');
  const source = readFileSync('services/moduleSubscriptionUpgradeStripe.ts', 'utf8');
  assert.match(source, /import \{ createFrozenPrice \} from '\.\/moduleSubscriptionUpgradeFrozenPrice'/);
  assert.doesNotMatch(source, /async function createFrozenPrice\(/);
  assert.equal((source.match(/await createFrozenPrice\(/g) || []).length, 4);
});

test('recurring frozen price preserves exact amount, metadata, order and idempotency keys', async () => {
  const calls: Array<{ resource: string; body: any; options: any }> = [];
  const stripe = {
    products: { create: async (body: any, options: any) => {
      calls.push({ resource: 'product', body, options });
      return { id: 'prod_test' };
    } },
    prices: { create: async (body: any, options: any) => {
      calls.push({ resource: 'price', body, options });
      return { id: 'price_test' };
    } },
  } as unknown as Stripe;
  const price = await createFrozenPrice(stripe, 'offer-test', { itemKey: 'speech', description: 'Fono', unitAmountCents: 1999.9 }, 'brl', true);
  assert.equal(price.id, 'price_test');
  assert.deepEqual(calls, [
    { resource: 'product', body: { name: 'Fono',
      metadata: { flowType: 'module_subscription_upgrade_v1', revenue_line: 'speech', sourceOfferId: 'offer-test' } },
      options: { idempotencyKey: 'module-upgrade:offer-test:speech:1999:brl:recurring:product' } },
    { resource: 'price', body: { currency: 'brl', unit_amount: 1999,
      recurring: { interval: 'month' }, product: 'prod_test',
      metadata: { flowType: 'module_subscription_upgrade_v1', revenue_line: 'speech', sourceOfferId: 'offer-test' } },
      options: { idempotencyKey: 'module-upgrade:offer-test:speech:1999:brl:recurring:price' } },
  ]);
});

test('one-time item never gains a recurring interval', async () => {
  let createdPrice: any;
  const stripe = {
    products: { create: async () => ({ id: 'prod_1' }) },
    prices: { create: async (body: any, options: any) => {
      createdPrice = { body, options };
      return { id: 'price_1' };
    } },
  } as unknown as Stripe;
  await createFrozenPrice(stripe, 'offer-A', { itemKey: 'setup', unitAmountCents: 750 }, 'brl', false);
  assert.equal(createdPrice.body.recurring, undefined);
  assert.equal(createdPrice.body.unit_amount, 750);
  assert.equal(createdPrice.options.idempotencyKey, 'module-upgrade:offer-A:setup:750:brl:one-time:price');
});

test('failed product creation must not call price creation', async () => {
  let pricesCreated = 0;
  const stripe = {
    products: { create: async () => { throw new Error('stripe test failure'); } },
    prices: { create: async () => { pricesCreated++; return {}; } },
  } as unknown as Stripe;
  await assert.rejects(createFrozenPrice(stripe, 'offer-A', { itemKey: 'setup', unitAmountCents: 750 }, 'brl', true), /stripe test failure/);
  assert.equal(pricesCreated, 0);
});
