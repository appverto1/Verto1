import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const auth = readFileSync('src/lib/supabase.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const googleStart = ui.match(/const handleGoogleLogin = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const oauthReturn = app.match(/const completeSalesActivationOAuth = async \(session: any\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const authListener = app.match(/const initSupabase = async \(\) => \{[\s\S]*?\n    void initSupabase\(\);/)?.[0] || '';

test('paid Director Google starts only by explicit click and returns to same offer activation', () => {
  assert.match(ui, /onClick=\{\(\) => void handleGoogleLogin\(\)\}/);
  assert.match(googleStart, /if \(!activation\?\.email\) return/);
  assert.match(googleStart, /localStorage\.setItem\('verto_intended_role', 'director'\)/);
  assert.match(googleStart, /localStorage\.setItem\('verto_activation_email', activation\.email\.toLowerCase\(\)\)/);
  assert.match(googleStart, /localStorage\.setItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY, token\)/);
  assert.match(googleStart, /supabase\.auth\.signInWithOAuth\(\{/);
  assert.match(googleStart, /provider: 'google'/);
  assert.match(googleStart, /redirectTo: `\$\{window\.location\.origin\}\/ativacao-comercial\/\$\{encodeURIComponent\(token\)\}`/);
  assert.match(googleStart, /scopes: 'https:\/\/www\.googleapis\.com\/auth\/userinfo\.email'/);
  assert.match(googleStart, /prompt: 'select_account'/);
  assert.doesNotMatch(googleStart, /createUser|checkout\.sessions\.create|window\.location\.assign/);
});

test('OAuth start failure clears only this attempt, preventing stale Director hints', () => {
  assert.match(googleStart, /if \(localStorage\.getItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY\) === token\) \{/);
  assert.match(googleStart, /localStorage\.removeItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY\)/);
  assert.match(googleStart, /localStorage\.getItem\('verto_intended_role'\) === 'director'/);
  assert.match(googleStart, /localStorage\.removeItem\('verto_intended_role'\)/);
  assert.match(googleStart, /localStorage\.getItem\('verto_activation_email'\) === activation\.email\.toLowerCase\(\)/);
  assert.match(googleStart, /localStorage\.removeItem\('verto_activation_email'\)/);
  assert.match(googleStart, /setSubmitting\(false\)/);
  assert.match(googleStart, /setError\(oauthError\?\.message \|\| 'Não foi possível iniciar o acesso com Google\.'/);
});

test('OAuth callback requires matching offer token, existing session and backend identity binding', () => {
  assert.match(oauthReturn, /!session\?\.access_token/);
  assert.match(oauthReturn, /\/\^\\\/ativacao-comercial/);
  assert.match(oauthReturn, /pendingToken !== routeToken \|\| !activationEmail/);
  assert.match(oauthReturn, /salesActivationOAuthLoginRef\.current\?\.accessToken === accessToken/);
  assert.match(oauthReturn, /handleLoginSuccess\(session, 'director', undefined, \{/);
  assert.match(oauthReturn, /provider: 'google'/);
  assert.match(oauthReturn, /activationFlow: true/);
  assert.match(oauthReturn, /activationEmail,/);
  assert.match(server, /SALES_ACTIVATION_EMAIL_MISMATCH/);
  assert.match(server, /verifySalesDirectorContractAccess\(/);
  assert.doesNotMatch(oauthReturn, /createUser\(|checkout\.sessions\.create/);
});

test('backend login exception returns actionable error without consuming the pending OAuth attempt', () => {
  assert.match(oauthReturn, /let loginResult: any;/);
  assert.match(oauthReturn, /try \{\s*loginResult = await handleLoginSuccess/);
  assert.match(oauthReturn, /catch \{\s*loginResult = \{\s*success: false,/);
  assert.match(oauthReturn, /Não foi possível concluir o acesso com Google agora\. Tente novamente\./);
  assert.match(oauthReturn, /if \(!loginResult\?\.success\)/);
  assert.match(oauthReturn, /publishActivationErrorMessage\(/);
  assert.match(oauthReturn, /if \(loginResult\?\.code === 'SALES_ACTIVATION_EMAIL_MISMATCH'\)/);
  assert.match(oauthReturn, /supabase\.auth\.signOut\(\{ scope: 'local' \} as any\)/);
  assert.match(oauthReturn, /localStorage\.removeItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY\)/);
});

test('OAuth code exchange stays single-owner and auth callback remains deferred', () => {
  assert.match(auth, /detectSessionInUrl: false/);
  assert.match(auth, /exchangeOAuthCodeOnce\(client, urlExchangeTimeoutMs\)/);
  assert.match(auth, /client\.auth[\s\S]*?\.exchangeCodeForSession\(code\)/);
  assert.match(authListener, /onAuthStateChange\(\(event, session\) => \{/);
  assert.match(authListener, /window\.setTimeout\(\(\) => \{/);
  assert.match(authListener, /authChangeQueue = authChangeQueue/);
  assert.match(authListener, /const salesActivationOAuth = await completeSalesActivationOAuth\(session\)/);
  assert.match(app, /const salesActivationOAuth = await completeSalesActivationOAuth\(session\);\s*if \(salesActivationOAuth\.handled\) return;/);
  assert.match(app, /<SalesActivationAccess token=\{salesActivationToken\} onLogin=\{handleLoginSuccess\} \/>/);
});
