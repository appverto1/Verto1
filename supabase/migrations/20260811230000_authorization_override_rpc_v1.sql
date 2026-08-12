-- Verto authorization override RPC v1
-- Atomic single-capability grant/deny/reset + immutable audit event.

begin;

create or replace function public.set_clinic_membership_permission_override_v1(
  p_membership_id uuid,
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
  v_target_user_id uuid;
  v_clinic_id uuid;
  v_previous_effect text;
  v_now timestamptz := now();
begin
  if p_membership_id is null then
    raise exception 'membership_id is required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_permission_key, '')), '') is null then
    raise exception 'permission_key is required' using errcode = '22023';
  end if;
  if p_effect is not null and p_effect not in ('allow', 'deny') then
    raise exception 'effect must be allow, deny or null' using errcode = '22023';
  end if;

  select cm.user_id, cm.clinic_id
    into v_target_user_id, v_clinic_id
  from public.clinic_memberships cm
  where cm.id = p_membership_id
    and cm.status = 'active'
  for update;

  if v_target_user_id is null or v_clinic_id is null then
    raise exception 'active membership not found' using errcode = 'P0002';
  end if;

  select o.effect
    into v_previous_effect
  from public.clinic_membership_permission_overrides o
  where o.membership_id = p_membership_id
    and o.permission_key = p_permission_key
  limit 1;

  if p_effect is null then
    delete from public.clinic_membership_permission_overrides
    where membership_id = p_membership_id
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
    ) values (
      p_membership_id,
      p_permission_key,
      p_effect,
      p_actor_user_id,
      nullif(btrim(coalesce(p_reason, '')), ''),
      v_now,
      v_now
    )
    on conflict (membership_id, permission_key)
    do update set
      effect = excluded.effect,
      granted_by = excluded.granted_by,
      reason = excluded.reason,
      updated_at = excluded.updated_at;
  end if;

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
  ) values (
    p_actor_user_id,
    v_target_user_id,
    v_clinic_id,
    'permission_override_changed',
    p_permission_key,
    case when v_previous_effect is null then null else jsonb_build_object('effect', v_previous_effect) end,
    case when p_effect is null then null else jsonb_build_object('effect', p_effect) end,
    nullif(btrim(coalesce(p_reason, '')), ''),
    v_now
  );

  return jsonb_build_object(
    'membershipId', p_membership_id,
    'targetUserId', v_target_user_id,
    'clinicId', v_clinic_id,
    'permissionKey', p_permission_key,
    'previousEffect', v_previous_effect,
    'effect', p_effect,
    'updatedAt', v_now
  );
end;
$$;

revoke all on function public.set_clinic_membership_permission_override_v1(uuid, text, text, uuid, text) from public;
revoke all on function public.set_clinic_membership_permission_override_v1(uuid, text, text, uuid, text) from anon;
revoke all on function public.set_clinic_membership_permission_override_v1(uuid, text, text, uuid, text) from authenticated;
grant execute on function public.set_clinic_membership_permission_override_v1(uuid, text, text, uuid, text) to service_role;

comment on function public.set_clinic_membership_permission_override_v1(uuid, text, text, uuid, text) is
  'Atomic server-only capability override mutation with authorization audit event.';

commit;
