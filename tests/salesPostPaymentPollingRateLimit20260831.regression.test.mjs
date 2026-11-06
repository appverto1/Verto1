import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const limiterBlock = server.match(/const publicSalesPostPaymentRateLimitKey[^]*?const patientCreateLimiter/)?.[0] || '';
const statusRoute = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const reconcileRoute = server.match(/"\/api\/public\/sales-offers\/:token\/prepare-activation"[^]*?"\/api\/public\/sales-offers\/:token\/director-session"/)?.[0] || '';
const sessionRoute = server.match(/"\/api\/public\/sales-offers\/:token\/director-session"[^]*?const loadPublicSalesActivation/)?.[0] || '';
const paymentEffect = publicOffer.match(/useEffect\(\(\) => \{[^]*?if \(returnedFromPayment\) void loadPaymentStatus\(\);/)?.[0] || '';
const loadPaymentStatus = paymentEffect.match(/const loadPaymentStatus = async \(\) => \{[^]*?\n    \};/)?.[0] || '';

assert.match(limiterBlock, /distributedRateLimitStore\('sales-payment-status'/);
assert.match(limiterBlock, /const publicSalesPaymentStatusLimiter = rateLimit\([\s\S]*?max:\s*90/);
assert.match(limiterBlock, /distributedRateLimitStore\('sales-post-payment'/);
assert.match(limiterBlock, /const publicSalesPostPaymentLimiter = rateLimit\([\s\S]*?max:\s*30/);
assert.match(limiterBlock, /keyGenerator:\s*publicSalesPostPaymentRateLimitKey/);
assert.match(limiterBlock, /hashSalesOfferToken\(token\)\.slice\(0, 24\)/);
assert.match(limiterBlock, /createHash\("sha256"\)\.update\(checkoutSessionId\)/);

assert.match(statusRoute, /publicSalesPaymentStatusLimiter/);
assert.doesNotMatch(statusRoute, /publicSalesLeadIpLimiter/);
assert.match(reconcileRoute, /publicSalesPostPaymentLimiter/);
assert.doesNotMatch(reconcileRoute, /publicSalesLeadIpLimiter|publicSalesActivationLimiter/);
assert.match(sessionRoute, /publicSalesPostPaymentLimiter/);
assert.doesNotMatch(sessionRoute, /publicSalesLeadIpLimiter|publicSalesActivationLimiter/);

// The success return must reconcile Stripe immediately. Polling is fallback, not the prerequisite.
assert.match(loadPaymentStatus, /const initialReconciliation = await reconcileDirectorProvisioning\(\)/);
assert.match(loadPaymentStatus, /initialReconciliation[\s\S]*?for \(let attempt = 0;/);
assert.match(loadPaymentStatus, /attempt === 2 \|\| attempt === 5 \|\| attempt === 8/);

// 429 is treated as backoff, never as an immediate terminal onboarding failure.
assert.match(paymentEffect, /response\.status === 429/);
assert.match(paymentEffect, /retry-after/);
assert.match(paymentEffect, /paymentRetryDelayMs/);
assert.doesNotMatch(loadPaymentStatus, /window\.setTimeout\(resolve, 1500\)/);

console.log('salesPostPaymentPollingRateLimit20260831.regression.test.mjs: OK');
