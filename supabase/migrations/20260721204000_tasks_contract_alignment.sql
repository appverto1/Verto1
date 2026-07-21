-- Align the legacy public.tasks contract with fields already written and read
-- by the current backend. Additive, idempotent and non-destructive.

do $$
begin
  if to_regclass('public.tasks') is null then
    raise notice 'public.tasks is absent; task contract alignment skipped.';
    return;
  end if;

  alter table public.tasks
    add column if not exists max_score integer,
    add column if not exists is_active boolean,
    add column if not exists deleted_at timestamptz;

  -- Existing rows were historically treated as visible and used max score 4
  -- in the application fallback, so this preserves the effective behavior.
  update public.tasks
     set is_active = true
   where is_active is null;

  alter table public.tasks
    alter column is_active set default true,
    alter column is_active set not null,
    alter column max_score set default 4;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.tasks'::regclass
       and conname = 'tasks_max_score_range'
  ) then
    alter table public.tasks
      add constraint tasks_max_score_range
      check (max_score is null or (max_score >= 1 and max_score <= 100)) not valid;
  end if;

  create index if not exists idx_tasks_patient_active_created
    on public.tasks(patient_id, created_at desc)
    where is_active = true and deleted_at is null;
end;
$$;

notify pgrst, 'reload schema';

-- Rollback: drop only idx_tasks_patient_active_created. Keep the nullable data
-- columns to avoid deleting task scores or archive state written after deploy.
