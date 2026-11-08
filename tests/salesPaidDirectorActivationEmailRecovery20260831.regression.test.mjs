import {readFileSync as readItem10Source} from 'node:fs';
import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const item10BootstrapSource = readItem10Source('services/paidDirectorSessionBootstrap.ts','utf8');
const item10ReconcileSource = readItem10Source('services/publicSalesPostPaymentReconciliationRoute.ts','utf8');
const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');
const directorSession = fs.readFileSync('src/services/publicSalesDirectorSession.ts', 'utf8');

const processPaid = stripePaidProcessorSource.match(/const processSalesAssistedCheckoutCompleted =[^]*?ITEM09_SOURCE_END/)?.[0] || '';
const bootstrap = item10BootstrapSource.match(/const preparePaidDirectorSessionBootstrap =[^]*?ITEM10_SOURCE_END/)?.[0] || '';
const statusRoute = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const reconcileRoute = item10ReconcileSource.match(/"\/api\/public\/sales-offers\/:token\/prepare-activation"[^]*?ITEM10_SOURCE_END/)?.[0] || '';
const sessionRoute = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');

// Compatibility intent: the Director remains provisioned server-side. For delayed
// Boleto uses the email path; modular card uses verified first-browser activation.
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

// The retained prepare-activation URL is now a reconciliation endpoint: it reads Stripe,
// reuses the canonical paid processor and does not create a new Checkout/subscription.
assert.match(reconcileRoute, /stripe\.checkout\.sessions\.retrieve\(checkoutSessionId\)/);
assert.match(reconcileRoute, /reconcileSalesAssistedCheckout\(stripe,\s*session\)/);
assert.doesNotMatch(reconcileRoute, /req\.body\?\.email|req\.body\.email/);
assert.doesNotMatch(reconcileRoute, /checkout\.sessions\.create|subscriptions\.update/);
assert.doesNotMatch(reconcileRoute, /emails\.send|sendTransactionalEmail/);

// A Checkout URL alone cannot issue a magic link or Director session.
assert.match(sessionRoute, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.doesNotMatch(sessionRoute, /generateLink|hashed_token/);

assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.match(processPaid, /const activationEmail = await prepareSalesActivationAccess\(/);
assert.match(processPaid, /preserveProvisioningStatus:\s*true/);

assert.match(directorSession, /director-session/);
assert.match(directorSession, /supabase\.auth\.verifyOtp/);
assert.match(directorSession, /provider:\s*'sales_checkout'/);
assert.match(directorSession, /\/api\/auth\/login/);
assert.match(publicOffer, /A Stripe confirmou o pagamento/);
assert.match(publicOffer, /Ative seu acesso pelo e-mail/);
assert.doesNotMatch(publicOffer, /openDirectorSession\(|Entrar na Verto e continuar onboarding/);

console.log('salesPaidDirectorActivationEmailRecovery20260831.regression.test.mjs: OK');
