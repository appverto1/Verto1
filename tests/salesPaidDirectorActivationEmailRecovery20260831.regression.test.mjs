import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const processPaid = server.match(/const processSalesAssistedCheckoutCompleted =[^]*?const stripeInvoiceSubscriptionId/)?.[0] || '';
const bootstrap = server.match(/const preparePaidDirectorSessionBootstrap =[^]*?const processSalesAssistedCheckoutCompleted/)?.[0] || '';
const statusRoute = server.match(/"\/api\/public\/sales-offers\/:token\/payment-status"[^]*?"\/api\/public\/sales-offers\/:token\/prepare-activation"/)?.[0] || '';
const reconcileRoute = server.match(/"\/api\/public\/sales-offers\/:token\/prepare-activation"[^]*?"\/api\/public\/sales-offers\/:token\/director-session"/)?.[0] || '';
const sessionRoute = server.match(/"\/api\/public\/sales-offers\/:token\/director-session"[^]*?const loadPublicSalesActivation/)?.[0] || '';

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

assert.match(publicOffer, /director-session/);
assert.match(publicOffer, /supabase\.auth\.verifyOtp/);
assert.match(publicOffer, /provider:\s*'sales_checkout'/);
assert.match(publicOffer, /\/api\/auth\/login/);
assert.match(publicOffer, /A Stripe confirmou o pagamento/);
assert.doesNotMatch(publicOffer, /Reenviar e-mail|activation_ready|\/ativacao-comercial\//);

console.log('salesPaidDirectorActivationEmailRecovery20260831.regression.test.mjs: OK');
