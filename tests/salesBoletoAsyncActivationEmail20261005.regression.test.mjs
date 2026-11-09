import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();

const activationFlow = server.match(
  /const SALES_ACTIVATION_EMAIL_CLAIM_TTL_MS[\s\S]*?const preparePaidDirectorSessionBootstrap/,
)?.[0] || '';
const processPaid = server.match(
  /const processSalesAssistedCheckoutCompleted =[^]*?const stripeInvoiceSubscriptionId/,
)?.[0] || '';
const eventRecognizer = server.match(
  /const isSalesAssistedStripeEvent = async[^]*?const processSalesAssistedStripeEvent = async/,
)?.[0] || '';
const eventProcessor = server.match(
  /const processSalesAssistedStripeEvent = async[^]*?\/\/ Stripe Payment Link activation webhook/,
)?.[0] || '';

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
  /sendActivationEmail:[\s\S]*?event\.type === "checkout\.session\.async_payment_succeeded"/,
  'pagamento assíncrono liquidado deve habilitar o e-mail de primeiro acesso',
);
assert.match(
  eventProcessor,
  /invoice\.paid[\s\S]*?offer\.status[\s\S]*?!== "paid"[\s\S]*?sendActivationEmail:\s*true/,
  'invoice.paid deve funcionar como recuperação apenas enquanto a oferta ainda não foi paga',
);

assert.match(
  processPaid,
  /options:\s*\{\s*sendActivationEmail\?: boolean\s*\}\s*=\s*\{\}/,
);
assert.match(
  processPaid,
  /options\.sendActivationEmail[\s\S]*?prepareSalesActivationAccess\(/,
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
