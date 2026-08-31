import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const activationUi = fs.readFileSync('src/components/SalesActivationAccess.tsx', 'utf8');
const publicOffer = fs.readFileSync('src/components/PublicSalesOffer.tsx', 'utf8');

const paymentStatus = server.match(/"\/api\/public\/sales-offers\/:token\/payment-status"[\s\S]*?const loadPublicSalesActivation/)?.[0] || '';
const loadActivation = server.match(/const loadPublicSalesActivation =[\s\S]*?app\.get\(\s*"\/api\/public\/sales-activations\/:token"/)?.[0] || '';
const passwordActivation = server.match(/"\/api\/public\/sales-activations\/:token\/password"[\s\S]*?const stripeSubscriptionToEntitlementStatus/)?.[0] || '';
const verification = server.match(/const verifySalesDirectorContractAccess =[\s\S]*?const resolveAcceptedModularCapacityContract/)?.[0] || '';
const finalize = server.match(/async function finalizeSalesActivationForUser[\s\S]*?const mutationActionLabel/)?.[0] || '';

assert.match(paymentStatus, /activation_email_sent_at,used/);
assert.match(paymentStatus, /accountActivated = activation\?\.used === true/);
assert.match(paymentStatus, /"account_activated"/);

assert.match(loadActivation, /from\("sales_offer_items"\)/);
assert.match(loadActivation, /SALES_CUSTOMER_FACING_MODULE_ITEM_KEYS/);
assert.match(server, /role: "director",\s*modules: loaded\.contractedModules/);

assert.match(passwordActivation, /role: "director"/);
assert.match(passwordActivation, /ensureClinicAndMembershipForCoordinator\(authUser\.id, "director"\)/);
assert.match(passwordActivation, /passwordSaved: true/);
assert.match(passwordActivation, /modules: loaded\.contractedModules/);
assert.match(passwordActivation, /SALES_DIRECTOR_ENTITLEMENT_VERIFICATION_FAILED/);

assert.match(verification, /from\("users"\)[\s\S]*?select\("id,role,clinic_id"\)/);
assert.match(verification, /from\("clinic_memberships"\)/);
assert.match(verification, /from\("organization_module_access_profiles"\)/);
assert.match(verification, /mode,source_offer_id,stripe_subscription_id/);
assert.match(verification, /from\("organization_module_entitlements"\)/);
assert.match(verification, /exactModules/);
assert.match(verification, /profile\.role[\s\S]*?"director"/);
assert.match(verification, /membership\.role[\s\S]*?"director"/);
assert.match(verification, /accessProfile\.mode[\s\S]*?"contract"/);

const verifyIndex = finalize.indexOf('await verifySalesDirectorContractAccess');
const consumeIndex = finalize.indexOf('.update({ used: true })');
assert.ok(verifyIndex >= 0 && consumeIndex > verifyIndex, 'ativação só pode ser consumida depois de validar Diretor + módulos');

assert.match(activationUi, /Você será o <strong>Diretor da clínica<\/strong>/);
assert.match(activationUi, /activation\.modules\.map/);
assert.match(activationUi, /Ativar como Diretor e entrar com Google/);
assert.match(publicOffer, /'account_activated'/);
assert.match(publicOffer, /Conta ativada como Diretor/);
assert.match(publicOffer, /Módulos contratados liberados/);
assert.match(publicOffer, /Atualizar status da ativação/);
assert.match(publicOffer, /paymentStatusRefreshKey/);


assert.match(server, /apply_sales_offer_module_entitlements_v2/);
assert.match(server, /p_stripe_event_created_at:\s*params\.stripeEventCreatedAt/);
assert.match(verification, /everyActiveModuleComesFromContract/);
console.log('salesDirectorContractActivation20260831.regression.test.mjs: OK');
