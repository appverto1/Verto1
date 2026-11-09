-- Task 09: the unpaid Stripe webhook now has an atomic server-side
-- .neq("status", "converted") filter. Remove the earlier transport-header
-- dependent trigger, which could interfere with legitimate owner CRM edits.
-- Checkout-link terminal-state protection remains unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER IF EXISTS guard_sales_converted_webhook_pending_v1 ON public.sales_leads;
DROP FUNCTION IF EXISTS public.guard_sales_converted_webhook_pending_v1();

COMMIT;
