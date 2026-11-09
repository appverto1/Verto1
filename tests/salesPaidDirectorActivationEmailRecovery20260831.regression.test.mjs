import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const processPaid = server.match(/const processSalesAssistedCheckoutCompleted =[^]*?const stripeInvoiceSubscriptionId/)?.[0] || '';
const bootstrap = server.match(/const preparePaidDirectorSessionBootstrap =[^]*?const processSalesAssistedCheckoutCompleted/)?.[0] || '';
const statusRoute = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const reconcileRoute = fs.readFileSync('services/publicSalesPostPaymentReconciliationRoute.ts', 'utf8');
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
assert.match(statusRoute, /activationEmailSent/);
assert.doesNotMatch(statusRoute, /cardActivationPath|activationPath/);

// The retained prepare-activation URL is now a reconciliation endpoint: it reads Stripe,
// reuses the canonical paid processor and does not create a new Checkout/subscription.
assert.match(reconcileRoute, /stripe\.checkout\.sessions\.retrieve\(checkoutSessionId\)/);
assert.match(reconcileRoute, /reconcileSalesAssistedCheckout\(stripe,\s*session\)/);
assert.doesNotMatch(reconcileRoute, /req\.body\?\.email|req\.body\.email/);
assert.doesNotMatch(reconcileRoute, /checkout\.sessions\.create|subscriptions\.update/);
assert.doesNotMatch(reconcileRoute, /emails\.send|sendTransactionalEmail/);

// The public return URL cannot create an authenticated Director session.
assert.match(sessionRoute, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.match(sessionRoute, /status\(410\)/);
assert.doesNotMatch(sessionRoute, /generateLink|hashed_token/);
assert.doesNotMatch(sessionRoute, /emails\.send|sendTransactionalEmail/);

assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.match(processPaid, /prepareSalesActivationAccess\(/);
assert.match(processPaid, /attemptEmail: settledMethod === 'boleto'/);
assert.match(processPaid, /preserveProvisioningStatus:\s*true/);

assert.match(reconcileRoute, /immediateCardActivation \|\| boletoEmailReady/);
assert.match(publicOffer, /cardActivationPath/);
assert.doesNotMatch(publicOffer, /supabase\.auth\.verifyOtp/);
assert.match(publicOffer, /A Stripe confirmou o pagamento/);
assert.match(publicOffer, /Configure seu acesso à Verto/);

console.log('salesPaidDirectorActivationEmailRecovery20260831.regression.test.mjs: OK');
