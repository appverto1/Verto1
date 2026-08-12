import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const team = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');
const invitationModal = fs.readFileSync('src/components/InvitationModal.tsx', 'utf8');
const landing = fs.readFileSync('src/components/LandingPage.tsx', 'utf8');

assert.match(server, /function isValidBrazilCpf\(/);
assert.match(server, /function isValidBrazilCnpj\(/);
assert.match(server, /readValidProfessionalIdentityDocument/);
assert.match(server, /hasPortableProfessionalIdentity/);
assert.match(server, /existingProfessionalInAppEligible/);
assert.match(server, /invitationDeliveryMode:\s*'in_app'/);
assert.match(server, /inAppInvitation:\s*true/);
assert.match(server, /invitationEmailSent:\s*false/);
assert.match(server, /fetchPendingClinicInvitationsForUser/);
assert.match(server, /\.eq\('email', email\)[\s\S]*?\.eq\('status', 'pending'\)/);
assert.match(server, /pendingClinicInvitations/);
assert.match(server, /CLINIC_MEMBER_ALREADY_ACTIVE/);

const inAppBranch = server.indexOf('if (existingProfessionalInAppEligible)');
const emailActivation = server.indexOf('const activationEntryUrl = reusedExistingAuthAccess', inAppBranch);
assert.ok(inAppBranch >= 0 && emailActivation > inAppBranch, 'in-app branch must run before e-mail activation');

assert.match(app, /Novos convites/);
assert.match(app, /Seu cadastro profissional será reutilizado/);
assert.match(app, /auth_action:\s*'accept_invitation'/);
assert.match(app, /pendingClinicInvitations\.length > 0/);
assert.match(app, /showWorkspacePicker && \(accessContextOptions\.length > 0 \|\| pendingClinicInvitations\.length > 0\)/);

assert.match(team, /result\.inAppInvitation === true \|\| result\.invitationEmailSent !== false/);
assert.match(invitationModal, /result\.inAppInvitation === true \|\| result\.invitationEmailSent !== false/);
assert.match(landing, /!response\.ok && data\?\.success !== true/);

console.log('existingProfessionalInAppInvitation.test.mjs: ok');
