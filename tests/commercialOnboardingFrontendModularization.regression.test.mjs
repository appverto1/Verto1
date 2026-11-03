import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSalesPostPaymentState, resolveSalesPostPaymentRetryDelayMs } from '../src/utils/salesPostPaymentState.mjs';
import { digitsOnly, formatDocument, formatCep, formatPhone, formatCountryCode, formatDateForDisplay, formatDateForApi } from '../src/utils/professionalOnboardingFormatting.mjs';

for (const [data, expected] of [
  [{ state: 'review_required', sessionClaimed: true }, 'review_required'],
  [{ reviewRequired: true, sessionClaimed: true }, 'review_required'],
  [{ state: 'account_activated' }, 'account_activated'],
  [{ sessionClaimed: true }, 'account_activated'],
  [{ directorSessionReady: true, accountProvisioned: true }, 'director_ready'],
  [{ state: 'provisioning' }, 'provisioning'],
  [{ accountProvisioned: true }, 'provisioning'],
  [{ paymentConfirmed: true }, 'payment_confirmed'],
  [{ state: 'payment_pending' }, 'payment_pending'],
  [{}, 'payment_pending']
]) assert.equal(resolveSalesPostPaymentState(data), expected);
for (const [header, payload, fallback, expected] of [
  ['10', {retryAfterMs: 2000}, 1800, 10000],
  [null, {retryAfterMs: 6000}, 1800, 6000],
  [null, {}, 1800, 1800],
  ['1', {}, 100, 1500],
  ['1000', {}, 1800, 30000],
]) assert.equal(resolveSalesPostPaymentRetryDelayMs(header, payload, fallback), expected);
assert.equal(digitsOnly('CPF 123.456.789-01'), '12345678901');
assert.equal(formatDocument('12345678901','CPF'),'123.456.789-01');
assert.equal(formatDocument('12345678000199','CNPJ'),'12.345.678/0001-99');
assert.equal(formatDocument('ABC-123','OTHER'),'ABC-123');
assert.equal(formatCep('12345678'),'12345-678');
assert.equal(formatPhone('11987654321'),'(11) 98765-4321');
assert.equal(formatPhone('1132345678'),'(11) 3234-5678');
assert.equal(formatCountryCode('55'),'+55');
assert.equal(formatDateForDisplay('2026-11-03'),'03/11/2026');
assert.equal(formatDateForApi('03112026'),'2026-11-03');
assert.equal(formatDateForApi('031126'),'');
const offer = readFileSync('src/components/PublicSalesOffer.tsx','utf8');
const onboarding = readFileSync('src/components/ProfessionalOnboarding.tsx','utf8');
assert.match(offer, /resolveSalesPostPaymentState\(data\)/);
assert.match(offer, /resolveSalesPostPaymentRetryDelayMs\(/);
assert.match(offer, /response\.status === 429/);
assert.match(offer, /response\.status === 404 && data\?\.error === 'OFFER_UNAVAILABLE'/);
assert.match(offer, /credentials: 'omit'/);
assert.match(onboarding, /dataService\.completeProfessionalOnboarding\(/);
assert.match(onboarding, /context\?\.onboardingMode === 'clinic_owner'/);
assert.match(onboarding, /formatDocument\(/);
assert.match(onboarding, /formatDateForApi\(/);
console.log('commercialOnboardingFrontendModularization: PASS');
