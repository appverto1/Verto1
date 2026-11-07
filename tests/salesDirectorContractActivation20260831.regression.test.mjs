import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const activationUi = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const processPaid = server.match(/const processSalesAssistedCheckoutCompleted =[^]*?const stripeInvoiceSubscriptionId/)?.[0] || '';
const paymentStatus = fs.readFileSync('services/publicSalesPaymentStatusRoute.ts', 'utf8');
const directorSession = fs.readFileSync('services/publicSalesDirectorSessionRoute.ts', 'utf8');
const verification = server.match(/const verifySalesDirectorContractAccess =[^]*?const resolveAcceptedModularCapacityContract/)?.[0] || '';
const provision = server.match(/async function provisionPaidSalesDirectorAccount[^]*?async function finalizeSalesActivationForUser/)?.[0] || '';
const finalize = server.match(/async function finalizeSalesActivationForUser[^]*?const mutationActionLabel/)?.[0] || '';

// New paid contracts are provisioned server-side as Director. E-mail is never a
// provisioning gate, but delayed payment methods may send a first-access link.
assert.match(processPaid, /provisionPaidSalesDirectorAccount\(/);
assert.match(processPaid, /preparePaidDirectorSessionBootstrap\(/);
assert.match(processPaid, /options\.sendActivationEmail[\s\S]*?prepareSalesActivationAccess\(/);
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
assert.doesNotMatch(paymentStatus, /activation_email_sent_at|activationEmailSent|emailDeliveryState/);

// Browser session issuance is one-time and only after the Director + exact modules are revalidated.
assert.match(directorSession, /verifySalesDirectorContractAccess\(/);
assert.match(directorSession, /provisioning_status[\s\S]*?"completed"/);
assert.match(directorSession, /generateLink\(\{[\s\S]*?type:\s*"magiclink"/);
assert.match(directorSession, /hashed_token/);
assert.doesNotMatch(directorSession, /emails\.send|sendTransactionalEmail/);

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

assert.match(server, /apply_sales_offer_module_entitlements_v2/);
assert.match(server, /p_stripe_event_created_at:\s*params\.stripeEventCreatedAt/);
assert.match(finalize, /activation_channel:\s*requireActivationRecord\s*\?\s*"legacy_activation"\s*:\s*"stripe_payment"/);

// Historical activation URLs remain readable for already-issued links, but are not used by new paid checkout.
assert.match(activationUi, /Diretor da clínica/);
assert.match(publicOffer, /'director_ready'/);
assert.match(publicOffer, /Diretor e módulos contratados liberados/);
assert.match(publicOffer, /Entrar na Verto e continuar onboarding/);
assert.match(publicOffer, /Atualizar status/);
assert.doesNotMatch(publicOffer, /Reenviar e-mail|E-mail de ativação enviado|activation_ready/);

console.log('salesDirectorContractActivation20260831.regression.test.mjs: OK');
