import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  readImplicitLoginTokens,
  establishImplicitLoginSession,
} from '../src/lib/implicitOAuthLogin';

test('ordinary Google implicit callback is consumed on the root route only', () => {
  assert.deepEqual(
    readImplicitLoginTokens('https://example.test/#access_token=access&refresh_token=refresh&token_type=bearer&provider_token=provider'),
    { accessToken: 'access', refreshToken: 'refresh' },
  );
  assert.deepEqual(
    readImplicitLoginTokens('https://example.test/?utm_source=google#access_token=a&refresh_token=r'),
    { accessToken: 'a', refreshToken: 'r' },
  );
  assert.equal(readImplicitLoginTokens('https://example.test/?code=pkce#access_token=a&refresh_token=r'), null);
  assert.equal(readImplicitLoginTokens('https://example.test/?auth_action=activate#access_token=a&refresh_token=r'), null);
  assert.equal(readImplicitLoginTokens('https://example.test/?invitation_id=invite#access_token=a&refresh_token=r'), null);
  assert.equal(readImplicitLoginTokens('https://example.test/#access_token=a'), null);
  assert.equal(readImplicitLoginTokens('https://example.test/?access_token=a&refresh_token=r'), null);
});

test('activation, invitation, recovery and partner callbacks retain their own handlers', () => {
  for (const url of [
    '/ativar#access_token=a&refresh_token=r',
    '/ativacao-comercial/offer#access_token=a&refresh_token=r',
    '/parcerias#access_token=a&refresh_token=r',
    '/reset-password#access_token=a&refresh_token=r',
    '/?type=invite#access_token=a&refresh_token=r',
    '/?type=signup#access_token=a&refresh_token=r',
    '/?type=recovery#access_token=a&refresh_token=r',
    '/#access_token=a&refresh_token=r&type=recovery',
    '/#access_token=a&refresh_token=r&error=access_denied',
    '/#access_token=a&refresh_token=r&token_type=invalid',
  ]) {
    assert.equal(readImplicitLoginTokens('https://example.test' + url), null, url);
  }
});

test('verified Supabase session is required; input tokens cannot assign roles or clinics', async () => {
  const href = 'https://example.test/#access_token=access&refresh_token=refresh';
  const calls: any[] = [];
  const session = { access_token: 'verified', user: { id: 'server-authenticated' } };
  const verified = await establishImplicitLoginSession(href, {
    setSession: async (tokens) => {
      calls.push(tokens);
      return { data: { session }, error: null };
    },
  });
  assert.deepEqual(calls, [{ access_token: 'access', refresh_token: 'refresh' }]);
  assert.equal(verified, session);
  assert.equal(await establishImplicitLoginSession(href, {
    setSession: async () => ({ data: { session }, error: { message: 'invalid token' } }),
  }), null);
  assert.equal(await establishImplicitLoginSession(href, {
    setSession: async () => ({ data: { session: null }, error: null }),
  }), null);
  assert.equal(await establishImplicitLoginSession('https://example.test/?auth_action=activate#access_token=a&refresh_token=r', {
    setSession: async () => { throw Error('must never consume activation credentials'); },
  }), null);
});

test('the app exchanges ordinary implicit callbacks before reading the SDK session', () => {
  const supabase = readFileSync('src/lib/supabase.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(supabase, /const exchangeImplicitLoginOnce = async \(client: any, timeoutMs: number\) =>/);
  assert.match(supabase, /implicitLoginSessionPromise = pending/);
  assert.match(supabase, /establishImplicitLoginSession\(callbackUrl, client\.auth\)/);
  assert.match(supabase, /const implicitSession = await exchangeImplicitLoginOnce\(client, urlExchangeTimeoutMs\);\s*if \(implicitSession\) return implicitSession/);
  assert.match(supabase, /stillPending\?\.accessToken === tokens\.accessToken/);
  assert.match(supabase, /window\.history\.replaceState\(/);
  assert.match(supabase, /detectSessionInUrl: false/);
  assert.match(app, /if \(loading \|\| oauthCallbackPending\) \{/);
});
