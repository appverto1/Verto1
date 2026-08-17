import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createClinicInvitationActivationToken,
  verifyClinicInvitationActivationToken,
} from '../src/utils/clinicInvitationActivationToken.ts';

const signingSecret = 'clinic-invitation-test-secret-1234567890';
const otherSecret = 'another-clinic-invitation-secret-123456';
const now = Date.now();
const payload = {
  invitationId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  nonce: 'n'.repeat(43),
  expiresAt: now + 60_000,
};

const token = createClinicInvitationActivationToken({
  ...payload,
  signingSecret,
});

assert.deepEqual(
  verifyClinicInvitationActivationToken({ token, signingSecret, now }),
  {
    invitationId: payload.invitationId,
    userId: payload.userId,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
  },
);

const [encodedPayload, signature] = token.split('.');
assert.equal(
  verifyClinicInvitationActivationToken({
    token: `${encodedPayload}.${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`,
    signingSecret,
    now,
  }),
  null,
  'assinatura adulterada não pode ser aceita',
);
assert.equal(
  verifyClinicInvitationActivationToken({ token, signingSecret: otherSecret, now }),
  null,
  'token assinado com outro segredo não pode ser aceito',
);
assert.equal(
  verifyClinicInvitationActivationToken({ token, signingSecret, now: payload.expiresAt + 1 }),
  null,
  'token expirado não pode ser aceito',
);
assert.throws(
  () => createClinicInvitationActivationToken({ ...payload, signingSecret: 'curto' }),
  /CLINIC_INVITATION_LINK_SECRET_INVALID/,
);

const server = fs.readFileSync('server.ts', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const membershipAuthority = fs.readFileSync('src/utils/clinicMembershipAuthority.ts', 'utf8');
const authorizationRuntime = fs.readFileSync('src/utils/authorizationRuntime.ts', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const inviteRoute = section(server, "app.post('/api/clinic/invite'", "app.get('/api/clinic/invitations'");
const activationPasswordRoute = section(
  server,
  "app.post('/api/auth/invitation/password'",
  "app.post('/api/auth/activation/bootstrap'",
);
const activationBootstrapRoute = section(
  server,
  "app.post('/api/auth/activation/bootstrap'",
  "app.post('/api/auth/login'",
);

assert.match(inviteRoute, /requireClinicCapability\('team\.invite'\)/);
assert.match(membershipAuthority, /if \(actorRole === 'director'\) return true/);
assert.match(membershipAuthority, /if \(actorRole === 'coordinator'\) return targetRole !== 'director'/);
assert.match(authorizationRuntime, /role !== 'director' && role !== 'coordinator'[\s\S]*?capabilities\.delete\('team\.invite'\)/);
assert.match(inviteRoute, /invitation_activation_nonce: invitationActivationNonce/);
assert.match(inviteRoute, /getClinicInvitationActivationUrl\(\{/);
assert.match(inviteRoute, /getClinicInvitationAcceptanceUrl\(data\?\.id\)/);
assert.match(activationPasswordRoute, /validateStrongPassword\(req\.body\?\.newPassword\)/);
assert.match(activationPasswordRoute, /\.eq\('id', claims\.invitationId\)/);
assert.match(activationPasswordRoute, /invitationStatus !== 'pending'/);
assert.match(activationPasswordRoute, /getUserById\(claims\.userId\)/);
assert.match(activationPasswordRoute, /crypto\.timingSafeEqual\(/);
assert.match(activationPasswordRoute, /email_confirm: true/);
assert.match(activationPasswordRoute, /delete metadata\.invitation_activation_nonce/);
assert.match(activationPasswordRoute, /tryAcquireDistributedJobLease\(/);
assert.match(activationPasswordRoute, /releaseDistributedJobLease\(/);
assert.match(activationBootstrapRoute, /invitation_activation_nonce: invitationActivationNonce/);
assert.match(activationBootstrapRoute, /getClinicInvitationActivationUrl\(\{/);
assert.match(activation, /hashParams\.get\('invite_token'\)/);
assert.match(activation, /fetch\('\/api\/auth\/invitation\/password'/);
assert.match(activation, /token: invitationActivationToken/);
assert.match(activation, /\{ email: loginEmail, password: newPassword \}/);

console.log('clinicInvitationActivationToken.test.ts: ok');
