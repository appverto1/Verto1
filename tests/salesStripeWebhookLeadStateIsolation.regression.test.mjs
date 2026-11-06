import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const server = readFileSync('server.ts','utf8');
const assisted = readFileSync('services/salesAssistedStripeEventHandlers.ts','utf8');
const migration = readFileSync('supabase/migrations/20261104200000_sales_stripe_webhook_monotonic_guard.sql','utf8');
const checkout = server.match(/const processSalesAssistedCheckoutCompleted = async[\s\S]*?const stripeInvoiceSubscriptionId/)?.[0] || '';
const processor = assisted.match(/const processSalesAssistedStripeEvent = async[\s\S]*?return \{ isSalesAssistedStripeEvent, processSalesAssistedStripeEvent \}/)?.[0] || '';
const leadPatch = server.match(/app\.patch\(\s*"\/api\/owner\/sales\/leads\/:leadId"[\s\S]*?app\.get\(\s*"\/api\/owner\/sales\/pricing-catalogs"/)?.[0] || '';

test('late unpaid checkout event cannot demote a converted lead', () => {
  const pending = checkout.match(/if \(!paymentConfirmed\) \{[\s\S]*?return \{ paymentConfirmed: false, activationPrepared: false \};/)?.[0] || '';
  assert.ok(pending, 'unpaid checkout branch must exist');
  assert.match(pending, /\.from\("sales_leads"\)[\s\S]*?\.update\(\{ status: "payment_pending", updated_at: now \}\)[\s\S]*?\.eq\("id", leadId\)[\s\S]*?\.is\("deleted_at", null\)[\s\S]*?\.neq\("status", "converted"\)/);
  assert.match(pending, /\.from\("sales_offers"\)[\s\S]*?\.neq\("status", "paid"\)/);
  assert.match(pending, /return \{ paymentConfirmed: false, activationPrepared: false \}/);
  assert.match(checkout, /confirm_sales_assisted_checkout_payment/);
});

test('manual CRM lead status remains editable, without global converted lead trigger', () => {
  assert.match(leadPatch,/checkPlatformAdmin/);
  assert.match(leadPatch,/const patch: Record<string, any> = \{ status, updated_at: now \}/);
  assert.match(leadPatch,/\.from\("sales_leads"\)[\s\S]*?\.update\(patch\)[\s\S]*?\.eq\("id", leadId\)/);
  assert.doesNotMatch(leadPatch,/\.neq\("status", "converted"\)/);
  const cleanup = readFileSync('supabase/migrations/20261104210000_sales_remove_header_dependent_lead_guard.sql','utf8');
  assert.match(cleanup,/DROP TRIGGER IF EXISTS guard_sales_converted_webhook_pending_v1 ON public\.sales_leads/);
  assert.match(cleanup,/DROP FUNCTION IF EXISTS public\.guard_sales_converted_webhook_pending_v1\(\)/);
  assert.doesNotMatch(cleanup,/DROP TRIGGER.*sales_checkout_links|DROP FUNCTION.*guard_sales_checkout_terminal_pending_v1/);
});

test('out-of-order unpaid session cannot erase terminal Checkout link or payment timestamp', () => {
  assert.match(migration,/OLD\.status IN \('completed', 'failed', 'expired'\)/);
  assert.match(migration,/NEW\.status = 'payment_pending'/);
  assert.match(migration,/RETURN NULL;/);
  assert.match(migration,/BEFORE UPDATE OF status ON public\.sales_checkout_links/);
  assert.match(processor,/status: result\.paymentConfirmed \? "completed" : "payment_pending"/);
  assert.match(processor,/payment_completed_at: result\.paymentConfirmed \? completedAt : null/);
});

test('Stripe webhook signature, idempotency, entitlements and checkout reuse remain in place', () => {
  assert.match(server,/stripe\.webhooks\.constructEvent/);
  assert.match(server,/async function reserveStripeWebhookEvent/);
  assert.match(server,/\.from\('stripe_webhook_events'\)/);
  assert.match(assisted,/checkout\.session\.async_payment_succeeded/);
  assert.match(server,/confirm_sales_assisted_checkout_payment/);
  assert.match(server,/applyModularEntitlementsForOrganization/);
  assert.match(server,/MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/);
  assert.match(server,/operationIdempotencyKey/);
});
