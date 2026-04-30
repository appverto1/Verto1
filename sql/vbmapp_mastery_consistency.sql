-- VB-MAPP mastery consistency support (safe/idempotent)
-- Run in Supabase SQL Editor (production + staging).

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'clinics'
  ) then
    alter table public.clinics
      add column if not exists vbmapp_mastery_criterion integer not null default 5;

    -- keep valid values constrained to 5 or 10
    begin
      alter table public.clinics
        add constraint clinics_vbmapp_mastery_criterion_chk
        check (vbmapp_mastery_criterion in (5, 10));
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'assigned_tasks'
  ) then
    alter table public.assigned_tasks
      add column if not exists consecutive_successes integer not null default 0;
  end if;
end $$;

comment on column public.assigned_tasks.consecutive_successes is
'Contagem de sucessos consecutivos (nota 1.0) para tarefas VB-MAPP.';

-- Optional DB-level guardrail:
-- Automatically maintains consecutive_successes on INSERT/UPDATE for VB-MAPP rows.
create or replace function public.fn_apply_vbmapp_consecutive_successes()
returns trigger
language plpgsql
as $$
declare
  protocol_hint text;
  next_score numeric;
begin
  -- Detect VB-MAPP by protocol hints in task_data/protocol columns
  protocol_hint :=
    lower(
      coalesce(new.protocol_id::text, '') || ' ' ||
      coalesce(new.task_data->>'protocol_id', '') || ' ' ||
      coalesce(new.task_data->>'protocolId', '') || ' ' ||
      coalesce(new.task_data->>'protocol_title', '') || ' ' ||
      coalesce(new.task_data->>'protocolTitle', '') || ' ' ||
      coalesce(new.task_data->>'protocol', '')
    );

  if protocol_hint !~ 'vb[[:space:]-]?mapp' then
    return new;
  end if;

  next_score := coalesce(new.pro_score::numeric, 0);

  if tg_op = 'INSERT' then
    if next_score >= 1 then
      new.consecutive_successes := coalesce(new.consecutive_successes, 0);
      if new.consecutive_successes <= 0 then
        new.consecutive_successes := 1;
      end if;
    else
      new.consecutive_successes := 0;
    end if;
    return new;
  end if;

  -- UPDATE
  if next_score >= 1 then
    if coalesce(old.pro_score::numeric, -1) >= 1 then
      -- keep if score stayed 1 and app already sent the value
      new.consecutive_successes := greatest(coalesce(new.consecutive_successes, old.consecutive_successes, 0), coalesce(old.consecutive_successes, 0));
    else
      -- transition from <1 to 1 => increment
      new.consecutive_successes := coalesce(old.consecutive_successes, 0) + 1;
    end if;
  else
    -- any score below 1 breaks streak
    new.consecutive_successes := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_vbmapp_consecutive_successes on public.assigned_tasks;
create trigger trg_apply_vbmapp_consecutive_successes
before insert or update on public.assigned_tasks
for each row
execute function public.fn_apply_vbmapp_consecutive_successes();
