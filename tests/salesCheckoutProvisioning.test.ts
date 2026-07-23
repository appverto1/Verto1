import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');
const server = read('server.ts');
const migration = read(
  'supabase/migrations/20260723120000_sales_checkout_payment_reconciliation.sql',
);
const publicOffer = read('src/components/PublicSalesOffer.tsx');

const checkoutProcessor =
  server.match(
    /const processSalesAssistedCheckoutCompleted = async \([\s\S]*?\n  const stripeInvoiceSubscriptionId/,
  )?.[0] || '';
const checkoutRoute =
  server.match(
    /app\.post\(\s*"\/api\/public\/sales-offers\/:token\/checkout"[\s\S]*?app\.get\(\s*"\/api\/public\/sales-offers\/:token\/payment-status"/,
  )?.[0] || '';
const activationLoader =
  server.match(
    /const loadPublicSalesActivation = async[\s\S]*?const finalizeSalesActivationForUser/,
  )?.[0] || '';

test('paid checkout is committed atomically before identity provisioning', () => {
  assert.match(migration, /create or replace function public\.confirm_sales_assisted_checkout_payment/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update/);
  assert.match(migration, /set status = 'paid'/);
  assert.match(migration, /'payment_completed'/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);

  const paymentUpdate = migration.indexOf("set status = 'paid'");
  const identityResolution = migration.indexOf('if v_current_email is null then');
  assert.ok(paymentUpdate >= 0 && identityResolution > paymentUpdate);
  assert.match(checkoutProcessor, /supabase\.rpc\("confirm_sales_assisted_checkout_payment"/);
});

test('minimal lead safely adopts checkout email without forcing an unsafe merge', () => {
  assert.match(migration, /and nullif\(btrim\(coalesce\(normalized_email, email, ''\)\), ''\) is null/);
  assert.match(migration, /exception when unique_violation/);
  assert.match(migration, /v_email_state := 'collision'/);
  assert.match(migration, /v_email_state := 'mismatch'/);
  assert.match(migration, /provisioning_status = 'review_required'/);
  assert.doesNotMatch(
    checkoutProcessor,
    /sanitizeEmail\(lead\.normalized_email \|\| lead\.email\) !== customerEmail/,
  );
  assert.match(checkoutProcessor, /emailState === "collision"/);
  assert.match(checkoutProcessor, /emailState === "mismatch" \|\| reviewRequired/);
});

test('activation is linked to the paid offer and checkout identity, not lead email equality', () => {
  assert.match(activationLoader, /\.eq\("source", "sales_assisted_signup"\)/);
  assert.match(activationLoader, /\.eq\("status", "paid"\)/);
  assert.match(activationLoader, /\.eq\("stripe_checkout_session_id", checkoutSessionId\)/);
  assert.doesNotMatch(activationLoader, /leadEmail\s*!==\s*email|normalized_email[^\n]*!==/);
  assert.match(checkoutProcessor, /email: customerEmail/);
  assert.match(checkoutProcessor, /deriveSalesActivationToken\(session\.id\)/);
  assert.match(checkoutProcessor, /idempotencyKey: `sales-activation:\$\{session\.id\}`/);
});

test('checkout creation verifies persistence and reuses the Stripe session idempotently', () => {
  assert.match(checkoutRoute, /const persistCheckoutSession = async/);
  assert.match(checkoutRoute, /const persistenceError = \[offerResult, leadResult, eventResult\]/);
  assert.match(checkoutRoute, /CHECKOUT_PERSISTENCE_FAILED/);
  assert.match(checkoutRoute, /stripe\.checkout\.sessions\.retrieve/);
  assert.match(checkoutRoute, /idempotencyKey: `sales-offer-checkout:\$\{offer\.id\}`/);
});

test('canonical webhook handles assisted lifecycle once and stays before JSON parsing', () => {
  const legacyRoute = server.indexOf('"/api/webhook/stripe"');
  const canonicalRoute = server.indexOf('"/api/stripe/webhook"');
  const jsonParser = server.indexOf('app.use(express.json({');
  assert.ok(legacyRoute >= 0 && canonicalRoute > legacyRoute && jsonParser > canonicalRoute);
  assert.match(server, /async function reserveStripeWebhookEvent/);
  assert.match(server, /processSalesAssistedStripeEvent/);
  assert.match(server, /checkout\.session\.completed/);
  assert.match(server, /invoice\.paid/);
  assert.match(server, /invoice\.payment_failed/);
  assert.match(server, /customer\.subscription\.updated/);
  assert.match(server, /customer\.subscription\.deleted/);
  assert.match(server, /flowType[\s\S]{0,120}sales_assisted_signup/);
});

test('public return reports bounded payment/provisioning progress without claiming account creation', () => {
  assert.match(server, /\/api\/public\/sales-offers\/:token\/payment-status/);
  assert.match(publicOffer, /const maxAttempts = 8/);
  assert.match(publicOffer, /Confirmando seu pagamento/);
  assert.match(publicOffer, /Esta página não cria a conta automaticamente/);
  assert.match(publicOffer, /activation_email_sent/);
});

test('reconciliation migrations are additive and server-only', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /add column if not exists/);
  assert.match(migration, /revoke all on function public\.confirm_sales_assisted_checkout_payment/);
  assert.match(migration, /grant execute on function public\.confirm_sales_assisted_checkout_payment[\s\S]*to postgres, service_role/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\.sales_/i);
});
