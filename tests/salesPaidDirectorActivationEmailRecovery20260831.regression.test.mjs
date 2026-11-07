import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');
const directorSession = fs.readFileSync('src/services/publicSalesDirectorSession.ts', 'utf8');

const processPaid = server.match(/const processSalesAssistedCheckoutCompleted =[^]*?const stripeInvoiceSubscriptionId/)?.[0] || '';
const bootstrap = server.match(/const preparePaidDirectorSessionBootstrap =[^]*?const processSalesAssistedCheckoutCompleted/)?.[0] || '';
const statusRoute = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const reconcileRoute = server.match(/"\/api\/public\/sales-offers\/:token\/prepare-activation"[^]*?registerPublicSalesDirectorSessionRoute\(/)?.[0] || '';
const sessionRoute = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');

// Compatibility intent: the Director remains provisioned server-side. For delayed
// payment methods, a payment-confirmed e-mail is an additional durable first-access path.
assert.match(bootstrap, /deriveSalesActivationToken\(checkoutSessionId\)/);
assert.match(bootstrap, /hashSalesOfferToken\(bootstrapToken\)/);
assert.match(bootstrap, /pending_activations/);
assert.match(bootstrap, /bootstrapReady:\s*true/);
assert.doesNotMatch(bootstrap, /activation_email|emails\.send|sendTransactionalEmail/);

assert.match(statusRoute, /paymentConfirmed/);
assert.match(statusRoute, /accountProvisioned/);
assert.match(statusRoute, /directorSessionReady/);
assert.match(statusRoute, /sessionClaimed/);
assert.match(statusRoute, /"director_ready"/);
assert.doesNotMatch(statusRoute, /activationPath|emailDeliveryState|activationEmailSent/);

// The retained prepare-activation URL is now a reconciliation endpoint: it reads Stripe,
// reuses the canonical paid processor and does not create a new Checkout/subscription.
assert.match(reconcileRoute, /stripe\.checkout\.sessions\.retrieve\(checkoutSessionId\)/);
assert.match(reconcileRoute, /reconcileSalesAssistedCheckout\(stripe,\s*session\)/);
assert.doesNotMatch(reconcileRoute, /req\.body\?\.email|req\.body\.email/);
assert.doesNotMatch(reconcileRoute, /checkout\.sessions\.create|subscriptions\.update/);
assert.doesNotMatch(reconcileRoute, /emails\.send|sendTransactionalEmail/);

// Session is issued without sending mail. It is backed by the frozen contract identity.
assert.match(sessionRoute, /sanitizeEmail\(offer\.contract_email\)/);
assert.match(sessionRoute, /generateLink\(\{[\s\S]*?type:\s*"magiclink"/);
assert.match(sessionRoute, /properties\?\.hashed_token/);
assert.doesNotMatch(sessionRoute, /emails\.send|sendTransactionalEmail/);

assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.match(processPaid, /options\.sendActivationEmail[\s\S]*?prepareSalesActivationAccess\(/);
assert.match(processPaid, /preserveProvisioningStatus:\s*true/);

assert.match(directorSession, /director-session/);
assert.match(directorSession, /supabase\.auth\.verifyOtp/);
assert.match(directorSession, /provider:\s*'sales_checkout'/);
assert.match(directorSession, /\/api\/auth\/login/);
assert.match(publicOffer, /A Stripe confirmou o pagamento/);
assert.doesNotMatch(publicOffer, /Reenviar e-mail|activation_ready|\/ativacao-comercial\//);

console.log('salesPaidDirectorActivationEmailRecovery20260831.regression.test.mjs: OK');
