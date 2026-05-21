-- Clinic DRE financial foundation.
-- Keeps operational clinic finance separate from platform/owner finance.

create extension if not exists pgcrypto;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  patient_id text not null,
  patient_name text,
  amount numeric(14,2) not null check (amount >= 0),
  payment_date date,
  due_date date,
  method text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'canceled', 'refunded', 'delinquent')),
  receipt_url text,
  receipt_file_name text,
  receipt_content_type text,
  type text,
  insurance_name text,
  specialty text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments add column if not exists clinic_id text;
alter table public.payments add column if not exists patient_id text;
alter table public.payments add column if not exists patient_name text;
alter table public.payments add column if not exists amount numeric(14,2);
alter table public.payments add column if not exists payment_date date;
alter table public.payments add column if not exists due_date date;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists status text default 'pending';
alter table public.payments add column if not exists receipt_url text;
alter table public.payments add column if not exists receipt_file_name text;
alter table public.payments add column if not exists receipt_content_type text;
alter table public.payments add column if not exists type text;
alter table public.payments add column if not exists insurance_name text;
alter table public.payments add column if not exists specialty text;
alter table public.payments add column if not exists notes text;
alter table public.payments add column if not exists created_by text;
alter table public.payments add column if not exists created_at timestamptz default now();
alter table public.payments add column if not exists updated_at timestamptz default now();

create table if not exists public.professional_payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  professional_id text,
  professional_name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  due_date date not null default current_date,
  payment_date date,
  method text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'canceled', 'refunded', 'delinquent')),
  receipt_url text,
  receipt_file_name text,
  receipt_content_type text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clinic_financial_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  entry_type text not null default 'expense' check (entry_type in ('income', 'expense')),
  category text not null default 'operacional',
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  occurred_on date not null default current_date,
  status text not null default 'paid' check (status in ('pending', 'paid', 'canceled')),
  source text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_clinic_month
  on public.payments (clinic_id, payment_date, due_date, status);
create index if not exists idx_payments_patient
  on public.payments (patient_id, clinic_id);
create index if not exists idx_professional_payments_clinic_month
  on public.professional_payments (clinic_id, due_date, payment_date, status);
create index if not exists idx_clinic_financial_entries_clinic_month
  on public.clinic_financial_entries (clinic_id, occurred_on, entry_type, status);

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
        or u.clinic_id::text = payments.clinic_id
        or u.id::text = payments.clinic_id
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
        or u.clinic_id::text = payments.clinic_id
        or u.id::text = payments.clinic_id
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
        or u.clinic_id::text = payments.clinic_id
        or u.id::text = payments.clinic_id
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
        or u.clinic_id::text = professional_payments.clinic_id
        or u.id::text = professional_payments.clinic_id
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
        or u.clinic_id::text = professional_payments.clinic_id
        or u.id::text = professional_payments.clinic_id
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
        or u.clinic_id::text = clinic_financial_entries.clinic_id
        or u.id::text = clinic_financial_entries.clinic_id
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
        or u.clinic_id::text = clinic_financial_entries.clinic_id
        or u.id::text = clinic_financial_entries.clinic_id
      )
  )
);
