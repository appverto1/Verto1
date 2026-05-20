-- Persist adult patient homework completion and professional scoring as durable clinical data.

create extension if not exists "pgcrypto";

alter table public.assigned_tasks
  add column if not exists max_score integer,
  add column if not exists patient_effort_emoji text,
  add column if not exists patient_effort_label text,
  add column if not exists reviewed_by text,
  add column if not exists last_history_event_id uuid,
  add column if not exists last_private_note_id uuid;

update public.assigned_tasks
set max_score = coalesce(
  max_score,
  case when coalesce(task_data->>'maxScore', '') ~ '^[0-9]+$' then (task_data->>'maxScore')::integer end,
  case when coalesce(task_data->>'max_score', '') ~ '^[0-9]+$' then (task_data->>'max_score')::integer end,
  4
)
where max_score is null;

alter table public.assigned_tasks
  alter column max_score set default 4;

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_pro_score_check,
  drop constraint if exists assigned_tasks_pro_score_range,
  add constraint assigned_tasks_pro_score_range
    check (pro_score is null or (pro_score >= 0 and pro_score <= greatest(coalesce(max_score, 4), 1)));

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_max_score_range,
  add constraint assigned_tasks_max_score_range
    check (max_score is null or (max_score >= 1 and max_score <= 100));

create index if not exists idx_assigned_tasks_reviewed
  on public.assigned_tasks(patient_id, reviewed_at desc)
  where reviewed_at is not null;

alter table public.history
  add column if not exists deleted_at timestamptz,
  add column if not exists is_active boolean not null default true,
  add column if not exists assigned_task_id uuid references public.assigned_tasks(id) on delete set null,
  add column if not exists source text,
  add column if not exists task_data jsonb not null default '{}'::jsonb,
  add column if not exists pro_score integer,
  add column if not exists max_score integer,
  add column if not exists protocol_id text,
  add column if not exists protocol_title text,
  add column if not exists domain_id text,
  add column if not exists domain_name text,
  add column if not exists skill_id text,
  add column if not exists skill_name text;

create index if not exists idx_history_assigned_task
  on public.history(assigned_task_id)
  where assigned_task_id is not null;

create index if not exists idx_history_adult_protocol_score
  on public.history(patient_id, protocol_id, created_at desc)
  where source = 'assigned_task_review' and deleted_at is null;

alter table public.notes
  add column if not exists deleted_at timestamptz,
  add column if not exists is_active boolean not null default true,
  add column if not exists assigned_task_id uuid references public.assigned_tasks(id) on delete set null,
  add column if not exists source text;

create index if not exists idx_notes_assigned_task
  on public.notes(assigned_task_id)
  where assigned_task_id is not null;

create table if not exists public.adult_task_reviews (
  id uuid primary key default gen_random_uuid(),
  assigned_task_id uuid not null references public.assigned_tasks(id) on delete cascade,
  clinic_id text,
  patient_id uuid not null references public.patients(id) on delete cascade,
  patient_email text,
  professional_id text,
  protocol_id text,
  protocol_title text,
  domain_id text,
  domain_name text,
  skill_id text,
  skill_name text,
  task_title text not null,
  patient_effort integer check (patient_effort is null or (patient_effort >= 0 and patient_effort <= 100)),
  patient_effort_emoji text,
  patient_effort_label text,
  patient_comment text,
  pro_score integer not null,
  max_score integer not null default 4,
  pro_review_note text,
  completed_at timestamptz,
  reviewed_at timestamptz not null default now(),
  history_id uuid,
  note_id uuid,
  review_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assigned_task_id),
  check (max_score >= 1 and max_score <= 100),
  check (pro_score >= 0 and pro_score <= max_score)
);

create index if not exists idx_adult_task_reviews_patient_reviewed
  on public.adult_task_reviews(patient_id, reviewed_at desc);

create index if not exists idx_adult_task_reviews_protocol
  on public.adult_task_reviews(patient_id, protocol_id, reviewed_at desc);

create or replace function public.adult_task_reviews_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_adult_task_reviews_updated_at on public.adult_task_reviews;
create trigger trg_adult_task_reviews_updated_at
before update on public.adult_task_reviews
for each row
execute function public.adult_task_reviews_set_updated_at();

alter table public.adult_task_reviews enable row level security;

drop policy if exists "adult_task_reviews_select_professional" on public.adult_task_reviews;
create policy "adult_task_reviews_select_professional"
on public.adult_task_reviews
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id::text = auth.uid()::text
      and u.role in ('coordinator', 'therapist', 'receptionist', 'admin', 'owner')
      and (
        u.clinic_id::text = adult_task_reviews.clinic_id::text
        or u.role in ('admin', 'owner')
      )
  )
);

drop policy if exists "adult_task_reviews_select_patient" on public.adult_task_reviews;
create policy "adult_task_reviews_select_patient"
on public.adult_task_reviews
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id::text = auth.uid()::text
      and u.role = 'patient'
      and lower(coalesce(u.email, '')) = lower(coalesce(adult_task_reviews.patient_email, ''))
  )
);
