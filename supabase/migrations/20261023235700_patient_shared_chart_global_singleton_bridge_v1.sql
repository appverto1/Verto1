-- P0: preserve the existing chart descriptor (PLAN_PTS/ABA_V3) and one
-- selection per clinic/patient. A non-null canonical global identity activates
-- an additional singleton across clinics, without backfilling unverified IDs.
-- This synchronizes in the same transaction as the existing Save RPC.

alter table public.patient_shared_graph_publications
  drop constraint if exists patient_shared_graph_publications_graph_type_check;
alter table public.patient_shared_graph_publications
  add constraint patient_shared_graph_publications_graph_type_check
  check (graph_type in ('protocol_comparison','mastery_growth','clinical_metric','PLAN_PTS','ABA_V3'));

create or replace function verto_internal_graph.sync_canonical_shared_chart_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_global uuid;
  v_previous public.patient_shared_graph_publications%rowtype;
begin
  if tg_op='DELETE' then
    -- A patient may already be deleted during FK cascade; read the
    -- prior owner from the registry rather than from the patient row.
    select * into v_previous from public.patient_shared_graph_publications
    where clinic_id=old.clinic_id and patient_id=old.patient_id and status='ACTIVE'
    for update;
    if found and v_previous.graph_type=old.chart_family and v_previous.graph_key=old.chart_key then
      update public.patient_shared_graph_publications
        set status='INACTIVE',version=version+1,updated_at=now()
      where global_patient_identity_id=v_previous.global_patient_identity_id;
      insert into public.patient_shared_graph_audit(
        global_patient_identity_id,clinic_id,patient_id,action,old_graph_type,old_graph_key
      ) values(
        v_previous.global_patient_identity_id,old.clinic_id,old.patient_id,
        'DISABLE',old.chart_family,old.chart_key
      );
    end if;
    return old;
  end if;

  if tg_op='UPDATE' and
     (new.clinic_id is distinct from old.clinic_id or new.patient_id is distinct from old.patient_id) then
    raise exception 'SHARED_CHART_OWNER_MOVE_DENIED' using errcode='42501';
  end if;

  select p.global_patient_identity_id into v_global
  from public.patients p
  where p.id=new.patient_id and p.clinic_id=new.clinic_id
    and p.is_active is true and p.deleted_at is null and p.archived_at is null
    and lower(coalesce(p.relationship_status,'active')) not in ('ended','inactive','terminated','revoked');
  if not found then
    raise exception 'SHARED_CHART_PATIENT_NOT_ACTIVE' using errcode='42501';
  end if;
  if v_global is null then
    -- There is no verified cross-clinic identity for this patient yet.
    -- Preserve exactly the existing tenant-scoped Save behavior.
    return new;
  end if;
  if new.chart_family not in ('PLAN_PTS','ABA_V3') then
    raise exception 'SHARED_CHART_FAMILY_INVALID' using errcode='22023';
  end if;

  insert into public.patient_shared_graph_publications(
    global_patient_identity_id,clinic_id,patient_id,graph_type,graph_key,status,version
  ) values(v_global,new.clinic_id,new.patient_id,new.chart_family,new.chart_key,'INACTIVE',0)
  on conflict(global_patient_identity_id) do nothing;

  select * into v_previous from public.patient_shared_graph_publications
  where global_patient_identity_id=v_global for update;
  if v_previous.status='ACTIVE' and
     (v_previous.clinic_id<>new.clinic_id or v_previous.patient_id<>new.patient_id) then
    raise exception 'SHARED_CHART_GLOBAL_OWNER_CONFLICT' using errcode='23505';
  end if;

  -- Idempotent Save: no duplicate audit/version for the same published chart.
  if v_previous.status='ACTIVE' and v_previous.clinic_id=new.clinic_id
     and v_previous.patient_id=new.patient_id and v_previous.graph_type=new.chart_family
     and v_previous.graph_key=new.chart_key then
    return new;
  end if;

  update public.patient_shared_graph_publications
    set clinic_id=new.clinic_id,patient_id=new.patient_id,
        graph_type=new.chart_family,graph_key=new.chart_key,
        status='ACTIVE',version=version+1,updated_at=now(),
        published_by=new.updated_by,published_at=now()
  where global_patient_identity_id=v_global;
  insert into public.patient_shared_graph_audit(
    global_patient_identity_id,clinic_id,patient_id,actor_id,action,
    old_graph_type,old_graph_key,new_graph_type,new_graph_key
  ) values(
    v_global,new.clinic_id,new.patient_id,new.updated_by,
    case when v_previous.status='ACTIVE' then 'REPLACE' else 'PUBLISH' end,
    case when v_previous.status='ACTIVE' then v_previous.graph_type end,
    case when v_previous.status='ACTIVE' then v_previous.graph_key end,
    new.chart_family,new.chart_key
  );
  return new;
end
$$;

drop trigger if exists trg_sync_canonical_shared_chart_v1 on public.patient_shared_chart_selections;
create trigger trg_sync_canonical_shared_chart_v1
after insert or update or delete on public.patient_shared_chart_selections
for each row execute function verto_internal_graph.sync_canonical_shared_chart_v1();
revoke execute on function verto_internal_graph.sync_canonical_shared_chart_v1() from public,anon,authenticated;

-- Reconcile the trigger already installed by the Draft migration in Staging.
-- Losing a live clinic relationship releases its verified-global ownership;
-- no chart series or patient record is deleted.
create or replace function verto_internal_graph.invalidate_patient_shared_graph_on_unlink_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_previous public.patient_shared_graph_publications%rowtype;
begin
  if new.is_active is not true or new.deleted_at is not null
     or new.archived_at is not null or new.clinic_id is distinct from old.clinic_id
     or new.global_patient_identity_id is distinct from old.global_patient_identity_id
     or lower(coalesce(new.relationship_status,'active')) in ('ended','inactive','terminated','revoked') then
    select * into v_previous from public.patient_shared_graph_publications
    where clinic_id=old.clinic_id and patient_id=old.id and status='ACTIVE'
    for update;
    if found then
      update public.patient_shared_graph_publications
      set status='INACTIVE',version=version+1,updated_at=now()
      where global_patient_identity_id=v_previous.global_patient_identity_id;
      insert into public.patient_shared_graph_audit(
        global_patient_identity_id,clinic_id,patient_id,action,old_graph_type,old_graph_key
      ) values (
        v_previous.global_patient_identity_id,v_previous.clinic_id,v_previous.patient_id,
        'AUTO_DISABLE',v_previous.graph_type,v_previous.graph_key
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
revoke execute on function verto_internal_graph.invalidate_patient_shared_graph_on_unlink_v1() from public,anon,authenticated;
