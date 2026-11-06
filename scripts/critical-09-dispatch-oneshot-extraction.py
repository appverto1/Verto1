#!/usr/bin/env python3
"""One-shot fail-closed extraction of existing sales-assisted Stripe handlers."""
from pathlib import Path
import subprocess

server = Path('server.ts')
target = Path('services/salesAssistedStripeEventHandlers.ts')
gate = Path('scripts/pre-main-gate.mjs')
anchor_start = '  const isSalesAssistedStripeEvent = async (\n'
anchor_end = '  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()\n'
import_anchor = "import { registerLegacySalesActivationStripeWebhookRoute } from './services/legacySalesActivationStripeWebhookRoute';\n"
import_new = "import { createSalesAssistedStripeEventHandlers } from './services/salesAssistedStripeEventHandlers';\n"
gate_anchor = "  'tests/legacySalesActivationStripeWebhookRoute.test.ts',\n"
gate_new = "  'tests/salesAssistedStripeEventHandlers.test.ts',\n"

original = server.read_text(encoding='utf8')
assert subprocess.check_output(['git', 'hash-object', 'server.ts'], text=True).strip() == '30b0cc691769c73aeb56230d0ae8947154e04fe2', 'source SHA mismatch'

def once(text, part):
    assert text.count(part) == 1, 'missing or ambiguous stable anchor'
    return text.index(part)

def fnv(text):
    h = 2166136261
    for ch in text:
        h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return f'{h:08x}'

start = once(original, anchor_start)
end = once(original, anchor_end)
assert start < end
body = original[start:end]
assert fnv(body) == '24e0e5ac', 'source event dispatcher differs from audit'
assert body.endswith('  };\n\n')
assert body.count('const isSalesAssistedStripeEvent = async') == 1
assert body.count('const processSalesAssistedStripeEvent = async') == 1
assert not target.exists()
once(original, import_anchor)

factory = """import type Stripe from 'stripe';
import type { StripeEnvironment } from './stripeEnvironment';

type EntitlementStatus = 'active' | 'trial' | 'grace' | 'suspended' | 'cancelled';
type EntitlementArgs = {
  offerId: string;
  organizationId: string;
  stripeSubscriptionId: string;
  stripeEventId: string;
  stripeEventCreatedAt: string;
  status: EntitlementStatus;
};

export interface SalesAssistedStripeEventDependencies {
  salesAssistedFlowType: (value: unknown) => boolean;
  stripeInvoiceSubscriptionId: (invoice: Stripe.Invoice) => string;
  reconcileSalesAssistedCheckout: (
    stripe: Stripe,
    session: Stripe.Checkout.Session,
    options?: { sendActivationEmail?: boolean },
  ) => Promise<any>;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  supabase: { from: (table: string) => any };
  isUuid: (value: string | null | undefined) => boolean;
  resolveStripeEnvironment: () => StripeEnvironment;
  validateStripeSecretForEnvironment: (environment: StripeEnvironment) => string;
  persistPlatformBillingInvoiceLedger: (params: {
    invoice: Stripe.Invoice;
    subscription?: Stripe.Subscription | null;
    organizationId?: string | null;
    offerId?: string | null;
    leadId?: string | null;
    eventId?: string | null;
    failed?: boolean;
  }) => Promise<unknown>;
  persistPlatformSubscriptionFinancialState: (params: {
    subscription: Stripe.Subscription;
    organizationId?: string | null;
    offerId?: string | null;
    leadId?: string | null;
    invoice?: Stripe.Invoice | null;
    paid?: boolean;
  }) => Promise<unknown>;
  syncSalesSubscriptionDiscount: (subscription: Stripe.Subscription) => Promise<unknown>;
  applyModularEntitlementsForOrganization: (params: EntitlementArgs) => Promise<unknown>;
  stripeSubscriptionToEntitlementStatus: (status: unknown) => EntitlementStatus;
}

export function createSalesAssistedStripeEventHandlers(
  deps: SalesAssistedStripeEventDependencies,
) {
  const {
    salesAssistedFlowType, stripeInvoiceSubscriptionId,
    reconcileSalesAssistedCheckout, sanitizeString, supabase, isUuid,
    resolveStripeEnvironment, validateStripeSecretForEnvironment,
    persistPlatformBillingInvoiceLedger, persistPlatformSubscriptionFinancialState,
    syncSalesSubscriptionDiscount, applyModularEntitlementsForOrganization,
    stripeSubscriptionToEntitlementStatus,
  } = deps;

"""
factory_end = """  return { isSalesAssistedStripeEvent, processSalesAssistedStripeEvent };
}
"""
registration = """  const {
    isSalesAssistedStripeEvent,
    processSalesAssistedStripeEvent,
  } = createSalesAssistedStripeEventHandlers({
    salesAssistedFlowType,
    stripeInvoiceSubscriptionId,
    reconcileSalesAssistedCheckout,
    sanitizeString,
    supabase,
    isUuid,
    resolveStripeEnvironment,
    validateStripeSecretForEnvironment,
    persistPlatformBillingInvoiceLedger,
    persistPlatformSubscriptionFinancialState,
    syncSalesSubscriptionDiscount,
    // These constants are declared later in startServer: preserve late binding.
    applyModularEntitlementsForOrganization: (params) =>
      applyModularEntitlementsForOrganization(params),
    stripeSubscriptionToEntitlementStatus: (status) =>
      stripeSubscriptionToEntitlementStatus(status),
  });

"""
updated = original[:start] + registration + original[end:]
updated = updated.replace(import_anchor, import_anchor + import_new, 1)
assert updated.count('"/api/stripe/webhook"') == original.count('"/api/stripe/webhook"')
assert updated.count('registerLegacySalesActivationStripeWebhookRoute(app, {') == 1
assert updated.count('createSalesAssistedStripeEventHandlers({') == 1
assert updated.count('app.use(express.json({') == original.count('app.use(express.json({')
assert updated.count('const processSalesAssistedStripeEvent = async') == 0
assert updated.index('createSalesAssistedStripeEventHandlers({') < updated.index('registerLegacySalesActivationStripeWebhookRoute(app, {')
assert updated.index('registerLegacySalesActivationStripeWebhookRoute(app, {') < updated.index('"/api/stripe/webhook"')

gate_old = gate.read_text(encoding='utf8')
once(gate_old, gate_anchor)
assert gate_new not in gate_old
gate_updated = gate_old.replace(gate_anchor, gate_anchor + gate_new, 1)

reduction = len(original.splitlines()) - len(updated.splitlines())
assert 295 <= reduction <= 330, 'unexpected net line count reduction'
target.write_text(factory + body + factory_end, encoding='utf8')
server.write_text(updated, encoding='utf8')
gate.write_text(gate_updated, encoding='utf8')
print(f'server.ts: {len(original.splitlines())} -> {len(updated.splitlines())}, -{reduction} lines')
print('original event handler block FNV32: ' + fnv(body))
