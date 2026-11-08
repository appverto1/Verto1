import {readFileSync as readItem10Source} from 'node:fs';
import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const item10ProvisioningSource = readItem10Source('services/salesPaidDirectorAccountProvisioning.ts','utf8');
const item10ContractSource = readItem10Source('services/salesDirectorContractAccess.ts','utf8');
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
const provision = item10ProvisioningSource.match(/async function provisionPaidSalesDirectorAccount[^]*?async function finalizeSalesActivationForUser/)?.[0] || '';
const finalize = item10ProvisioningSource.match(/async function finalizeSalesActivationForUser[^]*?ITEM10_SOURCE_END/)?.[0] || '';
const sessionRoute = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');
const verification = item10ContractSource.match(/const verifySalesDirectorContractAccess =[^]*?ITEM10_SOURCE_END/)?.[0] || '';

assert.match(processPaid, /paymentStatus === "paid"/);
assert.match(processPaid, /confirm_sales_assisted_checkout_payment/);
assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.doesNotMatch(processPaid, /buildSalesPostPaymentActivationEmail|sendTransactionalEmail|resend\.emails\.send/);
assert.match(processPaid, /const activationEmail = await prepareSalesActivationAccess\(/);
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

assert.match(sessionRoute, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.doesNotMatch(sessionRoute, /auth\.admin\.generateLink|hashed_token/);
assert.doesNotMatch(sessionRoute, /emails\.send|sendTransactionalEmail/);

assert.match(directorSession, /supabase\.auth\.verifyOtp/);
assert.match(directorSession, /provider:\s*'sales_checkout'/);
assert.match(directorSession, /intendedRole:\s*'director'/);
assert.match(publicOffer, /window\.location\.replace\('\/'\)/);
assert.match(publicOffer, /Acesso por Google ou senha configurado/);
assert.match(publicOffer, /Enviamos um link de ativação/);
assert.doesNotMatch(publicOffer, /openDirectorSession\(|establishPublicSalesDirectorSession/);

// Existing paid-Director onboarding remains the destination after automatic session establishment.
assert.match(onboarding, /director/i);
assert.match(onboarding, /Concluir configuração e acessar a Verto/);
assert.match(onboarding, /ownerAlreadyPaid[\s\S]*?'Concluir configuração e acessar a Verto'[\s\S]*?: 'Continuar para o plano'/);

console.log('salesAutomaticDirectorPostPayment20260831.regression.test.mjs: OK');
