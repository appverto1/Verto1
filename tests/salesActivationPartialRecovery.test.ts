import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');

const passwordActivation = fs.readFileSync('services/publicSalesActivationPasswordRoute.ts', 'utf8');
const authLogin = server.match(
  /app\.post\('\/api\/auth\/login'[\s\S]*?app\.post\('\/api\/auth\/logout'/
)?.[0] || '';
const publicActivationLoader = server.match(
  /const loadPublicSalesActivation = async[\s\S]*?app\.get\(\s*"\/api\/public\/sales-activations\/:token"/
)?.[0] || '';

assert.match(
  passwordActivation,
  /recoverablePartialActivation/,
  'perfil parcial criado pela mesma ativação deve poder retomar o onboarding'
);
assert.match(passwordActivation, /activationOfferId === loaded\.offerId/);
assert.match(passwordActivation, /profileEmail === loaded\.email/);
assert.match(passwordActivation, /\["director", "coordinator"\]\.includes\(profileRole\)/);
assert.match(passwordActivation, /loaded\.activation\.used !== true/);
assert.match(
  passwordActivation,
  /if \(!recoverablePartialActivation\) \{[\s\S]*?ACCOUNT_ALREADY_ACTIVE/,
  'ACCOUNT_ALREADY_ACTIVE só deve bloquear contas realmente concluídas ou não vinculadas à ativação atual'
);

assert.match(
  authLogin,
  /SALES_ACTIVATION_EMAIL_MISMATCH/,
  'login de ativação comercial deve vincular-se ao e-mail congelado da contratação'
);
assert.match(
  authLogin,
  /sales_activation_offer_id: validPaidActivation\.offerId/,
  'a identidade Auth deve receber marcador do offer antes do provisionamento parcial'
);
assert.match(
  authLogin,
  /activationOfferHint[\s\S]*?\.eq\(\s*'sales_offer_id',[\s\S]*?activationOfferHint/,
  'retry deve retomar a proposta exata em vez de escolher genericamente a última ativação do e-mail'
);
assert.match(
  authLogin,
  /finalizeSalesActivationForUser\(\{[\s\S]*?offerId: retryOfferId/,
  'login posterior deve concluir a ativação comercial interrompida'
);

assert.match(publicActivationLoader, /offer_type,contract_email/);
assert.match(
  publicActivationLoader,
  /contractEmail !== email/,
  'ativação modular deve falhar fechada se o token não corresponder ao e-mail contratual congelado'
);

console.log('salesActivationPartialRecovery.test.ts: OK');
