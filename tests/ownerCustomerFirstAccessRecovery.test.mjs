import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/SuperAdminDashboard.tsx', import.meta.url), 'utf8');

const clientsRoute = server.match(
  /app\.get\('\/api\/owner\/clients'[\s\S]*?app\.post\('\/api\/owner\/users\/:userId\/access-link'/
)?.[0] || '';

assert.ok(clientsRoute, 'owner clients route must exist');
assert.match(clientsRoute, /from\('pending_activations'\)/);
assert.match(clientsRoute, /\.eq\('source', 'sales_assisted_signup'\)/);
assert.match(clientsRoute, /\.eq\('used', false\)/);
assert.match(clientsRoute, /access_recovery/);
assert.match(clientsRoute, /can_generate_activation_link: true/);
assert.match(clientsRoute, /can_resend_activation: Boolean\(email && activationEmail === email\)/, 'e-mail resend must stay disabled until the pending activation matches the current login e-mail');
assert.doesNotMatch(clientsRoute, /select\([^)]*token/, 'customer list must never expose activation token');

assert.match(dashboard, /Gerar link/);
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

assert.doesNotMatch(
  reissueRoute,
  /event_type:\s*["']activation_reissued["']/,
  'reissue must not invent a PostgreSQL enum value that does not exist in sales_lead_event_type',
);
assert.match(
  reissueRoute,
  /event_type:\s*["']activation_sent["'][\s\S]*?reissued:\s*true/,
  'reissue audit must use the existing activation_sent enum with reissued metadata',
);
assert.match(
  reissueRoute,
  /token:\s*previousTokenHash \|\| null[\s\S]*?\.eq\("token", reissueTokenHash\)/,
  'failed e-mail delivery must restore the previous activation credential',
);
assert.match(
  reissueRoute,
  /bookkeepingWarning:\s*Boolean\(persistenceError\)/,
  'post-delivery bookkeeping failures must not turn a successfully delivered link into HTTP 5xx',
);

assert.match(
  reissueRoute,
  /deriveSalesActivationToken\(checkoutSessionId\)/,
  'reissue must reuse the deterministic paid-checkout activation credential',
);
assert.match(
  reissueRoute,
  /const reissuePreflight = await loadPublicSalesActivation\(reissueToken\)/,
  'the exact credential sent by e-mail must pass the public activation loader before delivery',
);
assert.match(
  reissueRoute,
  /SALES_ACTIVATION_REISSUE_PREFLIGHT_FAILED/,
  'preflight failures must block delivery instead of sending a broken activation link',
);
