do $$
begin
  if to_regclass('public.payments') is not null then
    alter table public.payments
      add column if not exists base_amount numeric,
      add column if not exists additional_amount numeric,
      add column if not exists additional_scope text,
      add column if not exists is_recurring boolean default false,
      add column if not exists recurrence_group_id text,
      add column if not exists recurrence_index integer,
      add column if not exists recurrence_total integer,
      add column if not exists recurrence_frequency text;

    create index if not exists idx_payments_recurrence_group
      on public.payments (recurrence_group_id, due_date)
      where recurrence_group_id is not null;

    create index if not exists idx_payments_due_status
      on public.payments (status, due_date)
      where due_date is not null;
  end if;

  if to_regclass('public.professional_payments') is not null then
    alter table public.professional_payments
      add column if not exists base_amount numeric,
      add column if not exists additional_amount numeric,
      add column if not exists additional_scope text,
      add column if not exists is_recurring boolean default false,
      add column if not exists recurrence_group_id text,
      add column if not exists recurrence_index integer,
      add column if not exists recurrence_total integer,
      add column if not exists recurrence_frequency text;

    create index if not exists idx_professional_payments_recurrence_group
      on public.professional_payments (recurrence_group_id, due_date)
      where recurrence_group_id is not null;

    create index if not exists idx_professional_payments_due_status
      on public.professional_payments (status, due_date)
      where due_date is not null;
  end if;
end $$;
