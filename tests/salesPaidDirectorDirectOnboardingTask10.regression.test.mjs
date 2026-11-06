import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolveSalesPostPaymentState } from '../src/utils/salesPostPaymentState.mjs';

const offer = readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');
const onboarding = readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const checkoutTransport = readFileSync('src/services/publicSalesCardCheckout.ts','utf8');
const postPaymentTransport = readFileSync('src/services/publicSalesPostPaymentTransport.ts','utf8');

const openSession = offer.match(/const openDirectorSession = async \(checkoutSessionId: string\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const paymentEffect = offer.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[paymentStatusRefreshKey, token\]\);/)?.[0] || '';
const finishPayment = paymentEffect.match(/const finishReturnedPaymentState = async \(data: any\) => \{[\s\S]*?\n    \};/)?.[0] || '';
const pollPayment = paymentEffect.match(/const loadPaymentStatus = async \(\) => \{[\s\S]*?\n    \};/)?.[0] || '';
const checkoutAction = offer.match(/const continueToCheckout = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';

test('paid Checkout return reconciles on the server before any optional status polling', () => {
  assert.match(paymentEffect, /query\.get\('payment'\) === 'success' && Boolean\(checkoutSessionId\)/);
  assert.match(pollPayment, /const initialReconciliation = await reconcileDirectorProvisioning\(\)/);
  assert.match(paymentEffect, /requestPublicSalesPostPaymentReconciliation\(token, checkoutSessionId\)/);
  assert.match(postPaymentTransport, /\/prepare-activation/);
  assert.match(postPaymentTransport, /body: JSON\.stringify\(\{ sessionId: checkoutSessionId \}\)/);
  assert.match(paymentEffect, /loadPublicSalesPaymentStatusResponse\(token, checkoutSessionId\)/);
  assert.match(postPaymentTransport, /\/payment-status\?session_id=/);
  assert.match(pollPayment, /const maxAttempts = 10/);
  assert.match(pollPayment, /response\.status === 429/);
  assert.doesNotMatch(paymentEffect, /requestPublicSalesCardCheckout|checkout\.sessions\.create/);
});

test('director enters the clinic only after one-time server bootstrap and authenticated login', () => {
  assert.match(finishPayment, /if \(state === 'review_required'\) return true/);
  assert.match(finishPayment, /if \(state === 'director_ready'\) \{[\s\S]*?await openDirectorSession\(checkoutSessionId\)/);
  assert.match(openSession, /\/director-session/);
  assert.match(openSession, /method: 'POST'/);
  assert.match(openSession, /credentials: 'omit'/);
  assert.match(openSession, /body: JSON\.stringify\(\{ sessionId: checkoutSessionId \}\)/);
  assert.match(openSession, /payload\?\.tokenHash/);
  assert.match(openSession, /supabase\.auth\.verifyOtp\(/);
  assert.match(openSession, /verified\?\.data\?\.session\?\.access_token/);
  assert.match(openSession, /fetch\('\/api\/auth\/login'/);
  assert.match(openSession, /credentials: 'include'/);
  assert.match(openSession, /accessToken: verified\.data\.session\.access_token/);
  assert.match(openSession, /intendedRole: 'director'/);
  assert.match(openSession, /if \(!loginResponse\.ok \|\| loginPayload\?\.success === false\) \{/);
  assert.match(openSession, /setPaymentReturnState\('account_activated'\);[\s\S]*?window\.location\.replace\('\/'\)/);
  assert.doesNotMatch(openSession, /requestPublicSalesCardCheckout|\/checkout['"`]|stripe\.checkout/);
});

test('only explicit acceptance/checkout action can start checkout, never payment recovery', () => {
  assert.match(checkoutAction, /await handoffPublicSalesCardCheckout\(token, \(url\) => window\.location\.assign\(url\)\)/);
  assert.match(checkoutTransport, /await requestPublicSalesCardCheckout\(token, request\)/);
  assert.match(checkoutTransport, /navigate\(data\.url\)/);
  assert.match(offer, /onClick=\{\(\) => void continueToCheckout\(\)\}/);
  assert.match(paymentEffect, /if \(legacyPaymentReturnWithoutContext\)[\s\S]*?else if \(returnedFromPayment\) void loadPaymentStatus\(\)/);
  assert.match(offer, /response\.status === 404 && data\?\.error === 'OFFER_UNAVAILABLE'/);
  assert.match(offer, /não faça outro pagamento/);
  assert.match(offer, /Atualizar status/);
  assert.doesNotMatch(pollPayment, /requestPublicSalesCardCheckout|window\.location\.assign/);
});

test('paid director onboarding stays server-authorized and saves without a second checkout', () => {
  assert.match(onboarding, /const ownerAlreadyPaid = Boolean\([\s\S]*?isOwnerOnboarding &&[\s\S]*?context\?\.requiresPayment === false &&[\s\S]*?context\?\.canAccessDashboard === true/);
  assert.match(onboarding, /ownerAlreadyPaid[\s\S]*?'Concluir configuração e acessar a Verto'[\s\S]*?: 'Continuar para o plano'/);
  assert.match(onboarding, /dataService\.completeProfessionalOnboarding\(/);
  assert.match(server, /async function resolveOnboardingContextForUser/);
  assert.match(server, /requiresPayment: onboardingMode === 'clinic_owner' \? !canAccessDashboard : false/);
  assert.match(server, /verifySalesDirectorContractAccess\(/);
});

test('payment statuses never turn pending or review into a false paid director session', () => {
  const cases = [
    [{ state: 'payment_pending' }, 'payment_pending'],
    [{ paymentConfirmed: true }, 'payment_confirmed'],
    [{ accountProvisioned: true }, 'provisioning'],
    [{ directorSessionReady: true }, 'director_ready'],
    [{ state: 'review_required', directorSessionReady: true }, 'review_required'],
    [{ sessionClaimed: true }, 'account_activated'],
  ];
  for (const [payload, expected] of cases) {
    assert.equal(resolveSalesPostPaymentState(payload), expected);
  }
  assert.match(pollPayment, /lastObservedPaymentState === 'payment_pending'/);
  assert.match(pollPayment, /setPaymentReturnState\('unavailable'\)/);
});
