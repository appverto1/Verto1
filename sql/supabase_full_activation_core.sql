-- Full activation core for persistent clinical workspace state
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create table if not exists public.clinic_state (
  clinic_id uuid primary key,
  rooms jsonb not null default '[]'::jsonb,
  appointments jsonb not null default '[]'::jsonb,
  protocols jsonb not null default '[]'::jsonb,
  specialty_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_anamnesis_submissions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null,
  professional_id uuid references public.users(id) on delete set null,
  title text not null,
  reference_date date not null,
  profile_type text not null default 'adult' check (profile_type in ('adult', 'child')),
  template_version int,
  anamnesis_data jsonb not null default '{}'::jsonb,
  patient_file_id uuid references public.patient_files(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_anamnesis_submissions_patient_id
  on public.patient_anamnesis_submissions(patient_id, created_at desc);
create index if not exists idx_patient_anamnesis_submissions_clinic_id
  on public.patient_anamnesis_submissions(clinic_id, created_at desc);

alter table public.clinic_state enable row level security;
alter table public.patient_anamnesis_submissions enable row level security;

drop policy if exists clinic_state_select on public.clinic_state;
create policy clinic_state_select
on public.clinic_state
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.clinic_id = clinic_state.clinic_id
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = clinic_state.clinic_id
      and cm.status = 'active'
  )
);

drop policy if exists clinic_state_insert on public.clinic_state;
create policy clinic_state_insert
on public.clinic_state
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = clinic_state.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = clinic_state.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
);

drop policy if exists clinic_state_update on public.clinic_state;
create policy clinic_state_update
on public.clinic_state
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = clinic_state.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = clinic_state.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = clinic_state.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = clinic_state.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
);

drop policy if exists clinic_state_delete on public.clinic_state;
create policy clinic_state_delete
on public.clinic_state
for delete
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (u.role in ('owner', 'admin') or (u.role = 'coordinator' and u.clinic_id = clinic_state.clinic_id))
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    join public.users u on u.id = cm.user_id
    where cm.user_id = auth.uid()
      and cm.clinic_id = clinic_state.clinic_id
      and cm.status = 'active'
      and cm.role = 'coordinator'
      and u.role in ('coordinator', 'admin', 'owner')
  )
);

drop policy if exists patient_anamnesis_submissions_select on public.patient_anamnesis_submissions;
create policy patient_anamnesis_submissions_select
on public.patient_anamnesis_submissions
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.clinic_id = patient_anamnesis_submissions.clinic_id
        or u.id = patient_anamnesis_submissions.professional_id
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_anamnesis_submissions.clinic_id
      and cm.status = 'active'
  )
);

drop policy if exists patient_anamnesis_submissions_insert on public.patient_anamnesis_submissions;
create policy patient_anamnesis_submissions_insert
on public.patient_anamnesis_submissions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = patient_anamnesis_submissions.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_anamnesis_submissions.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
);

drop policy if exists patient_anamnesis_submissions_delete on public.patient_anamnesis_submissions;
create policy patient_anamnesis_submissions_delete
on public.patient_anamnesis_submissions
for delete
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (u.role in ('owner', 'admin') or (u.role = 'coordinator' and u.clinic_id = patient_anamnesis_submissions.clinic_id))
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_anamnesis_submissions.clinic_id
      and cm.status = 'active'
      and cm.role = 'coordinator'
  )
);

alter table public.activity_logs
  add column if not exists actor_name text,
  add column if not exists clinic_id uuid,
  add column if not exists category text,
  add column if not exists action text default 'activity_logged';

update public.activity_logs
set action = coalesce(nullif(action, ''), nullif(action_type, ''), 'activity_logged')
where action is null or action = '';

alter table public.activity_logs alter column action set default 'activity_logged';
alter table public.activity_logs alter column action set not null;

create index if not exists idx_activity_logs_clinic_time
  on public.activity_logs(clinic_id, timestamp desc);

create index if not exists idx_activity_logs_action_time
  on public.activity_logs(action, timestamp desc);
