import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const checkoutRoute = server.match(
  /app\.post\(\s*"\/api\/public\/sales-offers\/:token\/checkout"[\s\S]*?app\.get\(\s*"\/api\/public\/sales-offers\/:token\/payment-status"/
)?.[0] || '';

assert.match(checkoutRoute, /offer_type, 30\) === "modular"/);
assert.match(checkoutRoute, /createOrReuseModularCheckout/);
assert.match(checkoutRoute, /MODULAR_OFFER_ACCEPTANCE_REQUIRED/);
assert.match(server, /const createOrReuseModularCheckout/);
assert.match(server, /stripe\.checkout\.sessions\.create/);
assert.match(server, /operationIdempotencyKey/);
assert.match(server, /public-modular-checkout:/);
assert.match(server, /processSalesAssistedCheckoutCompleted/);
assert.match(server, /confirm_sales_assisted_checkout_payment/);

console.log('salesCheckoutProvisioning.test.ts: OK');
