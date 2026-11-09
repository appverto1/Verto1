import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');
const eventHandlersSource = readItem09Source('services/salesAssistedStripeEventHandlers.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');

const activationFlow = server.match(
  /const SALES_ACTIVATION_EMAIL_CLAIM_TTL_MS[\s\S]*?const \{ preparePaidDirectorSessionBootstrap \}/,
)?.[0] || '';
const processPaid = stripePaidProcessorSource.match(/const processSalesAssistedCheckoutCompleted =[^]*?ITEM09_SOURCE_END/,
)?.[0] || '';
const eventRecognizer = eventHandlersSource;
const eventProcessor = eventHandlersSource;

assert.match(
  eventRecognizer,
  /checkout\.session\.async_payment_succeeded/,
  'pagamentos assíncronos pagos devem ser reconhecidos pelo webhook',
);

assert.match(
  eventProcessor,
  /event\.type === "checkout\.session\.async_payment_succeeded"/,
);
assert.match(
  eventProcessor,
  /sendActivationEmail:\s*true/,
  'pagamento assíncrono liquidado deve habilitar o e-mail de primeiro acesso',
);
assert.match(
  eventProcessor,
  /invoice\.paid[\s\S]*?offer\.status[\s\S]*?!== "paid"[\s\S]*?sendActivationEmail:\s*true/,
  'invoice.paid deve funcionar como recuperação apenas enquanto a oferta ainda não foi paga',
);

assert.match(
  processPaid,
  /_options:\s*\{\s*sendActivationEmail\?: boolean\s*\}\s*=\s*\{\}/,
);
assert.match(
  processPaid,
  /const activationEmail = await prepareSalesActivationAccess\(/,
);
assert.match(
  processPaid,
  /email:\s*directorEmail/,
  'o destino deve ser a identidade contratual resolvida pela Verto, não o contato de cobrança do Stripe',
);
assert.match(
  processPaid,
  /preserveProvisioningStatus:\s*true/,
  'o envio tardio não pode regredir o provisioning_status da conta já provisionada',
);
assert.match(processPaid, /attemptEmail: settledMethod === 'boleto'/,
  'somente boleto quitado deve enviar e-mail de ativação');

assert.match(
  activationFlow,
  /idempotencyKey:\s*`sales-activation:\$\{checkoutSessionId\}`/,
  'reentrega de webhook não pode duplicar o e-mail',
);
assert.match(
  activationFlow,
  /subject:\s*"Bem-vindo à Verto: conclua sua ativação"/,
);
assert.match(
  server,
  /Seu pagamento foi confirmado\. Clique no botão abaixo para criar sua conta e acessar seu painel\./,
);
assert.match(server, />\s*Criar minha conta\s*</);

console.log('salesBoletoAsyncActivationEmail20261005.regression.test.mjs: OK');
