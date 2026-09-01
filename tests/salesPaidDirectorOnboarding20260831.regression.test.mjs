import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');

const resolver = server.match(/async function resolveOnboardingContextForUser[\s\S]*?async function persistSpecialtyFromOnboardingContext/)?.[0] || '';
const finalize = server.match(/async function finalizeSalesActivationForUser[\s\S]*?const mutationActionLabel/)?.[0] || '';
const completeRoute = server.match(/'\/api\/profile\/:userId\/complete-onboarding'[\s\S]*?app\.get\('\/api\/profile\/:userId'/)?.[0] || '';

assert.match(resolver, /requiresPayment: onboardingMode === 'clinic_owner' \? !canAccessDashboard : false/);
assert.match(finalize, /patchTableSafely\("clinics"[\s\S]*?subscription_status: clinicSubscriptionStatus/);
assert.match(finalize, /patchTableSafely\("users"[\s\S]*?subscription_status: clinicSubscriptionStatus/);
assert.match(finalize, /applyModularEntitlementsForOrganization/);
assert.match(finalize, /verifySalesDirectorContractAccess/);
const verifyIndex = finalize.indexOf('await verifySalesDirectorContractAccess');
const consumeIndex = finalize.indexOf('.update({ used: true })');
const completeIndex = finalize.indexOf('provisioning_status: "completed"');
assert.ok(verifyIndex >= 0 && consumeIndex > verifyIndex && completeIndex > verifyIndex, 'só conclui ativação após validar Diretor e módulos');

assert.match(completeRoute, /role === 'director' \|\| role === 'coordinator'/, 'Diretor deve poder persistir identidade da própria clínica no onboarding');
assert.match(completeRoute, /clinicSubscriptionStatus/);
assert.match(completeRoute, /DIRECTOR_READY/);

assert.match(onboarding, /context\?\.onboardingMode === 'clinic_owner'/);
assert.match(onboarding, /const ownerAlreadyPaid = Boolean/);
assert.match(onboarding, /context\?\.requiresPayment === false/);
assert.match(onboarding, /context\?\.canAccessDashboard === true/);
assert.match(onboarding, /Seu plano já está ativo/);
assert.match(onboarding, /Concluir configuração e acessar a Verto/);
assert.match(onboarding, /context\?\.requiresPayment === true \?/);
assert.doesNotMatch(onboarding, /const isOwnerOnboarding = context\?\.requiresPayment === true/);

console.log('salesPaidDirectorOnboarding20260831.regression.test.mjs: OK');
