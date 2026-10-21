import assert from 'node:assert/strict';
import fs from 'node:fs';

const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');

const retryStart = dataService.indexOf('async function fetchWithAuthRetry');
const retryEnd = dataService.indexOf('async function safeJson', retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, 'fetchWithAuthRetry must exist');
const retry = dataService.slice(retryStart, retryEnd);

assert.match(dataService, /SERVER_SESSION_EXPIRED_EVENT = 'verto:server-session-expired'/);
assert.match(dataService, /SERVER_SESSION_EXPIRED_CODES = new Set\(\['SERVER_SESSION_REQUIRED', 'SESSION_REVOKED'\]\)/);
assert.match(dataService, /response\.clone\(\)\.json\(\)/, '401 payload must be inspected without consuming the caller response');
assert.match(dataService, /lastServerSessionExpiryDispatchAt < 5000/, 'concurrent 401 responses must not flood logout events');

const first401Index = retry.indexOf("if (response.status !== 401)");
const retryFetchIndex = retry.indexOf("response = await fetch(url, { ...init, headers: retryHeaders })");
const notifyIndex = retry.indexOf('await notifyServerSessionExpiredIfNeeded(response)');
assert.ok(first401Index >= 0 && retryFetchIndex > first401Index && notifyIndex > retryFetchIndex,
  'logout notification must happen only after the authenticated retry also returns 401');
assert.match(retry, /if \(response\.status === 401\) \{[\s\S]*?notifyServerSessionExpiredIfNeeded/);

assert.match(app, /window\.addEventListener\('verto:server-session-expired', handleServerSessionExpired\)/);
assert.match(app, /manualLogoutInProgressRef\.current\) return;[\s\S]*?void handleLogout\('expired'\)/);
assert.match(app, /window\.removeEventListener\('verto:server-session-expired', handleServerSessionExpired\)/);
assert.match(app, /const handleLogout = async \(reason: 'manual' \| 'expired' = 'manual'\) => \{[\s\S]*?resetWorkspaceScopedState\(\)[\s\S]*?setUser\(null\)/,
  'expired server sessions must reuse the canonical logout cleanup instead of leaving stale workspace state');

// Expired sessions must immediately hide protected data and must never attempt
// unauthorized offline replay or activity-log writes before logout.
const expiredStart = app.indexOf("const handleLogout = async (reason: 'manual' | 'expired'");
const expiredEnd = app.indexOf("window.addEventListener('verto:server-session-expired'", expiredStart);
const expiredLogout = app.slice(expiredStart, expiredEnd);
assert.match(expiredLogout, /reason === 'expired'[\s\S]*?setUser\(null\)[\s\S]*?resetWorkspaceScopedState\(\)/);
assert.match(expiredLogout, /if \(reason !== 'expired'\) \{[\s\S]*?syncOfflineData\(\)/);
assert.match(expiredLogout, /reason === 'expired'[\s\S]*?window\.history\.replaceState\(\{\}, document\.title, '\/'\)/);
assert.match(expiredLogout, /clearSensitiveOfflineCacheForUser\(signingOutUserId\)/);

 // A confirmed 401 must show a single actionable re-entry notice after the
 // canonical cleanup. Never auto-select a professional/patient role.
assert.match(app, /const \[sessionRecoveryNotice, setSessionRecoveryNotice\] = useState<'expired' \| 'revoked' \| null>\(null\)/);
assert.match(app, /if \(user\?\.id\) \{[\s\S]*?setSessionRecoveryNotice\(null\)/, 'successful authentication clears the old notice');
assert.match(app, /const handleServerSessionExpired = \(event: Event\) => \{[\s\S]*?setSessionRecoveryNotice\(code === 'SESSION_REVOKED' \? 'revoked' : 'expired'\);[\s\S]*?handleLogout\('expired'\)/);
assert.match(app, /\{sessionRecoveryNotice && \(/, 'the notice only renders after an expired server session');
assert.match(app, /role="alert"/, 'the notice is exposed to assistive technology');
assert.match(app, /sessionRecoveryNotice === 'revoked' \? 'Sua sessão foi encerrada por segurança\.' : 'Sua sessão expirou\.'/);
assert.match(app, /onClick=\{\(\) => window\.location\.assign\('\/entrar'\)\}/, 'the CTA returns to the role-neutral access gateway');
assert.match(app, /Entrar novamente/, 'a manual login action is offered instead of redirect loops');
assert.match(app, /Confira se as alterações feitas antes de sair foram salvas\./, 'never imply that unsaved clinical edits were persisted');

console.log('sessionExpiredCleanLogout.regression.test.mjs: ok');
