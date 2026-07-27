import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculateVertoPatientBasedMonthlyPrice,
  previewVertoPatientBillingPrice
} from '../services/stripeService';

const server = fs.readFileSync('server.ts', 'utf8');
assert.equal(calculateVertoPatientBasedMonthlyPrice(5).totalAmountCents, 19700);
assert.equal(calculateVertoPatientBasedMonthlyPrice(50).totalAmountCents, 109700);
assert.equal(calculateVertoPatientBasedMonthlyPrice(51).requiresCustomPricing, true);
assert.equal(
  previewVertoPatientBillingPrice({
    activePatientCount: 5,
    patientBasedBillingEnabled: false,
    legacyMonthlyPriceCents: 19700
  }).pricingModel,
  'legacy'
);
assert.match(server, /app\.post\('\/api\/billing\/checkout', checkAuth, handleCreateClinicCheckout\)/);
assert.match(server, /app\.post\('\/api\/stripe\/create-checkout', checkAuth, handleCreateClinicCheckout\)/);

console.log('billing.test.ts: OK');
