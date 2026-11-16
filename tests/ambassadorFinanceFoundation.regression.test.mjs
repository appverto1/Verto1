import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync('supabase/migrations/20261110110000_ambassador_finance_foundation_v1.sql','utf8');
const routes = readFileSync('services/ambassadorFinanceRoutes.ts','utf8');
const hardening = readFileSync('supabase/migrations/20261110111000_ambassador_finance_hardening_v1.sql','utf8');
const bridge = readFileSync('services/salesProspectingRoutes.ts','utf8');
const checkout = readFileSync('services/salesAssistedCheckoutPaymentProcessor.ts','utf8');
const financial = readFileSync('services/salesSubscriptionFinancialReconciliation.ts','utf8');

test('ambassador finance remains a standalone module behind platform-admin MFA', () => {
  assert.match(bridge, /registerAmbassadorFinanceRoutes\(app,\{supabase,checkAuth,checkPlatformAdmin,isUuid\}\)/);
  assert.match(routes, /const guard = \[checkAuth, checkPlatformAdmin\]/);
  assert.match(routes, /ambassador_create_partner_v1/);
  assert.match(routes, /ambassador_assign_lead_v1/);
  assert.doesNotMatch(routes, /\/api\/patients|\/api\/clinic\//);
  assert.doesNotMatch(routes, /stripe\.transfers|transfers\.create|payouts\.create|paymentIntents\.create/);
});

test('private commission ledger cannot be read or written by ordinary authenticated clients', () => {
  for (const table of ['ambassador_partners','ambassador_referrals','ambassador_commission_entries']) {
    assert.match(sql,new RegExp('ALTER TABLE public\\.'+table+' ENABLE ROW LEVEL SECURITY'));
  }
  assert.match(sql,/REVOKE ALL ON public\.ambassador_partners, public\.ambassador_referrals, public\.ambassador_commission_entries\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.ambassador_create_partner_v1/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.ambassador_assign_lead_v1/);
  assert.match(sql,/WHERE user_id = p_actor AND active = true/g);
});

test('a lead can only have one immutable ambassador attribution before payment', () => {
  assert.match(sql,/sales_lead_id uuid NOT NULL UNIQUE REFERENCES public\.sales_leads/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/ON CONFLICT \(sales_lead_id\) DO NOTHING/);
  assert.match(sql,/AMBASSADOR_REFERRAL_ALREADY_ATTRIBUTED/);
  assert.match(sql,/AMBASSADOR_REFERRAL_INELIGIBLE/);
  assert.match(sql,/converted_clinic_id IS NOT NULL/);
  assert.match(sql,/payment_confirmed_at IS NOT NULL/);
});

test('invoices are the source of provisional expenses, not automatic payouts', () => {
  assert.match(sql,/payouts_enabled boolean NOT NULL DEFAULT false CHECK \(payouts_enabled = false\)/);
  assert.match(sql,/invoice_id uuid NOT NULL UNIQUE REFERENCES public\.platform_billing_invoice_ledger/);
  assert.match(sql,/CREATE TRIGGER ambassador_invoice_commission_v1/);
  assert.match(sql,/AFTER INSERT OR UPDATE OF status,amount_paid_cents,paid_at,period_start,period_end,sales_lead_id/);
  assert.match(sql,/NEW\.status <> 'paid'/);
  assert.match(sql,/NEW\.amount_paid_cents <= 0/);
  assert.match(sql,/NEW\.currency <> 'brl'/);
  assert.match(sql,/NEW\.stripe_subscription_id IS NULL/);
  assert.match(sql,/INTERVAL '12 months'/);
  assert.match(sql,/INTERVAL '30 days'/);
  assert.match(sql,/THEN 'needs_review' ELSE 'provisional'/);
  assert.match(sql,/ON CONFLICT\(invoice_id\) DO UPDATE/);
  assert.doesNotMatch(sql,/status\s*=\s*'paid_out'|execute.*payout/i);
});

test('commercial checkout and webhook continue owning payment persistence', () => {
  assert.match(checkout,/confirm_sales_assisted_checkout_payment/);
  assert.match(financial,/platform_billing_invoice_ledger/);
  assert.doesNotMatch(routes, /getStripe|checkout\.sessions|stripe\.transfers|Stripe Connect/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.ambassador_record_invoice_commission_v1/);
});

test('admin pagination and input validation limit query and write resource use', () => {
  assert.match(routes,/limit > 100/);
  assert.match(routes,/offset > 10000/);
  assert.match(routes,/\.range\(paging\.offset, paging\.offset \+ paging\.limit - 1\)/g);
  assert.match(routes,/\^\[A-Z0-9_-\]\{3,32\}\$/);
  assert.match(routes,/private, no-store/);
});


test('late invoice organization and subscription identity trigger a safe re-evaluation', () => {
  assert.match(hardening,/organization_id,stripe_subscription_id/);
  assert.match(hardening,/DROP TRIGGER IF EXISTS ambassador_invoice_commission_v1/);
  assert.match(hardening,/CREATE TRIGGER ambassador_invoice_commission_v1/);
  for (const index of ['ambassador_partners_linked_clinic_idx',
                       'ambassador_partners_created_by_idx',
                       'ambassador_referrals_attributed_by_idx']) {
    assert.ok(hardening.includes(index));
  }
  assert.match(sql,/NEW.organization_id IS NULL OR v_partner.linked_clinic_id = NEW.organization_id/);
});

const safety = readFileSync('supabase/migrations/20261111101500_ambassador_commission_safety_v1.sql','utf8');

test('canonical and finance attribution registries reject double-credit across concurrent requests', () => {
  assert.match(safety,/PERFORM 1 FROM public\.sales_leads[\s\S]*?FOR UPDATE/);
  assert.match(safety,/IF TG_TABLE_NAME = 'ambassador_referrals'/);
  assert.match(safety,/IF EXISTS \(SELECT 1 FROM public\.verto_partner_referrals/);
  assert.match(safety,/ELSIF TG_TABLE_NAME = 'verto_partner_referrals'/);
  assert.match(safety,/IF EXISTS \(SELECT 1 FROM public\.ambassador_referrals/);
  assert.match(safety,/BEFORE INSERT OR UPDATE OF sales_lead_id ON public\.ambassador_referrals/);
  assert.match(safety,/BEFORE INSERT OR UPDATE OF sales_lead_id ON public\.verto_partner_referrals/);
  assert.match(safety,/PARTNER_REFERRAL_ALREADY_ATTRIBUTED/);
});

test('invalid invoice status or payer correction reverses provisional commissions without payout', () => {
  assert.match(safety,/CREATE OR REPLACE FUNCTION public\.ambassador_reverse_invalid_invoice_v1/);
  assert.match(safety,/NEW\.status <> 'paid'/);
  assert.match(safety,/NEW\.amount_paid_cents <= 0/);
  assert.match(safety,/NEW\.currency <> 'brl'/);
  assert.match(safety,/NEW\.sales_lead_id IS DISTINCT FROM OLD\.sales_lead_id/);
  assert.match(safety,/NEW\.organization_id = p\.linked_clinic_id/);
  assert.match(safety,/INTERVAL '12 months'/);
  assert.match(safety,/status = 'reversed'/);
  assert.match(safety,/status IN \('provisional','needs_review'\)/);
  assert.doesNotMatch(safety,/payouts_enabled\s*=\s*true|stripe\.transfers/i);
});
