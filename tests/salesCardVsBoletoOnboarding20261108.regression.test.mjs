import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSalesPostPaymentState } from '../src/utils/salesPostPaymentState.mjs';

const read = (path) => readFileSync(path, 'utf8');
const payment = read('services/salesAssistedCheckoutPaymentProcessor.ts');
const method = read('services/salesSettledCheckoutMethod.ts');
const browser = read('services/salesCardCheckoutBrowserProof.ts');
const checkout = read('services/salesModularCheckoutCore.ts');
const publicCheckout = read('services/publicSalesCheckoutRoutes.ts');
const publicTransport = read('src/services/publicSalesCardCheckout.ts');
const cardRoute = read('services/publicSalesDirectorSessionRoute.ts');
const status = read('services/publicSalesPaymentStatusRoute.ts');
const reconcile = read('services/publicSalesPostPaymentReconciliationRoute.ts');
const ui = read('src/components/PublicSalesOffer.tsx');
const transport = read('src/services/publicSalesPostPaymentTransport.ts');
const db = read('supabase/migrations/20261108210000_sales_card_browser_handoff_v1.sql');
const chooser = read('src/components/SalesActivationAccess.tsx');

// Stripe explicitly permits both choices, so never infer the chosen one
// from checkout.payment_method_types or the webhook name.
assert.match(method, /invoicePayments\.list/);
assert.match(method, /paymentIntents\.retrieve/);
assert.match(method, /latest_charge/);
assert.match(method, /payment_method_details\?\.type/);
assert.match(method, /intent\.status !== 'succeeded'/);
assert.match(method, /method !== 'card' && method !== 'boleto'/);
assert.doesNotMatch(method, /session\.payment_method_types/);

// No payment or zero trial means no provisional user or clinic access.
assert.match(payment, /paymentStatus === "paid" &&\s+Number\.isSafeInteger\(paidAmountCents\) &&\s+paidAmountCents > 0/);
assert.match(payment, /if \(!paymentConfirmed\)/);
assert.match(payment, /resolveSalesSettledCheckoutMethod\(stripe, session\)/);
assert.match(payment, /settled_payment_method: settledPaymentMethod/);
assert.match(payment, /settledPaymentMethod === 'boleto' \|\| !isModularSalesFlow/);
assert.match(payment, /cardImmediateEligible: settledPaymentMethod === 'card' && isModularSalesFlow/);
assert.match(payment, /preserveProvisioningStatus: true/);

// No Checkout-return bearer URL alone grants a Director login.
assert.match(browser, /crypto\.randomBytes\(32\)/);
assert.match(browser, /httpOnly: true/);
assert.match(browser, /secure: true/);
assert.match(browser, /sameSite: 'lax'/);
assert.match(browser, /timingSafeEqual/);
assert.match(browser, /eq\('offer_id', offerId\)/);
assert.match(browser, /gt\('expires_at'/);
assert.match(checkout, /issueSalesCardCheckoutBrowserProof\(/);
assert.match(publicCheckout, /app\.use\('\/api\/public\/sales-checkouts\/:token'/);
assert.match(publicCheckout, /issueSalesCardCheckoutBrowserProof\(/);
assert.match(publicTransport, /credentials: 'same-origin'/);
assert.match(db, /enable row level security/);
assert.match(db, /revoke all on public\.sales_card_checkout_handoffs from public, anon, authenticated/);
assert.match(db, /grant select, insert on public\.sales_card_checkout_handoffs to service_role/);
assert.match(cardRoute, /res\.status\(410\)/);
assert.match(cardRoute, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.match(cardRoute, /\/card-activation/);
assert.match(cardRoute, /verifySalesCardCheckoutBrowserProof\(/);
assert.match(cardRoute, /offer\.settled_payment_method !== 'card'/);
assert.match(cardRoute, /verifySalesDirectorContractAccess\(/);
assert.doesNotMatch(cardRoute, /auth\.admin\.generateLink|hashed_token|verifyOtp/);
assert.match(cardRoute, /offer\.offer_type !== 'modular'/);
assert.match(status, /offer\.offer_type === 'modular'/);
assert.match(status, /"card_ready"/);
assert.match(status, /"director_ready"/);
assert.match(reconcile, /result\.cardImmediateEligible === true/);

// An immediate choice in browser, never a card-activation email; boleto email.
assert.equal(resolveSalesPostPaymentState({state:'card_ready'}), 'card_ready');
assert.equal(resolveSalesPostPaymentState({cardActivationReady:true}), 'card_ready');
assert.equal(resolveSalesPostPaymentState({state:'director_ready'}), 'director_ready');
assert.equal(resolveSalesPostPaymentState({state:'payment_pending'}), 'payment_pending');
assert.match(transport, /credentials: 'same-origin'/);
assert.match(ui, /requestPaidSalesCardActivation\(/);
assert.match(ui, /window\.location\.replace\(cardAccess\.activationPath\)/);
assert.match(ui, /paymentReturnState === 'card_ready'/);
assert.match(chooser, /beginSalesActivationGoogleOAuth\(/);
assert.match(chooser, /persistPublicSalesActivationPassword\(/);

console.log('salesCardVsBoletoOnboarding20261108.regression.test.mjs: PASS');
