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
assert.match(route, /activation_reissued/);
assert.doesNotMatch(route, /processSalesAssistedCheckoutCompleted\(/, 'reissue must not replay checkout/payment');
assert.doesNotMatch(route, /subscriptions\.update|checkout\.sessions\.create/, 'reissue must not mutate Stripe');

assert.match(server, /function createSalesActivationReissueToken\(\): string \{\s*return crypto\.randomBytes\(32\)\.toString\("base64url"\);\s*\}/);
assert.match(ui, /Este link de ativação não está disponível/);

console.log('salesActivationExpiredLinkReissue.test.mjs: OK');
