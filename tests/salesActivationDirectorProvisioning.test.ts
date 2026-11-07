import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const activationUi = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');

const passwordActivation = fs.readFileSync('services/publicSalesActivationPasswordRoute.ts', 'utf8');
const authLogin = server.match(
  /app\.post\('\/api\/auth\/login'[\s\S]*?app\.post\('\/api\/auth\/logout'/
)?.[0] || '';
const ownedClinicHelper = server.match(
  /async function ensureClinicAndMembershipForCoordinator\([\s\S]*?\/\/ Initialize Supabase Admin Client/
)?.[0] || '';
const onboardingResolver = server.match(
  /async function resolveOnboardingContextForUser[\s\S]*?async function persistSpecialtyFromOnboardingContext/
)?.[0] || '';

assert.match(activationUi, /verto_intended_role', 'director'/);
assert.match(activationUi, /onLogin\(\s*null,\s*'director'/);
assert.doesNotMatch(activationUi, /onLogin\(\s*null,\s*'coordinator'/);

assert.match(passwordActivation, /role: "director"/);
assert.match(passwordActivation, /ensureClinicAndMembershipForCoordinator\(authUser\.id, "director"\)/);
assert.match(passwordActivation, /finalizeSalesActivationForUser\(\{/);
assert.match(passwordActivation, /offerId: loaded\.offerId/);
assert.match(passwordActivation, /checkoutSessionId: loaded\.checkoutSessionId/);
assert.match(passwordActivation, /role: "director"[\s\S]*?modules: loaded\.contractedModules/);
assert.match(
  passwordActivation,
  /\["director", "coordinator"\]\.includes\(profileRole\)/,
  'retry de uma ativação parcial antiga como coordinator deve poder ser promovido a director'
);

assert.match(ownedClinicHelper, /ownerRole: 'director' \| 'coordinator' = 'coordinator'/);
assert.match(ownedClinicHelper, /role: ownerRole/);

assert.match(authLogin, /finalRole = "director"/);
assert.match(authLogin, /\['director', 'coordinator'\]\.includes\(normalizeRequestedRole\(intendedRole\)\)/);
assert.match(authLogin, /\['director', 'coordinator'\]\.includes\(profile\?\.role\)/);
assert.match(authLogin, /ownedCommercialClinicId/);

assert.match(authLogin, /normalizeRequestedRole\(intendedRole\) === 'director'/);
assert.match(authLogin, /resumableDirectorActivation/);
assert.match(authLogin, /\.update\(\{ role: 'director', clinic_id: user\.id \}\)/);

assert.match(onboardingResolver, /\['owner', 'director', 'coordinator'\]\.includes\(fallbackRole\)/);
assert.match(onboardingResolver, /\['owner', 'director', 'coordinator'\]\.includes\(role\)/);

console.log('salesActivationDirectorProvisioning.test.ts: OK');
