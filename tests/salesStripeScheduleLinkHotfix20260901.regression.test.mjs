import {readFileSync as readItem10Source} from 'node:fs';
import {readFileSync as readItem09Source} from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const item10ReconcileSource = readItem10Source('services/publicSalesPostPaymentReconciliationRoute.ts','utf8');
const stripeWebhookEventStateSource = readItem09Source('services/stripeWebhookEventState.ts','utf8');
const stripePaidProcessorSource = readItem09Source('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const stripeFinancialSource = readItem09Source('services/salesSubscriptionFinancialReconciliation.ts','utf8');
const stripeScheduleSource = readItem09Source('services/salesModularSubscriptionSchedule.ts','utf8');
const stripeDiscountSource = readItem09Source('services/salesSubscriptionDiscountSync.ts','utf8');
const stripeEntitlementsSource = readItem09Source('services/salesSubscriptionEntitlementTransitions.ts','utf8');
const assistedHandlerSource = readItem09Source('services/salesAssistedStripeEventHandlers.ts','utf8');
const checkoutCoreSource = readItem09Source('services/salesModularCheckoutCore.ts','utf8');

const server = fs.readFileSync('server.ts', 'utf8');

const scheduleBlock = stripeScheduleSource.match(/const stripeExpandableId = \(value: unknown[\s\S]*?\n  const reconcileSalesAssistedCheckout = async \(/
)?.[0] || '';

const ensureBlock = stripeScheduleSource.match(/const ensureModularSubscriptionSchedule = async \([\s\S]*?\n  const reconcileSalesAssistedCheckout = async \(/
)?.[0] || '';
// Inspect the relocated assisted-event processor, not the monolithic server.
const assistedPaidProcessorSource = assistedHandlerSource.slice(
  assistedHandlerSource.indexOf('const processSalesAssistedStripeEvent = async ('),
);
const checkoutEventBlock = assistedPaidProcessorSource.match(
  /if \(\s*event\.type === "checkout\.session\.completed" \|\|[\s\S]*?return \{ handled: true, result \};\n    \}/
)?.[0] || '';
const invoicePaidBlock = assistedPaidProcessorSource.match(
  /if \(\s*event\.type === "invoice\.paid" \|\|[\s\S]*?return \{ handled: true, result \};\n      \}/
)?.[0] || '';
const prepareActivationBlock = item10ReconcileSource.match(
  /app\.post\(\n    "\/api\/public\/sales-offers\/:token\/prepare-activation"[\s\S]*?\n  \/\/ ITEM10_SOURCE_END/
)?.[0] || '';

assert.ok(scheduleBlock, 'bloco de reconciliação de Schedule modular deve existir');
assert.ok(ensureBlock, 'reconciliador de Schedule modular deve existir');
assert.match(
  ensureBlock,
  /subscriptionSchedules\.create\(\n\s*\{ from_subscription: subscriptionId \},/,
  'from_subscription deve ser enviado sozinho no payload de criação da Schedule',
);
assert.doesNotMatch(
  ensureBlock,
  /subscriptionSchedules\.create\(\s*\{\s*from_subscription:[\s\S]{0,240}?metadata\s*:/,
  'metadata não pode ser enviada junto de from_subscription',
);
assert.match(ensureBlock, /subscriptionSchedules\.update\(/);
assert.match(scheduleBlock, /preserveStripeSchedulePhaseForUpdate/);
assert.match(scheduleBlock, /start_date: startDate/);
assert.match(scheduleBlock, /end_date: endDate/);
assert.match(scheduleBlock, /preserved\.trial_end = trialEnd/);
assert.match(scheduleBlock, /preserved\.proration_behavior = prorationBehavior/);
assert.doesNotMatch(
  ensureBlock,
  /start_date:\s*["']now["']\s*(?:as const)?\s*,/,
  'o hotfix não pode reconstruir a fase atual com start_date=now',
);
assert.match(
  ensureBlock,
  /subscriptionScheduleId = stripeExpandableId\([\s\S]*?subscription as any\)\?\.schedule/,
  'retry deve consultar a Schedule vinculada à Subscription na Stripe',
);
assert.match(ensureBlock, /MODULAR_SCHEDULE_REUSE_VALIDATION_FAILED/);
assert.match(ensureBlock, /MODULAR_SCHEDULE_METADATA_CONFLICT/);
assert.match(ensureBlock, /MODULAR_SUBSCRIPTION_LINKAGE_CONFLICT/);
assert.match(ensureBlock, /MODULAR_CURRENT_PHASE_RECONCILIATION_FAILED/);
assert.match(scheduleBlock, /buildStripeScheduleContinuationPhase/);
assert.match(scheduleBlock, /MODULAR_SCHEDULE_PHASE_BOUNDARY_BEFORE_CURRENT_PERIOD_END/);
assert.match(ensureBlock, /MODULAR_SCHEDULE_PHASE_SEQUENCE_INVALID/);
assert.match(ensureBlock, /proration_behavior: "none"/);

const persistIndex = ensureBlock.indexOf('stripe_subscription_id: subscriptionId');
const createIndex = ensureBlock.indexOf('subscriptionSchedules.create');
assert.ok(
  persistIndex >= 0 && createIndex >= 0 && persistIndex < createIndex,
  'Checkout -> Subscription deve ser persistido antes da criação/reconciliação da Schedule',
);

assert.match(checkoutEventBlock, /reconcileSalesAssistedCheckout\(/);
assert.match(invoicePaidBlock, /reconcileSalesAssistedCheckout\(/);
assert.match(prepareActivationBlock, /reconcileSalesAssistedCheckout\(stripe, session\)/);

// Escopo cirúrgico: esta entrega corrige o link/pós-pagamento e não antecipa a
// mudança comercial posterior de remoção de trial/precificação.
assert.match(checkoutCoreSource, /resolveFrozenSalesOfferTrialDays\(offer\)/);
assert.match(checkoutCoreSource, /trial_period_days: frozenTrialDays/);

console.log('salesStripeScheduleLinkHotfix20260901.regression.test.mjs: ok');
