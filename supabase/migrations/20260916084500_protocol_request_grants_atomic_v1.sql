-- Issue #178: tenant-bound protocol requests and atomic grants.
-- Forward-only; preserves protocol_import_requests history and clinic_state compatibility.

alter table public.protocol_import_requests
  add column if not exists canonical_request_key text generated always as (
    lower(trim(coalesce(approved_canonical_key, suggested_canonical_key, protocol_name)))
  ) stored,
  add column if not exists quarantine_status text not null default 'quarantined',
  add column if not exists scan_status text not null default 'pending',
  add column if not exists safe_preview_status text not null default 'not_generated',
  add column if not exists raw_file_access text not null default 'blocked',
  add column if not exists safe_preview_text text null,
  add column if not exists scan_report jsonb null;

create table if not exists public.clinic_protocol_grants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  canonical_key text not null,
  source_request_id uuid not null references public.protocol_import_requests(id),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by uuid null,
  created_at timestamptz not null default now(),
  constraint clinic_protocol_grants_key_nonblank check (length(trim(canonical_key)) > 0),
  constraint clinic_protocol_grants_unique unique (clinic_id, canonical_key)
);

create index if not exists idx_clinic_protocol_grants_clinic_active
  on public.clinic_protocol_grants (clinic_id, canonical_key)
  where revoked_at is null;

alter table public.clinic_protocol_grants enable row level security;

drop policy if exists clinic_protocol_grants_platform_admin_all on public.clinic_protocol_grants;
create policy clinic_protocol_grants_platform_admin_all
  on public.clinic_protocol_grants for all
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

drop policy if exists clinic_protocol_grants_tenant_read on public.clinic_protocol_grants;
create policy clinic_protocol_grants_tenant_read
  on public.clinic_protocol_grants for select
  using (exists (
    select 1 from public.clinic_memberships cm
    where cm.user_id = auth.uid()
      and cm.clinic_id = clinic_protocol_grants.clinic_id
      and cm.status = 'active'
  ));

drop policy if exists protocol_import_requests_clinic_insert on public.protocol_import_requests;
create policy protocol_import_requests_clinic_insert
  on public.protocol_import_requests for insert
  with check (
    requester_user_id = auth.uid()
    and exists (
      select 1 from public.clinic_memberships cm
      where cm.user_id = auth.uid()
        and cm.clinic_id = protocol_import_requests.clinic_id
        and cm.status = 'active'
    )
  );

-- Existing duplicate pending requests are historical evidence. Mark redundant pending
-- rows rejected when the same clinic/key already has an approved request, preserving rows.
update public.protocol_import_requests pending
set status = 'rejected',
    reviewed_at = coalesce(reviewed_at, now()),
    updated_at = now()
where pending.status = 'pending'
  and exists (
    select 1 from public.protocol_import_requests approved
    where approved.clinic_id = pending.clinic_id
      and approved.canonical_request_key = pending.canonical_request_key
      and approved.status = 'approved'
  );

create unique index if not exists uq_protocol_import_requests_one_pending_per_key
  on public.protocol_import_requests (clinic_id, canonical_request_key)
  where status = 'pending';

create or replace function public.approve_protocol_import_request_v1(
  p_request_id uuid,
  p_canonical_key text
) returns public.clinic_protocol_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.protocol_import_requests%rowtype;
  v_grant public.clinic_protocol_grants%rowtype;
  v_key text := lower(trim(coalesce(p_canonical_key, '')));
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if v_key = '' then raise exception 'canonical_key_required'; end if;

  select * into v_request from public.protocol_import_requests
  where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.clinic_id is null then raise exception 'request_clinic_required'; end if;

  if v_request.status not in ('pending', 'approved') then
    raise exception 'request_not_approvable';
  end if;
  if v_request.status = 'approved'
     and lower(trim(coalesce(v_request.approved_canonical_key, ''))) not in ('', v_key) then
    raise exception 'request_already_approved_with_different_key';
  end if;

  insert into public.clinic_protocol_grants
    (clinic_id, canonical_key, source_request_id, granted_by)
  values (v_request.clinic_id, v_key, v_request.id, auth.uid())
  on conflict (clinic_id, canonical_key) do update
    set source_request_id = excluded.source_request_id,
        revoked_at = null,
        revoked_by = null
  returning * into v_grant;

  update public.protocol_import_requests
  set status = 'approved', approved_canonical_key = v_key,
      reviewed_by = auth.uid(), reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
  where id = v_request.id;

  return v_grant;
end;
$$;

revoke all on function public.approve_protocol_import_request_v1(uuid,text) from public, anon;
grant execute on function public.approve_protocol_import_request_v1(uuid,text) to authenticated;
