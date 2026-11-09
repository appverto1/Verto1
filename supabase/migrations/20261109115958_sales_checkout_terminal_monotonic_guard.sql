-- Preserve terminal checkout state when Stripe delivers an older pending event.
-- The webhook's guarded lead update separately protects converted customers.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.guard_sales_checkout_terminal_pending_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.status in ('completed', 'failed', 'expired')
     and new.status = 'payment_pending' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_sales_checkout_terminal_pending_v1 on public.sales_checkout_links;
create trigger guard_sales_checkout_terminal_pending_v1
  before update of status on public.sales_checkout_links
  for each row execute function public.guard_sales_checkout_terminal_pending_v1();
commit;
