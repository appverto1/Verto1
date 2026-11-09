-- Release gate: first-invoice payment rail is server-owned.
-- Additive, nullable and backcompatible with historic offers; no backfill or
-- status/role/clinic changes. Only the Stripe paid reconciliation may write it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.sales_offers
  ADD COLUMN IF NOT EXISTS settled_payment_method text;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sales_offers'::regclass
      AND conname = 'sales_offers_settled_payment_method_check'
  ) THEN
    ALTER TABLE public.sales_offers
      ADD CONSTRAINT sales_offers_settled_payment_method_check
      CHECK (
        settled_payment_method IS NULL
        OR settled_payment_method IN ('card', 'boleto')
      ) NOT VALID;
  END IF;
END
$guard$;

ALTER TABLE public.sales_offers
  VALIDATE CONSTRAINT sales_offers_settled_payment_method_check;

COMMIT;
