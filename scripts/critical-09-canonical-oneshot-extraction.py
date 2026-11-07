#!/usr/bin/env python3
"""One-shot fail-closed canonical Stripe webhook extraction, scope: server.ts only."""
from pathlib import Path
import subprocess

SERVER = Path('server.ts')
MODULE = Path('services/stripeCanonicalWebhookRoute.ts')
GATE = Path('scripts/pre-main-gate.mjs')
OLD_SHA = 'a175a92d282429c6886e2e16468692d9c810b881'
START = '  // Stripe Webhook - MUST BE BEFORE express.json()\n'
END = '  app.use((req, res, next) => {\n'
IMPORT_ANCHOR = "import { createSalesAssistedStripeEventHandlers } from './services/salesAssistedStripeEventHandlers';\n"
IMPORT_NEW = "import { registerStripeCanonicalWebhookRoute } from './services/stripeCanonicalWebhookRoute';\n"
TEST_ANCHOR = "  'tests/salesAssistedStripeEventHandlers.test.ts',\n"
TEST_NEW = "  'tests/stripeCanonicalWebhookRoute.test.ts',\n"

def once(s, target):
    if s.count(target) != 1:
        raise RuntimeError('Missing/ambiguous immutable anchor: ' + target[:80])
    return s.index(target)

def fnv32(s):
    h = 2166136261
    for c in s:
        h = ((h ^ ord(c)) * 16777619) & 0xffffffff
    return f'{h:08x}'

src = SERVER.read_text(encoding='utf8')
sha = subprocess.check_output(['git', 'hash-object', 'server.ts'], text=True).strip()
if sha != OLD_SHA:
    raise RuntimeError('Staging server.ts blob changed; refuse blind patch')
a = once(src, START)
b = once(src, END)
if not a < b:
    raise RuntimeError('middleware order changed')
body = src[a:b]
if fnv32(body) != '1f85f092':
    raise RuntimeError('Stripe canonical handler content changed')
if body.count('"/api/stripe/webhook"') != 1 or not body.endswith('  );\n\n'):
    raise RuntimeError('Stripe route does not match audited boundary')
if MODULE.exists():
    raise RuntimeError('Module already exists')
once(src, IMPORT_ANCHOR)
once(src, '  registerLegacySalesActivationStripeWebhookRoute(app, {\n')

registration = """  // Stripe Webhook - MUST BE BEFORE express.json()
  registerStripeCanonicalWebhookRoute(app, {
    getStripe,
    reserveStripeWebhookEvent,
    processSalesAssistedStripeEvent,
    markStripeWebhookEventStatus,
    sanitizeString,
    sanitizeEmail,
    maskEmail,
    checkoutSessionUsesActivePatientPrice,
    ACTIVE_PATIENT_BILLING_MODEL,
    updateClinicSubscriptionStatus,
    resolveActivePatientPriceId,
    queueActivePatientSync,
    persistStripeCustomerReference,
    persistStripeSubscriptionReference,
    supabase,
    generateSupabaseActionLink,
    getActivationRedirectUrl,
    buildActivationEmailTemplate,
    sendTransactionalEmailSafe,
    OFFICIAL_FROM_CONTACT,
    OFFICIAL_TRANSACTIONAL_REPLY_TO,
    // Declared later in startServer: defer invocation until an event arrives.
    trackProfessionalSignupCheckoutCancellation: (params) =>
      trackProfessionalSignupCheckoutCancellation(params),
    isUuid,
    markClinicPaymentFailed,
    clearClinicPaymentFailure,
    normalizeSubscriptionStatusFromStripe,
    syncSalesSubscriptionDiscount,
    syncStripeBillingPlanSnapshots,
  });

"""

header = """import express, { type Express } from 'express';
import type Stripe from 'stripe';

type BillingStatus = 'active' | 'pending' | 'delinquent' | 'canceled';
type BillingIdentity = {
  clinicId?: string | null;
  userId?: string | null;
  email?: string | null;
};
type SubscriptionReference = BillingIdentity & {
  subscriptionId?: string | null;
  subscriptionItemId?: string | null;
  customerId?: string | null;
  priceId?: string | null;
  activePatientCount?: number | null;
  activePatientLimit?: number | null;
  billingSyncStatus?: string | null;
  billingSyncError?: string | null;
  status?: string | null;
};

export interface StripeCanonicalWebhookDeps {
  getStripe: () => Stripe;
  reserveStripeWebhookEvent: (event: Stripe.Event) => Promise<boolean>;
  processSalesAssistedStripeEvent: (
    stripe: Stripe, event: Stripe.Event,
  ) => Promise<{ handled: boolean; result?: Record<string, any> }>;
  markStripeWebhookEventStatus: (
    event: Stripe.Event, state: 'processed' | 'failed', errorCode?: string | null,
  ) => Promise<void>;
  sanitizeString: (value: unknown, maxLength?: number) => string;
  sanitizeEmail: (value: unknown) => string | null;
  maskEmail: (value: unknown) => string;
  checkoutSessionUsesActivePatientPrice: (stripe: Stripe, session: Stripe.Checkout.Session) => Promise<boolean>;
  ACTIVE_PATIENT_BILLING_MODEL: string;
  updateClinicSubscriptionStatus: (params: BillingIdentity & { status: BillingStatus }) => Promise<unknown>;
  resolveActivePatientPriceId: () => string;
  queueActivePatientSync: (clinicId: string | null | undefined, reason: string) => Promise<unknown>;
  persistStripeCustomerReference: (params: BillingIdentity & { customerId: string }) => Promise<unknown>;
  persistStripeSubscriptionReference: (params: SubscriptionReference) => Promise<unknown>;
  supabase: {
    from: (table: string) => any;
    auth: { admin: { getUserById: (id: string) => Promise<any> } };
  };
  generateSupabaseActionLink: (params: {
    type: 'signup' | 'recovery'; email: string; redirectTo: string;
  }) => Promise<string | null>;
  getActivationRedirectUrl: (role?: unknown, email?: unknown) => string;
  buildActivationEmailTemplate: (params: any) => { subject: string; html: string };
  sendTransactionalEmailSafe: (params: any) => Promise<boolean>;
  OFFICIAL_FROM_CONTACT: string;
  OFFICIAL_TRANSACTIONAL_REPLY_TO: string;
  trackProfessionalSignupCheckoutCancellation: (params: {
    userId?: string | null;
    email?: string | null;
    planName?: string | null;
    checkoutSessionId?: string | null;
    source?: string | null;
  }) => Promise<unknown>;
  isUuid: (value: string | null | undefined) => boolean;
  markClinicPaymentFailed: (params: BillingIdentity & { invoiceId?: string | null }) => Promise<unknown>;
  clearClinicPaymentFailure: (params: BillingIdentity) => Promise<unknown>;
  normalizeSubscriptionStatusFromStripe: (status: string) => BillingStatus;
  syncSalesSubscriptionDiscount: (subscription: Stripe.Subscription) => Promise<unknown>;
  syncStripeBillingPlanSnapshots: (reason?: string) => Promise<unknown>;
}

export function registerStripeCanonicalWebhookRoute(
  app: Express,
  deps: StripeCanonicalWebhookDeps,
): void {
  const {
    getStripe, reserveStripeWebhookEvent, processSalesAssistedStripeEvent,
    markStripeWebhookEventStatus, sanitizeString, sanitizeEmail, maskEmail,
    checkoutSessionUsesActivePatientPrice, ACTIVE_PATIENT_BILLING_MODEL,
    updateClinicSubscriptionStatus, resolveActivePatientPriceId,
    queueActivePatientSync, persistStripeCustomerReference,
    persistStripeSubscriptionReference, supabase, generateSupabaseActionLink,
    getActivationRedirectUrl, buildActivationEmailTemplate,
    sendTransactionalEmailSafe, OFFICIAL_FROM_CONTACT,
    OFFICIAL_TRANSACTIONAL_REPLY_TO, trackProfessionalSignupCheckoutCancellation,
    isUuid, markClinicPaymentFailed, clearClinicPaymentFailure,
    normalizeSubscriptionStatusFromStripe, syncSalesSubscriptionDiscount,
    syncStripeBillingPlanSnapshots,
  } = deps;

"""
updated = src[:a] + registration + src[b:]
updated = updated.replace(IMPORT_ANCHOR, IMPORT_ANCHOR + IMPORT_NEW, 1)
if updated.count('registerStripeCanonicalWebhookRoute(app, {') != 1:
    raise RuntimeError('Registration count mismatch')
if '  app.post(\n    "/api/stripe/webhook",' in updated:
    raise RuntimeError('Original webhook still registered')
if updated.count('registerLegacySalesActivationStripeWebhookRoute(app, {') != 1:
    raise RuntimeError('Legacy Stripe route count changed')
if not (updated.index('registerLegacySalesActivationStripeWebhookRoute(app, {')
        < updated.index('registerStripeCanonicalWebhookRoute(app, {')
        < updated.index('app.use(express.json({')):
    raise RuntimeError('Signature raw middleware order changed')
if updated.count('app.use(express.json({') != src.count('app.use(express.json({'):
    raise RuntimeError('Global parser changed')

gate = GATE.read_text(encoding='utf8')
once(gate, TEST_ANCHOR)
if TEST_NEW in gate:
    raise RuntimeError('Duplicate test gate')
updated_gate = gate.replace(TEST_ANCHOR, TEST_ANCHOR + TEST_NEW, 1)

net = len(src.splitlines()) - len(updated.splitlines())
if not (540 <= net <= 590):
    raise RuntimeError('Unexpected net server.ts reduction: ' + str(net))
MODULE.write_text(header + body + '}\n', encoding='utf8')
SERVER.write_text(updated, encoding='utf8')
GATE.write_text(updated_gate, encoding='utf8')
print('server.ts:', len(src.splitlines()) - 1, '->', len(updated.splitlines()) - 1, '; removed:', net)
print('Original webhook body FNV32:', fnv32(body))
