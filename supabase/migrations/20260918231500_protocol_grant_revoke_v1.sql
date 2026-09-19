-- Issue #207: canonical tenant-scoped protocol grant revocation.
-- Forward-only. Recovery/regrant is intentionally performed through the existing
-- approve_protocol_import_request_v1 flow, which reactivates the same UNIQUE
-- (clinic_id, canonical_key) grant without deleting request or usage history.
--
-- Authorization split:
-- - this RPC is service-role-only;
-- - the application server must resolve the actor from the authenticated session
--   and enforce the effective aba.program.edit capability before invoking it;
-- - the database independently validates platform-admin authority or active
--   clinic membership and rejects an explicit deny override as defense in depth.
-- Role defaults/module capability composition remain application-owned and are
-- deliberately not duplicated in SQL.

create or replace function public.revoke_clinic_protocol_grant_v1(
  p_actor_id uuid,
  p_request_id uuid
) returns public.clinic_protocol_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.protocol_import_requests%rowtype;
  v_grant public.clinic_protocol_grants%rowtype;
  v_membership_id uuid;
  v_is_platform_admin boolean := false;
  v_event_type text;
  v_previous_value jsonb;
begin
  if p_actor_id is null then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'request_required' using errcode = '22023';
  end if;

  select *
    into v_request
  from public.protocol_import_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_request.clinic_id is null then
    raise exception 'request_clinic_required' using errcode = '23502';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'approved_request_required' using errcode = '22023';
  end if;
  if nullif(lower(trim(coalesce(v_request.approved_canonical_key, ''))), '') is null then
    raise exception 'approved_canonical_key_required' using errcode = '22023';
  end if;

  v_is_platform_admin := public.is_platform_admin(p_actor_id);

  if not v_is_platform_admin then
    select cm.id
      into v_membership_id
    from public.clinic_memberships cm
    where cm.user_id = p_actor_id
      and cm.clinic_id = v_request.clinic_id
      and cm.status = 'active'
    limit 1;

    if v_membership_id is null then
      raise exception 'active_clinic_membership_required' using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.clinic_membership_permission_overrides mpo
      where mpo.membership_id = v_membership_id
        and mpo.permission_key = 'aba.program.edit'
        and mpo.effect = 'deny'
    ) then
      raise exception 'protocol_edit_capability_denied' using errcode = '42501';
    end if;
  end if;

  select *
    into v_grant
  from public.clinic_protocol_grants
  where clinic_id = v_request.clinic_id
    and canonical_key = lower(trim(v_request.approved_canonical_key))
  for update;

  if not found then
    raise exception 'protocol_grant_not_found' using errcode = 'P0002';
  end if;

  if v_grant.revoked_at is not null then
    return v_grant;
  end if;

  v_previous_value := jsonb_build_object(
    'grant_id', v_grant.id,
    'request_id', v_request.id,
    'canonical_key', v_grant.canonical_key,
    'revoked_at', v_grant.revoked_at,
    'revoked_by', v_grant.revoked_by
  );

  update public.clinic_protocol_grants
  set revoked_at = now(),
      revoked_by = p_actor_id
  where id = v_grant.id
    and revoked_at is null
  returning * into v_grant;

  if not found then
    select *
      into v_grant
    from public.clinic_protocol_grants
    where id = v_grant.id;

    return v_grant;
  end if;

  v_event_type := case
    when v_is_platform_admin then 'protocol_grant_admin_revoked'
    else 'protocol_grant_self_revoked'
  end;

  insert into public.authorization_audit_events (
    actor_user_id,
    clinic_id,
    event_type,
    permission_key,
    previous_value,
    new_value,
    reason
  ) values (
    p_actor_id,
    v_request.clinic_id,
    v_event_type,
    'aba.program.edit',
    v_previous_value,
    jsonb_build_object(
      'grant_id', v_grant.id,
      'request_id', v_request.id,
      'canonical_key', v_grant.canonical_key,
      'revoked_at', v_grant.revoked_at,
      'revoked_by', v_grant.revoked_by
    ),
    case
      when v_is_platform_admin then 'protocol grant revoked by platform admin'
      else 'protocol grant revoked by authorized clinic actor'
    end
  );

  return v_grant;
end;
$$;

revoke all on function public.revoke_clinic_protocol_grant_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_clinic_protocol_grant_v1(uuid, uuid)
  to service_role;

comment on function public.revoke_clinic_protocol_grant_v1(uuid, uuid) is
  'Service-role-only canonical tenant-scoped protocol grant revoke. Resolves clinic/key from approved request, preserves request/grant/history, validates actor membership/admin, rejects explicit aba.program.edit deny, and writes one audit event only on the first revoke.';
