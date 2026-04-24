-- Adult Homework Workflow
-- Stores professional assigned tasks and patient/professional feedback lifecycle.

create extension if not exists "pgcrypto";

create table if not exists public.assigned_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  patient_email text,
  professional_id text not null,
  task_type text not null default 'task',
  task_data jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  patient_effort integer check (patient_effort between 0 and 100),
  patient_comment text,
  pro_score integer check (pro_score between 0 and 4),
  pro_review_note text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz,
  reviewed_at timestamptz,
  parent_assigned_task_id uuid references public.assigned_tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assigned_tasks_patient on public.assigned_tasks(patient_id);
create index if not exists idx_assigned_tasks_clinic on public.assigned_tasks(clinic_id);
create index if not exists idx_assigned_tasks_status on public.assigned_tasks(status);
create index if not exists idx_assigned_tasks_scheduled on public.assigned_tasks(scheduled_at desc);
create index if not exists idx_assigned_tasks_parent on public.assigned_tasks(parent_assigned_task_id);

create or replace function public.assigned_tasks_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_assigned_tasks_updated_at on public.assigned_tasks;
create trigger trg_assigned_tasks_updated_at
before update on public.assigned_tasks
for each row
execute function public.assigned_tasks_set_updated_at();

alter table public.assigned_tasks enable row level security;

drop policy if exists "assigned_tasks_select_professional" on public.assigned_tasks;
create policy "assigned_tasks_select_professional"
on public.assigned_tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id::text = auth.uid()::text
      and u.role in ('coordinator', 'therapist', 'receptionist', 'admin', 'owner')
      and (
        u.clinic_id::text = assigned_tasks.clinic_id::text
        or u.role in ('admin', 'owner')
      )
  )
);

drop policy if exists "assigned_tasks_select_patient" on public.assigned_tasks;
create policy "assigned_tasks_select_patient"
on public.assigned_tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id::text = auth.uid()::text
      and u.role = 'patient'
      and lower(coalesce(u.email, '')) = lower(coalesce(assigned_tasks.patient_email, ''))
  )
);

drop policy if exists "assigned_tasks_insert_professional" on public.assigned_tasks;
create policy "assigned_tasks_insert_professional"
on public.assigned_tasks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id::text = auth.uid()::text
      and u.role in ('coordinator', 'therapist', 'receptionist', 'admin', 'owner')
      and (
        u.clinic_id::text = assigned_tasks.clinic_id::text
        or u.role in ('admin', 'owner')
      )
  )
);

drop policy if exists "assigned_tasks_update_professional_or_patient" on public.assigned_tasks;
create policy "assigned_tasks_update_professional_or_patient"
on public.assigned_tasks
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id::text = auth.uid()::text
      and (
        (
          u.role in ('coordinator', 'therapist', 'receptionist', 'admin', 'owner')
          and (u.clinic_id::text = assigned_tasks.clinic_id::text or u.role in ('admin', 'owner'))
        )
        or (
          u.role = 'patient'
          and lower(coalesce(u.email, '')) = lower(coalesce(assigned_tasks.patient_email, ''))
        )
      )
  )
)
with check (true);
