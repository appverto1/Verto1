import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const checkoutRoute = publicCheckoutRouteSource.slice(publicCheckoutRouteSource.indexOf('"/api/public/sales-offers/:token/checkout"'));

assert.match(checkoutRoute, /offer_type, 30\) === "modular"/);
assert.match(checkoutRoute, /createOrReuseModularCheckout/);
assert.match(checkoutRoute, /MODULAR_OFFER_ACCEPTANCE_REQUIRED/);
assert.match(checkoutCoreSource, /const createOrReuseModularCheckout/);
assert.match(checkoutCoreSource, /stripe\.checkout\.sessions\.create/);
assert.match(checkoutCoreSource, /operationIdempotencyKey/);
assert.match(publicCheckoutRouteSource, /public-modular-checkout:/);
assert.match(server, /processSalesAssistedCheckoutCompleted/);
assert.match(server, /confirm_sales_assisted_checkout_payment/);

console.log('salesCheckoutProvisioning.test.ts: OK');
