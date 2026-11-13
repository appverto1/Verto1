import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldDetectSalesActivationImplicitOAuthReturn } from '../src/utils/salesActivationImplicitOAuthReturn';
import {
  beginSalesActivationGoogleOAuth,
  readSalesActivationOAuthContext,
  SALES_ACTIVATION_OAUTH_PENDING_KEY,
} from '../src/services/salesActivationGoogleOAuth';

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  return { storage, data };
};

test('one Google OAuth request preserves provider, scope, prompt and exact return token', async () => {
  const { storage, data } = createStorage();
  let count = 0;
  await beginSalesActivationGoogleOAuth(
    'offer/with space', 'Director@Example.Test', 'https://staging.example',
    storage as any,
    (async () => ({ auth: { signInWithOAuth: async (options: any) => {
      count += 1;
      assert.deepEqual(options, {
        provider: 'google',
        options: {
          redirectTo: 'https://staging.example/ativacao-comercial/offer%2Fwith%20space',
          scopes: 'https://www.googleapis.com/auth/userinfo.email',
          queryParams: { prompt: 'select_account' },
        },
      });
      return { error: null };
    } } })) as any,
  );
  assert.equal(count, 1);
  assert.equal(data.get(SALES_ACTIVATION_OAUTH_PENDING_KEY), 'offer/with space');
  assert.equal(data.get('verto_intended_role'), 'director');
  assert.equal(data.get('verto_activation_email'), 'director@example.test');
});

test('failed OAuth initiation clears only matching markers, without automatic retries', async () => {
  const { storage, data } = createStorage();
  let calls = 0;
  await assert.rejects(
    beginSalesActivationGoogleOAuth('failed', 'Director@Example.Test', 'https://staging.example',
      storage as any, (async () => ({auth: {signInWithOAuth: async () => {
        calls += 1;
        return { error: new Error('GOOGLE_UNAVAILABLE') };
      }}})) as any),
    /GOOGLE_UNAVAILABLE/,
  );
  assert.equal(calls, 1);
  assert.equal(data.has(SALES_ACTIVATION_OAUTH_PENDING_KEY), false);
  assert.equal(data.has('verto_intended_role'), false);
  assert.equal(data.has('verto_activation_email'), false);
});

test('older OAuth failure does not erase a newer Director attempt', async () => {
  const { storage, data } = createStorage();
  await assert.rejects(
    beginSalesActivationGoogleOAuth('old', 'old@example.test', 'https://staging.example',
      storage as any, (async () => ({auth: {signInWithOAuth: async () => {
        storage.setItem(SALES_ACTIVATION_OAUTH_PENDING_KEY, 'new');
        storage.setItem('verto_activation_email', 'new@example.test');
        return { error: new Error('OLD_FAILED') };
      }}})) as any),
    /OLD_FAILED/,
  );
  assert.equal(data.get(SALES_ACTIVATION_OAUTH_PENDING_KEY), 'new');
  assert.equal(data.get('verto_activation_email'), 'new@example.test');
});

test('callback rejects absent, forged, cross-offer and malformed return links', () => {
  const { storage } = createStorage({
    [SALES_ACTIVATION_OAUTH_PENDING_KEY]: 'offer_123',
    verto_activation_email: ' Director@Example.Test ',
  });
  assert.deepEqual(
    readSalesActivationOAuthContext('/ativacao-comercial/offer_123', storage),
    { activationEmail: 'director@example.test' },
  );
  assert.deepEqual(
    readSalesActivationOAuthContext('/ativacao-comercial/offer_123/', storage),
    { activationEmail: 'director@example.test' },
  );
  for (const path of ['/login','/ativacao-comercial/forged','/ativacao-comercial/','/ativacao-comercial/%E0%A4%A','/ativacao-comercial/offer_123/more']) {
    assert.equal(readSalesActivationOAuthContext(path, storage), null, path);
  }
  storage.removeItem('verto_activation_email');
  assert.equal(readSalesActivationOAuthContext('/ativacao-comercial/offer_123', storage), null);
});

test('paid Director implicit Google callback restores a session only for the matching pending token', () => {
  const { storage } = createStorage({
    [SALES_ACTIVATION_OAUTH_PENDING_KEY]: 'offer/with space',
    verto_activation_email: 'director@example.test',
  });
  const location = {
    pathname: '/ativacao-comercial/offer%2Fwith%20space',
    search: '',
    hash: '#access_token=jwt-test&refresh_token=refresh-test&token_type=bearer',
  };
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn(location, storage), true);

  for (const pathname of [
    '/', '/entrar', '/ativar', '/parcerias', '/ativacao-comercial/other',
    '/ativacao-comercial/%E0%A4%A', '/ativacao-comercial/offer%2Fwith%20space/extra',
  ]) {
    assert.equal(shouldDetectSalesActivationImplicitOAuthReturn({ ...location, pathname }, storage), false, pathname);
  }
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn({
    ...location, search: '?code=pkce-code',
  }, storage), false, 'PKCE callback keeps its single manual owner');
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn({
    ...location, hash: '#access_token=jwt-test',
  }, storage), false, 'never accept a partial OAuth fragment');
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn({
    ...location, hash: '#error=access_denied',
  }, storage), false, 'OAuth provider errors cannot establish sessions');
});

test('implicit callback rejects absent, stale and blocked browser activation context', () => {
  const location = {
    pathname: '/ativacao-comercial/test-offer',
    search: '',
    hash: '#access_token=jwt-test&refresh_token=refresh-test',
  };
  const { storage } = createStorage({ verto_activation_email: 'director@example.test' });
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn(location, storage), false);
  storage.setItem(SALES_ACTIVATION_OAUTH_PENDING_KEY, 'different-offer');
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn(location, storage), false);
  storage.setItem(SALES_ACTIVATION_OAUTH_PENDING_KEY, 'test-offer');
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn(location, storage), true);
  storage.removeItem('verto_activation_email');
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn(location, storage), false);
  assert.equal(shouldDetectSalesActivationImplicitOAuthReturn(location, {
    getItem: () => { throw new Error('Storage blocked'); },
  }), false);
});
