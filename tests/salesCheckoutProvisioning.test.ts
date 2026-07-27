import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const checkoutRoute = server.match(
  /app\.post\(\s*"\/api\/public\/sales-offers\/:token\/checkout"[\s\S]*?app\.get\(\s*"\/api\/public\/sales-offers\/:token\/payment-status"/
)?.[0] || '';

assert.match(checkoutRoute, /offer_type, 30\) === "modular"/);
assert.match(checkoutRoute, /PROPOSAL_MODULAR_CHECKOUT_NOT_ENABLED/);
assert.match(checkoutRoute, /stripe\.checkout\.sessions\.create/);
assert.match(checkoutRoute, /idempotencyKey: `sales-offer-checkout:/);
assert.match(server, /processSalesAssistedCheckoutCompleted/);
assert.match(server, /confirm_sales_assisted_checkout_payment/);

console.log('salesCheckoutProvisioning.test.ts: OK');
