import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const portalComponent = read('src/components/PortalRelationshipConfirmation.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const migrationCode = read('supabase/migrations/20260601150000_portal_otp_relationship_flow.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 5000) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return source.slice(start, end);
}

test('email de vinculo usa rota do portal e nao reset de senha', () => {
  const emailBuilder = sliceFrom(serverCode, 'function buildRelationshipConfirmationEmail', 1800);
  const createRequest = sliceFrom(serverCode, 'async function createRelationshipConfirmationRequest', 3600);
  assert.match(emailBuilder, /Confirme o novo vínculo/);
  assert.match(emailBuilder, /Confirmar vínculo/);
  assert.match(createRequest, /getAppPortalPathUrl\('\/portal\/confirmar-vinculo', \{ token \}\)/);
  assert.doesNotMatch(emailBuilder, /reset-password|redefini/i);
  assert.doesNotMatch(createRequest, /getRecoveryRedirectUrl|getActivationRedirectUrl/);
});

test('OTP do portal e separado de recuperacao de senha e usa hash', () => {
  const requestCode = sliceFrom(serverCode, "app.post('/api/portal/auth/request-code'", 6200);
  const verifyCode = sliceFrom(serverCode, "app.post('/api/portal/auth/verify-code'", 7600);
  assert.match(serverCode, /type OtpPurpose = 'password_recovery' \| 'phone_verification' \| 'portal_login'/);
  assert.match(requestCode, /makeOtpChallengeKey\('email', 'portal_login', email\)/);
  assert.match(requestCode, /codeHash:\s*hashIdentifier\(code\)/);
  assert.match(requestCode, /PORTAL_LOGIN_OTP_TTL_MS/);
  assert.match(requestCode, /Se este e-mail estiver cadastrado/);
  assert.doesNotMatch(requestCode, /buildPasswordRecoveryEmailTemplate|getRecoveryRedirectUrl/);
  assert.match(verifyCode, /hashIdentifier\(code\) !== challenge\.codeHash/);
  assert.match(verifyCode, /challenge\.attempts > 5/);
  assert.match(verifyCode, /await consumeOtpChallenge\(key\)/);
  assert.match(verifyCode, /error:\s*'INVALID_CODE'/);
  assert.match(verifyCode, /portalVerified:\s*true/);
  assert.match(verifyCode, /accountState:\s*'PORTAL_VERIFIED'/);
  assert.match(verifyCode, /passwordStatus:\s*'PASSWORD_OPTIONAL'/);
  assert.match(verifyCode, /req\.session\.user = buildSessionUserPayload/);
  assert.match(verifyCode, /PORTAL_OTP_VERIFIED|OTP do portal verificado/);
  assert.doesNotMatch(verifyCode, /PATIENT_ACTIVATION_REQUIRED/);
});

test('relationship token localiza solicitacao mas nao autentica nem libera historico', () => {
  const getRoute = sliceFrom(serverCode, "app.get('/api/portal/relationship-confirmations/:token'", 5200);
  const confirmRoute = sliceFrom(serverCode, "app.post('/api/portal/relationship-confirmations/:token/confirm'", 5200);
  assert.doesNotMatch(getRoute, /req\.session\.user =/);
  assert.match(getRoute, /requiresAuth:\s*!authenticatedMatches/);
  assert.match(getRoute, /canAuthorizeSharedHistory/);
  assert.match(confirmRoute, /portalActionLimiter, checkPortalAuth/);
  assert.match(serverCode, /error:\s*'PORTAL_AUTH_REQUIRED'/);
  assert.match(serverCode, /error:\s*'RELATIONSHIP_USER_MISMATCH'/);
  assert.match(confirmRoute, /Vínculo já confirmado/);
  assert.match(confirmRoute, /RELATIONSHIP_CONFIRMED/);
});

test('autorizacao de historico acontece depois do vinculo confirmado e importa timeline', () => {
  const previewRoute = sliceFrom(serverCode, "app.get('/api/portal/relationship-confirmations/:token/shareable-history-preview'", 2600);
  const authorizeRoute = sliceFrom(serverCode, "app.post('/api/portal/relationship-confirmations/:token/authorize-history'", 7600);
  assert.match(previewRoute, /checkPortalAuth/);
  assert.match(previewRoute, /Confirme o vínculo antes de compartilhar histórico/);
  assert.match(authorizeRoute, /sanitizeString\(confirmation\.status, 40\) !== 'CONFIRMED'/);
  assert.match(authorizeRoute, /buildPatientPortabilitySnapshot/);
  assert.match(authorizeRoute, /importSharedSnapshotIntoLongitudinalTimeline/);
  assert.match(authorizeRoute, /PRIVATE_HISTORY_EXCLUDED_FROM_PORTABILITY/);
  assert.match(authorizeRoute, /status:\s*'HISTORY_SHARE_AUTHORIZED'/);
  assert.match(authorizeRoute, /Histórico compartilhado com sucesso/);
  assert.match(authorizeRoute, /idempotent:\s*true/);
});

test('UI tem rota propria, login por codigo e checklist de compartilhamento', () => {
  assert.match(appCode, /portal\\\/confirmar-vinculo/);
  assert.match(appCode, /PortalRelationshipConfirmation/);
  assert.match(portalComponent, /Enviar código/);
  assert.match(portalComponent, /Código de 6 dígitos/);
  assert.match(portalComponent, /Confirmar vínculo/);
  assert.match(portalComponent, /Não compartilhar histórico/);
  assert.match(portalComponent, /Anotações privadas de clínicas anteriores não serão compartilhadas/);
  assert.match(dataServiceCode, /requestPortalLoginCode/);
  assert.match(dataServiceCode, /verifyPortalLoginCode/);
  assert.match(dataServiceCode, /authorizeRelationshipHistory/);
});

test('pos compartilhamento encerra no portal e senha fica opcional', () => {
  const authorizeHandler = sliceBetween(portalComponent, 'const authorizeHistory = async () => {', 'const goToPortal = () => {');
  const successView = sliceFrom(portalComponent, 'Compartilhamento autorizado', 2600);
  const userActivationGuard = sliceFrom(appCode, 'const userNeedsPatientActivation =', 420);
  assert.doesNotMatch(authorizeHandler, /window\.location|reset-password|ativar|auth\/callback|api\/auth\/login/);
  assert.match(authorizeHandler, /setHistoryAuthorized\(true\)/);
  assert.match(successView, /O vínculo foi confirmado e o histórico selecionado foi compartilhado com a clínica/);
  assert.match(successView, /Anotações privadas de clínicas anteriores não foram compartilhadas/);
  assert.match(successView, /Ir para o portal/);
  assert.match(successView, /Fechar/);
  assert.match(successView, /Quer criar uma senha para entrar mais rápido depois/);
  assert.match(successView, /Criar senha/);
  assert.match(successView, /Agora não/);
  assert.match(userActivationGuard, /portalVerified !== true/);
  assert.match(userActivationGuard, /accountState !== 'PORTAL_VERIFIED'/);
});

test('migration cria suporte OTP sem expor codigo puro', () => {
  assert.match(migrationCode, /create table if not exists public\.otp_challenges/);
  assert.match(migrationCode, /code_hash text/);
  assert.match(migrationCode, /portal_login/);
  assert.match(migrationCode, /alter table public\.otp_challenges enable row level security/);
  assert.doesNotMatch(migrationCode, /\bcode text\b/);
});

test('sem select star', () => {
  assert.doesNotMatch(serverCode, /\.select\(\s*['"`]\*['"`]\s*\)/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} portal relationship confirmation checks passed`);
