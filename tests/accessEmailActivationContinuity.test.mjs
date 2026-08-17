import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

const emailRoute = server.match(
  /app\.patch\('\/api\/owner\/users\/:userId\/access-email'[\s\S]*?app\.get\('\/api\/owner\/financial-overview'/,
)?.[0] || '';
assert.ok(emailRoute, 'owner access-email route must exist');
assert.match(emailRoute, /activationOfferId = sanitizeString\(authUser\.user_metadata\?\.sales_activation_offer_id/, 'access-email change must resolve the canonical paid-offer binding');
assert.match(emailRoute, /\.from\('pending_activations'\)[\s\S]*?\.update\(\{ email: nextEmail \}\)/, 'a still-pending first-access identity must follow the audited login-email change');
assert.match(emailRoute, /activationEmailChanged/, 'activation-email update must participate in compensation logic');
assert.match(emailRoute, /profileChanged/, 'public profile e-mail must also participate in compensation logic');
assert.doesNotMatch(emailRoute, /\.from\('sales_offers'\)[\s\S]*?\.update\(\{[^}]*contract_email/s, 'historical commercial contract e-mail must not be rewritten by an access-email request');

const loader = server.match(
  /const loadPublicSalesActivation = async[\s\S]*?app\.get\(\s*"\/api\/public\/sales-activations\/:token"/,
)?.[0] || '';
assert.ok(loader, 'public sales activation loader must exist');
assert.doesNotMatch(loader, /contractEmail !== email/, 'current login e-mail must be allowed to differ from immutable commercial contact e-mail');
assert.match(loader, /paid offer \+ lead \+ Stripe Checkout session \+ secret token/, 'security rationale must remain explicit after separating commercial and access identities');

console.log('accessEmailActivationContinuity.test.mjs: OK');
