import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');

const section = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const maskEmailHelper = section(server, 'function maskEmail', 'function maskPhone');
const duplicateHelperIndex = server.indexOf('function isDuplicateConstraintError');
const coordinatorProvisioningIndex = server.indexOf('async function ensureClinicAndMembershipForCoordinator');
const loginRoute = section(server, "app.post('/api/auth/login'", "app.post('/api/auth/logout'");

assert.match(maskEmailHelper, /email: unknown/);
assert.match(maskEmailHelper, /const safeEmail = sanitizeEmail\(email\)/);
assert.match(maskEmailHelper, /if \(!safeEmail\) return '\*\*\*'/);
assert.ok(duplicateHelperIndex >= 0, 'helper global de duplicidade ausente');
assert.ok(
  duplicateHelperIndex < coordinatorProvisioningIndex,
  'helper de duplicidade deve existir antes do provisionamento de clínica',
);
assert.match(
  server.slice(duplicateHelperIndex, duplicateHelperIndex + 700),
  /23505[\s\S]*?duplicate key[\s\S]*?unique constraint/,
);

assert.match(
  loginRoute,
  /finalRole === "coordinator"[\s\S]*?!invitationPendingAcceptance[\s\S]*?sanitizeString\(clinicId, 120\) === sanitizeString\(user\.id, 120\)/,
  'convite de coordenador não pode provisionar uma clínica própria',
);
assert.match(
  loginRoute,
  /const shouldEnsureOwnedCoordinatorWorkspace =[\s\S]*?profile\.role === 'coordinator'[\s\S]*?!requestedClinicInvitation[\s\S]*?profile\.clinic_id[\s\S]*?user\.id/,
  'compatibilidade legada deve ficar restrita ao workspace próprio e fora do fluxo de convite',
);
assert.doesNotMatch(
  loginRoute,
  /if \(profile\.role === 'coordinator'\) \{\s*await ensureClinicAndMembershipForCoordinator\(user\.id\);/,
  'login de coordenador convidado não pode criar workspace próprio só pelo papel global',
);

console.log('invitedCoordinatorLoginHardening.regression.test.mjs: ok');
