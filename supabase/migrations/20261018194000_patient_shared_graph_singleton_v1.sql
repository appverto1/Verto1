-- One global shared clinical graph per verified patient identity.
-- All reads/writes are performed by the authenticated Express API using its service-role client.
-- No anon/authenticated grants or permissive RLS policies.
begin;

create table if not exists public.patient_shared_graph_publications (
  global_patient_identity_id uuid primary key,
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id),
  graph_type text not null check (graph_type in ('protocol_comparison','mastery_growth','clinical_metric')),
  graph_key text not null default '',
  status text not null default 'INACTIVE' check (status in ('ACTIVE','INACTIVE')),
  version bigint not null default 0 check (version >= 0),
  published_by uuid,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists patient_shared_graph_publications_owner_idx on public.patient_shared_graph_publications(clinic_id,patient_id) where status = 'ACTIVE';
alter table public.patient_shared_graph_publications enable row level security;
revoke all on public.patient_shared_graph_publications from public, anon, authenticated;
grant select, insert, update, delete on public.patient_shared_graph_publications to service_role;

create table if not exists public.patient_shared_graph_delegations (
  patient_id uuid not null references public.patients(id),
  clinic_id uuid not null references public.clinics(id),
  professional_user_id uuid not null,
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  primary key (patient_id, clinic_id, professional_user_id)
);
create index if not exists patient_shared_graph_delegations_professional_idx on public.patient_shared_graph_delegations(professional_user_id,clinic_id,patient_id) where revoked_at is null;
alter table public.patient_shared_graph_delegations enable row level security;
revoke all on public.patient_shared_graph_delegations from public, anon, authenticated;
grant select, insert, update, delete on public.patient_shared_graph_delegations to service_role;

create table if not exists public.patient_shared_graph_audit (
  id bigint generated always as identity primary key,
  global_patient_identity_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('PUBLISH','REPLACE','DISABLE','AUTO_DISABLE','DELEGATE','REVOKE')),
  old_graph_type text,
  old_graph_key text,
  new_graph_type text,
  new_graph_key text,
  created_at timestamptz not null default now()
);
create index if not exists patient_shared_graph_audit_subject_idx on public.patient_shared_graph_audit(global_patient_identity_id, created_at desc);
alter table public.patient_shared_graph_audit enable row level security;
revoke all on public.patient_shared_graph_audit from public, anon, authenticated;
grant select, insert on public.patient_shared_graph_audit to service_role;

-- Service-role-only transaction: one row per verified identity, row locked for every swap.
-- Express must independently authorize actor and graph read scope before calling this RPC.
create or replace function public.set_patient_shared_graph_v1(
  p_identity_id uuid, p_clinic_id uuid, p_patient_id uuid, p_actor_id uuid,
  p_action text, p_graph_type text, p_graph_key text, p_expected_version bigint
)
returns table (out_version bigint, out_status text)
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  current_record public.patient_shared_graph_publications%rowtype;
  next_status text;
  next_type text;
  next_key text;
begin
  if p_identity_id is null or p_clinic_id is null or p_patient_id is null or p_actor_id is null
     or p_expected_version is null or p_action not in ('PUBLISH','DISABLE') then
    raise exception 'SHARED_GRAPH_INVALID_REQUEST' using errcode='22023';
  end if;
  if p_action = 'PUBLISH' and (
       p_graph_type is null or p_graph_type not in ('protocol_comparison','mastery_growth','clinical_metric')
       or length(coalesce(p_graph_key,'')) > 180
       or (p_graph_type = 'clinical_metric' and length(coalesce(p_graph_key,'')) < 1)
  ) then
    raise exception 'SHARED_GRAPH_INVALID_GRAPH' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.patients p
    where p.id=p_patient_id and p.clinic_id=p_clinic_id
      and p.global_patient_identity_id=p_identity_id
      and p.is_active is true and p.deleted_at is null and p.archived_at is null
      and coalesce(lower(p.relationship_status),'active') not in ('ended','inactive','terminated','revoked')
  ) then
    raise exception 'SHARED_GRAPH_PATIENT_NOT_LINKED' using errcode='42501';
  end if;

  insert into public.patient_shared_graph_publications
     (global_patient_identity_id,clinic_id,patient_id,graph_type,graph_key,status,version)
  values (p_identity_id,p_clinic_id,p_patient_id,'protocol_comparison','','INACTIVE',0)
  on conflict (global_patient_identity_id) do nothing;

  select * into current_record
  from public.patient_shared_graph_publications
  where global_patient_identity_id=p_identity_id
  for update;

  if current_record.version <> p_expected_version then
    raise exception 'SHARED_GRAPH_VERSION_CONFLICT' using errcode='40001';
  end if;
  if current_record.status = 'ACTIVE' and (current_record.clinic_id <> p_clinic_id or current_record.patient_id <> p_patient_id) then
    raise exception 'SHARED_GRAPH_OTHER_CLINIC_OWNS_PUBLICATION' using errcode='42501';
  end if;
  if p_action = 'DISABLE' and (current_record.clinic_id <> p_clinic_id or current_record.patient_id <> p_patient_id) then
    raise exception 'SHARED_GRAPH_OTHER_CLINIC_OWNS_PUBLICATION' using errcode='42501';
  end if;

  next_status := case when p_action='PUBLISH' then 'ACTIVE' else 'INACTIVE' end;
  next_type := case when p_action='PUBLISH' then p_graph_type else current_record.graph_type end;
  next_key := case when p_action='PUBLISH' then coalesce(p_graph_key,'') else current_record.graph_key end;

  update public.patient_shared_graph_publications
    set clinic_id=p_clinic_id,patient_id=p_patient_id,graph_type=next_type,graph_key=next_key,
        status=next_status,version=version+1,updated_at=now(),
        published_by=case when p_action='PUBLISH' then p_actor_id else published_by end,
        published_at=case when p_action='PUBLISH' then now() else published_at end
  where global_patient_identity_id=p_identity_id
  returning version,status into out_version,out_status;

  insert into public.patient_shared_graph_audit (
    global_patient_identity_id,clinic_id,patient_id,actor_id,action,
    old_graph_type,old_graph_key,new_graph_type,new_graph_key
  ) values (
    p_identity_id,p_clinic_id,p_patient_id,p_actor_id,
    case when p_action='DISABLE' then 'DISABLE' when current_record.status='ACTIVE' then 'REPLACE' else 'PUBLISH' end,
    case when current_record.status='ACTIVE' then current_record.graph_type end,
    case when current_record.status='ACTIVE' then current_record.graph_key end,
    case when next_status='ACTIVE' then next_type end,
    case when next_status='ACTIVE' then next_key end
  );
  return next;
end
$$;
revoke execute on function public.set_patient_shared_graph_v1(uuid,uuid,uuid,uuid,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.set_patient_shared_graph_v1(uuid,uuid,uuid,uuid,text,text,text,bigint) to service_role;

-- Delegations and their audit records commit together, not as two HTTP writes.
create or replace function public.set_patient_shared_graph_delegation_v1(
  p_patient_id uuid,p_clinic_id uuid,p_professional_id uuid,p_actor_id uuid,p_allow boolean
)
returns void language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_identity uuid;
begin
  if p_patient_id is null or p_clinic_id is null or p_professional_id is null
     or p_actor_id is null or p_allow is null then
    raise exception 'SHARED_GRAPH_INVALID_DELEGATION' using errcode='22023';
  end if;
  select p.global_patient_identity_id into v_identity from public.patients p
  where p.id=p_patient_id and p.clinic_id=p_clinic_id and p.is_active=true
    and p.deleted_at is null and p.archived_at is null;
  if v_identity is null then
    raise exception 'SHARED_GRAPH_PATIENT_NOT_LINKED' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.patient_professional_links l
    join public.clinic_memberships m on m.clinic_id=p_clinic_id and m.user_id=p_professional_id
    where l.patient_id=p_patient_id and l.organization_id=p_clinic_id::text
      and l.professional_id=p_professional_id::text and l.status='active'
      and m.status='active' and m.role in ('therapist','supervisor')
  ) then
    raise exception 'SHARED_GRAPH_PROFESSIONAL_NOT_ON_CASE' using errcode='42501';
  end if;
  insert into public.patient_shared_graph_delegations(
    patient_id,clinic_id,professional_user_id,granted_by,granted_at,revoked_at,revoked_by
  ) values (
    p_patient_id,p_clinic_id,p_professional_id,p_actor_id,now(),
    case when p_allow then null else now() end,
    case when p_allow then null else p_actor_id end
  ) on conflict (patient_id,clinic_id,professional_user_id)
    do update set granted_by=excluded.granted_by,granted_at=excluded.granted_at,
      revoked_at=excluded.revoked_at,revoked_by=excluded.revoked_by;
  insert into public.patient_shared_graph_audit(
    global_patient_identity_id,clinic_id,patient_id,actor_id,action
  ) values(v_identity,p_clinic_id,p_patient_id,p_actor_id,case when p_allow then 'DELEGATE' else 'REVOKE' end);
end
$$;
revoke execute on function public.set_patient_shared_graph_delegation_v1(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_patient_shared_graph_delegation_v1(uuid,uuid,uuid,uuid,boolean) to service_role;

-- Loss of clinic relationship immediately invalidates its publication.
create schema if not exists verto_internal_graph;
revoke all on schema verto_internal_graph from public, anon, authenticated;
create or replace function verto_internal_graph.invalidate_patient_shared_graph_on_unlink_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare old_record public.patient_shared_graph_publications%rowtype;
begin
  if new.is_active is not true or new.deleted_at is not null or new.archived_at is not null
     or new.clinic_id is distinct from old.clinic_id
     or new.global_patient_identity_id is distinct from old.global_patient_identity_id
     or coalesce(lower(new.relationship_status),'active') in ('ended','inactive','terminated','revoked') then
    select * into old_record from public.patient_shared_graph_publications
    where patient_id=old.id and clinic_id=old.clinic_id and status='ACTIVE' for update;
    if found then
      update public.patient_shared_graph_publications set status='INACTIVE',version=version+1,updated_at=now()
      where global_patient_identity_id=old_record.global_patient_identity_id;
      insert into public.patient_shared_graph_audit(
        global_patient_identity_id,clinic_id,patient_id,action,old_graph_type,old_graph_key
      ) values(
        old_record.global_patient_identity_id,old_record.clinic_id,old_record.patient_id,
        'AUTO_DISABLE',old_record.graph_type,old_record.graph_key
      );
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists trg_invalidate_patient_shared_graph_on_unlink_v1 on public.patients;
create trigger trg_invalidate_patient_shared_graph_on_unlink_v1
after update of is_active,deleted_at,archived_at,clinic_id,global_patient_identity_id,relationship_status
on public.patients for each row
execute function verto_internal_graph.invalidate_patient_shared_graph_on_unlink_v1();
revoke execute on function verto_internal_graph.invalidate_patient_shared_graph_on_unlink_v1() from public, anon, authenticated;

commit;
