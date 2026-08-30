import assert from 'node:assert/strict';
import fs from 'node:fs';

const supabase = fs.readFileSync('src/lib/supabase.ts', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const ensureSession = section(supabase, 'export const ensureFreshSession', 'export const getSupabase');
const authHeaders = section(dataService, 'async function getAuthHeaders', 'async function getNoStoreAuthHeaders');
const activationSession = section(activation, 'const establishSessionFromUrl', 'const requestActivationBootstrap');
const googleLogin = section(activation, 'const handleGoogleLogin', 'const validateRecoveryPassword');

// Ordinary authenticated mutations must not wait indefinitely for a Supabase token refresh.
assert.match(supabase, /AUTH_SESSION_READ_TIMEOUT_MS\s*=\s*1600/);
assert.match(ensureSession, /withAuthTimeout\(client\.auth\.getSession\(\), sessionTimeoutMs, null as any\)/);
assert.match(authHeaders, /ensureFreshSession\(\{\s*sessionTimeoutMs:\s*1200,\s*urlExchangeTimeoutMs:\s*8000\s*\}\)/s);
assert.match(authHeaders, /sessão HTTP existente/);

// OAuth code exchange has exactly one owner and automatic URL detection is disabled.
assert.match(supabase, /exchangeOAuthCodeOnce/);
assert.match(supabase, /\.exchangeCodeForSession\(code\)/);
assert.match(supabase, /detectSessionInUrl:\s*false/);
assert.doesNotMatch(activationSession, /exchangeCodeForSession/);
assert.doesNotMatch(activationSession, /signOut\(\{\s*scope:\s*'local'/);
assert.match(activationSession, /ensureFreshSession\(\{\s*sessionTimeoutMs:\s*2500,\s*urlExchangeTimeoutMs:\s*8000\s*\}\)/s);

// Activation steps and Google redirect initiation must fail visibly instead of spinning forever.
assert.match(activation, /withActivationTimeout/);
assert.match(activationSession, /Tempo esgotado ao validar o link de ativação/);
assert.match(activationSession, /Tempo esgotado ao concluir a sessão de ativação/);
assert.match(googleLogin, /Tempo esgotado ao iniciar o acesso com Google/);

console.log('authPatientSessionHang.regression.test.mjs: ok');
