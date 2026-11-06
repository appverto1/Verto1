-- Task 09: keep settled Checkout link states monotonic when Stripe
-- delivers different verified events out of order (not just duplicate IDs).
-- No new queries, columns, indexes, privileges, API or Stripe calls.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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


-- Existing authenticated owner PATCH calls .select(), sending PostgREST
-- Prefer: return=representation. The unpaid Stripe webhook uses the same
-- service-role client without .select(), so it uses return=minimal.
-- Restrict this guard to the current two verified backend request shapes.
-- Request headers are not authentication, payment confirmation or authorization.
CREATE OR REPLACE FUNCTION public.guard_sales_converted_webhook_pending_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $lead_guard$
DECLARE
  request_headers_text text;
  request_prefer text := '';
BEGIN
  IF OLD.status::text = 'converted'
     AND NEW.status::text = 'payment_pending'
     AND current_setting('request.method', true) = 'PATCH' THEN
    request_headers_text := nullif(current_setting('request.headers', true), '');
    IF request_headers_text IS NOT NULL THEN
      request_prefer := coalesce(request_headers_text::jsonb ->> 'prefer', '');
    END IF;
    -- Manual owner PATCH: .select() => return=representation => allow.
    -- Automatic unpaid webhook PATCH: no .select() => no representation => skip.
    IF position('return=representation' IN request_prefer) = 0 THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$lead_guard$;

DROP TRIGGER IF EXISTS guard_sales_converted_webhook_pending_v1 ON public.sales_leads;
CREATE TRIGGER guard_sales_converted_webhook_pending_v1
  BEFORE UPDATE OF status ON public.sales_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sales_converted_webhook_pending_v1();

COMMIT;
