import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

const helperStart = server.indexOf('async function fetchPendingClinicInvitationsForUser');
const helperEnd = server.indexOf('async function hydrateSessionUserPendingClinicInvitations', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'pending invitation helper must exist');
const helper = server.slice(helperStart, helperEnd);
assert.match(helper, /\.from\('invitations'\)[\s\S]*?\.eq\('email', email\)[\s\S]*?\.eq\('status', 'pending'\)/);
assert.match(helper, /\.limit\(50\)/);
assert.match(helper, /activeClinicIds\.has\(row\.clinic_id\)/);
assert.doesNotMatch(helper, /\.from\('clinic_memberships'\)/);
assert.doesNotMatch(helper, /\.from\('clinics'\)/);

assert.match(server, /async function hydrateSessionUserPendingClinicInvitations\(/);
assert.match(server, /const activeClinicIds = \(Array\.isArray\(sessionUser\?\.workspaces\)/);
assert.match(server, /const sessionUser = await hydrateSessionUserPendingClinicInvitations\([\s\S]*?hydrateSessionUserWithOnboardingContext\(userData\)/);

const authMeStart = server.indexOf("app.get('/api/auth/me'");
const authMeEnd = server.indexOf("app.get('/api/onboarding/context'", authMeStart);
assert.ok(authMeStart >= 0 && authMeEnd > authMeStart, 'auth/me route must exist');
const authMe = server.slice(authMeStart, authMeEnd);
assert.ok((authMe.match(/hydrateSessionUserPendingClinicInvitations/g) || []).length >= 2, 'cookie and bearer auth/me must refresh pending invitations');

const acceptStart = server.indexOf("app.post('/api/clinic/accept-invite'");
const acceptEnd = server.indexOf("app.post('/api/clinic/assign-role'", acceptStart);
assert.ok(acceptStart >= 0 && acceptEnd > acceptStart, 'accept invite route must exist');
const acceptRoute = server.slice(acceptStart, acceptEnd);
assert.match(acceptRoute, /acceptClinicInvitationAtomically/);
assert.match(acceptRoute, /hydrateSessionUserPendingClinicInvitations/);

assert.match(app, /pendingClinicInvitations\.length > 0/);
assert.match(app, /auth_action: 'accept_invitation'/);

console.log('pendingProfessionalInvitationsRuntime.test.mjs: ok');
