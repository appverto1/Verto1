import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const page=readFileSync('src/components/PublicSalesOffer.tsx','utf8');
const transport=readFileSync('src/services/publicSalesCardCheckout.ts','utf8');
const postPaymentTransport=readFileSync('src/services/publicSalesPostPaymentTransport.ts','utf8');
const server=readFileSync('server.ts','utf8');
const env=readFileSync('services/stripeEnvironment.ts','utf8');

test('card checkout remains explicit and follows modular acceptance/Stripe availability',()=>{
  const action=page.split('const continueToCheckout = async () => {')[1]?.split('const acceptModularOffer = async')[0]||'';
  assert.match(action,/setContinuing\(true\)/);
  assert.match(action,/await handoffPublicSalesCardCheckout\(token, \(url\) => window\.location\.assign\(url\)\)/);
  assert.match(transport,/const data = await requestPublicSalesCardCheckout\(token, request\)/);
  assert.match(transport,/navigate\(data\.url\)/);
  assert.ok(transport.indexOf('await requestPublicSalesCardCheckout(token, request)') < transport.indexOf('navigate(data.url)'));
  assert.match(page,/\{acceptedAt \? \(\s*<button[\s\S]*?onClick=\{\(\) => void continueToCheckout\(\)\}/);
  assert.match(page,/disabled=\{continuing \|\| !offer\.modularCheckoutEnabled \|\| !offer\.stripeReady\}/);
  assert.match(page,/Continuar para cadastro do cartão/);
  assert.match(page,/const acceptModularOffer = async/);
  assert.match(page,/await acceptPublicSalesModularOffer\(token\)/);
  assert.match(transport,/commercialValuesConsent: true/);
  assert.match(transport,/credentials: 'omit'/);
  assert.ok(page.indexOf('await acceptPublicSalesModularOffer(token)') < page.indexOf('setAcceptedAt(data.acceptedAt'));

});
test('backend alone validates test/live keys, accepted snapshot and idempotent Checkout',()=>{
  assert.match(env,/value === 'test' \|\| value === 'live'/);
  assert.match(env,/STRIPE_ENVIRONMENT deve ser explicitamente test ou live/);
  assert.match(env,/sk_test_/);
  assert.match(env,/sk_live_/);
  assert.match(server,/const createOrReuseModularCheckout = async/);
  assert.match(server,/MODULAR_OFFER_ACCEPTANCE_REQUIRED/);
  assert.match(server,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/);
  assert.match(server,/public-modular-checkout:/);
  assert.match(server,/operationIdempotencyKey/);
  assert.match(server,/stripe\.checkout\.sessions\.create/);
  assert.match(server,/processSalesAssistedCheckoutCompleted/);
  assert.match(server,/confirm_sales_assisted_checkout_payment/);
  assert.doesNotMatch(transport,/getSupabase|service_role|sk_live_|sk_test_|stripe\.checkout|localStorage|\/webhook/);
});
test('payment confirmation, Stripe session binding, recovery and onboarding remain untouched',()=>{
  assert.match(page,/legacyPaymentReturnWithoutContext/);
  assert.match(page,/const loadPaymentStatus = async/);
  assert.match(page,/const reconcileDirectorProvisioning = async/);
  assert.match(page,/const openDirectorSession = async/);
  assert.match(page,/resolveSalesPostPaymentRetryDelayMs/);
  assert.match(page,/resolveSalesPostPaymentState/);
  assert.match(postPaymentTransport,/session_id=\$\{encodeURIComponent\(checkoutSessionId\)\}/);
  assert.match(page,/token\.toLowerCase\(\) === 'pagamento'/);
});
