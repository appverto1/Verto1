create table if not exists public.protocol_import_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid null,
  requester_user_id uuid null,
  requester_name text null,
  requester_email text null,
  protocol_name text not null,
  file_name text not null,
  file_type text null,
  file_size bigint null,
  file_data_url text null,
  status text not null default 'pending',
  suggested_canonical_key text null,
  suggested_canonical_name text null,
  suggested_confidence numeric null,
  approved_canonical_key text null,
  approved_canonical_name text null,
  rights_accepted boolean not null default false,
  full_protocol_confirmed boolean not null default false,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_protocol_import_requests_status_created
  on public.protocol_import_requests (status, created_at desc);

create index if not exists idx_protocol_import_requests_clinic
  on public.protocol_import_requests (clinic_id, created_at desc);

alter table public.protocol_import_requests enable row level security;

drop policy if exists protocol_import_requests_owner_all on public.protocol_import_requests;
create policy protocol_import_requests_owner_all
  on public.protocol_import_requests
  for all
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('owner', 'admin')
    )
  );

drop policy if exists protocol_import_requests_clinic_insert on public.protocol_import_requests;
create policy protocol_import_requests_clinic_insert
  on public.protocol_import_requests
  for insert
  with check (requester_user_id = auth.uid());

drop policy if exists protocol_import_requests_clinic_read_own on public.protocol_import_requests;
create policy protocol_import_requests_clinic_read_own
  on public.protocol_import_requests
  for select
  using (
    requester_user_id = auth.uid()
    or exists (
      select 1
      from public.clinic_memberships cm
      where cm.user_id = auth.uid()
        and cm.clinic_id = protocol_import_requests.clinic_id
        and cm.status = 'active'
    )
  );

create table if not exists public.verto_canonical_protocols (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  title text not null,
  category text not null default 'evaluation',
  source_label text null,
  version_label text null,
  status text not null default 'draft',
  protocol_json jsonb not null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_verto_canonical_protocols_status
  on public.verto_canonical_protocols (status, updated_at desc);

alter table public.verto_canonical_protocols enable row level security;

drop policy if exists verto_canonical_protocols_owner_all on public.verto_canonical_protocols;
create policy verto_canonical_protocols_owner_all
  on public.verto_canonical_protocols
  for all
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('owner', 'admin')
    )
  );

drop policy if exists verto_canonical_protocols_authenticated_read on public.verto_canonical_protocols;
create policy verto_canonical_protocols_authenticated_read
  on public.verto_canonical_protocols
  for select
  using (auth.uid() is not null and status = 'published');
