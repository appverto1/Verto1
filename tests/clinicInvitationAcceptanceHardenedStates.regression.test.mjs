import assert from 'node:assert/strict';
import fs from 'node:fs';

const invitationAcceptance = fs.readFileSync('src/components/ClinicInvitationAcceptance.tsx', 'utf8');

const errorMapperStart = invitationAcceptance.indexOf('const invitationErrorMessage');
const componentStart = invitationAcceptance.indexOf('/**', errorMapperStart);
assert.notEqual(errorMapperStart, -1, 'invitation error mapper must exist');
assert.notEqual(componentStart, -1, 'invitation component boundary must exist');
const errorMapper = invitationAcceptance.slice(errorMapperStart, componentStart);

const identityMismatch = errorMapper.indexOf("code === 'CLINIC_INVITATION_IDENTITY_EMAIL_MISMATCH'");
const expired = errorMapper.indexOf("code === 'CLINIC_INVITATION_EXPIRED'");
const notAvailable = errorMapper.indexOf("code === 'CLINIC_INVITATION_NOT_AVAILABLE'");
const genericMessage = errorMapper.indexOf('if (message) return message');

assert.ok(identityMismatch >= 0, 'identity mismatch must have an explicit fail-closed message');
assert.ok(expired >= 0, 'expired invitations must have an explicit message');
assert.ok(notAvailable >= 0, 'unavailable invitations must have an explicit message');
assert.ok(genericMessage >= 0, 'generic server message fallback must remain available');
assert.ok(identityMismatch < genericMessage, 'identity mismatch code must win over a generic server message');
assert.ok(expired < genericMessage, 'expired code must win over a generic server message');
assert.ok(notAvailable < genericMessage, 'unavailable code must win over a generic server message');

assert.match(errorMapper, /CLINIC_INVITATION_ALREADY_USED/);
assert.match(errorMapper, /CLINIC_INVITATION_NOT_FOUND/);
assert.match(errorMapper, /Entre com a conta convidada para continuar/);
assert.match(errorMapper, /Este convite expirou/);
assert.match(errorMapper, /Este convite não está mais disponível/);

assert.doesNotMatch(errorMapper, /clinic[_-]?id|patient[_-]?id|role\s*[:=]/i, 'error handling must not derive authority from client context');

console.log('clinicInvitationAcceptanceHardenedStates.regression.test.mjs: ok');
