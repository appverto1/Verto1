-- Super Admin Financial Data Model for Supabase (Postgres)
-- Execute this script in Supabase SQL Editor with a privileged role.

create extension if not exists pgcrypto;

create schema if not exists finance;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'entry_status') then
    create type finance.entry_status as enum ('pending', 'paid', 'delinquent', 'refunded');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'cost_type') then
    create type finance.cost_type as enum ('fixed', 'variable');
  end if;
end $$;

create table if not exists finance.revenue_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users(id) on delete cascade,
  plan_name text not null,
  billed_on date not null default current_date,
  due_date date,
  paid_at timestamptz,
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  discounts numeric(14,2) not null default 0 check (discounts >= 0),
  taxes numeric(14,2) not null default 0 check (taxes >= 0),
  status finance.entry_status not null default 'pending',
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists finance.cost_entries (
  id uuid primary key default gen_random_uuid(),
  cost_type finance.cost_type not null,
  customer_id uuid references public.users(id) on delete set null,
  description text not null,
  occurred_on date not null default current_date,
  amount numeric(14,2) not null check (amount >= 0),
  is_operational boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_finance_revenue_customer_status
  on finance.revenue_entries (customer_id, status, billed_on);
create index if not exists idx_finance_revenue_plan
  on finance.revenue_entries (plan_name);
create index if not exists idx_finance_cost_customer_type
  on finance.cost_entries (customer_id, cost_type, occurred_on);

create or replace function finance.is_super_admin(target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user
      and u.role in ('owner', 'admin')
  );
$$;

grant execute on function finance.is_super_admin(uuid) to authenticated;

alter table finance.revenue_entries enable row level security;
alter table finance.cost_entries enable row level security;

drop policy if exists finance_revenue_super_admin_all on finance.revenue_entries;
create policy finance_revenue_super_admin_all
  on finance.revenue_entries
  for all
  to authenticated
  using (finance.is_super_admin())
  with check (finance.is_super_admin());

drop policy if exists finance_cost_super_admin_all on finance.cost_entries;
create policy finance_cost_super_admin_all
  on finance.cost_entries
  for all
  to authenticated
  using (finance.is_super_admin())
  with check (finance.is_super_admin());

create or replace view public.vw_owner_dre_monthly as
with months as (
  select date_trunc('month', (current_date - make_interval(months => gs.i))::timestamp)::date as period_month
  from generate_series(0, 11) as gs(i)
),
revenue as (
  select
    date_trunc('month', billed_on)::date as period_month,
    sum(gross_amount) as revenue_gross,
    sum(discounts + taxes) as deductions,
    sum(gross_amount - discounts - taxes) filter (where status in ('paid', 'pending')) as revenue_net,
    sum(gross_amount - discounts - taxes) filter (where status = 'delinquent') as delinquency_amount
  from finance.revenue_entries
  group by 1
),
costs as (
  select
    date_trunc('month', occurred_on)::date as period_month,
    sum(amount) filter (where cost_type = 'variable') as variable_costs,
    sum(amount) filter (where cost_type = 'fixed') as fixed_costs
  from finance.cost_entries
  group by 1
)
select
  m.period_month,
  coalesce(r.revenue_gross, 0) as revenue_gross,
  coalesce(r.deductions, 0) as deductions,
  coalesce(r.revenue_net, 0) as revenue_net,
  coalesce(c.variable_costs, 0) as variable_costs,
  coalesce(c.fixed_costs, 0) as fixed_costs,
  (coalesce(r.revenue_net, 0) - coalesce(c.variable_costs, 0)) as contribution_margin_value,
  case
    when coalesce(r.revenue_net, 0) = 0 then 0
    else round(((coalesce(r.revenue_net, 0) - coalesce(c.variable_costs, 0)) / coalesce(r.revenue_net, 1)) * 100, 2)
  end as contribution_margin_pct,
  (coalesce(r.revenue_net, 0) - coalesce(c.variable_costs, 0) - coalesce(c.fixed_costs, 0)) as ebitda,
  case
    when coalesce(r.revenue_net, 0) = 0 then 0
    else round(((coalesce(r.revenue_net, 0) - coalesce(c.variable_costs, 0) - coalesce(c.fixed_costs, 0)) / coalesce(r.revenue_net, 1)) * 100, 2)
  end as ebitda_pct,
  coalesce(r.delinquency_amount, 0) as delinquency_amount
from months m
left join revenue r on r.period_month = m.period_month
left join costs c on c.period_month = m.period_month
order by m.period_month;

create or replace view public.vw_owner_dre_summary as
select
  coalesce(sum(revenue_gross), 0) as revenue_gross,
  coalesce(sum(deductions), 0) as deductions,
  coalesce(sum(revenue_net), 0) as revenue_net,
  coalesce(sum(variable_costs), 0) as variable_costs,
  coalesce(sum(fixed_costs), 0) as fixed_costs,
  coalesce(sum(contribution_margin_value), 0) as contribution_margin_value,
  case
    when coalesce(sum(revenue_net), 0) = 0 then 0
    else round((coalesce(sum(contribution_margin_value), 0) / coalesce(sum(revenue_net), 1)) * 100, 2)
  end as contribution_margin_pct,
  coalesce(sum(ebitda), 0) as ebitda,
  case
    when coalesce(sum(revenue_net), 0) = 0 then 0
    else round((coalesce(sum(ebitda), 0) / coalesce(sum(revenue_net), 1)) * 100, 2)
  end as ebitda_pct,
  coalesce(sum(delinquency_amount), 0) as delinquency_amount
from public.vw_owner_dre_monthly;

create or replace view public.vw_owner_revenue_by_plan as
select
  plan_name,
  count(distinct customer_id) as customers,
  coalesce(sum(gross_amount - discounts - taxes), 0) as revenue_net
from finance.revenue_entries
where status in ('paid', 'pending')
group by plan_name
order by revenue_net desc;

create or replace view public.vw_owner_customer_profitability as
with customer_revenue as (
  select
    r.customer_id,
    max(u.name) as name,
    max(u.email) as email,
    max(u.subscription_status) as subscription_status,
    coalesce(sum(r.gross_amount - r.discounts - r.taxes) filter (where r.status in ('paid', 'pending')), 0) as revenue_net
  from finance.revenue_entries r
  join public.users u on u.id = r.customer_id
  group by r.customer_id
),
variable_costs as (
  select
    c.customer_id,
    coalesce(sum(c.amount), 0) as variable_cost
  from finance.cost_entries c
  where c.cost_type = 'variable' and c.customer_id is not null
  group by c.customer_id
),
fixed_total as (
  select coalesce(sum(amount), 0) as fixed_cost_pool
  from finance.cost_entries
  where cost_type = 'fixed'
),
revenue_total as (
  select coalesce(sum(revenue_net), 0) as total_revenue
  from customer_revenue
)
select
  cr.customer_id,
  cr.name,
  cr.email,
  cr.subscription_status,
  cr.revenue_net,
  coalesce(vc.variable_cost, 0) as variable_cost,
  case
    when rt.total_revenue = 0 then 0
    else round((cr.revenue_net / rt.total_revenue) * ft.fixed_cost_pool, 2)
  end as fixed_cost_allocated,
  (
    cr.revenue_net
    - coalesce(vc.variable_cost, 0)
    - case when rt.total_revenue = 0 then 0 else round((cr.revenue_net / rt.total_revenue) * ft.fixed_cost_pool, 2) end
  ) as profit,
  case
    when cr.revenue_net = 0 then 0
    else round((
      (
        cr.revenue_net
        - coalesce(vc.variable_cost, 0)
        - case when rt.total_revenue = 0 then 0 else round((cr.revenue_net / rt.total_revenue) * ft.fixed_cost_pool, 2) end
      ) / cr.revenue_net
    ) * 100, 2)
  end as margin_pct
from customer_revenue cr
left join variable_costs vc on vc.customer_id = cr.customer_id
cross join fixed_total ft
cross join revenue_total rt
order by profit asc;

create or replace view public.vw_owner_delinquent_customers as
select
  r.customer_id,
  max(u.name) as name,
  max(u.email) as email,
  coalesce(sum(r.gross_amount - r.discounts - r.taxes), 0) as delinquency_amount,
  count(*) as open_titles
from finance.revenue_entries r
join public.users u on u.id = r.customer_id
where r.status = 'delinquent'
group by r.customer_id
order by delinquency_amount desc;

grant select on public.vw_owner_dre_monthly to authenticated;
grant select on public.vw_owner_dre_summary to authenticated;
grant select on public.vw_owner_revenue_by_plan to authenticated;
grant select on public.vw_owner_customer_profitability to authenticated;
grant select on public.vw_owner_delinquent_customers to authenticated;
