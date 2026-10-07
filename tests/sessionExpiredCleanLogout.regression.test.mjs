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

const first401Index = retry.indexOf("if (response.status !== 401) return response");
const retryFetchIndex = retry.indexOf("response = await fetch(url, { ...init, headers: retryHeaders })");
const notifyIndex = retry.indexOf('await notifyServerSessionExpiredIfNeeded(response)');
assert.ok(first401Index >= 0 && retryFetchIndex > first401Index && notifyIndex > retryFetchIndex,
  'logout notification must happen only after the authenticated retry also returns 401');
assert.match(retry, /if \(response\.status === 401\) \{[\s\S]*?notifyServerSessionExpiredIfNeeded/);

assert.match(app, /window\.addEventListener\('verto:server-session-expired', handleServerSessionExpired\)/);
assert.match(app, /manualLogoutInProgressRef\.current\) return;[\s\S]*?void handleLogout\(\)/);
assert.match(app, /window\.removeEventListener\('verto:server-session-expired', handleServerSessionExpired\)/);
assert.match(app, /const handleLogout = async \(\) => \{[\s\S]*?resetWorkspaceScopedState\(\)[\s\S]*?setUser\(null\)/,
  'expired server sessions must reuse the canonical logout cleanup instead of leaving stale workspace state');

console.log('sessionExpiredCleanLogout.regression.test.mjs: ok');
