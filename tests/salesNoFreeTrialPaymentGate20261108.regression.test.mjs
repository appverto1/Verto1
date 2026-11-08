import assert from 'node:assert/strict';
import fs from 'node:fs';

const builder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const validator = fs.readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const checkout = fs.readFileSync('services/salesModularCheckoutCore.ts', 'utf8');
const paidProcessor = fs.readFileSync('services/salesAssistedCheckoutPaymentProcessor.ts', 'utf8');
const webhook = fs.readFileSync('services/salesAssistedStripeEventHandlers.ts', 'utf8');

// New proposals cannot select or silently inherit a free-trial period.
assert.match(builder, /trialDays: 0,/);
assert.match(builder, /buildSalesModularProposalDuplicateDraft\(simulation, catalog\), trialDays: 0/);
assert.doesNotMatch(builder, /<option value=\{7\}>7 dias<\/option>/);
assert.match(validator, /Number\(input\.trialDays \?\? 0\) !== 0/);

// Frozen historic offers are not mutated or sent to Stripe as a free trial.
assert.match(checkout, /frozenTrialDays !== 0/);
assert.match(checkout, /MODULAR_CHECKOUT_TRIAL_DISABLED/);
assert.match(checkout, /Number\(firstPhase\.invoiceAmountCents\) <= 0/);
assert.match(checkout, /MODULAR_CHECKOUT_INITIAL_PAYMENT_REQUIRED/);
assert.doesNotMatch(checkout, /trial_period_days:/);
assert.doesNotMatch(checkout, /payment_method_collection: "always"/);

// A zero-value 'paid' Checkout or an unpaid boleto cannot provision the Director.
assert.match(paidProcessor, /const paidAmountCents = Number\(session\.amount_total\)/);
assert.match(paidProcessor, /paymentStatus === "paid" &&\s+Number\.isSafeInteger\(paidAmountCents\) &&\s+paidAmountCents > 0/);
assert.doesNotMatch(paidProcessor, /\["active", "trialing"\]\.includes\(subscriptionStatus\)/);
assert.match(paidProcessor, /if \(!paymentConfirmed\)/);
assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
assert.match(webhook, /sendActivationEmail:\s+event\.type === "checkout\.session\.async_payment_succeeded"/);

console.log('salesNoFreeTrialPaymentGate20261108.regression.test.mjs: OK');
