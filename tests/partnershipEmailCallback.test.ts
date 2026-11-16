import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPartnerAuthReturnUrl, readPartnerEmailCallbackHash } from '../src/lib/partnerEmailCallback';

test('partner email confirmation extracts implicit tokens and removes both credentials from URL', () => {
  const hash = '#access_token=jwt-example&refresh_token=refresh-example&type=signup&expires_in=3600';
  assert.deepEqual(readPartnerEmailCallbackHash(hash), {
    hasAuthResponse: true, failed: false,
    accessToken: 'jwt-example', refreshToken: 'refresh-example',
  });
  const cleaned = cleanPartnerAuthReturnUrl(
    'https://api.appverto.com.br/parcerias?partner_oauth=1' + hash,
  );
  assert.equal(cleaned, '/parcerias');
  assert.doesNotMatch(cleaned, /jwt-example|refresh-example|access_token|refresh_token/);
});

test('PKCE partner callback keeps the exchange code while removing the marker', () => {
  assert.deepEqual(readPartnerEmailCallbackHash(''), {
    hasAuthResponse: false, failed: false,
    accessToken: '', refreshToken: '',
  });
  assert.equal(
    cleanPartnerAuthReturnUrl('https://api.appverto.com.br/parcerias?partner_oauth=1&code=pkce-example'),
    '/parcerias?code=pkce-example',
  );
});

test('failure callback removes error fragments and never trusts incomplete tokens', () => {
  assert.equal(readPartnerEmailCallbackHash('#error=access_denied&error_description=expired').failed, true);
  assert.equal(
    cleanPartnerAuthReturnUrl('https://api.appverto.com.br/parcerias?partner_oauth=1#error=access_denied&error_description=expired'),
    '/parcerias',
  );
  assert.deepEqual(readPartnerEmailCallbackHash('#access_token=only-token'), {
    hasAuthResponse: true, failed: false,
    accessToken: 'only-token', refreshToken: '',
  });
});

test('non-auth anchors survive and regular URLs remain unchanged', () => {
  assert.equal(
    cleanPartnerAuthReturnUrl('https://api.appverto.com.br/parcerias?partner_oauth=1#informacoes'),
    '/parcerias#informacoes',
  );
  assert.equal(
    cleanPartnerAuthReturnUrl('https://api.appverto.com.br/parcerias#informacoes'),
    '/parcerias#informacoes',
  );
});

test('one-time activation markers and tokens are removed from the browser URL', () => {
  assert.equal(cleanPartnerAuthReturnUrl(
    'https://appverto.com.br/parcerias?partner_oauth=1&partner_setup=1#access_token=aa&refresh_token=bb',
  ), '/parcerias');
});

test('public registration return markers are removed without deleting PKCE exchange code', () => {
  const cleaned = cleanPartnerAuthReturnUrl(
    'https://api.appverto.com.br/parcerias?partner_oauth=1&partner_apply=1&code=pkce-signup',
  );
  assert.equal(cleaned, '/parcerias?code=pkce-signup');
  assert.equal(cleanPartnerAuthReturnUrl(
    'https://api.appverto.com.br/parcerias?partner_oauth=1&partner_apply=1#access_token=aa&refresh_token=bb',
  ), '/parcerias');
});
