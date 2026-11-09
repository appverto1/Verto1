import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readModularServerSource();
const migration = fs.readFileSync(
  'supabase/migrations/20260728010000_sales_multidisciplinary_commercial_evolution.sql',
  'utf8'
);
const checkoutRoute = server.match(
  /app\.post\(\s*"\/api\/owner\/sales\/offers\/:offerId\/modular-checkout"[\s\S]*?app\.get\(\s*"\/api\/owner\/sales\/offers\/:offerId\/modular-checkout"/
)?.[0] || '';
const checkoutCore = server.match(
  /const createOrReuseModularCheckout =[\s\S]*?app\.post\(\s*"\/api\/owner\/sales\/offers\/:offerId\/modular-checkout"/
)?.[0] || '';
const publicLegacyCheckout = server.match(
  /app\.post\(\s*"\/api\/public\/sales-offers\/:token\/checkout"[\s\S]*?app\.get\(\s*"\/api\/public\/sales-offers\/:token\/payment-status"/
)?.[0] || '';
const proposalEngine = fs.readFileSync('src/utils/salesModularProposal.ts', 'utf8');
const checkoutBuilder = fs.readFileSync('src/utils/salesCommercialEvolution.ts', 'utf8');
const ownerBuilder = fs.readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');

assert.match(server, /const STRIPE_API_VERSION: Stripe\.LatestApiVersion = '2026-03-25\.dahlia'/);
assert.match(server, /new Stripe\(key, \{ apiVersion: STRIPE_API_VERSION \}\)/);
assert.match(checkoutRoute, /checkPlatformAdmin/, 'Checkout modular deve exigir administração da plataforma');
assert.match(checkoutRoute, /hasVerifiedMfaSession/, 'MFA deve ser obrigatório para qualquer administrador da plataforma');
assert.match(checkoutCore, /MODULAR_OFFER_ACCEPTANCE_REQUIRED/);
assert.match(checkoutCore, /accepted_terms_snapshot/);
assert.match(checkoutRoute, /MODULAR_CHECKOUT_BROWSER_VALUES_REJECTED/);
assert.match(checkoutCore, /MODULAR_CHECKOUT_RECONCILIATION_FAILED/);
assert.match(checkoutCore, /everyPhaseIsInternallyReconciled/);
assert.match(checkoutCore, /checkout\.sessions\.expire\(session\.id\)/, 'sessão Stripe órfã deve ser expirada se a persistência falhar');
assert.match(server, /resolveStripeEnvironment/);
assert.match(server, /validateStripeSecretForEnvironment/);
assert.match(fs.readFileSync('services/stripeEnvironment.ts', 'utf8'), /sk_test_/);
assert.match(fs.readFileSync('services/stripeEnvironment.ts', 'utf8'), /sk_live_/);
assert.match(checkoutCore, /mode: "subscription"/);
assert.match(checkoutCore, /resolveFrozenSalesOfferTrialDays\(offer\)/);
assert.match(checkoutCore, /trialDays: frozenTrialDays/);
assert.match(checkoutCore, /trial_period_days: frozenTrialDays/);
assert.match(server, /PROPOSAL_TRIAL_SNAPSHOT_MISMATCH/);
assert.match(checkoutCore, /client_reference_id: offerId/);
assert.match(checkoutCore, /idempotencyKey/);
assert.match(checkoutCore, /MODULAR_CHECKOUT_IDEMPOTENCY_CONFLICT/);
assert.match(checkoutCore, /MODULAR_OFFER_EXPIRED/);
assert.match(
  checkoutCore,
  /MODULAR_CHECKOUT_MARGIN_POLICY_REVIEW_REQUIRED/
);
assert.match(checkoutCore, /MODULAR_CHECKOUT_PAYMENT_RECOVERY_REQUIRED/);
assert.match(
  checkoutCore,
  /operationIdempotencyKey/,
  'regeneração e expiração devem produzir uma geração idempotente própria'
);
assert.doesNotMatch(
  checkoutCore.match(/const requestHash =[\s\S]*?\.digest\("hex"\);/)?.[0] || '',
  /actorUserId/,
  'request hash deve representar a proposta congelada, não o owner que clicou'
);
assert.match(server, /clinical_core_capacity/);
assert.doesNotMatch(checkoutCore, /patientName|patient_name|cpf|diagnosis|prontu/i, 'metadata não pode receber conteúdo clínico');
assert.match(checkoutBuilder, /clinical_core_capacity/);
assert.match(checkoutBuilder, /billingInterval === 'monthly'/);
assert.match(checkoutBuilder, /recurring: line\.billingInterval === 'monthly'/);
assert.doesNotMatch(proposalEngine, /getStripe\(|stripe\./, 'cálculo modular não pode chamar Stripe');
assert.match(ownerBuilder, /checkoutLink\.status === 'failed'/);
assert.match(ownerBuilder, /assinatura já foi criada e a cobrança falhou/);

assert.match(server, /function deriveSalesCheckoutPublicToken/);
assert.match(server, /public_token_hash/);
assert.match(
  server,
  /`\$\{link\.request_hash\}:\$\{link\.idempotency_key\}`/,
  'cada regeneração deve possuir token público próprio'
);
assert.match(server, /checkout_opened/);
assert.match(server, /ensureModularSubscriptionSchedule/);
assert.match(
  server,
  /sanitizeString\(pendingOffer\.status, 40\) !== "paid"/,
  'avisos comerciais ao cliente só podem sair após pagamento confirmado'
);
assert.match(server, /subscriptionSchedules\.create/);
assert.match(server, /subscriptionSchedules\.update/);
assert.match(server, /end_behavior: "release"/);
assert.match(server, /checkout\.session\.completed/);
assert.match(server, /checkout\.session\.expired/);
assert.match(server, /invoice\.paid/);
assert.match(server, /invoice\.payment_failed/);
assert.match(server, /event\.type === "invoice\.payment_failed"[\s\S]*?"failed"/);
assert.match(server, /customer\.subscription\.created/);
assert.match(server, /customer\.subscription\.updated/);
assert.match(server, /customer\.subscription\.deleted/);
assert.match(server, /event\.type\.startsWith\("subscription_schedule\."\)/);
assert.match(server, /subscription_schedule\.completed/);
assert.match(server, /subscription_schedule\.canceled/);
assert.match(server, /reserveStripeWebhookEvent/, 'webhook precisa de reserva idempotente');
assert.match(server, /constructEvent/, 'assinatura Stripe precisa ser validada');
assert.match(server, /confirm_sales_assisted_checkout_payment/);
assert.match(server, /pending_activations/);
assert.match(server, /\.eq\("stripe_checkout_session_id", session\.id\)[\s\S]*?\.eq\("source", "sales_assisted_signup"\)/);

assert.match(publicLegacyCheckout, /createOrReuseModularCheckout/);
assert.match(publicLegacyCheckout, /MODULAR_OFFER_ACCEPTANCE_REQUIRED/);
assert.match(publicLegacyCheckout, /stripe\.checkout\.sessions\.create/);
assert.match(publicLegacyCheckout, /sales-offer-checkout:/, 'Checkout legado deve continuar no mesmo fluxo');

assert.match(migration, /create table if not exists public\.sales_checkout_links/);
assert.match(migration, /idx_sales_checkout_links_one_active/);
assert.match(migration, /unique \(created_by, idempotency_key\)/);
assert.match(migration, /environment text not null check \(environment in \('test','live'\)\)/);
assert.match(migration, /revoke all on public\.sales_offer_item_discounts, public\.sales_checkout_links from anon, authenticated/);
assert.doesNotMatch(migration, /drop table|truncate/i);

console.log('salesModularStripeAssisted.test.ts: ok');
