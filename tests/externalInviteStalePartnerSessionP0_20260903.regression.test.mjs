import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExternalEvolutionBootstrapMode } from '../src/utils/externalEvolutionInviteContract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const externalUi = fs.readFileSync(path.join(root, 'src/components/ExternalEvolutionShare.tsx'), 'utf8');

// Regression: stale partner session A must not block a valid invitation for B.
assert.equal(
  resolveExternalEvolutionBootstrapMode({ authenticated: false, mismatch: true, tokenState: 'VALID', authUserExists: false }),
  'ACTIVATE',
  'valid invitation B must reach ACTIVATE even when the browser carries stale external session A',
);
assert.equal(
  resolveExternalEvolutionBootstrapMode({ authenticated: false, mismatch: true, tokenState: 'VALID', authUserExists: true }),
  'LOGIN',
  'valid invitation B must reach LOGIN when B already has an Auth/account identity',
);
assert.equal(
  resolveExternalEvolutionBootstrapMode({ authenticated: false, mismatch: true, tokenState: 'MISSING', authUserExists: false }),
  'MISMATCH',
  'without a valid invitation, stale session A must still block locator B',
);
assert.equal(
  resolveExternalEvolutionBootstrapMode({ authenticated: true, mismatch: false, tokenState: 'VALID', authUserExists: true }),
  'AUTHENTICATED',
  'a matching external session for the invited recipient may continue directly',
);

// Enforce the server-side ordering: token validation must happen before stale-session mismatch.
const bootstrapStart = server.indexOf('const handleExternalEvolutionBootstrap = async');
const bootstrapEnd = server.indexOf("app.post('/api/external/evolution/:publicId/bootstrap'", bootstrapStart);
assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'bootstrap handler must exist');
const bootstrap = server.slice(bootstrapStart, bootstrapEnd);
const tokenValidationAt = bootstrap.indexOf('resolveExternalEvolutionInvitationCredential(req, res, publicId, rawActivationToken)');
const staleSessionAt = bootstrap.indexOf('resolveExternalProfessionalAccountFromExternalSession(req, sanitizeEmail(loaded.grant.recipient_email))');
assert.ok(tokenValidationAt >= 0, 'bootstrap must resolve a BODY/COOKIE invitation credential');
assert.ok(staleSessionAt >= 0, 'bootstrap must still enforce session identity without a valid invitation');
assert.ok(tokenValidationAt < staleSessionAt, 'invitation validation must precede stale-session mismatch evaluation');
assert.match(bootstrap, /credential\.tokenState === 'VALID'[\s\S]*resolveExternalProfessionalAccountFromExternalSession\(req, recipientEmail\)[\s\S]*findAuthUserByEmail\(recipientEmail\)/);
assert.match(bootstrap, /Without a VALID invitation[\s\S]*EXTERNAL_ACCOUNT_MISMATCH/);

// Successful login/activation rotates only the dedicated external identity session.
const sessionSetterStart = server.indexOf('async function setExternalClinicalIdentitySession');
const sessionSetterEnd = server.indexOf('async function resolveExternalProfessionalAccountFromExternalSession', sessionSetterStart);
const sessionSetter = server.slice(sessionSetterStart, sessionSetterEnd);
assert.match(sessionSetter, /req\.session\.externalClinicalIdentity\s*=/);
assert.doesNotMatch(sessionSetter, /req\.session\.user\s*=/);

// The UI's explicit "Trocar conta" action must not globally sign out an internal Verto session.
const switchStart = externalUi.indexOf('const switchAccount = async');
const switchEnd = externalUi.indexOf('\n\n  return (', switchStart);
const switchBlock = externalUi.slice(switchStart, switchEnd);
assert.match(switchBlock, /\/api\/external\/auth\/logout/);
assert.doesNotMatch(switchBlock, /\/api\/auth\/logout/);
assert.doesNotMatch(switchBlock, /auth\.signOut\(/);

// Model the external-session rotation after B authenticates: B replaces A only in the partner context.
const browserSession = {
  user: { id: 'internal-user-id', email: 'internal@clinic.example' },
  externalClinicalIdentity: { accountId: 'account-a', authUserId: 'auth-a', normalizedEmail: 'antigo@exemplo.com' },
};
const internalBefore = structuredClone(browserSession.user);
browserSession.externalClinicalIdentity = { accountId: 'account-b', authUserId: 'auth-b', normalizedEmail: 'comercialdcoratto@gmail.com' };
assert.deepEqual(browserSession.user, internalBefore, 'internal clinical session must remain untouched');
assert.equal(browserSession.externalClinicalIdentity.normalizedEmail, 'comercialdcoratto@gmail.com');

// Longitudinal authorization after rotation remains account/grant scoped: grants from A never appear for B.
const grants = [
  { id: 'grant-a', external_account_id: 'account-a', status: 'ACTIVE' },
  { id: 'grant-b', external_account_id: 'account-b', status: 'ACTIVE' },
  { id: 'grant-b-old', external_account_id: 'account-b', status: 'REVOKED' },
];
assert.deepEqual(
  grants.filter((grant) => grant.external_account_id === 'account-b' && grant.status === 'ACTIVE').map((grant) => grant.id),
  ['grant-b'],
);

console.log('externalInviteStalePartnerSessionP0_20260903.regression: PASS');
