import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Release-specific fail-closed gate. This is intentionally red until main's
// monolithic checkout, Auth return and webhook are reconciled with staging.
// It must NOT be bypassed by re-enabling free trials or automatic Director login.
const read = (path) => readFileSync(path, 'utf8');
const server = read('server.ts');
const offer = read('src/components/PublicSalesOffer.tsx');
const builder = read('src/components/SalesModularProposalBuilder.tsx');
const proposal = read('src/utils/salesModularProposal.ts');
const settled = read('services/salesCheckoutSettledMethod.ts');

const paidStart = server.indexOf('const processSalesAssistedCheckoutCompleted');
const paidEnd = server.indexOf('const stripeInvoiceSubscriptionId', paidStart);
assert.ok(paidStart >= 0 && paidEnd > paidStart, 'paid processor must be present');
const paidProcessor = server.slice(paidStart, paidEnd);
const directorStart = server.indexOf('"/api/public/sales-offers/:token/director-session"');
const directorEnd = server.indexOf('const loadPublicSalesActivation', directorStart);
assert.ok(directorStart >= 0 && directorEnd > directorStart, 'director session route must be present');
const director = server.slice(directorStart, directorEnd);

assert.match(builder, /trialDays:\s*0,/);
assert.doesNotMatch(builder, /<option value=\{7\}>7 dias<\/option>/);
assert.match(proposal, /Number\(input\.trialDays \?\? 0\) !== 0/);
assert.match(server, /MODULAR_CHECKOUT_TRIAL_DISABLED/);
assert.match(server, /MODULAR_CHECKOUT_INITIAL_PAYMENT_REQUIRED/);
assert.doesNotMatch(server, /trial_period_days:\s*frozenTrialDays/);
assert.match(paidProcessor, /paymentStatus === "paid"/);
assert.match(paidProcessor, /paidAmountCents\s*>\s*0/);
assert.doesNotMatch(paidProcessor, /paymentStatus === "no_payment_required"/);
assert.match(paidProcessor, /resolveSalesSettledCheckoutMethod/);
assert.match(paidProcessor, /settledMethod === "boleto"/);
assert.match(paidProcessor, /cardActivationPath/);
assert.match(server, /immediateCardActivation/);
assert.match(server, /boletoEmailReady/);
assert.match(server, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.doesNotMatch(director, /generateLink|hashed_token|tokenHash|otpType/);
assert.doesNotMatch(offer, /openDirectorSession|establishPublicSalesDirectorSession/);
assert.match(offer, /cardActivationPath/);
assert.match(settled, /invoicePayments\.list/);
assert.match(settled, /paymentIntents\.retrieve/);
assert.match(settled, /paymentMethods\.retrieve/);
console.log('commercialMainPromotionGate20261109: PASS');
