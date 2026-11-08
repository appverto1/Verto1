-- Permit an immediate first-access choice only to the same browser that
-- intentionally opened a paid card Checkout. No client authority by session_id.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.sales_offers
  add column if not exists settled_payment_method text;
do $guard$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sales_offers'::regclass
      and conname = 'sales_offers_settled_payment_method_check'
  ) then
    alter table public.sales_offers
      add constraint sales_offers_settled_payment_method_check
      check (settled_payment_method is null or settled_payment_method in ('card', 'boleto'));
  end if;
end
$guard$;

create table if not exists public.sales_card_checkout_handoffs (
  checkout_session_id text primary key,
  offer_id uuid not null references public.sales_offers(id) on delete restrict,
  proof_hash text not null check (proof_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.sales_card_checkout_handoffs enable row level security;
revoke all on public.sales_card_checkout_handoffs from public, anon, authenticated;
grant select, insert on public.sales_card_checkout_handoffs to service_role;
comment on table public.sales_card_checkout_handoffs is
 'One secure first-browser proof per Checkout session; browser cookie holds random secret, only SHA256 is persisted. Card paid only.';

commit;
