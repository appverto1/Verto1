import {readFileSync as readItem10Source} from 'node:fs';
import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const item10ProvisioningSource = readItem10Source('services/salesPaidDirectorAccountProvisioning.ts','utf8');
const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');

const resolver = server.match(/async function resolveOnboardingContextForUser[\s\S]*?async function persistSpecialtyFromOnboardingContext/)?.[0] || '';
const finalize = item10ProvisioningSource.match(/async function finalizeSalesActivationForUser[\s\S]*?ITEM10_SOURCE_END/)?.[0] || '';
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
