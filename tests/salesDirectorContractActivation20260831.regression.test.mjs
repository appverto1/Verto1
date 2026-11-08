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
const activationUi = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const processPaid = stripePaidProcessorSource.match(/const processSalesAssistedCheckoutCompleted =[^]*?ITEM09_SOURCE_END/)?.[0] || '';
const paymentStatus = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const directorSession = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');
const verification = item10ContractSource.match(/const verifySalesDirectorContractAccess =[^]*?ITEM10_SOURCE_END/)?.[0] || '';
const provision = item10ProvisioningSource.match(/async function provisionPaidSalesDirectorAccount[^]*?async function finalizeSalesActivationForUser/)?.[0] || '';
const finalize = item10ProvisioningSource.match(/async function finalizeSalesActivationForUser[^]*?ITEM10_SOURCE_END/)?.[0] || '';

// New paid contracts are provisioned server-side as Director. E-mail is never a
// provisioning gate, but delayed payment methods may send a first-access link.
assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.match(processPaid, /preparePaidDirectorSessionBootstrap\(/);
assert.match(processPaid, /const activationEmail = await prepareSalesActivationAccess\(/);
assert.match(processPaid, /preserveProvisioningStatus:\s*true/);
assert.doesNotMatch(processPaid, /buildSalesPostPaymentActivationEmail|sendTransactionalEmailWithResultSafe|resend\.emails\.send/);

assert.match(provision, /role:\s*"director"/);
assert.match(provision, /ensureClinicAndMembershipForCoordinator\(authUser\.id,\s*"director"\)/);
assert.match(provision, /requireActivationRecord:\s*false/);
assert.match(provision, /email_confirm:\s*true/);

// Paid status is now about provisioning/session state, not activation e-mail delivery.
assert.match(paymentStatus, /accountProvisioned/);
assert.match(paymentStatus, /directorSessionReady/);
assert.match(paymentStatus, /sessionClaimed/);
assert.match(paymentStatus, /"director_ready"/);
assert.match(paymentStatus, /"account_activated"/);
assert.match(paymentStatus, /activation_email_sent_at/);
assert.match(paymentStatus, /activationEmailSent/);

// A public Checkout URL can never issue a privileged Auth session.
assert.match(directorSession, /SALES_DIRECTOR_EMAIL_ACTIVATION_REQUIRED/);
assert.doesNotMatch(directorSession, /generateLink|hashed_token/);

assert.match(verification, /from\("users"\)[\s\S]*?select\("id,role,clinic_id"\)/);
assert.match(verification, /from\("clinic_memberships"\)/);
assert.match(verification, /from\("organization_module_access_profiles"\)/);
assert.match(verification, /mode,source_offer_id,stripe_subscription_id/);
assert.match(verification, /from\("organization_module_entitlements"\)/);
assert.match(verification, /exactModules/);
assert.match(verification, /profile\.role[\s\S]*?"director"/);
assert.match(verification, /membership\.role[\s\S]*?"director"/);
assert.match(verification, /accessProfile\.mode[\s\S]*?"contract"/);
assert.match(verification, /everyActiveModuleComesFromContract/);

assert.match(stripeEntitlementsSource, /apply_sales_offer_module_entitlements_v2/);
assert.match(stripeEntitlementsSource, /p_stripe_event_created_at:\s*params\.stripeEventCreatedAt/);
assert.match(finalize, /activation_channel:\s*requireActivationRecord\s*\?\s*"legacy_activation"\s*:\s*"stripe_payment"/);

// Historical activation URLs remain readable for already-issued links, but are not used by new paid checkout.
assert.match(activationUi, /Diretor da clínica/);
assert.match(publicOffer, /'director_ready'/);
assert.match(publicOffer, /E-mail de ativação disponível/);
assert.match(publicOffer, /Ative seu acesso pelo e-mail/);
assert.match(publicOffer, /Atualizar status/);
assert.doesNotMatch(publicOffer, /Entrar na Verto e continuar onboarding/);

console.log('salesDirectorContractActivation20260831.regression.test.mjs: OK');
