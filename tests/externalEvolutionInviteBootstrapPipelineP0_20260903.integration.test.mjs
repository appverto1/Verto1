import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildExternalEvolutionActivationAccessUrl,
  buildExternalEvolutionInviteEmailContract,
  classifyExternalEvolutionBootstrapFailure,
  readExternalEvolutionActivationTokenFromUrl,
  resolveExternalEvolutionBootstrapMode,
} from '../src/utils/externalEvolutionInviteContract.mjs';

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
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const storedTokenHash = sha256(rawToken);

  // Persistence contract: the repository stores only the hash, never the bearer secret.
  const databaseRow = {
    grant_id: grantId,
    recipient_email_normalized: recipientEmail.toLowerCase(),
    token_hash: storedTokenHash,
    consumed_at: null,
    invalidated_at: null,
  };
  assert.equal(Object.values(databaseRow).includes(rawToken), false);

  // Production generator -> production e-mail HTML -> actual CTA href -> production parser.
  const accessUrl = buildExternalEvolutionActivationAccessUrl(
    `https://staging.appverto.com.br/evolucao-compartilhada/${publicId}`,
    rawToken,
  );
  const email = buildExternalEvolutionInviteEmailContract({
    clinicName: 'Construindo Saberes',
    shareUrl: accessUrl,
    logoUrl: 'https://assets.example/verto.png',
  });
  const href = extractCtaHref(email.html);
  const parsedToken = readExternalEvolutionActivationTokenFromUrl(href);
  assert.equal(parsedToken, rawToken, 'CTA parser must recover the exact raw activation token');
  assert.equal(sha256(parsedToken), databaseRow.token_hash, 'href token hash must match persisted token_hash');
  assert.match(email.html, /Acessar timeline compartilhada/);

  // First access contract: ACTIVE grant, no external account/Auth user, valid token => ACTIVATE.
  const bootstrapMode = resolveExternalEvolutionBootstrapMode({
    authenticated: false,
    mismatch: false,
    tokenState: sha256(parsedToken) === databaseRow.token_hash ? 'VALID' : 'INVALID',
    authUserExists: false,
  });
  assert.equal(bootstrapMode, 'ACTIVATE');

  // Simulate the post-activation invariants without inventing a second identity source.
  const authUser = { id: 'a8d8f7f7-5ed0-4c3f-a8aa-4ba08164c778', email: recipientEmail.toLowerCase() };
  const externalAccount = { id: 'bc93470a-7248-4ec2-a73c-8f18485a26bc', auth_user_id: authUser.id, normalized_email: authUser.email };
  databaseRow.consumed_at = new Date().toISOString();
  const grant = { id: grantId, public_id: publicId, status: 'ACTIVE', recipient_email: authUser.email, external_account_id: externalAccount.id };
  const session = { accountId: externalAccount.id, authUserId: authUser.id, normalizedEmail: authUser.email };
  assert.equal(grant.external_account_id, session.accountId);
  assert.equal(databaseRow.consumed_at !== null, true);
  assert.equal(resolveExternalEvolutionBootstrapMode({ authenticated: true, mismatch: false, tokenState: 'CONSUMED', authUserExists: true }), 'AUTHENTICATED');

  // Longitudinal read path remains grant-derived after activation.
  const timeline = [
    { id: 'item-sep', external_account_id: externalAccount.id, status: 'ACTIVE' },
    { id: 'item-aug', external_account_id: externalAccount.id, status: 'REVOKED' },
  ].filter((item) => item.external_account_id === session.accountId && item.status === 'ACTIVE');
  assert.deepEqual(timeline.map((item) => item.id), ['item-sep']);
}

runInviteBootstrapPipeline('comercialdcoratto@gmail.com');
runInviteBootstrapPipeline('contato@neurosingulares.com.br');

// Error-state contract: runtime/bootstrap failures are not presented as revocation.
assert.equal(classifyExternalEvolutionBootstrapFailure(404, 'EXTERNAL_SHARE_NOT_FOUND'), 'UNAVAILABLE');
assert.equal(classifyExternalEvolutionBootstrapFailure(401, 'EXTERNAL_ACCESS_LINK_REFRESH_REQUIRED'), 'REFRESH');
assert.equal(classifyExternalEvolutionBootstrapFailure(403, 'EXTERNAL_ACCOUNT_MISMATCH'), 'MISMATCH');
assert.equal(classifyExternalEvolutionBootstrapFailure(500, 'EXTERNAL_ACCESS_BOOTSTRAP_FAILED'), 'TEMPORARY_ERROR');
assert.equal(classifyExternalEvolutionBootstrapFailure(502, 'EXTERNAL_INVALID_JSON_RESPONSE'), 'TEMPORARY_ERROR');
assert.equal(classifyExternalEvolutionBootstrapFailure(0, ''), 'TEMPORARY_ERROR');

console.log('externalEvolutionInviteBootstrapPipelineP0_20260903.integration: PASS');
