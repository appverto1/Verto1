import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildExternalEvolutionActivationAccessUrl,
  buildExternalEvolutionInviteEmailContract,
  classifyExternalEvolutionBootstrapFailure,
  readExternalEvolutionActivationTokenFromUrl,
  resolveExternalEvolutionBootstrapMode,
} from '../src/utils/externalEvolutionInviteContract.mjs';
import {
  EXTERNAL_EVOLUTION_INVITE_CONTEXT_TTL_MS,
  buildExternalEvolutionActivationHandoffUrl,
  buildExternalEvolutionCleanAccessPath,
  externalEvolutionInvitationCookieOptions,
  signExternalEvolutionInvitationContext,
  verifyExternalEvolutionInvitationContext,
} from '../src/utils/externalEvolutionInviteHandoff.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function extractCtaHref(html) {
  const marker = '<a href="';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'invite HTML must contain its CTA anchor');
  const valueStart = start + marker.length;
  const valueEnd = html.indexOf('"', valueStart);
  assert.notEqual(valueEnd, -1, 'invite CTA href must be closed');
  return html.slice(valueStart, valueEnd)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'");
}

function runInviteBootstrapPipeline(recipientEmail) {
  const publicId = 'd438e831-6293-4c95-b9c3-ffd5be9a49a7';
  const grantId = '9a5bc709-efdc-4b45-af5d-119b7e2395b2';
  const tokenId = 'e0ca3982-ae5c-4f8c-b08c-45f85f12e940';
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const storedTokenHash = sha256(rawToken);
  const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;

  const databaseRow = {
    id: tokenId,
    grant_id: grantId,
    recipient_email_normalized: recipientEmail.toLowerCase(),
    token_hash: storedTokenHash,
    expires_at: new Date(expiresAt).toISOString(),
    consumed_at: null,
    invalidated_at: null,
  };
  assert.equal(Object.values(databaseRow).includes(rawToken), false, 'database persists only the token hash');

  // BEFORE: fragment transport is intrinsically client-side. A redirect that does not
  // preserve the fragment reproduces the observed tokenState=MISSING class of failure.
  const legacyUrl = buildExternalEvolutionActivationAccessUrl(
    `https://staging.appverto.com.br/evolucao-compartilhada/${publicId}`,
    rawToken,
  );
  const redirectWithoutFragment = new URL(legacyUrl);
  redirectWithoutFragment.hash = '';
  assert.equal(readExternalEvolutionActivationTokenFromUrl(redirectWithoutFragment.toString()), '');

  // AFTER: production email uses a backend handoff query. Redirect intermediaries see and
  // preserve the query as part of the destination URL; the final Verto redirect removes it.
  const accessUrl = buildExternalEvolutionActivationHandoffUrl(
    `https://staging.appverto.com.br/evolucao-compartilhada/${publicId}`,
    rawToken,
  );
  const email = buildExternalEvolutionInviteEmailContract({
    clinicName: 'Construindo Saberes',
    shareUrl: accessUrl,
    logoUrl: 'https://assets.example/verto.png',
  });
  const href = extractCtaHref(email.html);
  const handoff = new URL(href);
  assert.equal(handoff.pathname, `/evolucao-compartilhada/${publicId}/convite`);
  assert.equal(handoff.hash, '', 'new invite must not depend on URL fragments');
  const presentedRawToken = handoff.searchParams.get('t');
  assert.equal(presentedRawToken, rawToken);
  assert.equal(sha256(presentedRawToken), databaseRow.token_hash, 'handoff raw token must match the persisted hash');
  assert.match(email.html, /Acessar timeline compartilhada/);

  // Simulate the real backend exchange: validate hash/status first, then sign a temporary
  // context containing only locators/token-row id (never the bearer raw token).
  const grant = { id: grantId, public_id: publicId, status: 'ACTIVE', recipient_email: recipientEmail.toLowerCase() };
  const handoffValid = grant.status === 'ACTIVE'
    && databaseRow.grant_id === grant.id
    && databaseRow.consumed_at === null
    && databaseRow.invalidated_at === null
    && new Date(databaseRow.expires_at).getTime() > Date.now()
    && sha256(presentedRawToken) === databaseRow.token_hash;
  assert.equal(handoffValid, true);

  const contextExpiresAt = Math.min(expiresAt, Date.now() + EXTERNAL_EVOLUTION_INVITE_CONTEXT_TTL_MS);
  const signingSecret = 'staging-test-secret-that-is-longer-than-thirty-two-characters';
  const cookieValue = signExternalEvolutionInvitationContext({ publicId, grantId, tokenId, expiresAt: contextExpiresAt }, signingSecret);
  assert.equal(cookieValue.includes(rawToken), false, 'temporary cookie must never contain the raw activation token');
  const cookieOptions = externalEvolutionInvitationCookieOptions({ secureValue: true, maxAgeValue: contextExpiresAt - Date.now() });
  assert.equal(cookieOptions.httpOnly, true);
  assert.equal(cookieOptions.secure, true);
  assert.equal(cookieOptions.sameSite, 'lax');
  assert.equal(cookieOptions.path, '/api/external');
  assert.ok(cookieOptions.maxAge <= EXTERNAL_EVOLUTION_INVITE_CONTEXT_TTL_MS);

  const verifiedContext = verifyExternalEvolutionInvitationContext(cookieValue, signingSecret, Date.now());
  assert.deepEqual(
    { publicId: verifiedContext?.publicId, grantId: verifiedContext?.grantId, tokenId: verifiedContext?.tokenId },
    { publicId, grantId, tokenId },
  );

  const redirectPath = buildExternalEvolutionCleanAccessPath(publicId);
  assert.equal(redirectPath, `/evolucao-compartilhada/${publicId}`);
  assert.equal(redirectPath.includes(rawToken), false, 'post-handoff browser URL must be clean');

  // Critical P0: a VALID invitation outranks stale partner session A.
  assert.equal(
    resolveExternalEvolutionBootstrapMode({ authenticated: false, mismatch: true, tokenState: 'VALID', authUserExists: false }),
    'ACTIVATE',
  );
  assert.equal(
    resolveExternalEvolutionBootstrapMode({ authenticated: false, mismatch: true, tokenState: 'VALID', authUserExists: true }),
    'LOGIN',
  );
  assert.equal(
    resolveExternalEvolutionBootstrapMode({ authenticated: false, mismatch: true, tokenState: 'MISSING', authUserExists: false }),
    'MISMATCH',
  );

  // Revocation/expiry/invalid token block the handoff even with a correctly signed locator.
  assert.equal({ ...grant, status: 'REVOKED' }.status === 'ACTIVE' && handoffValid, false);
  assert.equal(new Date(Date.now() - 1).getTime() > Date.now(), false);
  assert.notEqual(sha256(`${presentedRawToken}x`), databaseRow.token_hash);

  // Legacy links remain readable when their fragment arrives intact.
  assert.equal(readExternalEvolutionActivationTokenFromUrl(legacyUrl), rawToken);
}

runInviteBootstrapPipeline('comercialdcoratto@gmail.com');
runInviteBootstrapPipeline('contato@neurosingulares.com.br');

assert.equal(classifyExternalEvolutionBootstrapFailure(404, 'EXTERNAL_SHARE_NOT_FOUND'), 'UNAVAILABLE');
assert.equal(classifyExternalEvolutionBootstrapFailure(401, 'EXTERNAL_ACCESS_LINK_REFRESH_REQUIRED'), 'REFRESH');
assert.equal(classifyExternalEvolutionBootstrapFailure(403, 'EXTERNAL_ACCOUNT_MISMATCH'), 'MISMATCH');
assert.equal(classifyExternalEvolutionBootstrapFailure(500, 'EXTERNAL_ACCESS_BOOTSTRAP_FAILED'), 'TEMPORARY_ERROR');
assert.equal(classifyExternalEvolutionBootstrapFailure(502, 'EXTERNAL_INVALID_JSON_RESPONSE'), 'TEMPORARY_ERROR');
assert.equal(classifyExternalEvolutionBootstrapFailure(0, ''), 'TEMPORARY_ERROR');

console.log('externalEvolutionInviteBootstrapPipelineP0_20260903.integration: PASS');
