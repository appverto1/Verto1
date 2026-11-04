-- Task 09: keep settled checkout/converted CRM states monotonic when Stripe
-- delivers different verified events out of order (not just duplicate IDs).
-- No new queries, columns, indexes, privileges, API or Stripe calls.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_sales_converted_pending_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $lead_guard$
BEGIN
  IF OLD.status::text = 'converted' AND NEW.status::text = 'payment_pending' THEN
    -- A delayed unpaid checkout event cannot demote a converted lead.
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$lead_guard$;

DROP TRIGGER IF EXISTS guard_sales_converted_pending_v1 ON public.sales_leads;
CREATE TRIGGER guard_sales_converted_pending_v1
  BEFORE UPDATE OF status ON public.sales_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sales_converted_pending_v1();

CREATE OR REPLACE FUNCTION public.guard_sales_checkout_terminal_pending_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $link_guard$
BEGIN
  IF OLD.status IN ('completed', 'failed', 'expired')
     AND NEW.status = 'payment_pending' THEN
    -- Skip the entire stale write; retain status, payment timestamp, and other columns.
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$link_guard$;

DROP TRIGGER IF EXISTS guard_sales_checkout_terminal_pending_v1 ON public.sales_checkout_links;
CREATE TRIGGER guard_sales_checkout_terminal_pending_v1
  BEFORE UPDATE OF status ON public.sales_checkout_links
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sales_checkout_terminal_pending_v1();

COMMIT;
