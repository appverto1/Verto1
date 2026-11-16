import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesRequiredMethod,
  verifyPortalAuthEvidence,
} from '../services/auth/verifiedPortalAuthMethod';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const NOW = 1794854000;
const validClaims = (changes: Record<string, unknown> = {}) => ({
  sub: ID,
  session_id: SESSION,
  role: 'authenticated',
  is_anonymous: false,
  iat: NOW - 30,
  exp: NOW + 1800,
  amr: [{ method: 'password', timestamp: NOW - 35 }],
  ...changes,
});
const tokenFor = (claims: unknown) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'),
  'does-not-matter-the-verifier-must-check-it',
].join('.');
const verified = async () => ({ data: { user: { id: ID } }, error: null });
const denied = async () => ({ data: { user: null }, error: new Error('invalid signature') });

test('server verification precedes method interpretation: unverified token is never trusted', async () => {
  const token = tokenFor(validClaims());
  assert.equal(await verifyPortalAuthEvidence(token, denied, NOW), null);
  assert.equal(await verifyPortalAuthEvidence(token, async () => ({
    data: { user: { id: OTHER } }, error: null,
  }), NOW), null);
  let called = 0;
  assert.equal(await verifyPortalAuthEvidence('not-a-jwt', async () => {
    called += 1;
    return verified();
  }, NOW), null);
  assert.equal(called, 0);
});

test('password login is a proved method but not a role or patient membership', async () => {
  const proof = await verifyPortalAuthEvidence(tokenFor(validClaims()), verified, NOW);
  assert.deepEqual(proof, {
    authUserId: ID,
    sessionId: SESSION,
    category: 'password',
    authenticatedAt: NOW - 35,
  });
  assert.equal(matchesRequiredMethod(proof, 'password'), true);
  assert.equal(matchesRequiredMethod(proof, 'google'), false);
});

test('OAuth is NOT Google proof: linked or claimed Google metadata is insufficient', async () => {
  const proof = await verifyPortalAuthEvidence(tokenFor(validClaims({
    amr: [{ method: 'oauth', timestamp: NOW - 35 }],
    app_metadata: { provider: 'google', providers: ['email', 'google'] },
    user_metadata: { provider: 'google', role: 'director' },
  })), verified, NOW);
  assert.equal(proof?.category, 'oauth');
  assert.equal(matchesRequiredMethod(proof, 'password'), false);
  assert.equal(matchesRequiredMethod(proof, 'google'), false);
});

test('refresh retains original method only when signed claims retain it', async () => {
  const preserved = await verifyPortalAuthEvidence(tokenFor(validClaims({
    amr: [
      { method: 'oauth', timestamp: NOW - 120 },
      { method: 'token_refresh', timestamp: NOW - 32 },
    ],
  })), verified, NOW);
  assert.equal(preserved?.category, 'oauth');
  const refreshOnly = await verifyPortalAuthEvidence(tokenFor(validClaims({
    amr: [{ method: 'token_refresh', timestamp: NOW - 10 }],
  })), verified, NOW);
  assert.equal(refreshOnly, null);
  const missing = await verifyPortalAuthEvidence(tokenFor(validClaims({ amr: undefined })), verified, NOW);
  assert.equal(missing, null);
});

test('two different methods require unambiguous time ordering; ties fail closed', async () => {
  const mixed = await verifyPortalAuthEvidence(tokenFor(validClaims({
    amr: [
      { method: 'oauth', timestamp: NOW - 40 },
      { method: 'password', timestamp: NOW - 35 },
      { method: 'token_refresh', timestamp: NOW - 32 },
    ],
  })), verified, NOW);
  assert.equal(mixed?.category, 'password');
  const tied = await verifyPortalAuthEvidence(tokenFor(validClaims({
    amr: [
      { method: 'oauth', timestamp: NOW - 35 },
      { method: 'password', timestamp: NOW - 35 },
    ],
  })), verified, NOW);
  assert.equal(tied, null);
});

test('invalid session ID, user ID, expiration or anonymous token fail closed', async () => {
  for (const change of [
    { sub: OTHER }, { session_id: 'not-a-uuid' },
    { is_anonymous: true }, { iat: NOW + 90 }, { exp: NOW - 1 },
    { exp: NOW - 40 }, { amr: [] },
    { amr: [{ method: 'password', timestamp: NOW + 90 }] },
    { amr: [{ method: 'password', timestamp: -1 }] },
    { amr: [{ method: 'unknown', timestamp: NOW - 35 }] },
    { amr: [{ method: 'oauth', timestamp: 'yesterday' }] },
  ]) {
    const proof = await verifyPortalAuthEvidence(tokenFor(validClaims(change)), verified, NOW);
    assert.equal(proof, null, JSON.stringify(change));
  }
});

test('a malformed verification result or invalid JWT never grants a method', async () => {
  assert.equal(await verifyPortalAuthEvidence(tokenFor(validClaims()),
    async () => { throw new Error('network error'); }, NOW), null);
  assert.equal(await verifyPortalAuthEvidence(null, verified, NOW), null);
  assert.equal(await verifyPortalAuthEvidence('x'.repeat(8200), verified, NOW), null);
  assert.equal(await verifyPortalAuthEvidence('eyJhbGciOiJub25lIn0.e30.signature', verified, NOW), null);
  assert.equal(matchesRequiredMethod(null, 'password'), false);
});
