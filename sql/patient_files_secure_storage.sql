-- Secure patient files vault (private + auditable)
-- Apply in Supabase SQL Editor or via MCP migration tool.

create extension if not exists pgcrypto;

create table if not exists public.patient_files (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null,
  uploaded_by uuid references public.users(id) on delete set null,
  storage_bucket text not null default 'patient-files-private',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  source text not null default 'upload',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patient_files_patient_id on public.patient_files(patient_id);
create index if not exists idx_patient_files_clinic_id on public.patient_files(clinic_id);
create index if not exists idx_patient_files_uploaded_by on public.patient_files(uploaded_by);
create index if not exists idx_patient_files_created_at on public.patient_files(created_at desc);

create or replace function public.set_patient_files_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_patient_files_updated_at on public.patient_files;
create trigger trg_patient_files_updated_at
before update on public.patient_files
for each row
execute function public.set_patient_files_updated_at();

alter table public.patient_files enable row level security;

drop policy if exists patient_files_select on public.patient_files;
create policy patient_files_select
on public.patient_files
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or u.id = patient_files.uploaded_by
        or u.clinic_id = patient_files.clinic_id
      )
  )
  or exists (
    select 1
    from public.patients p
    where p.id = patient_files.patient_id
      and p.therapist_id = auth.uid()
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_files.clinic_id
      and cm.status = 'active'
  )
);

drop policy if exists patient_files_insert on public.patient_files;
create policy patient_files_insert
on public.patient_files
for insert
to authenticated
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = patient_files.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_files.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
);

drop policy if exists patient_files_update on public.patient_files;
create policy patient_files_update
on public.patient_files
for update
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = patient_files.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_files.clinic_id
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
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = patient_files.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_files.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
);

drop policy if exists patient_files_delete on public.patient_files;
create policy patient_files_delete
on public.patient_files
for delete
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role in ('owner', 'admin')
        or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = patient_files.clinic_id)
      )
  )
  or exists (
    select 1
    from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = patient_files.clinic_id
      and cm.status = 'active'
      and cm.role in ('coordinator', 'receptionist', 'therapist')
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files-private',
  'patient-files-private',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/json',
    'text/plain',
    'text/html'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "patient files private read" on storage.objects;
create policy "patient files private read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'patient-files-private'
  and (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and (
          u.role in ('owner', 'admin')
          or u.clinic_id::text = split_part(name, '/', 1)
        )
    )
    or exists (
      select 1
      from public.clinic_memberships cm
      where cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.clinic_id::text = split_part(name, '/', 1)
    )
  )
);

drop policy if exists "patient files private write" on storage.objects;
create policy "patient files private write"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'patient-files-private'
  and (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and (
          u.role in ('owner', 'admin')
          or (
            u.role in ('coordinator', 'receptionist', 'therapist')
            and u.clinic_id::text = split_part(name, '/', 1)
          )
        )
    )
    or exists (
      select 1
      from public.clinic_memberships cm
      where cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role in ('coordinator', 'receptionist', 'therapist')
        and cm.clinic_id::text = split_part(name, '/', 1)
    )
  )
);

drop policy if exists "patient files private delete" on storage.objects;
create policy "patient files private delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'patient-files-private'
  and (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and (
          u.role in ('owner', 'admin')
          or (
            u.role in ('coordinator', 'receptionist', 'therapist')
            and u.clinic_id::text = split_part(name, '/', 1)
          )
        )
    )
    or exists (
      select 1
      from public.clinic_memberships cm
      where cm.user_id = auth.uid()
        and cm.status = 'active'
        and cm.role in ('coordinator', 'receptionist', 'therapist')
        and cm.clinic_id::text = split_part(name, '/', 1)
    )
  )
);
