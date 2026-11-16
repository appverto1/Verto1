BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Verto Ambassador Program: additive financial foundation, independent of
-- clinical records, checkout, customer invoices and cash disbursements.
CREATE TABLE IF NOT EXISTS public.ambassador_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 180),
  contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254 AND contact_email = lower(contact_email)),
  kind text NOT NULL CHECK (kind IN ('person','company')),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  linked_clinic_id uuid NULL REFERENCES public.clinics(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  commission_percent smallint NOT NULL DEFAULT 10 CHECK (commission_percent = 10),
  duration_months smallint NOT NULL DEFAULT 12 CHECK (duration_months = 12),
  payouts_enabled boolean NOT NULL DEFAULT false CHECK (payouts_enabled = false),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ambassador_partners_email_key
  ON public.ambassador_partners (contact_email);

CREATE TABLE IF NOT EXISTS public.ambassador_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.ambassador_partners(id) ON DELETE RESTRICT,
  sales_lead_id uuid NOT NULL UNIQUE REFERENCES public.sales_leads(id) ON DELETE RESTRICT,
  attributed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  program_started_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ambassador_referrals_partner_idx
  ON public.ambassador_referrals(partner_id,attributed_at DESC);

CREATE TABLE IF NOT EXISTS public.ambassador_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.ambassador_referrals(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.platform_billing_invoice_ledger(id) ON DELETE RESTRICT,
  source_amount_cents integer NOT NULL CHECK (source_amount_cents > 0),
  commission_cents integer NOT NULL CHECK (commission_cents > 0),
  status text NOT NULL CHECK (status IN ('provisional','needs_review','reversed')),
  paid_invoice_at timestamptz NOT NULL,
  available_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ambassador_commissions_referral_idx
  ON public.ambassador_commission_entries(referral_id,created_at DESC);

-- The Data API must not expose this commercial/financial information.
ALTER TABLE public.ambassador_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ambassador_commission_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ambassador_partners, public.ambassador_referrals, public.ambassador_commission_entries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ambassador_partners TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ambassador_referrals TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ambassador_commission_entries TO service_role;

-- Double-check the caller's Super Admin authority inside each write transaction.
-- All functions are restricted to the server-side service role.
CREATE OR REPLACE FUNCTION public.ambassador_create_partner_v1(
  p_actor uuid, p_name text, p_email text, p_kind text,
  p_code text, p_linked_clinic_id uuid DEFAULT null
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_row public.ambassador_partners%rowtype;
  v_email text := lower(trim(coalesce(p_email,'')));
  v_code text := upper(trim(coalesce(p_code,'')));
  v_name text := trim(coalesce(p_name,''));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins
      WHERE user_id = p_actor AND active = true) THEN
    RAISE EXCEPTION 'AMBASSADOR_ADMIN_REQUIRED';
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 180
     OR char_length(v_email) NOT BETWEEN 3 AND 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR v_code !~ '^[A-Z0-9_-]{3,32}$'
     OR p_kind NOT IN ('person','company') THEN
    RAISE EXCEPTION 'AMBASSADOR_INVALID_PARTNER';
  END IF;
  IF p_linked_clinic_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clinics WHERE id = p_linked_clinic_id
  ) THEN
    RAISE EXCEPTION 'AMBASSADOR_CLINIC_NOT_FOUND';
  END IF;
  INSERT INTO public.ambassador_partners
    (display_name,contact_email,kind,code,linked_clinic_id,created_by)
  VALUES (v_name,v_email,p_kind,v_code,p_linked_clinic_id,p_actor)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id',v_row.id,'name',v_row.display_name,
    'code',v_row.code,'kind',v_row.kind,'status',v_row.status,
    'cashback',v_row.linked_clinic_id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.ambassador_assign_lead_v1(
  p_actor uuid, p_lead_id uuid, p_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_lead public.sales_leads%rowtype;
  v_partner public.ambassador_partners%rowtype;
  v_referral public.ambassador_referrals%rowtype;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins
      WHERE user_id = p_actor AND active = true) THEN
    RAISE EXCEPTION 'AMBASSADOR_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_partner FROM public.ambassador_partners
  WHERE code = upper(trim(coalesce(p_code,''))) AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'AMBASSADOR_CODE_UNAVAILABLE'; END IF;

  -- Serialize competing assignments and conversions for this lead.
  SELECT * INTO v_lead FROM public.sales_leads
  WHERE id=p_lead_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMBASSADOR_LEAD_NOT_FOUND'; END IF;
  IF v_lead.converted_clinic_id IS NOT NULL
     OR v_lead.converted_user_id IS NOT NULL
     OR v_lead.status::text = 'converted'
     OR EXISTS (SELECT 1 FROM public.sales_offers o
       WHERE o.lead_id=p_lead_id AND o.payment_confirmed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.platform_billing_invoice_ledger i
       WHERE i.sales_lead_id=p_lead_id AND i.status='paid' AND i.amount_paid_cents > 0)
     OR lower(coalesce(v_lead.normalized_email,v_lead.email,'')) = v_partner.contact_email
  THEN RAISE EXCEPTION 'AMBASSADOR_REFERRAL_INELIGIBLE'; END IF;

  INSERT INTO public.ambassador_referrals(partner_id,sales_lead_id,attributed_by)
  VALUES(v_partner.id,p_lead_id,p_actor)
  ON CONFLICT (sales_lead_id) DO NOTHING;
  SELECT * INTO v_referral FROM public.ambassador_referrals
  WHERE sales_lead_id=p_lead_id;
  IF v_referral.partner_id <> v_partner.id THEN
    RAISE EXCEPTION 'AMBASSADOR_REFERRAL_ALREADY_ATTRIBUTED';
  END IF;
  RETURN jsonb_build_object('id',v_referral.id,'partnerId',v_referral.partner_id,
    'leadId',v_referral.sales_lead_id,'attributedAt',v_referral.attributed_at);
END $$;

-- The Stripe billing ledger is already the single persisted payment authority.
-- This trigger only derives a provisional expense: it never transfers money.
CREATE OR REPLACE FUNCTION public.ambassador_record_invoice_commission_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_referral public.ambassador_referrals%rowtype;
  v_partner public.ambassador_partners%rowtype;
  v_amount integer;
  v_state text;
BEGIN
  IF NEW.sales_lead_id IS NULL OR NEW.status <> 'paid'
     OR NEW.paid_at IS NULL OR NEW.amount_paid_cents <= 0
     OR NEW.stripe_subscription_id IS NULL OR NEW.currency <> 'brl' THEN
    -- Invoice reversals are NOT automatically marked paid: all disbursements
    -- remain disabled until manual refund/chargeback reconciliation exists.
    RETURN NEW;
  END IF;
  SELECT r.* INTO v_referral FROM public.ambassador_referrals r
  WHERE r.sales_lead_id=NEW.sales_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO v_partner FROM public.ambassador_partners
  WHERE id=v_referral.partner_id;
  IF v_partner.status <> 'active'
     OR (v_partner.linked_clinic_id IS NOT NULL
         AND (NEW.organization_id IS NULL OR v_partner.linked_clinic_id = NEW.organization_id)) THEN
    RETURN NEW;
  END IF;

  IF v_referral.program_started_at IS NULL THEN
    UPDATE public.ambassador_referrals
      SET program_started_at=NEW.paid_at
    WHERE id=v_referral.id
    RETURNING * INTO v_referral;
  END IF;
  IF NEW.paid_at < v_referral.program_started_at
     OR NEW.paid_at >= v_referral.program_started_at + INTERVAL '12 months' THEN
    RETURN NEW;
  END IF;
  v_amount := round(NEW.amount_paid_cents::numeric * 0.10)::integer;
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  -- Annual/prepaid or unknown invoice periods require financial review:
  -- never treat the entire advance payment as monthly commission earned.
  v_state := CASE
    WHEN NEW.period_start IS NULL OR NEW.period_end IS NULL
       OR NEW.period_end <= NEW.period_start
       OR NEW.period_end > NEW.period_start + INTERVAL '40 days'
    THEN 'needs_review' ELSE 'provisional' END;

  INSERT INTO public.ambassador_commission_entries
    (referral_id,invoice_id,source_amount_cents,commission_cents,
     status,paid_invoice_at,available_after)
  VALUES(v_referral.id,NEW.id,NEW.amount_paid_cents,v_amount,v_state,
    NEW.paid_at,NEW.paid_at + INTERVAL '30 days')
  ON CONFLICT(invoice_id) DO UPDATE
    SET source_amount_cents=EXCLUDED.source_amount_cents,
        commission_cents=EXCLUDED.commission_cents,
        status=EXCLUDED.status,
        updated_at=now()
    WHERE ambassador_commission_entries.status IN ('provisional','needs_review')
      AND ambassador_commission_entries.referral_id=EXCLUDED.referral_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ambassador_invoice_commission_v1
  ON public.platform_billing_invoice_ledger;
CREATE TRIGGER ambassador_invoice_commission_v1
AFTER INSERT OR UPDATE OF status,amount_paid_cents,paid_at,period_start,period_end,sales_lead_id
ON public.platform_billing_invoice_ledger
FOR EACH ROW EXECUTE FUNCTION public.ambassador_record_invoice_commission_v1();

REVOKE ALL ON FUNCTION public.ambassador_create_partner_v1(uuid,text,text,text,text,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ambassador_assign_lead_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ambassador_record_invoice_commission_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ambassador_create_partner_v1(uuid,text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ambassador_assign_lead_v1(uuid,uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
