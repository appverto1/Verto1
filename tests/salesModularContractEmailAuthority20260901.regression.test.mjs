import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const processPaid = server.match(/const processSalesAssistedCheckoutCompleted =[^]*?const stripeInvoiceSubscriptionId/)?.[0] || '';

assert.match(processPaid, /const stripeObservedCustomerEmail = sanitizeEmail\([\s\S]*?session\.customer_details\?\.email \|\| session\.customer_email/);
assert.match(processPaid, /const isModularSalesFlow = sanitizeString\(metadata\.flowType, 80\) === "sales_modular_assisted"/);
assert.match(processPaid, /const frozenContractEmail = sanitizeEmail\(\(offer as any\)\.contract_email\)/);
assert.match(processPaid, /metadata\.contractEmailHash/);
assert.match(processPaid, /expectedContractEmailHash/);
assert.match(processPaid, /paymentIdentityEmail = frozenContractEmail/);
assert.match(processPaid, /p_customer_email:\s*paymentIdentityEmail/);
assert.doesNotMatch(processPaid, /p_customer_email:\s*stripeObservedCustomerEmail/);
assert.match(processPaid, /customer_details\.email is a billing\/payer contact/);

// Legacy/non-modular flows still use the Stripe-observed e-mail as before.
assert.match(processPaid, /let paymentIdentityEmail = stripeObservedCustomerEmail/);

console.log('salesModularContractEmailAuthority20260901.regression.test.mjs: OK');
