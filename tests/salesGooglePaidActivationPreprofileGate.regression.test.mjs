import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const src=readFileSync('server.ts','utf8');
const start=src.indexOf("      // Legacy compatibility is restricted to a coordinator profile");
const end=src.indexOf("      // Retry an interrupted paid modular activation on a later login",start);
const login=src.slice(start,end);

test('partial Coordinator -> Director cannot mutate role before paid offer and Stripe eligible',()=>{
 const mark=login.indexOf("resumableDirectorActivation?.sales_offer_id === activationOfferHint");
 const verify=login.indexOf("const resumeEligible =");
 const roleWrite=login.indexOf(".update({ role: 'director', clinic_id: user.id })");
 assert.ok(mark>0 && verify>mark && roleWrite>verify);
 assert.match(login,/\.eq\('status', 'paid'\)/);
 assert.match(login,/\.eq\('stripe_checkout_session_id', resumeCheckoutId\)/);
 assert.match(login,/resumeContractEmail === safeAuthEmail/);
 assert.match(login,/resumeSubscription\?\.status === 'active'/);
 assert.match(login,/resumeExpiresAt > Date\.now\(\)/);
});

test('first Google login must validate Stripe active status and buyer email before creating a Director profile',()=>{
 const first=login.indexOf("let validPaidActivation:");
 const active=login.indexOf('verifiedSubscription?.status === "active"',first);
 const auth=login.indexOf('const activationMetadata =',first);
 const profile=login.indexOf('const newProfile = {',first);
 const membership=login.indexOf('await ensureClinicAndMembershipForCoordinator(',profile);
 assert.ok(first>0 && active>first && auth>active && profile>auth && membership>profile);
 assert.match(login,/\.select\("id,lead_id,status,stripe_checkout_session_id,offer_type,stripe_subscription_id,contract_email"\)/);
 assert.match(login,/\.eq\("status", "paid"\)/);
 assert.match(login,/sanitizeEmail\(paidActivation\.email\) === safeUserEmail/);
 assert.match(login,/contractedEmail === safeUserEmail/);
 assert.match(login,/priorOfferMarker && priorOfferMarker !== validPaidActivation\.offerId/);
 assert.match(login,/app_metadata: \{/);
 assert.match(login,/verifiedSubscription,/);
});

test('login retry passes only paid offer, canonical user and clinic through the protected finalizer',()=>{
 assert.match(src,/finalizeSalesActivationForUser\(\{\s*\.\.\.commercialPaidActivation,\s*userId: user\.id,\s*clinicId: user\.id/);
 assert.match(src,/finalizeSalesActivationForUser\(\{\s*email: safeAuthEmail,\s*userId: user\.id,\s*clinicId: ownedCommercialClinicId/);
});
