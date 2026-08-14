-- Verto authorization bulk override RPC v1
-- Atomic multi-member capability grant/deny/reset with one audit event per membership.

begin;

create or replace function public.set_clinic_membership_permission_overrides_bulk_v1(
  p_membership_ids uuid[],
  p_permission_key text,
  p_effect text,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_requested_count integer;
  v_active_count integer;
  v_clinic_count integer;
  v_now timestamptz := now();
begin
  v_requested_count := coalesce(cardinality(p_membership_ids), 0);
  if v_requested_count < 1 or v_requested_count > 100 then
    raise exception 'membership_ids must contain between 1 and 100 items' using errcode = '22023';
  end if;
  if (
    select count(*)
    from (select distinct value from unnest(p_membership_ids) as requested(value)) deduped
  ) <> v_requested_count then
    raise exception 'membership_ids must not contain duplicates' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_permission_key, '')), '') is null then
    raise exception 'permission_key is required' using errcode = '22023';
  end if;
  if p_effect is not null and p_effect not in ('allow', 'deny') then
    raise exception 'effect must be allow, deny or null' using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_user_id is required' using errcode = '22023';
  end if;

  select count(*), count(distinct cm.clinic_id)
    into v_active_count, v_clinic_count
  from public.clinic_memberships cm
  where cm.id = any(p_membership_ids)
    and cm.status = 'active';

  if v_active_count <> v_requested_count then
    raise exception 'one or more active memberships were not found' using errcode = 'P0002';
  end if;
  if v_clinic_count <> 1 then
    raise exception 'all memberships must belong to the same clinic' using errcode = '22023';
  end if;

  -- Lock all target memberships in deterministic order so concurrent batch/single
  -- mutations cannot interleave into a partially observed state.
  perform 1
  from public.clinic_memberships cm
  where cm.id = any(p_membership_ids)
    and cm.status = 'active'
  order by cm.id
  for update;

  -- Append-only audit is part of the same transaction. Any later failure rolls
  -- these rows back together with the permission mutation.
  insert into public.authorization_audit_events (
    actor_user_id,
    target_user_id,
    clinic_id,
    event_type,
    permission_key,
    previous_value,
    new_value,
    reason,
    created_at
  )
  select
    p_actor_user_id,
    cm.user_id,
    cm.clinic_id,
    'permission_override_changed',
    p_permission_key,
    case when existing.effect is null then null else jsonb_build_object('effect', existing.effect) end,
    case when p_effect is null then null else jsonb_build_object('effect', p_effect) end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_now
  from public.clinic_memberships cm
  left join public.clinic_membership_permission_overrides existing
    on existing.membership_id = cm.id
   and existing.permission_key = p_permission_key
  where cm.id = any(p_membership_ids)
    and cm.status = 'active'
    and existing.effect is distinct from p_effect;

  if p_effect is null then
    delete from public.clinic_membership_permission_overrides
    where membership_id = any(p_membership_ids)
      and permission_key = p_permission_key;
  else
    insert into public.clinic_membership_permission_overrides (
      membership_id,
      permission_key,
      effect,
      granted_by,
      reason,
      created_at,
      updated_at
    )
    select
      cm.id,
      p_permission_key,
      p_effect,
      p_actor_user_id,
      nullif(btrim(coalesce(p_reason, '')), ''),
      v_now,
      v_now
    from public.clinic_memberships cm
    where cm.id = any(p_membership_ids)
      and cm.status = 'active'
    on conflict (membership_id, permission_key)
    do update set
      effect = excluded.effect,
      granted_by = excluded.granted_by,
      reason = excluded.reason,
      updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object(
    'updatedCount', v_requested_count,
    'permissionKey', p_permission_key,
    'effect', p_effect,
    'updatedAt', v_now
  );
end;
$$;

revoke all on function public.set_clinic_membership_permission_overrides_bulk_v1(uuid[], text, text, uuid, text) from public;
revoke all on function public.set_clinic_membership_permission_overrides_bulk_v1(uuid[], text, text, uuid, text) from anon;
revoke all on function public.set_clinic_membership_permission_overrides_bulk_v1(uuid[], text, text, uuid, text) from authenticated;
grant execute on function public.set_clinic_membership_permission_overrides_bulk_v1(uuid[], text, text, uuid, text) to service_role;

comment on function public.set_clinic_membership_permission_overrides_bulk_v1(uuid[], text, text, uuid, text) is
  'Atomic server-only multi-membership capability override mutation with one append-only audit event per target membership.';

commit;
