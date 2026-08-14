import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const activationFlow = server.match(
  /const SALES_ACTIVATION_EMAIL_CLAIM_TTL_MS[\s\S]*?const stripeInvoiceSubscriptionId/
)?.[0] || '';

assert.match(
  activationFlow,
  /const claimSalesActivationEmailDelivery/,
  'o envio de ativação deve possuir claim centralizado antes de chamar o provedor'
);
assert.match(
  activationFlow,
  /\.is\("activation_email_sent_at", null\)/,
  'uma ativação já enviada não pode ser reclamada'
);
assert.match(
  activationFlow,
  /\.is\("activation_email_last_attempt_at", null\)/,
  'o primeiro webhook deve reivindicar atomicamente uma ativação ainda não tentada'
);
assert.match(
  activationFlow,
  /\.lt\("activation_email_last_attempt_at", staleBefore\)/,
  'um claim abandonado deve poder ser retomado após timeout curto'
);
assert.match(
  activationFlow,
  /if \(!activationEmailClaim\) \{[\s\S]*?activationToken = "";[\s\S]*?if \(!activationEmailAlreadySent && activationToken\) \{[\s\S]*?resend\.emails\.send/,
  'worker sem claim deve perder o token local e não pode chamar Resend'
);
assert.match(
  activationFlow,
  /idempotencyKey: `sales-activation:\$\{session\.id\}`/,
  'retries legítimos devem continuar reutilizando a mesma chave idempotente do e-mail'
);
assert.match(
  activationFlow,
  /activation_email_sent_at: new Date\(\)\.toISOString\(\)/,
  'sucesso deve continuar persistido no banco antes de considerar provisioning completo'
);
assert.match(
  activationFlow,
  /provisioning_status: "email_pending"/,
  'falha real do provedor deve continuar auditável e reenviável'
);
assert.doesNotMatch(
  activationFlow,
  /Promise\.all\([^)]*resend\.emails\.send/,
  'envio do e-mail não pode ser paralelizado dentro do próprio fluxo'
);

console.log('salesActivationEmailConcurrency.test.ts: OK');
