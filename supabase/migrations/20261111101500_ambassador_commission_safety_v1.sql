BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Two partner registries exist while the financial module is being integrated.
-- An individual lead MUST NOT be attributed to both, even under concurrency.
CREATE OR REPLACE FUNCTION public.verto_partner_exclusive_referral_registry_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sales_lead_id IS NOT DISTINCT FROM OLD.sales_lead_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Both attribution paths serialize on the same sales lead before checking.
  PERFORM 1 FROM public.sales_leads
    WHERE id = NEW.sales_lead_id FOR UPDATE;

  IF TG_TABLE_NAME = 'ambassador_referrals' THEN
    IF EXISTS (SELECT 1 FROM public.verto_partner_referrals
               WHERE sales_lead_id = NEW.sales_lead_id) THEN
      RAISE EXCEPTION 'PARTNER_REFERRAL_ALREADY_ATTRIBUTED';
    END IF;
  ELSIF TG_TABLE_NAME = 'verto_partner_referrals' THEN
    IF EXISTS (SELECT 1 FROM public.ambassador_referrals
               WHERE sales_lead_id = NEW.sales_lead_id) THEN
      RAISE EXCEPTION 'PARTNER_REFERRAL_ALREADY_ATTRIBUTED';
    END IF;
  ELSE
    RAISE EXCEPTION 'PARTNER_REFERRAL_INVALID_TABLE';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ambassador_exclusive_referral_registry_v1 ON public.ambassador_referrals;
CREATE TRIGGER ambassador_exclusive_referral_registry_v1
BEFORE INSERT OR UPDATE OF sales_lead_id ON public.ambassador_referrals
FOR EACH ROW EXECUTE FUNCTION public.verto_partner_exclusive_referral_registry_v1();

DROP TRIGGER IF EXISTS verto_exclusive_referral_registry_v1 ON public.verto_partner_referrals;
CREATE TRIGGER verto_exclusive_referral_registry_v1
BEFORE INSERT OR UPDATE OF sales_lead_id ON public.verto_partner_referrals
FOR EACH ROW EXECUTE FUNCTION public.verto_partner_exclusive_referral_registry_v1();

-- A paid invoice that is later invalidated may not retain a provisional
-- commission. Stripe refunds / disputes not reflected in invoice status still
-- require separate reconciliation before any payouts are enabled.
CREATE OR REPLACE FUNCTION public.ambassador_reverse_invalid_invoice_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status <> 'paid' OR NEW.amount_paid_cents <= 0
     OR NEW.paid_at IS NULL OR NEW.stripe_subscription_id IS NULL
     OR NEW.sales_lead_id IS NULL OR NEW.currency <> 'brl'
     OR NEW.sales_lead_id IS DISTINCT FROM OLD.sales_lead_id THEN
    UPDATE public.ambassador_commission_entries
      SET status = 'reversed', updated_at = now()
      WHERE invoice_id = NEW.id AND status IN ('provisional','needs_review');
    RETURN NEW;
  END IF;

  -- Late payer identity correction and paid-at corrections also invalidate
  -- self-referrals or payments outside the commission eligibility window.
  UPDATE public.ambassador_commission_entries c
    SET status = 'reversed', updated_at = now()
    FROM public.ambassador_referrals r
    JOIN public.ambassador_partners p ON p.id = r.partner_id
    WHERE c.invoice_id = NEW.id AND c.referral_id = r.id
      AND c.status IN ('provisional','needs_review')
      AND (
        (p.linked_clinic_id IS NOT NULL AND
          (NEW.organization_id IS NULL OR NEW.organization_id = p.linked_clinic_id))
        OR r.sales_lead_id IS DISTINCT FROM NEW.sales_lead_id
        OR r.program_started_at IS NULL
        OR NEW.paid_at < r.program_started_at
        OR NEW.paid_at >= r.program_started_at + INTERVAL '12 months'
      );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ambassador_invoice_invalidation_v1
  ON public.platform_billing_invoice_ledger;
CREATE TRIGGER ambassador_invoice_invalidation_v1
AFTER UPDATE OF status,amount_paid_cents,paid_at,stripe_subscription_id,
  sales_lead_id,currency,organization_id
ON public.platform_billing_invoice_ledger
FOR EACH ROW EXECUTE FUNCTION public.ambassador_reverse_invalid_invoice_v1();

REVOKE ALL ON FUNCTION public.verto_partner_exclusive_referral_registry_v1()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ambassador_reverse_invalid_invoice_v1()
  FROM PUBLIC, anon, authenticated;

COMMIT;
