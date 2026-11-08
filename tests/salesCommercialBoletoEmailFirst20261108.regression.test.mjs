import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = (path) => fs.readFileSync(path, 'utf8');
const builder = source('src/components/SalesModularProposalBuilder.tsx');
const validator = source('src/utils/salesModularProposal.ts');
const checkout = source('services/salesModularCheckoutCore.ts');
const processor = source('services/salesAssistedCheckoutPaymentProcessor.ts');
const webhook = source('services/salesAssistedStripeEventHandlers.ts');
const status = source('services/publicSalesPaymentStatusRoute.ts');
const reconciliation = source('services/publicSalesPostPaymentReconciliationRoute.ts');
const sessionRoute = source('services/publicSalesDirectorSessionRoute.ts');
const publicOffer = source('src/components/PublicSalesOffer.tsx');
const activationUi = source('src/components/SalesActivationAccess.tsx');
const director = source('services/salesPaidDirectorAccountProvisioning.ts');

// No new sale may contain a trial or a first zero-value invoice.
assert.match(builder, /trialDays: 0,/);
assert.doesNotMatch(builder, /<option value=\{7\}>7 dias<\/option>/);
assert.match(validator, /Number\(input\.trialDays \?\? 0\) !== 0/);
assert.match(checkout, /frozenTrialDays !== 0/);
assert.match(checkout, /MODULAR_CHECKOUT_TRIAL_DISABLED/);
assert.match(checkout, /Number\(firstPhase\.invoiceAmountCents\) <= 0/);
assert.doesNotMatch(checkout, /trial_period_days:/);

// Checkout completed != paid boleto; positive paid only.
assert.match(processor, /paymentStatus === "paid" &&\s+Number\.isSafeInteger\(paidAmountCents\) &&\s+paidAmountCents > 0/);
assert.doesNotMatch(processor, /paymentStatus === "no_payment_required"/);
assert.match(processor, /if \(!paymentConfirmed\)/);
assert.match(processor, /return \{ paymentConfirmed: false, activationPrepared: false \}/);

// Card and boleto use the SAME email-first activation and the same frozen identity.
assert.match(webhook, /event\.type === "checkout\.session\.completed"/);
assert.match(webhook, /event\.type === "checkout\.session\.async_payment_succeeded"/);
assert.match(webhook, /sendActivationEmail:\s*true/);
assert.match(processor, /paymentIdentityEmail = frozenContractEmail/);
assert.match(processor, /const activationEmail = await prepareSalesActivationAccess\(/);
assert.match(processor, /preserveProvisioningStatus:\s*true/);
assert.match(processor, /activationEmailSent: Boolean\(activationEmail\?\.activationEmailSent\)/);
assert.match(status, /Boolean\(bootstrap\.activation_email_sent_at\)/);
assert.match(reconciliation, /result\.directorSessionReady && result\.activationEmailSent/);

// Prevent a public Checkout return URL from issuing a Director login token.
assert.match(sessionRoute, /res\.status\(410\)/);
assert.match(sessionRoute, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.doesNotMatch(sessionRoute, /generateLink|hashed_token|verifyOtp/);
assert.doesNotMatch(publicOffer, /openDirectorSession|establishPublicSalesDirectorSession/);
assert.match(publicOffer, /Ative seu acesso pelo e-mail/);
assert.match(publicOffer, /escolha Google ou e-mail e senha/);
assert.match(activationUi, /beginSalesActivationGoogleOAuth\(/);
assert.match(activationUi, /persistPublicSalesActivationPassword\(/);

// Webhook replays must NOT reset the save-authoritative onboarding or clinic name.
assert.match(director, /const onboardingCompleted = existingProfile\.data\?\.first_login_completed === true/);
assert.match(director, /first_login_completed: onboardingCompleted/);
assert.match(director, /clinicName && !onboardingCompleted/);
assert.match(director, /name: onboardingCompleted \? \(profile\.name \|\| ownerName\)/);

const cases = [
  ['paid', 149400, true],
  ['paid', 0, false],
  ['unpaid', 149400, false],
  ['no_payment_required', 0, false],
  ['processing', 149400, false],
  ['paid', -1, false],
  ['paid', NaN, false],
];
for (const [paymentStatus, amount, expected] of cases) {
  const actual = paymentStatus === 'paid' &&
    Number.isSafeInteger(amount) && amount > 0;
  assert.equal(actual, expected, 'paid/positive-amount invariant');
}

console.log('salesCommercialBoletoEmailFirst20261108.regression.test.mjs: OK');
