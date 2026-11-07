import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');
const directorSession = fs.readFileSync('src/services/publicSalesDirectorSession.ts', 'utf8');
const onboarding = fs.readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');

const processPaid = stripePaidProcessorSource.match(/const processSalesAssistedCheckoutCompleted =[^]*?ITEM09_SOURCE_END/)?.[0] || '';
const provision = server.match(/async function provisionPaidSalesDirectorAccount[^]*?async function finalizeSalesActivationForUser/)?.[0] || '';
const finalize = server.match(/async function finalizeSalesActivationForUser[^]*?const mutationActionLabel/)?.[0] || '';
const sessionRoute = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');
const verification = server.match(/const verifySalesDirectorContractAccess =[^]*?const resolveAcceptedModularCapacityContract/)?.[0] || '';

assert.match(processPaid, /paymentStatus === "paid"/);
assert.match(processPaid, /confirm_sales_assisted_checkout_payment/);
assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.doesNotMatch(processPaid, /buildSalesPostPaymentActivationEmail|sendTransactionalEmail|resend\.emails\.send/);
assert.match(processPaid, /options\.sendActivationEmail[\s\S]*?prepareSalesActivationAccess\(/);
assert.match(processPaid, /preserveProvisioningStatus:\s*true/);

const createUserBlock = provision.match(/supabase\.auth\.admin\.createUser\(\{[^]*?\}\);/)?.[0] || '';
assert.match(createUserBlock, /email,/);
assert.match(createUserBlock, /email_confirm:\s*true/);
assert.match(createUserBlock, /sales_paid_director:\s*true/);
assert.match(createUserBlock, /first_login_completed:\s*false/);
assert.doesNotMatch(createUserBlock, /password\s*:/);

assert.match(provision, /role:\s*"director"/);
assert.match(provision, /clinic_id:\s*authUser\.id/);
assert.match(provision, /ensureClinicAndMembershipForCoordinator\(authUser\.id,\s*"director"\)/);
assert.match(provision, /requireActivationRecord:\s*false/);
assert.match(provision, /SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED/);

assert.match(finalize, /applyModularEntitlementsForOrganization\(/);
assert.match(finalize, /provisionModularCapacityBillingContract\(/);
assert.match(finalize, /verifySalesDirectorContractAccess\(/);
assert.match(finalize, /provisioning_status:\s*"completed"/);
assert.match(verification, /exactModules/);
assert.match(verification, /everyActiveModuleComesFromContract/);

assert.match(sessionRoute, /SALES_DIRECTOR_SESSION_ALREADY_CLAIMED/);
assert.match(sessionRoute, /verifySalesDirectorContractAccess\(/);
assert.match(sessionRoute, /supabase\.auth\.admin\.generateLink/);
assert.match(sessionRoute, /hashed_token/);
assert.doesNotMatch(sessionRoute, /emails\.send|sendTransactionalEmail/);

assert.match(directorSession, /supabase\.auth\.verifyOtp/);
assert.match(directorSession, /provider:\s*'sales_checkout'/);
assert.match(directorSession, /intendedRole:\s*'director'/);
assert.match(publicOffer, /window\.location\.replace\('\/'\)/);
assert.match(publicOffer, /Entrada no onboarding da clínica/);
assert.doesNotMatch(publicOffer, /E-mail de ativação enviado|Reenviar e-mail/);

// Existing paid-Director onboarding remains the destination after automatic session establishment.
assert.match(onboarding, /director/i);
assert.match(onboarding, /Concluir configuração e acessar a Verto/);
assert.match(onboarding, /ownerAlreadyPaid[\s\S]*?'Concluir configuração e acessar a Verto'[\s\S]*?: 'Continuar para o plano'/);

console.log('salesAutomaticDirectorPostPayment20260831.regression.test.mjs: OK');
