#!/usr/bin/env python3
"""Extract only the audited legacy Stripe webhook from server.ts; fail closed."""
from pathlib import Path
import subprocess

server_file = Path("server.ts")
module_file = Path("services/legacySalesActivationStripeWebhookRoute.ts")
gate_file = Path("scripts/pre-main-gate.mjs")
marker = "  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()\n"
next_marker = "  // Stripe Webhook - MUST BE BEFORE express.json()\n"
import_anchor = "import { registerPublicSalesPaymentStatusRoute } from './services/publicSalesPaymentStatusRoute';\n"
added_import = "import { registerLegacySalesActivationStripeWebhookRoute } from './services/legacySalesActivationStripeWebhookRoute';\n"
test_anchor = "  'tests/salesStripeWebhookDbMonotonicGuard.regression.test.mjs',\n"
test_added = "  'tests/legacySalesActivationStripeWebhookRoute.test.ts',\n"
expected_blob = "536c6d9ee0673a16ff5b899c01f05ce745b02e7f"


def find_once(source, value):
    assert source.count(value) == 1, "ambiguous or missing source anchor"
    return source.index(value)


def fnv32(source):
    value = 2166136261
    for char in source:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return f"{value:08x}"


source = server_file.read_text(encoding="utf-8")
assert subprocess.check_output(["git", "hash-object", "server.ts"], text=True).strip() == expected_blob
a = find_once(source, marker)
b = find_once(source, next_marker)
assert a < b
old_block = source[a:b]
assert fnv32(old_block) == "a5fcfd4b", "audited route has changed"
assert old_block.count('"/api/webhook/stripe"') == 1
assert old_block.endswith("  );\n\n")
find_once(source, import_anchor)
assert not module_file.exists()

registration = """  // Stripe Payment Link activation webhook - MUST BE BEFORE express.json()
  registerLegacySalesActivationStripeWebhookRoute(app, {
    getStripe,
    getResend,
    supabase,
    sanitizeString,
    sanitizeEmail,
    maskEmail,
    OFFICIAL_FROM_NOREPLY,
    buildPostPaymentActivationEmail,
    isSalesAssistedStripeEvent,
    reserveStripeWebhookEvent,
    processSalesAssistedStripeEvent,
    markStripeWebhookEventStatus,
  });

"""
header = """import crypto from 'crypto';
import express, { type Express } from 'express';
import type Stripe from 'stripe';
import type { Resend } from 'resend';

interface LegacySalesActivationStripeWebhookDeps {
  getStripe: () => Stripe;
  getResend: () => Resend;
  supabase: { from: (table: string) => any };
  sanitizeString: (value: unknown, max?: number) => string;
  sanitizeEmail: (value: unknown) => string | null;
  maskEmail: (value: unknown) => string;
  OFFICIAL_FROM_NOREPLY: string;
  buildPostPaymentActivationEmail: (token: string) => string;
  isSalesAssistedStripeEvent: (stripe: Stripe, event: Stripe.Event) => Promise<boolean>;
  reserveStripeWebhookEvent: (event: Stripe.Event) => Promise<boolean>;
  processSalesAssistedStripeEvent: (stripe: Stripe, event: Stripe.Event) => Promise<{
    handled: boolean;
    result?: Record<string, any>;
  }>;
  markStripeWebhookEventStatus: (event: Stripe.Event, status: 'processed' | 'failed', error?: string | null) => Promise<void>;
}

export function registerLegacySalesActivationStripeWebhookRoute(
  app: Express,
  deps: LegacySalesActivationStripeWebhookDeps,
): void {
  const {
    getStripe, getResend, supabase, sanitizeString, sanitizeEmail, maskEmail,
    OFFICIAL_FROM_NOREPLY, buildPostPaymentActivationEmail,
    isSalesAssistedStripeEvent, reserveStripeWebhookEvent,
    processSalesAssistedStripeEvent, markStripeWebhookEventStatus,
  } = deps;

"""
module = header + old_block + "}\n"
updated = source[:a] + registration + source[b:]
updated = updated.replace(import_anchor, import_anchor + added_import, 1)
assert updated.count('"/api/stripe/webhook"') == source.count('"/api/stripe/webhook"')
assert updated.count("app.use(express.json({") == source.count("app.use(express.json({")
assert '  app.post(\n    "/api/webhook/stripe",' not in updated
assert updated.count("registerLegacySalesActivationStripeWebhookRoute(app, {") == 1
gate = gate_file.read_text(encoding="utf-8")
find_once(gate, test_anchor)
assert test_added not in gate
gate_new = gate.replace(test_anchor, test_anchor + test_added, 1)
old_count = len(source.splitlines())
new_count = len(updated.splitlines())
assert 95 <= old_count - new_count <= 140
module_file.write_text(module, encoding="utf-8")
server_file.write_text(updated, encoding="utf-8")
gate_file.write_text(gate_new, encoding="utf-8")
print(f"server.ts lines {old_count} -> {new_count}, delta {new_count - old_count}")
print("route source parity:", fnv32(old_block))
