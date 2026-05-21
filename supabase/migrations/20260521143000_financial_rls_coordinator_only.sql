-- Tighten DRE/finance RLS: only coordinator of the clinic, admin or owner can read/write.

alter table public.payments enable row level security;
alter table public.professional_payments enable row level security;
alter table public.clinic_financial_entries enable row level security;

drop policy if exists payments_clinic_finance_read on public.payments;
create policy payments_clinic_finance_read
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = payments.clinic_id
            or u.id::text = payments.clinic_id
          )
        )
      )
  )
);

drop policy if exists payments_clinic_finance_write on public.payments;
create policy payments_clinic_finance_write
on public.payments
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = payments.clinic_id
            or u.id::text = payments.clinic_id
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = payments.clinic_id
            or u.id::text = payments.clinic_id
          )
        )
      )
  )
);

drop policy if exists professional_payments_clinic_finance_rw on public.professional_payments;
create policy professional_payments_clinic_finance_rw
on public.professional_payments
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = professional_payments.clinic_id
            or u.id::text = professional_payments.clinic_id
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = professional_payments.clinic_id
            or u.id::text = professional_payments.clinic_id
          )
        )
      )
  )
);

drop policy if exists clinic_financial_entries_clinic_finance_rw on public.clinic_financial_entries;
create policy clinic_financial_entries_clinic_finance_rw
on public.clinic_financial_entries
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = clinic_financial_entries.clinic_id
            or u.id::text = clinic_financial_entries.clinic_id
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (
          u.role = 'coordinator'
          and (
            u.clinic_id::text = clinic_financial_entries.clinic_id
            or u.id::text = clinic_financial_entries.clinic_id
          )
        )
      )
  )
);
