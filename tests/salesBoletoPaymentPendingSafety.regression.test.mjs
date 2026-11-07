import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const publicPage=readFileSync('src/components/PublicSalesOffer.tsx','utf8');
const postPaymentTransport=readFileSync('src/services/publicSalesPostPaymentTransport.ts','utf8');
const server=readFileSync('server.ts','utf8');
const assisted=readFileSync('services/salesAssistedStripeEventHandlers.ts','utf8');
const env=readFileSync('services/stripeEnvironment.ts','utf8');

test('bounded payment polling never relabels a possibly unpaid boleto as provisioning',()=>{
  const action=publicPage.split('const loadPaymentStatus = async () => {')[1]?.split('const loadOffer = async () => {')[0]||'';
  assert.match(publicPage,/\| 'payment_pending'/);
  assert.match(action,/const maxAttempts = 10/);
  assert.match(action,/await reconcileDirectorProvisioning\(\)/);
  assert.match(action,/response\.status === 429/);
  assert.match(action,/loadPublicSalesPaymentStatusResponse\(token, checkoutSessionId\)/);
  assert.match(postPaymentTransport,/credentials: 'omit'/);
  assert.match(postPaymentTransport,/cache: 'no-store'/);
  assert.match(publicPage,/lastObservedPaymentState = state/);
  assert.match(action,/lastObservedPaymentState === 'payment_pending'/);
  assert.match(action,/setPaymentReturnState\('payment_pending'\)/);
  assert.match(action,/lastObservedPaymentState === null/);
  assert.doesNotMatch(action,/if \(!cancelled\) setPaymentReturnState\('provisioning'\)/);
  assert.match(publicPage,/paymentReturnState === 'payment_pending'[\s\S]*?'Pagamento aguardando confirmação'/);
  assert.match(publicPage,/A emissão do boleto não confirma a quitação/);
  assert.match(publicPage,/A Stripe ainda está verificando o resultado da transação/);
  assert.match(publicPage,/paymentReturnState !== 'payment_pending' && paymentReturnState !== 'unavailable'/);
  assert.match(publicPage,/\['payment_pending', 'payment_confirmed', 'provisioning', 'director_ready'\]\.includes\(paymentReturnState\)/);
});
test('paid status and activation remain backend-authoritative and never use client payment status',()=>{
  assert.match(server,/paymentStatus === "paid" \|\|/);
  assert.match(server,/paymentStatus === "no_payment_required"/);
  assert.match(server,/if \(!paymentConfirmed\) \{/);
  assert.match(server,/activationPrepared: false/);
  assert.match(server,/confirm_sales_assisted_checkout_payment/);
  assert.match(assisted,/checkout\.session\.async_payment_succeeded/);
  assert.match(assisted,/event\.type === "checkout\.session\.async_payment_succeeded"/);
  assert.match(server,/reserveStripeWebhookEvent/);
  assert.match(env,/resolveStripeEnvironment/);
  assert.match(env,/validateStripeSecretForEnvironment/);
});
test('Boleto is not forcibly enabled in a live subscription or assumed available from the client',()=>{
  const moduleCheckout = checkoutCoreSource.slice(checkoutCoreSource.indexOf('const createOrReuseModularCheckout = async'));
  assert.match(moduleCheckout,/mode: "subscription"/);
  assert.match(moduleCheckout,/resolveStripeEnvironment\(\)/);
  assert.match(moduleCheckout,/validateStripeSecretForEnvironment/);
  assert.match(moduleCheckout,/operationIdempotencyKey/);
  assert.doesNotMatch(publicPage,/payment_method_types: \["boleto"\]/);
  assert.doesNotMatch(publicPage,/status:\s*'paid'/);
});
