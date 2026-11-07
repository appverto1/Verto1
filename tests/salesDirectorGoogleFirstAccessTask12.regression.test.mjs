import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ui = readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const auth = readFileSync('src/lib/supabase.ts', 'utf8');
const google = readFileSync('src/services/salesActivationGoogleOAuth.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const googleStart = ui.match(/const handleGoogleLogin = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const oauthReturn = app.match(/const completeSalesActivationOAuth = async \(session: any\) => \{[\s\S]*?\n  \};/)?.[0] || '';
const authListener = app.match(/const initSupabase = async \(\) => \{[\s\S]*?\n    void initSupabase\(\);/)?.[0] || '';

test('paid Director Google starts only on click and keeps the exact activation return link', () => {
  assert.match(ui, /onClick=\{\(\) => void handleGoogleLogin\(\)\}/);
  assert.match(googleStart, /if \(!activation\?\.email\) return/);
  assert.match(googleStart, /beginSalesActivationGoogleOAuth\(token, activation\.email, window\.location\.origin\)/);
  assert.match(google, /storage\.setItem\('verto_intended_role', 'director'\)/);
  assert.match(google, /storage\.setItem\('verto_activation_email', email\.toLowerCase\(\)\)/);
  assert.match(google, /storage\.setItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY, token\)/);
  assert.match(google, /supabase\.auth\.signInWithOAuth\(\{/);
  assert.match(google, /provider: 'google'/);
  assert.match(google, /redirectTo: `\$\{origin\}\/ativacao-comercial\/\$\{encodeURIComponent\(token\)\}`/);
  assert.match(google, /scopes: 'https:\/\/www\.googleapis\.com\/auth\/userinfo\.email'/);
  assert.match(google, /prompt: 'select_account'/);
  assert.doesNotMatch(googleStart + google, /createUser|checkout\.sessions\.create|window\.location\.assign/);
});

test('OAuth start failure cleans only the current attempt and keeps actionable UI feedback', () => {
  assert.match(google, /if \(storage\.getItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY\) === token\) \{/);
  assert.match(google, /storage\.removeItem\(SALES_ACTIVATION_OAUTH_PENDING_KEY\)/);
  assert.match(google, /storage\.getItem\('verto_intended_role'\) === 'director'/);
  assert.match(google, /storage\.removeItem\('verto_intended_role'\)/);
  assert.match(google, /storage\.getItem\('verto_activation_email'\) === email\.toLowerCase\(\)/);
  assert.match(google, /storage\.removeItem\('verto_activation_email'\)/);
  assert.match(googleStart, /setSubmitting\(false\)/);
  assert.match(googleStart, /setError\(oauthError\?\.message \|\| 'Não foi possível iniciar o acesso com Google\.'/);
});

test('OAuth callback requires matching activation token and server-verified contractual identity', () => {
  assert.match(oauthReturn, /!session\?\.access_token/);
  assert.match(oauthReturn, /readSalesActivationOAuthContext\(/);
  assert.match(google, /pathname\.match\(/);
  assert.match(google, /pendingToken !== routeToken \|\| !activationEmail/);
  assert.match(oauthReturn, /salesActivationOAuthLoginRef\.current\?\.accessToken === accessToken/);
  assert.match(oauthReturn, /handleLoginSuccess\(session, 'director', undefined, \{/);
  assert.match(oauthReturn, /provider: 'google'/);
  assert.match(oauthReturn, /activationFlow: true/);
  assert.match(oauthReturn, /activationEmail,/);
  assert.match(server, /SALES_ACTIVATION_EMAIL_MISMATCH/);
  assert.match(server, /verifySalesDirectorContractAccess\(/);
  assert.doesNotMatch(oauthReturn + google, /createUser\(|checkout\.sessions\.create/);
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
