import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const activationFlow = server.match(
  /const SALES_ACTIVATION_EMAIL_CLAIM_TTL_MS[\s\S]*?createSalesAssistedCheckoutPaymentProcessor/
)?.[0] || '';
const resendTransport = server.match(
  /async function postResendEmail[\s\S]*?async function sendEmailViaResend[\s\S]*?return \{[\s\S]*?deliveryMode,/
)?.[0] || '';

assert.match(activationFlow, /const claimSalesActivationEmailDelivery/);
assert.match(activationFlow, /\.is\("activation_email_sent_at", null\)/);
assert.match(activationFlow, /\.is\("activation_email_last_attempt_at", null\)/);
assert.match(activationFlow, /\.lt\("activation_email_last_attempt_at", staleBefore\)/);
assert.match(activationFlow, /const prepareSalesActivationAccess/);
assert.match(
  activationFlow,
  /const claim = await claimSalesActivationEmailDelivery\(checkoutSessionId\)/,
  'o provedor só pode ser chamado depois do claim persistido',
);
assert.match(
  activationFlow,
  /sendTransactionalEmailWithResultSafe\(\{[\s\S]*?idempotencyKey: `sales-activation:\$\{checkoutSessionId\}`/,
  'o envio usa o transporte transacional comum e uma chave idempotente por Checkout',
);
assert.match(
  activationFlow,
  /if \(delivery\.sent\)[\s\S]*?activation_email_sent_at: sentAt/,
  'sucesso do provedor precisa ser persistido',
);
assert.match(
  activationFlow,
  /emailErrorCode = delivery\.errorCode[\s\S]*?provisioning_status: "email_pending"/,
  'falha do canal permanece auditável e reenviável sem desfazer pagamento',
);
assert.match(
  activationFlow,
  /activationReady: true[\s\S]*?activationPath:/,
  'falha de e-mail não pode bloquear o link direto de ativação',
);
assert.match(resendTransport, /'Idempotency-Key'/, 'transporte HTTP do Resend deve preservar idempotência');
assert.doesNotMatch(
  activationFlow,
  /Promise\.all\([^)]*sendTransactionalEmailWithResultSafe/,
  'envio do e-mail não pode correr em paralelo com o próprio claim',
);

console.log('salesActivationEmailConcurrency.test.ts: OK');
