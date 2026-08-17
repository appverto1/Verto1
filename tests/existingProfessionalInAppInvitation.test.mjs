import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const activation = fs.readFileSync('src/components/ActivationAccess.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

// A confirmed Auth identity is reused. The clinic invitation creates a new relationship,
// not a second account and not a password reset for an existing professional.
assert.match(server, /findAuthUserByEmail\(email\)/);
assert.match(server, /const authUserHadVerifiedEmail = Boolean\(/);
assert.match(server, /const reusedExistingAuthAccess = Boolean\(authUserHadVerifiedEmail\)/);
assert.match(server, /if \(!authUser\?\.id\) \{[\s\S]*?supabase\.auth\.admin\.createUser/);
assert.match(server, /const activationLink = reusedExistingAuthAccess[\s\S]*?getClinicInvitationAcceptanceUrl\(data\?\.id\)[\s\S]*?: getClinicInvitationActivationUrl/);
assert.match(server, /reusedExistingAuthAccess/);

// Acceptance is an explicit authenticated flow and is completed atomically server-side.
assert.match(server, /app\.post\('\/api\/clinic\/accept-invite', checkAuth/);
assert.match(server, /acceptClinicInvitationAtomically/);
assert.match(dataService, /\/api\/clinic\/accept-invite/);
assert.match(activation, /accept_invitation/);
assert.match(app, /auth_action:\s*'accept_invitation'/);
assert.match(app, /pendingClinicInvitations\.length > 0/);

// The normal clinic invitation remains an e-mail delivery; existing accounts receive the
// acceptance URL while new identities receive the activation URL.
assert.match(server, /buildClinicInvitationEmailTemplate/);
assert.match(server, /invitationEmailSent:\s*true/);
assert.match(server, /message:\s*'Convite enviado com sucesso\.'/);

console.log('existingProfessionalInAppInvitation.test.mjs: ok');
