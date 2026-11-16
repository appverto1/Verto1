import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const getSection = (text, start, end) => {
  const begin = text.indexOf(start);
  const finish = text.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, 'required auth section present: ' + start);
  return text.slice(begin, finish);
};

const authMe = getSection(server, "app.get('/api/auth/me'", "app.get('/api/onboarding/context'");
assert.match(authMe, /^app\.get\('\/api\/auth\/me', noStoreDynamicResponse, authMeLimiter, syncWorkspaceContextInSession/);
assert.match(server, /function noStoreDynamicResponse\(req: any, res: any, next: any\) \{[\s\S]*?delete req\.headers\['if-none-match'\];[\s\S]*?suppressEtagHeader\(res\);[\s\S]*?applyNoStoreHeaders\(res\);/);
assert.match(server, /'Cache-Control': 'no-store, no-cache, must-revalidate, private, proxy-revalidate'/);
assert.match(authMe, /if \(!await isActiveSessionToken\(sessionUserId, sessionToken\)\)/);
assert.match(server, /error: 'SERVER_SESSION_REQUIRED'/);
assert.match(server, /error: 'SESSION_REVOKED'/);

const authChange = getSection(app, "let authSubscription: { unsubscribe: () => void } | null = null;", "const checkSession = async () => {");
assert.match(authChange, /onAuthStateChange\(\(event, session\) => \{/);
assert.match(authChange, /window\.setTimeout\(\(\) => \{/);
assert.match(authChange, /const explicitIntendedRole = localStorage\.getItem\('verto_intended_role'\)/);
assert.match(authChange, /!isActivationFlow && !isInvitationAcceptanceContinuation && !explicitIntendedRole/);
assert.match(authChange, /authenticatedUserIdRef\.current === String\(session\.user\?\.id \|\| ''\)\.trim\(\)/);
assert.ok(authChange.indexOf('authenticatedUserIdRef.current === String(session.user?.id') < authChange.indexOf('const loginResult = await handleLoginSuccess(session'), 'silent SIGNED_IN must not issue a new server session');
assert.match(authChange, /if \(isActivationFlow && authProvider !== 'google'\)/);
assert.match(authChange, /const salesActivationOAuth = await completeSalesActivationOAuth\(session\)/);

const login = getSection(app, 'const handleLoginSuccess = async', 'const [therapistNotes');
assert.match(app, /const serverLoginInFlightRef = useRef<\{ key: string; promise: Promise<Response \| null> \} \| null>\(null\)/);
assert.match(app, /authenticatedUserIdRef\.current = String\(nextUser\?\.id \|\| ''\)\.trim\(\)/);
assert.match(login, /const loginRequestBody = JSON\.stringify\(\{[\s\S]*?accessToken,[\s\S]*?intendedRole,[\s\S]*?provider,[\s\S]*?invitationId: authContext\?\.invitationId \|\| null/);
assert.match(login, /serverLoginInFlightRef\.current\?\.key === loginRequestBody/);
assert.match(login, /serverLoginInFlightRef\.current = \{ key: loginRequestBody, promise: loginRequest \}/);
assert.match(login, /const response = \(await loginRequest\)\?\.clone\(\) \|\| null/);
assert.match(login, /serverLoginInFlightRef\.current = null/);

const contextSwitch = getSection(server, "app.post('/api/access-contexts/select'", "app.post('/api/workspaces/select'");
assert.match(contextSwitch, /fetchUserAccessContexts\(req\.session\.user\.id, workspaces\)/);
assert.match(contextSwitch, /selected = accessContexts\.find/);
assert.match(contextSwitch, /error: 'ACCESS_CONTEXT_NOT_AUTHORIZED'/);
assert.match(contextSwitch, /req\.session\.save/);
assert.doesNotMatch(contextSwitch, /issueSessionToken\(|revokeDistributedSessionToken\(/, 'switching an authorized clinic must not reissue or revoke the login session');

const expiredLogout = getSection(app, "const handleLogout = async", "window.addEventListener('verto:server-session-expired'");
assert.match(expiredLogout, /authenticatedUserIdRef\.current = ''/);
assert.match(expiredLogout, /setUser\(null\)/);

console.log('stagingIdempotentServerSession.regression.test.mjs: OK');
