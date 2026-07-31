-- Atomic, server-authoritative acceptance of professional clinic invitations.
-- The function is service-role only; the browser never supplies clinic_id or role.

create or replace function public.accept_clinic_invitation_v1(
  p_invitation_id uuid,
  p_user_id uuid,
  p_verified_email text
)
returns table (
  invitation_id uuid,
  clinic_id uuid,
  membership_role text,
  invitation_status text,
  membership_status text,
  idempotent boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.invitations%rowtype;
  v_email text := lower(trim(coalesce(p_verified_email, '')));
  v_status text;
  v_role text;
  v_existing_membership public.clinic_memberships%rowtype;
  v_invited_by uuid;
begin
  if p_invitation_id is null or p_user_id is null or v_email = '' then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_INVALID';
  end if;

  select *
    into v_invitation
    from public.invitations
   where id = p_invitation_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_NOT_FOUND';
  end if;

  if lower(trim(coalesce(v_invitation.email::text, ''))) <> v_email then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_EMAIL_MISMATCH';
  end if;

  v_status := lower(trim(coalesce(v_invitation.status::text, '')));
  v_role := lower(trim(coalesce(v_invitation.role::text, '')));

  if v_role not in ('coordinator', 'therapist', 'receptionist') then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ROLE_INVALID';
  end if;

  select *
    into v_existing_membership
    from public.clinic_memberships
   where user_id = p_user_id
     and clinic_id = v_invitation.clinic_id
   limit 1
   for update;

  if v_status = 'accepted' then
    if v_existing_membership.user_id is null
       or lower(trim(coalesce(v_existing_membership.status::text, ''))) <> 'active' then
      raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ALREADY_USED';
    end if;

    return query
      select v_invitation.id,
             v_invitation.clinic_id,
             v_existing_membership.role::text,
             v_status,
             v_existing_membership.status::text,
             true;
    return;
  end if;

  if v_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_NOT_AVAILABLE';
  end if;

  -- A pending invitation created before an explicit unlink cannot reactivate the
  -- old membership. A new invitation must have been created after the unlink.
  if v_existing_membership.user_id is not null
     and lower(trim(coalesce(v_existing_membership.status::text, ''))) <> 'active'
     and coalesce(v_invitation.created_at, '-infinity'::timestamptz)
         <= coalesce(
              v_existing_membership.updated_at,
              v_existing_membership.created_at,
              'infinity'::timestamptz
            ) then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ALREADY_USED';
  end if;

  if coalesce(v_invitation.invited_by::text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_invited_by := v_invitation.invited_by::text::uuid;
  else
    v_invited_by := null;
  end if;

  insert into public.clinic_memberships (
    user_id,
    clinic_id,
    role,
    status,
    invited_by,
    created_at,
    updated_at
  ) values (
    p_user_id,
    v_invitation.clinic_id,
    v_role,
    'active',
    v_invited_by,
    now(),
    now()
  )
  on conflict (user_id, clinic_id)
  do update set
    role = excluded.role,
    status = 'active',
    invited_by = excluded.invited_by,
    updated_at = now();

  update public.invitations
     set status = 'accepted',
         accepted_at = coalesce(accepted_at, now()),
         updated_at = now()
   where id = v_invitation.id
     and status = 'pending';

  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_CONCURRENT_UPDATE';
  end if;

  return query
    select v_invitation.id,
           v_invitation.clinic_id,
           v_role,
           'accepted'::text,
           'active'::text,
           false;
end;
$$;

revoke all on function public.accept_clinic_invitation_v1(uuid, uuid, text) from public;
revoke all on function public.accept_clinic_invitation_v1(uuid, uuid, text) from anon;
revoke all on function public.accept_clinic_invitation_v1(uuid, uuid, text) from authenticated;
grant execute on function public.accept_clinic_invitation_v1(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
