-- Patient file access control v1
-- Additive/idempotent. Existing files keep their prior patient-scoped visibility by default.
-- ACL changes are server-only and atomic; the uploader is the only actor allowed to manage them.

begin;

create extension if not exists pgcrypto;

alter table public.patient_files
  add column if not exists access_scope text,
  add column if not exists patient_portal_visible boolean;

-- Preserve existing behavior: canonical files already visible to a patient-scoped actor remain so.
update public.patient_files
set access_scope = 'PATIENT_ACCESS'
where access_scope is null or btrim(access_scope) = '';

-- Preserve any pre-existing family/patient release semantics.
update public.patient_files
set patient_portal_visible = (
  lower(coalesce(source, '')) = 'family_portal_document'
  or lower(coalesce(metadata->>'releasedToPatient', '')) = 'true'
  or lower(coalesce(metadata->>'released_to_patient', '')) = 'true'
  or lower(coalesce(metadata->>'visibleToPatient', '')) = 'true'
  or lower(coalesce(metadata->>'visible_to_patient', '')) = 'true'
  or lower(coalesce(metadata->>'visibility', '')) in ('patient', 'family', 'shared_patient')
)
where patient_portal_visible is null;

alter table public.patient_files
  alter column access_scope set default 'PATIENT_ACCESS',
  alter column access_scope set not null,
  alter column patient_portal_visible set default false,
  alter column patient_portal_visible set not null;

alter table public.patient_files
  drop constraint if exists patient_files_access_scope_v1;
alter table public.patient_files
  add constraint patient_files_access_scope_v1
  check (access_scope in ('OWNER', 'CASE_TEAM', 'PATIENT_ACCESS', 'SELECTED'));

create table if not exists public.patient_file_access_grants (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.patient_files(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null,
  grantee_user_id uuid not null references public.users(id) on delete cascade,
  granted_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (file_id, grantee_user_id)
);

create index if not exists patient_file_access_grants_grantee_idx
  on public.patient_file_access_grants (grantee_user_id, file_id);
create index if not exists patient_file_access_grants_patient_idx
  on public.patient_file_access_grants (patient_id, file_id);
create index if not exists patient_files_access_scope_idx
  on public.patient_files (clinic_id, patient_id, access_scope, created_at desc);

-- Changes to ACL fields must go through the server-side RPC below. This prevents an
-- authenticated client from bypassing the atomic grant replacement operation.
create or replace function public.enforce_patient_file_acl_write_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.uploaded_by is distinct from old.uploaded_by
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'PATIENT_FILE_UPLOADER_IMMUTABLE';
  end if;

  if (
      new.access_scope is distinct from old.access_scope
      or new.patient_portal_visible is distinct from old.patient_portal_visible
    )
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'PATIENT_FILE_ACCESS_RPC_REQUIRED';
  end if;

  return new;
end;
$function$;

drop trigger if exists patient_file_acl_write_guard_v1 on public.patient_files;
create trigger patient_file_acl_write_guard_v1
before update of uploaded_by, access_scope, patient_portal_visible
on public.patient_files
for each row
execute function public.enforce_patient_file_acl_write_v1();

create or replace function public.set_patient_file_access_v1(
  p_file_id uuid,
  p_patient_id uuid,
  p_clinic_id uuid,
  p_actor_id uuid,
  p_access_scope text,
  p_patient_portal_visible boolean,
  p_selected_user_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_file public.patient_files%rowtype;
  v_scope text := upper(btrim(coalesce(p_access_scope, '')));
  v_selected uuid[] := coalesce(p_selected_user_ids, array[]::uuid[]);
  v_selected_count integer := 0;
  v_valid_count integer := 0;
begin
  if v_scope not in ('OWNER', 'CASE_TEAM', 'PATIENT_ACCESS', 'SELECTED') then
    raise exception 'PATIENT_FILE_ACCESS_SCOPE_INVALID';
  end if;

  select * into v_file
  from public.patient_files f
  where f.id = p_file_id
    and f.patient_id = p_patient_id
    and f.clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'PATIENT_FILE_NOT_FOUND';
  end if;

  if v_file.uploaded_by is null or v_file.uploaded_by <> p_actor_id then
    raise exception 'PATIENT_FILE_ACCESS_OWNER_REQUIRED';
  end if;

  select count(distinct selected_id)
  into v_selected_count
  from unnest(v_selected) selected_id;

  if v_selected_count > 100 then
    raise exception 'PATIENT_FILE_ACCESS_GRANT_LIMIT';
  end if;

  if v_scope = 'SELECTED' and v_selected_count = 0 then
    raise exception 'PATIENT_FILE_ACCESS_SELECTED_EMPTY';
  end if;

  if v_scope = 'SELECTED' then
    select count(distinct selected_id)
    into v_valid_count
    from unnest(v_selected) selected_id
    where selected_id <> p_actor_id
      and exists (
        select 1
        from public.patient_professional_links link
        where link.patient_id = p_patient_id
          and link.professional_id = selected_id::text
          and link.status = 'active'
          and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
      );

    if v_valid_count <> (
      select count(distinct selected_id)
      from unnest(v_selected) selected_id
      where selected_id <> p_actor_id
    ) then
      raise exception 'PATIENT_FILE_ACCESS_GRANTEE_OUTSIDE_CASE_TEAM';
    end if;
  end if;

  update public.patient_files
  set access_scope = v_scope,
      patient_portal_visible = coalesce(p_patient_portal_visible, false),
      updated_at = now()
  where id = p_file_id;

  delete from public.patient_file_access_grants
  where file_id = p_file_id;

  if v_scope = 'SELECTED' then
    insert into public.patient_file_access_grants (
      file_id, patient_id, clinic_id, grantee_user_id, granted_by
    )
    select p_file_id, p_patient_id, p_clinic_id, selected_id, p_actor_id
    from (
      select distinct selected_id
      from unnest(v_selected) selected_id
      where selected_id <> p_actor_id
    ) selected;
  end if;

  return jsonb_build_object(
    'fileId', p_file_id,
    'accessScope', v_scope,
    'patientPortalVisible', coalesce(p_patient_portal_visible, false),
    'selectedUserIds', case
      when v_scope = 'SELECTED' then (
        select coalesce(jsonb_agg(grant_row.grantee_user_id order by grant_row.grantee_user_id::text), '[]'::jsonb)
        from public.patient_file_access_grants grant_row
        where grant_row.file_id = p_file_id
      )
      else '[]'::jsonb
    end
  );
end;
$function$;

revoke all on function public.set_patient_file_access_v1(uuid, uuid, uuid, uuid, text, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.set_patient_file_access_v1(uuid, uuid, uuid, uuid, text, boolean, uuid[]) to service_role;

-- Direct-storage RLS needs a patient-access decision as well; membership alone must
-- never imply access to every patient in a clinic.
create or replace function public.patient_file_actor_has_patient_access_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.clinic_id = p_clinic_id
      and (
        exists (
          select 1
          from public.clinics c
          where c.id = p_clinic_id
            and c.owner_user_id = p_actor_id
        )
        or exists (
          select 1
          from public.clinic_memberships cm
          where cm.user_id = p_actor_id
            and cm.clinic_id = p_clinic_id
            and cm.status = 'active'
            and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
        )
        or exists (
          select 1
          from public.users u
          where u.id = p_actor_id
            and u.clinic_id = p_clinic_id
            and lower(coalesce(u.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
        )
        or p.therapist_id = p_actor_id
        or exists (
          select 1
          from public.patient_professional_links link
          where link.patient_id = p_patient_id
            and link.professional_id = p_actor_id::text
            and link.status = 'active'
            and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
        )
      )
  );
$function$;

revoke all on function public.patient_file_actor_has_patient_access_v1(uuid, uuid, uuid) from public;
grant execute on function public.patient_file_actor_has_patient_access_v1(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.patient_file_current_actor_can_read_v1(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select exists (
    select 1
    from public.patient_files f
    where f.id = p_file_id
      and (
        f.uploaded_by = auth.uid()
        or (
          f.patient_portal_visible = true
          and exists (
            select 1
            from public.patients p
            where p.id = f.patient_id
              and p.responsible_user_id = auth.uid()
          )
        )
        or (
          f.access_scope = 'PATIENT_ACCESS'
          and public.patient_file_actor_has_patient_access_v1(auth.uid(), f.clinic_id, f.patient_id)
        )
        or (
          f.access_scope = 'CASE_TEAM'
          and exists (
            select 1
            from public.patient_professional_links link
            where link.patient_id = f.patient_id
              and link.professional_id = auth.uid()::text
              and link.status = 'active'
              and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
          )
        )
        or (
          f.access_scope = 'SELECTED'
          and exists (
            select 1
            from public.patient_file_access_grants grant_row
            where grant_row.file_id = f.id
              and grant_row.grantee_user_id = auth.uid()
          )
        )
      )
  );
$function$;

revoke all on function public.patient_file_current_actor_can_read_v1(uuid) from public;
grant execute on function public.patient_file_current_actor_can_read_v1(uuid) to authenticated, service_role;

alter table public.patient_file_access_grants enable row level security;
alter table public.patient_files enable row level security;

-- Read access is now enforced at the database too, including direct storage access.
drop policy if exists patient_files_select on public.patient_files;
create policy patient_files_select
on public.patient_files
for select
to authenticated
using (public.patient_file_current_actor_can_read_v1(id));

-- Preserve the pre-existing write roles, but never allow an actor to mutate a file
-- that the ACL itself hides from them. ACL columns are additionally protected by trigger.
drop policy if exists patient_files_update on public.patient_files;
create policy patient_files_update
on public.patient_files
for update
to authenticated
using (
  public.patient_file_current_actor_can_read_v1(id)
  and (
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
)
with check (
  public.patient_file_current_actor_can_read_v1(id)
  and (
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
);

drop policy if exists patient_files_delete on public.patient_files;
create policy patient_files_delete
on public.patient_files
for delete
to authenticated
using (
  public.patient_file_current_actor_can_read_v1(id)
  and (
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
);

-- Grants are readable only by the uploader. All grant mutations happen inside the
-- service-role RPC so DELETE + INSERT is one transaction under the file row lock.
drop policy if exists patient_file_access_grants_select_v1 on public.patient_file_access_grants;
create policy patient_file_access_grants_select_v1
on public.patient_file_access_grants
for select
to authenticated
using (
  exists (
    select 1 from public.patient_files f
    where f.id = patient_file_access_grants.file_id
      and f.uploaded_by = auth.uid()
  )
);

revoke insert, update, delete on table public.patient_file_access_grants from anon, authenticated;
grant select on table public.patient_file_access_grants to authenticated;
grant all on table public.patient_file_access_grants to service_role;

drop policy if exists "patient files private read" on storage.objects;
create policy "patient files private read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'patient-files-private'
  and exists (
    select 1
    from public.patient_files f
    where f.storage_path = storage.objects.name
      and public.patient_file_current_actor_can_read_v1(f.id)
  )
);

-- Preserve deletion for actors that had it before, but only for files the ACL permits.
drop policy if exists "patient files private delete" on storage.objects;
create policy "patient files private delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'patient-files-private'
  and exists (
    select 1
    from public.patient_files f
    where f.storage_path = storage.objects.name
      and public.patient_file_current_actor_can_read_v1(f.id)
      and (
        exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and (
              u.role in ('owner', 'admin')
              or (u.role in ('coordinator', 'receptionist', 'therapist') and u.clinic_id = f.clinic_id)
            )
        )
        or exists (
          select 1
          from public.clinic_memberships cm
          where cm.user_id = auth.uid()
            and cm.clinic_id = f.clinic_id
            and cm.status = 'active'
            and cm.role in ('coordinator', 'receptionist', 'therapist')
        )
      )
  )
);

commit;
