BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Cover FK lookup paths used by account/clinic lifecycle operations.
CREATE INDEX IF NOT EXISTS ambassador_partners_linked_clinic_idx
  ON public.ambassador_partners(linked_clinic_id);
CREATE INDEX IF NOT EXISTS ambassador_partners_created_by_idx
  ON public.ambassador_partners(created_by);
CREATE INDEX IF NOT EXISTS ambassador_referrals_attributed_by_idx
  ON public.ambassador_referrals(attributed_by);

-- Stripe's ledger can acquire verified organization/subscription identity after
-- the initial invoice insert. Re-evaluate the SAME invoice, deduped by invoice_id,
-- rather than losing eligible cashback or trusting an unresolved payer identity.
DROP TRIGGER IF EXISTS ambassador_invoice_commission_v1
  ON public.platform_billing_invoice_ledger;
CREATE TRIGGER ambassador_invoice_commission_v1
AFTER INSERT OR UPDATE OF status,amount_paid_cents,paid_at,period_start,
  period_end,sales_lead_id,organization_id,stripe_subscription_id
ON public.platform_billing_invoice_ledger
FOR EACH ROW EXECUTE FUNCTION public.ambassador_record_invoice_commission_v1();

COMMIT;
