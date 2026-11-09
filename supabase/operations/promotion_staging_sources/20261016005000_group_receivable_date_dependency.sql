-- Canonical finance functions create unpaid forecasts with payment_date=NULL
-- and an optional expected method. Staging retained legacy NOT NULL columns,
-- which reject those functions before a GROUP reservation can commit.
-- Preserve every stored value/default and keep settled receipts constrained.
begin;
alter table public.payments alter column payment_date drop not null;
alter table public.payments alter column method drop not null;
alter table public.payments add constraint payments_settled_receipt_fields_required
check (
  (payment_date is not null and method is not null)
  or (
    coalesce(paid_amount,0)=0 and coalesce(refunded_amount,0)=0
    and lower(coalesce(status,'')) not in ('paid','pago','received','recebido','refunded','reembolsado')
  )
) not valid;
commit;
