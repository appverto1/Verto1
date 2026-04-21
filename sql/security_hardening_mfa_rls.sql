-- Security hardening: strict therapist scoping + immutable record read audit
-- Run in Supabase SQL editor

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Immutable audit for medical record reads
-- ---------------------------------------------------------------------------
create table if not exists public.record_read_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  clinic_id uuid null,
  role text null,
  patient_id uuid null,
  route text not null,
  ip_address text null,
  outcome text not null check (outcome in ('allowed', 'denied')),
  reason text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_record_read_audit_created_at on public.record_read_audit (created_at desc);
create index if not exists idx_record_read_audit_user_id on public.record_read_audit (user_id);
create index if not exists idx_record_read_audit_clinic_id on public.record_read_audit (clinic_id);
create index if not exists idx_record_read_audit_patient_id on public.record_read_audit (patient_id);

alter table public.record_read_audit enable row level security;

drop policy if exists "record_read_audit_select_owner_admin" on public.record_read_audit;
create policy "record_read_audit_select_owner_admin"
on public.record_read_audit
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role in ('owner', 'admin')
  )
  or (
    clinic_id is not null
    and exists (
      select 1
      from public.clinic_memberships cm
      where cm.user_id = auth.uid()
        and cm.clinic_id = record_read_audit.clinic_id
        and cm.status = 'active'
        and cm.role = 'coordinator'
    )
  )
);

revoke update, delete on public.record_read_audit from anon, authenticated;

create or replace function public.prevent_record_read_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'record_read_audit is immutable';
end;
$$;

drop trigger if exists trg_prevent_record_read_audit_update on public.record_read_audit;
create trigger trg_prevent_record_read_audit_update
before update on public.record_read_audit
for each row execute function public.prevent_record_read_audit_mutation();

drop trigger if exists trg_prevent_record_read_audit_delete on public.record_read_audit;
create trigger trg_prevent_record_read_audit_delete
before delete on public.record_read_audit
for each row execute function public.prevent_record_read_audit_mutation();

-- ---------------------------------------------------------------------------
-- RLS hardening helpers
-- ---------------------------------------------------------------------------
create or replace function public.user_clinic_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.clinic_id
  from public.clinic_memberships cm
  where cm.user_id = auth.uid()
    and cm.status = 'active'
$$;

grant execute on function public.user_clinic_ids() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Patients: therapist can only read own linked patients in own workspace.
-- ---------------------------------------------------------------------------
alter table public.patients enable row level security;

drop policy if exists "patients_select_coord_reception" on public.patients;
create policy "patients_select_coord_reception"
on public.patients
for select
to authenticated
using (
  exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patients.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "patients_select_therapist_linked" on public.patients;
create policy "patients_select_therapist_linked"
on public.patients
for select
to authenticated
using (
  patients.therapist_id = auth.uid()
  and exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patients.clinic_id
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);

-- ---------------------------------------------------------------------------
-- Clinical tables follow patient ownership
-- ---------------------------------------------------------------------------
alter table public.notes enable row level security;
alter table public.history enable row level security;
alter table public.tasks enable row level security;
alter table public.patient_records enable row level security;
alter table public.patient_files enable row level security;
alter table public.patient_anamnesis_submissions enable row level security;

drop policy if exists "notes_select_coord_reception" on public.notes;
create policy "notes_select_coord_reception"
on public.notes
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = notes.patient_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "notes_select_therapist_linked" on public.notes;
create policy "notes_select_therapist_linked"
on public.notes
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = notes.patient_id
      and p.therapist_id = auth.uid()
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);

drop policy if exists "history_select_coord_reception" on public.history;
create policy "history_select_coord_reception"
on public.history
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = history.patient_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "history_select_therapist_linked" on public.history;
create policy "history_select_therapist_linked"
on public.history
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = history.patient_id
      and p.therapist_id = auth.uid()
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);

drop policy if exists "tasks_select_coord_reception" on public.tasks;
create policy "tasks_select_coord_reception"
on public.tasks
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = tasks.patient_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "tasks_select_therapist_linked" on public.tasks;
create policy "tasks_select_therapist_linked"
on public.tasks
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = tasks.patient_id
      and p.therapist_id = auth.uid()
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);

drop policy if exists "patient_records_select_coord_reception" on public.patient_records;
create policy "patient_records_select_coord_reception"
on public.patient_records
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = patient_records.patient_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "patient_records_select_therapist_linked" on public.patient_records;
create policy "patient_records_select_therapist_linked"
on public.patient_records
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = patient_records.patient_id
      and p.therapist_id = auth.uid()
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);

drop policy if exists "patient_files_select_coord_reception" on public.patient_files;
create policy "patient_files_select_coord_reception"
on public.patient_files
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = patient_files.patient_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "patient_files_select_therapist_linked" on public.patient_files;
create policy "patient_files_select_therapist_linked"
on public.patient_files
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = patient_files.patient_id
      and p.therapist_id = auth.uid()
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);

drop policy if exists "patient_anamnesis_select_coord_reception" on public.patient_anamnesis_submissions;
create policy "patient_anamnesis_select_coord_reception"
on public.patient_anamnesis_submissions
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = patient_anamnesis_submissions.patient_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist')
  )
);

drop policy if exists "patient_anamnesis_select_therapist_linked" on public.patient_anamnesis_submissions;
create policy "patient_anamnesis_select_therapist_linked"
on public.patient_anamnesis_submissions
for select
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.clinic_memberships cm on cm.clinic_id = p.clinic_id
    where p.id = patient_anamnesis_submissions.patient_id
      and p.therapist_id = auth.uid()
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role = 'therapist'
  )
);
