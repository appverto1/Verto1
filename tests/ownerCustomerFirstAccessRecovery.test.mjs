import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');

const clientsRoute = server.match(
  /app\.get\('\/api\/owner\/clients'[\s\S]*?app\.patch\('\/api\/owner\/users\/:userId\/access-email'/
)?.[0] || '';

assert.ok(clientsRoute, 'owner clients route must exist');
assert.match(clientsRoute, /from\('pending_activations'\)/);
assert.match(clientsRoute, /\.eq\('source', 'sales_assisted_signup'\)/);
assert.match(clientsRoute, /\.eq\('used', false\)/);
assert.match(clientsRoute, /access_recovery/);
assert.match(clientsRoute, /can_resend_activation: true/);
assert.doesNotMatch(clientsRoute, /select\([^)]*token/, 'customer list must never expose activation token');

assert.match(dashboard, /Reenviar acesso/);
assert.match(dashboard, /customer\?\.access_recovery\?\.can_resend_activation/);
assert.match(dashboard, /\/api\/owner\/sales\/offers\/\$\{encodeURIComponent\(offerId\)\}\/resend-activation/);
assert.match(dashboard, /nenhuma nova cobrança será criada/);
assert.match(dashboard, /resendingCustomerAccessId/);

const reissueRoute = server.match(
  /app\.post\(\s*["']\/api\/owner\/sales\/offers\/:offerId\/resend-activation["'][\s\S]*?app\.post\(['"]\/api\/admin\/billing\/sync-stripe-plans['"]/
)?.[0] || '';
assert.ok(reissueRoute, 'secure sales activation reissue route must remain available');
assert.doesNotMatch(reissueRoute, /checkout\.sessions\.create|subscriptions\.update/, 'first-access recovery must not create or mutate Stripe billing');

console.log('ownerCustomerFirstAccessRecovery.test.mjs: OK');
