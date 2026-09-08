-- Gestão operacional de despesas da clínica.
-- Reutiliza clinic_recurring_costs como regra/template e clinic_financial_entries como ocorrência financeira canônica.
-- Não materializa horizonte infinito: competências recorrentes são criadas sob demanda por mês, de forma idempotente.

create extension if not exists pgcrypto;

alter table public.clinic_recurring_costs
  add column if not exists logical_id uuid,
  add column if not exists version integer not null default 1,
  add column if not exists category text not null default 'operacional',
  add column if not exists due_day smallint,
  add column if not exists ends_on date,
  add column if not exists notes text,
  add column if not exists specialty text,
  add column if not exists replaces_cost_id uuid references public.clinic_recurring_costs(id) on delete restrict,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by text,
  add column if not exists updated_by text;

update public.clinic_recurring_costs
set logical_id = id
where logical_id is null;

update public.clinic_recurring_costs
set due_day = extract(day from starts_on)::smallint
where recurrence = 'monthly'
  and due_day is null;

alter table public.clinic_recurring_costs
  alter column logical_id set default gen_random_uuid(),
  alter column logical_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_recurring_costs_version_positive'
      and conrelid = 'public.clinic_recurring_costs'::regclass
  ) then
    alter table public.clinic_recurring_costs
      add constraint clinic_recurring_costs_version_positive check (version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_recurring_costs_due_day_valid'
      and conrelid = 'public.clinic_recurring_costs'::regclass
  ) then
    alter table public.clinic_recurring_costs
      add constraint clinic_recurring_costs_due_day_valid
      check (due_day is null or due_day between 1 and 31);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_recurring_costs_period_valid'
      and conrelid = 'public.clinic_recurring_costs'::regclass
  ) then
    alter table public.clinic_recurring_costs
      add constraint clinic_recurring_costs_period_valid
      check (ends_on is null or ends_on >= starts_on);
  end if;
end $$;

create unique index if not exists uq_clinic_recurring_costs_logical_version
  on public.clinic_recurring_costs (clinic_id, logical_id, version);

create index if not exists idx_clinic_recurring_costs_period
  on public.clinic_recurring_costs (clinic_id, starts_on, ends_on, logical_id, version);

alter table public.clinic_financial_entries
  add column if not exists expected_amount numeric(14,2),
  add column if not exists due_date date,
  add column if not exists paid_on date,
  add column if not exists competence_month date,
  add column if not exists recurring_cost_id uuid references public.clinic_recurring_costs(id) on delete restrict,
  add column if not exists recurring_cost_logical_id uuid,
  add column if not exists recurrence_occurrence_key text,
  add column if not exists specialty text,
  add column if not exists updated_by text;

update public.clinic_financial_entries
set expected_amount = amount
where entry_type = 'expense'
  and expected_amount is null;

update public.clinic_financial_entries
set competence_month = date_trunc('month', occurred_on)::date
where entry_type = 'expense'
  and competence_month is null;

update public.clinic_financial_entries
set paid_on = occurred_on
where entry_type = 'expense'
  and status = 'paid'
  and paid_on is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinic_financial_entries_expected_amount_valid'
      and conrelid = 'public.clinic_financial_entries'::regclass
  ) then
    alter table public.clinic_financial_entries
      add constraint clinic_financial_entries_expected_amount_valid
      check (expected_amount is null or (expected_amount >= 0 and expected_amount <= 10000000));
  end if;
end $$;

update public.clinic_financial_entries e
set recurring_cost_logical_id = r.logical_id
from public.clinic_recurring_costs r
where e.recurring_cost_id = r.id
  and e.entry_type = 'expense'
  and e.recurring_cost_logical_id is null;

create unique index if not exists uq_clinic_expense_recurring_occurrence
  on public.clinic_financial_entries (clinic_id, recurring_cost_logical_id, recurrence_occurrence_key)
  where recurring_cost_logical_id is not null and recurrence_occurrence_key is not null;

create index if not exists idx_clinic_financial_entries_expense_competence
  on public.clinic_financial_entries (clinic_id, competence_month, status, due_date)
  where entry_type = 'expense';

create index if not exists idx_clinic_financial_entries_expense_cash
  on public.clinic_financial_entries (clinic_id, paid_on, status)
  where entry_type = 'expense';

-- Defesa em profundidade: regras recorrentes são mutadas exclusivamente pelo backend.
-- Não há caller browser direto; owner/admin/coordinator continuam operando via API,
-- protegidos por finance.entries.manage e pelas RPCs service_role abaixo.
alter table public.clinic_recurring_costs enable row level security;

drop policy if exists clinic_recurring_costs_select on public.clinic_recurring_costs;
drop policy if exists clinic_recurring_costs_insert on public.clinic_recurring_costs;
drop policy if exists clinic_recurring_costs_clinic_finance_rw on public.clinic_recurring_costs;

revoke all on table public.clinic_recurring_costs from public, anon, authenticated;
grant all on table public.clinic_recurring_costs to service_role;

-- Ocorrências financeiras também são mutadas exclusivamente pelo backend.
-- O browser não possui caller direto legítimo; toda leitura/escrita operacional passa pela API.
alter table public.clinic_financial_entries enable row level security;
drop policy if exists clinic_financial_entries_clinic_finance_rw on public.clinic_financial_entries;
revoke all on table public.clinic_financial_entries from public, anon, authenticated;
grant all on table public.clinic_financial_entries to service_role;

create or replace function public.materialize_clinic_expense_occurrences_v1(
  p_clinic_id text,
  p_month date,
  p_actor_id text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date := date_trunc('month', p_month)::date;
  v_month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_rule record;
  v_due date;
  v_days_in_month integer;
  v_anchor_delta integer;
  v_inserted integer := 0;
  v_row_count integer := 0;
begin
  if nullif(btrim(coalesce(p_clinic_id, '')), '') is null then
    raise exception 'CLINIC_EXPENSE_SCOPE_REQUIRED';
  end if;

  for v_rule in
    select
      id, clinic_id, logical_id, version, name, amount, recurrence, starts_on,
      category, due_day, ends_on, notes, specialty
    from public.clinic_recurring_costs
    where clinic_id = p_clinic_id
      and starts_on <= v_month_end
      and (ends_on is null or ends_on >= v_month_start)
      and (active = true or ends_on is not null)
    order by starts_on, version, id
  loop
    if v_rule.recurrence = 'monthly' then
      v_days_in_month := extract(day from v_month_end)::integer;
      v_due := v_month_start + (least(coalesce(v_rule.due_day, extract(day from v_rule.starts_on)::integer), v_days_in_month) - 1);

      if v_due < v_rule.starts_on or (v_rule.ends_on is not null and v_due > v_rule.ends_on) then
        continue;
      end if;

      insert into public.clinic_financial_entries (
        clinic_id, entry_type, category, description, amount, expected_amount,
        occurred_on, due_date, paid_on, competence_month, status, source, notes,
        created_by, updated_by, recurring_cost_id, recurring_cost_logical_id, recurrence_occurrence_key, specialty
      ) values (
        p_clinic_id, 'expense', coalesce(nullif(btrim(v_rule.category), ''), 'operacional'),
        v_rule.name, v_rule.amount, v_rule.amount,
        v_due, v_due, null, v_month_start, 'pending', 'recurring_cost', v_rule.notes,
        p_actor_id, p_actor_id, v_rule.id, v_rule.logical_id, 'monthly:' || to_char(v_month_start, 'YYYY-MM'), v_rule.specialty
      )
      on conflict (clinic_id, recurring_cost_logical_id, recurrence_occurrence_key)
        where recurring_cost_logical_id is not null and recurrence_occurrence_key is not null
      do nothing;
      get diagnostics v_row_count = row_count;
      v_inserted := v_inserted + v_row_count;
    elsif v_rule.recurrence = 'weekly' then
      v_due := v_rule.starts_on;
      if v_due < v_month_start then
        v_anchor_delta := (v_month_start - v_due);
        v_due := v_due + (((v_anchor_delta + 6) / 7) * 7);
      end if;

      while v_due <= v_month_end loop
        exit when v_rule.ends_on is not null and v_due > v_rule.ends_on;
        if v_due >= v_rule.starts_on then
          insert into public.clinic_financial_entries (
            clinic_id, entry_type, category, description, amount, expected_amount,
            occurred_on, due_date, paid_on, competence_month, status, source, notes,
            created_by, updated_by, recurring_cost_id, recurring_cost_logical_id, recurrence_occurrence_key, specialty
          ) values (
            p_clinic_id, 'expense', coalesce(nullif(btrim(v_rule.category), ''), 'operacional'),
            v_rule.name, v_rule.amount, v_rule.amount,
            v_due, v_due, null, v_month_start, 'pending', 'recurring_cost', v_rule.notes,
            p_actor_id, p_actor_id, v_rule.id, v_rule.logical_id, 'weekly:' || to_char(v_due, 'YYYY-MM-DD'), v_rule.specialty
          )
          on conflict (clinic_id, recurring_cost_logical_id, recurrence_occurrence_key)
            where recurring_cost_logical_id is not null and recurrence_occurrence_key is not null
          do nothing;
          get diagnostics v_row_count = row_count;
          v_inserted := v_inserted + v_row_count;
        end if;
        v_due := v_due + 7;
      end loop;
    end if;
  end loop;

  return v_inserted;
end;
$$;

-- Versão futura da regra: encerra a versão anterior, cria a próxima e reaponta
-- apenas ocorrências futuras ainda pendentes. Campos individualmente alterados
-- são preservados quando divergem do template antigo.
create or replace function public.version_clinic_recurring_cost_v1(
  p_clinic_id text,
  p_rule_id uuid,
  p_new_rule_id uuid,
  p_effective_from date,
  p_name text,
  p_amount numeric,
  p_category text,
  p_due_day integer,
  p_notes text,
  p_specialty text,
  p_actor_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.clinic_recurring_costs%rowtype;
  v_existing public.clinic_recurring_costs%rowtype;
  v_new_starts_on date;
begin
  select * into v_rule
  from public.clinic_recurring_costs
  where id = p_rule_id and clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'CLINIC_EXPENSE_RULE_NOT_FOUND';
  end if;
  if p_effective_from is null or p_effective_from <= v_rule.starts_on then
    raise exception 'CLINIC_EXPENSE_RULE_EFFECTIVE_DATE_INVALID';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'CLINIC_EXPENSE_RULE_AMOUNT_INVALID';
  end if;
  if v_rule.recurrence = 'monthly' and (p_due_day is null or p_due_day < 1 or p_due_day > 31) then
    raise exception 'CLINIC_EXPENSE_RULE_DUE_DAY_INVALID';
  end if;
  if v_rule.recurrence = 'monthly' and extract(day from p_effective_from)::integer <> 1 then
    raise exception 'CLINIC_EXPENSE_RULE_EFFECTIVE_MONTH_BOUNDARY_REQUIRED';
  end if;

  v_new_starts_on := case
    when v_rule.recurrence = 'weekly' then
      p_effective_from + ((7 - ((p_effective_from - v_rule.starts_on) % 7)) % 7)
    else p_effective_from
  end;

  select * into v_existing
  from public.clinic_recurring_costs
  where id = p_new_rule_id and clinic_id = p_clinic_id;
  if found then
    if v_existing.logical_id = v_rule.logical_id
       and v_existing.version = v_rule.version + 1
       and v_existing.starts_on = v_new_starts_on
       and v_existing.name = left(btrim(p_name), 120)
       and v_existing.amount = p_amount
       and v_existing.recurrence = v_rule.recurrence
       and v_existing.category = coalesce(nullif(btrim(p_category), ''), 'operacional')
       and v_existing.due_day is not distinct from (
         case
           when v_rule.recurrence = 'monthly' then p_due_day::smallint
           else null::smallint
         end
       )
       and v_existing.notes is not distinct from nullif(btrim(coalesce(p_notes, '')), '')
       and v_existing.specialty is not distinct from nullif(btrim(coalesce(p_specialty, '')), '') then
      return v_existing.id;
    end if;
    raise exception 'CLINIC_EXPENSE_RULE_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.clinic_recurring_costs (
    id, clinic_id, logical_id, version, name, amount, recurrence, starts_on,
    active, category, due_day, ends_on, notes, specialty, replaces_cost_id,
    created_by, updated_by, created_at, updated_at
  ) values (
    p_new_rule_id, p_clinic_id, v_rule.logical_id, v_rule.version + 1,
    left(btrim(p_name), 120), p_amount, v_rule.recurrence, v_new_starts_on,
    true, coalesce(nullif(btrim(p_category), ''), 'operacional'),
    case when v_rule.recurrence = 'monthly' then p_due_day else null end,
    null, nullif(btrim(coalesce(p_notes, '')), ''), nullif(btrim(coalesce(p_specialty, '')), ''),
    v_rule.id, p_actor_id, p_actor_id, now(), now()
  );

  update public.clinic_recurring_costs
  set active = false,
      ends_on = p_effective_from - 1,
      ended_at = now(),
      ended_by = p_actor_id,
      updated_by = p_actor_id,
      updated_at = now()
  where id = v_rule.id and clinic_id = p_clinic_id;

  -- Atualiza apenas competências futuras ainda abertas. Alterações individuais
  -- são reconhecidas por divergência em relação ao template anterior.
  update public.clinic_financial_entries e
  set recurring_cost_id = p_new_rule_id,
      recurring_cost_logical_id = v_rule.logical_id,
      expected_amount = p_amount,
      amount = case
        when e.amount = v_rule.amount and coalesce(e.expected_amount, v_rule.amount) = v_rule.amount then p_amount
        else e.amount
      end,
      description = case when e.description = v_rule.name then left(btrim(p_name), 120) else e.description end,
      category = case when e.category = v_rule.category then coalesce(nullif(btrim(p_category), ''), 'operacional') else e.category end,
      specialty = case when e.specialty is not distinct from v_rule.specialty then nullif(btrim(coalesce(p_specialty, '')), '') else e.specialty end,
      notes = case when e.notes is not distinct from v_rule.notes then nullif(btrim(coalesce(p_notes, '')), '') else e.notes end,
      due_date = case
        when v_rule.recurrence = 'monthly'
          and e.due_date is not null
          and extract(day from e.due_date)::integer = least(
            coalesce(v_rule.due_day, extract(day from v_rule.starts_on)::integer),
            extract(day from (date_trunc('month', e.competence_month) + interval '1 month - 1 day'))::integer
          )
        then date_trunc('month', e.competence_month)::date
          + (least(
              coalesce(p_due_day, extract(day from e.due_date)::integer),
              extract(day from (date_trunc('month', e.competence_month) + interval '1 month - 1 day'))::integer
            ) - 1)
        else e.due_date
      end,
      updated_by = p_actor_id,
      updated_at = now()
  where e.clinic_id = p_clinic_id
    and e.recurring_cost_id = v_rule.id
    and e.entry_type = 'expense'
    and e.status = 'pending'
    and coalesce(e.due_date, e.occurred_on) >= p_effective_from;

  return p_new_rule_id;
end;
$$;

-- Encerramento histórico: mantém ocorrências passadas e cancela somente obrigações
-- futuras ainda pendentes da versão encerrada.
create or replace function public.end_clinic_recurring_cost_v1(
  p_clinic_id text,
  p_rule_id uuid,
  p_end_on date,
  p_actor_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.clinic_recurring_costs%rowtype;
begin
  select * into v_rule
  from public.clinic_recurring_costs
  where id = p_rule_id and clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'CLINIC_EXPENSE_RULE_NOT_FOUND';
  end if;
  if v_rule.active = false and v_rule.ends_on is not null then
    if v_rule.ends_on = p_end_on then
      return v_rule.id;
    end if;
    raise exception 'CLINIC_EXPENSE_RULE_END_IDEMPOTENCY_CONFLICT';
  end if;
  if p_end_on is null or p_end_on < v_rule.starts_on then
    raise exception 'CLINIC_EXPENSE_RULE_END_DATE_INVALID';
  end if;

  update public.clinic_recurring_costs
  set active = false,
      ends_on = least(coalesce(ends_on, p_end_on), p_end_on),
      ended_at = coalesce(ended_at, now()),
      ended_by = coalesce(ended_by, p_actor_id),
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_rule_id and clinic_id = p_clinic_id;

  update public.clinic_financial_entries
  set status = 'canceled',
      updated_by = p_actor_id,
      updated_at = now()
  where clinic_id = p_clinic_id
    and recurring_cost_id = p_rule_id
    and entry_type = 'expense'
    and status = 'pending'
    and coalesce(due_date, occurred_on) > p_end_on;

  return p_rule_id;
end;
$$;

revoke all on function public.materialize_clinic_expense_occurrences_v1(text, date, text) from public, anon, authenticated;
revoke all on function public.version_clinic_recurring_cost_v1(text, uuid, uuid, date, text, numeric, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.end_clinic_recurring_cost_v1(text, uuid, date, text) from public, anon, authenticated;
grant execute on function public.materialize_clinic_expense_occurrences_v1(text, date, text) to service_role;
grant execute on function public.version_clinic_recurring_cost_v1(text, uuid, uuid, date, text, numeric, text, integer, text, text, text) to service_role;
grant execute on function public.end_clinic_recurring_cost_v1(text, uuid, date, text) to service_role;

comment on table public.clinic_recurring_costs is
  'Regra/template versionável de despesas recorrentes da clínica; ocorrências financeiras vivem em clinic_financial_entries.';

comment on column public.clinic_financial_entries.expected_amount is
  'Valor previsto congelado para a competência; amount representa o valor atual/realizado da ocorrência.';
comment on column public.clinic_financial_entries.recurring_cost_id is
  'Versão da regra recorrente que originou a ocorrência; histórico não é apagado ao encerrar a regra.';
comment on column public.clinic_financial_entries.recurring_cost_logical_id is
  'Identidade estável da recorrência usada para idempotência entre versões futuras da mesma regra.';
