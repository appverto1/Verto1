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

const provision = server.match(/async function provisionPaidSalesDirectorAccount[^]*?async function finalizeSalesActivationForUser/)?.[0] || '';
const reconcile = server.match(/"\/api\/public\/sales-offers\/:token\/prepare-activation"[^]*?registerPublicSalesDirectorSessionRoute\(/)?.[0] || '';

assert.match(provision, /createUser\(\{/);
assert.match(provision, /normalized\.includes\("already"\)/);
assert.match(provision, /authUser = await findAuthUserByEmail\(email\)/);
assert.doesNotMatch(
  provision.match(/if \(createError\)[^]*?\n\s*}\n\s*if \(!authUser\?\.id\)/)?.[0] || '',
  /throw conflict/,
  'a concurrent Auth create race must not be converted directly into review_required',
);

assert.match(provision, /from\("clinic_memberships"\)/);
assert.match(provision, /membershipClinicId === authUser\.id/);
assert.match(provision, /\["director", "coordinator"\]\.includes\(membershipRole\)/);
assert.match(provision, /SALES_DIRECTOR_EXISTING_ACCOUNT_REVIEW_REQUIRED/);
assert.match(provision, /existingMetadataOfferId === offerId/);

assert.match(reconcile, /stripe\.checkout\.sessions\.retrieve\(checkoutSessionId\)/);
assert.match(reconcile, /reconcileSalesAssistedCheckout\(stripe, session\)/);
assert.doesNotMatch(
  reconcile,
  /if \(sanitizeString\(offer\.provisioning_status, 40\) === "review_required"\) \{[^]*?SALES_ACTIVATION_REVIEW_REQUIRED/,
  'prepare-activation must revalidate stored review_required instead of making a stale flag terminal',
);
assert.match(reconcile, /result\.reviewRequired/);

console.log('salesDirectorProvisioningRaceRecovery20260901.regression.test.mjs: OK');
