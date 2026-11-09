import {readFileSync as readItem10Source} from 'node:fs';
import { readFileSync as readItem07Source } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const item10ReconcileSource = readItem10Source('services/publicSalesPostPaymentReconciliationRoute.ts','utf8');
const checkoutCoreSource = readItem07Source('services/salesModularCheckoutCore.ts','utf8');
const publicCheckoutRouteSource = readItem07Source('services/publicSalesCheckoutRoutes.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const checkoutHelper = server.match(/const SALES_CHECKOUT_RETURN_CONTEXT_PREFIX[^]*?function resolveSalesStripeConfiguration/)?.[0] || '';
const modularCheckout = checkoutCoreSource.slice(checkoutCoreSource.indexOf('const createOrReuseModularCheckout = async'));
const statusRoute = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const reconcileRoute = item10ReconcileSource.match(/"\/api\/public\/sales-offers\/:token\/prepare-activation"[^]*?ITEM10_SOURCE_END/)?.[0] || '';
const directorRoute = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');

assert.match(checkoutHelper, /SALES_CHECKOUT_RETURN_CONTEXT_PREFIX\s*=\s*"pagamento-"/);
assert.match(checkoutHelper, /sales_checkout_links/);
assert.match(checkoutHelper, /public_token_hash/);
assert.match(checkoutHelper, /stripe_checkout_session_id/);
assert.match(checkoutHelper, /deriveSalesCheckoutPublicToken/);
assert.match(checkoutHelper, /timingSafeEqual/);
assert.match(checkoutHelper, /source:\s*"checkout"/);
assert.match(checkoutHelper, /source:\s*"offer"/);

assert.match(modularCheckout, /buildSalesCheckoutReturnContextToken\(checkoutPublicToken\)/);
assert.doesNotMatch(modularCheckout, /\/oferta\/pagamento\?payment=success/);
assert.match(modularCheckout, /session_id=\{CHECKOUT_SESSION_ID\}/);

for (const [name, route] of [
  ['status', statusRoute],
  ['reconcile', reconcileRoute],
]) {
  assert.match(route, /resolveSalesPostPaymentContextToken\(token, checkoutSessionId\)/, `${name} must resolve offer or checkout return context`);
  assert.match(route, /\.eq\("id", context\.offerId\)/, `${name} must bind the resolved offer`);
  assert.match(route, /\.eq\("lead_id", context\.leadId\)/, `${name} must bind the resolved lead`);
  assert.match(route, /\.eq\("stripe_checkout_session_id", checkoutSessionId\)/, `${name} must bind the returned Stripe session`);
}
assert.match(directorRoute, /status\(410\)/);
assert.match(directorRoute, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.doesNotMatch(directorRoute, /req\.session|signInWith|setSession/);

assert.match(publicOffer, /legacyPaymentReturnWithoutContext/);
assert.match(publicOffer, /token\.toLowerCase\(\) === 'pagamento'/);
assert.match(publicOffer, /Este Checkout foi criado por uma versão anterior sem o contexto seguro de retorno/);
assert.match(publicOffer, /if \(legacyPaymentReturnWithoutContext\)[^]*?else if \(returnedFromPayment\) void loadPaymentStatus\(\)/);

console.log('salesCheckoutReturnContext20260831.regression.test.mjs: OK');
