import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createPasswordRecoveryToken,
  verifyPasswordRecoveryToken,
} from '../src/utils/passwordRecoveryLink';
import {
  buildPasswordRecoveryEmailTemplate,
} from '../src/services/emailTemplates';
import { extractPasswordRecoveryUrlState } from '../src/utils/passwordRecoveryUrl';

const signingSecret = 'verto-test-recovery-secret-with-at-least-32-bytes';
const challengeSecret = 'high-entropy-one-time-secret-with-more-than-32-bytes';
const challengeKey = 'sha256-email-identity-key';
const expiresAt = Date.now() + 15 * 60 * 1000;

const token = createPasswordRecoveryToken({
  challengeKey,
  challengeSecret,
  expiresAt,
  signingSecret,
});

assert.deepEqual(
  verifyPasswordRecoveryToken({ token, signingSecret, now: expiresAt - 1 }),
  { challengeKey, challengeSecret, expiresAt },
  'o link assinado deve preservar somente as credenciais opacas do desafio',
);
assert.equal(
  verifyPasswordRecoveryToken({ token, signingSecret, now: expiresAt }),
  null,
  'o link deve expirar exatamente na vigência congelada',
);
assert.equal(
  verifyPasswordRecoveryToken({
    token: `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`,
    signingSecret,
  }),
  null,
  'qualquer adulteração da assinatura deve ser recusada',
);
assert.equal(
  verifyPasswordRecoveryToken({ token, signingSecret: 'wrong-secret-with-at-least-32-bytes!' }),
  null,
);
assert.throws(
  () => createPasswordRecoveryToken({
    challengeKey,
    challengeSecret,
    expiresAt,
    signingSecret: 'short',
  }),
  /PASSWORD_RECOVERY_LINK_SECRET_INVALID/,
);

const visibleEmail = 'conta@example.invalid';
const visibleOtp = '123456';
assert.doesNotMatch(token, new RegExp(visibleEmail.replace('.', '\\.')));
assert.doesNotMatch(token, new RegExp(visibleOtp));

const resetLink = `https://www.appverto.com.br/reset-password?auth_action=recovery&recovery_token=${token}`;
const recoveryEmail = buildPasswordRecoveryEmailTemplate({
  nome: 'Conta Verto',
  link_recuperacao: resetLink,
  expira_em_minutos: 15,
});
assert.deepEqual(recoveryEmail.variables, { reset_link: resetLink });
assert.equal(Object.keys(recoveryEmail.variables).length, 1);
assert.doesNotMatch(recoveryEmail.html, /Código de recuperação/);
assert.match(recoveryEmail.html, /Redefinir minha senha/);

const capturedRecoveryUrl = extractPasswordRecoveryUrlState(
  `https://www.appverto.com.br/reset-password?auth_action=recovery&recovery_token=${encodeURIComponent(token)}&source=email#redefinir`,
);
assert.equal(capturedRecoveryUrl.recoveryToken, token);
assert.equal(capturedRecoveryUrl.hadRecoveryToken, true);
assert.equal(
  capturedRecoveryUrl.sanitizedRelativeUrl,
  '/reset-password?auth_action=recovery&source=email#redefinir',
);
assert.doesNotMatch(capturedRecoveryUrl.sanitizedRelativeUrl, /recovery_token|signed-token/);

const canonicalFragmentRecoveryUrl = extractPasswordRecoveryUrlState(
  `https://www.appverto.com.br/reset-password?auth_action=recovery#recovery_token=${encodeURIComponent(token)}&source=email`,
);
assert.equal(canonicalFragmentRecoveryUrl.recoveryToken, token);
assert.equal(
  canonicalFragmentRecoveryUrl.sanitizedRelativeUrl,
  '/reset-password?auth_action=recovery#source=email',
);

const oversizedRecoveryUrl = extractPasswordRecoveryUrlState(
  `https://www.appverto.com.br/reset-password?auth_action=recovery&recovery_token=${'a'.repeat(4097)}`,
);
assert.equal(oversizedRecoveryUrl.recoveryToken, '');
assert.equal(oversizedRecoveryUrl.hadRecoveryToken, true);
assert.equal(oversizedRecoveryUrl.sanitizedRelativeUrl, '/reset-password?auth_action=recovery');

const server = fs.readFileSync('server.ts', 'utf8');
assert.match(server, /const tokenFragment = new URLSearchParams\(\)/);
const activationAccess = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const landingPage = fs.readFileSync('src/components/LandingPage.tsx', 'utf8');
const recoveryRequestStart = server.indexOf("app.post('/api/auth/password/recovery/email/request'");
const recoveryRequestEnd = server.indexOf("app.post('/api/portal/auth/request-code'", recoveryRequestStart);
const recoveryVerifyStart = server.indexOf("app.post('/api/auth/password/recovery/verify'", recoveryRequestEnd);
const recoveryVerifyEnd = server.indexOf("app.post('/api/auth/login'", recoveryVerifyStart);
assert.notEqual(recoveryRequestStart, -1);
assert.notEqual(recoveryRequestEnd, -1);
assert.notEqual(recoveryVerifyStart, -1);
assert.notEqual(recoveryVerifyEnd, -1);
const recoveryRequestRoute = server.slice(recoveryRequestStart, recoveryRequestEnd);
const recoveryVerifyRoute = server.slice(recoveryVerifyStart, recoveryVerifyEnd);

assert.match(recoveryRequestRoute, /createPasswordRecoveryLink\(\{/);
assert.match(recoveryRequestRoute, /templateKind: 'password_recovery'/);
assert.match(recoveryRequestRoute, /templateData: recoveryEmail\.variables/);
assert.doesNotMatch(recoveryRequestRoute, /templateData:\s*\{[\s\S]*?codigo:/);
assert.match(recoveryVerifyRoute, /verifyPasswordRecoveryToken\(\{/);
assert.match(recoveryVerifyRoute, /tokenClaims\?\.challengeKey/);
assert.match(
  server,
  /app\.post\('\/api\/auth\/password\/recovery\/verify', authMfaLimiter/,
  'a confirmação do link deve possuir rate limit específico',
);
assert.match(recoveryVerifyRoute, /updateOtpChallengeAttempts\(/);
assert.match(recoveryVerifyRoute, /expectedAttempts: challenge\.attempts/);
assert.match(
  recoveryVerifyRoute,
  /const challengeConsumed = await consumeOtpChallenge\([\s\S]*?if \(!challengeConsumed\)[\s\S]*?auth\.admin\.updateUserById/,
  'o desafio deve ser consumido por compare-and-set antes da alteração de senha',
);
assert.match(recoveryVerifyRoute, /RECOVERY_TEMPORARILY_UNAVAILABLE/);
assert.match(server, /requiresPersistentRecoveryStorage/);
assert.match(activationAccess, /isRecoveryRoute && recoveryToken/);
assert.match(activationAccess, /\? \{ recoveryToken \}/);
assert.match(activationAccess, /requiresMfa/);
assert.match(activationAccess, /extractPasswordRecoveryUrlState\(window\.location\.href\)/);
assert.match(activationAccess, /window\.history\.replaceState\(/);
assert.doesNotMatch(activationAccess, /continuationParams\.set\(['"]recovery_token['"]/);
assert.doesNotMatch(activationAccess, /localStorage\.setItem\([^\n]*recovery_token/);
assert.match(activationAccess, /\{ email: recoveryEmail, code: otpCode \}/);

assert.match(landingPage, /useState<'request' \| 'sent'>\('request'\)/);
assert.match(landingPage, /receber um link seguro de recuperação/);
assert.match(landingPage, /Verifique sua caixa de entrada/);
assert.match(landingPage, /Enviar link de recuperação/);
assert.doesNotMatch(landingPage, /handleRecoveryVerify/);
assert.doesNotMatch(landingPage, /Código de recuperação/);
assert.doesNotMatch(landingPage, /Enviar código/);

console.log('authLoginRecoveryFallback.test.ts: ok');
