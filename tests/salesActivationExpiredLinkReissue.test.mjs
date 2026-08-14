import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/components/SalesActivationAccess.tsx', import.meta.url), 'utf8');

const route = server.match(
  /app\.post\(\s*["']\/api\/owner\/sales\/offers\/:offerId\/resend-activation["'][\s\S]*?app\.post\(['"]\/api\/admin\/billing\/sync-stripe-plans['"]/
)?.[0] || '';

assert.ok(route, 'admin activation reissue route must exist');
assert.match(route, /checkAuth,\s*checkPlatformAdmin,\s*resendActivationLimiter/);
assert.match(route, /createSalesActivationReissueToken\(\)/);
assert.match(route, /token: reissueTokenHash/);
assert.match(route, /expires_at: expiresAt/);
assert.match(route, /\.eq\("used", false\)/);
assert.match(route, /SALES_ACTIVATION_ALREADY_USED/);
assert.match(route, /sales-activation-reissue:/);
assert.doesNotMatch(
  route,
  /event_type:\s*["']activation_reissued["']/,
  'reissue must not use an enum value absent from sales_lead_event_type',
);
assert.match(route, /event_type:\s*["']activation_sent["'][\s\S]*?reissued:\s*true/);
assert.match(route, /token:\s*previousTokenHash \|\| null[\s\S]*?\.eq\("token", reissueTokenHash\)/);
assert.match(route, /bookkeepingWarning:\s*Boolean\(persistenceError\)/);
assert.doesNotMatch(route, /processSalesAssistedCheckoutCompleted\(/, 'reissue must not replay checkout/payment');
assert.doesNotMatch(route, /subscriptions\.update|checkout\.sessions\.create/, 'reissue must not mutate Stripe');

assert.match(server, /function createSalesActivationReissueToken\(\): string \{\s*return crypto\.randomBytes\(32\)\.toString\("base64url"\);\s*\}/);
assert.match(ui, /Este link de ativação não está disponível/);

console.log('salesActivationExpiredLinkReissue.test.mjs: OK');
