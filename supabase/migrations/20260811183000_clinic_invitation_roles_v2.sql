-- Verto clinic invitation roles v2
-- Extends atomic invitation acceptance to the new clinic-scoped base roles.
-- Additive: no existing membership or invitation rows are deleted.

begin;

-- Keep the invitation contract aligned with clinic_memberships when a legacy
-- role CHECK exists. The block is idempotent and does not touch invitation rows.
do $invitation_role_constraint$
declare
  item record;
begin
  if to_regclass('public.invitations') is null then
    raise exception 'CLINIC_INVITATIONS_TABLE_REQUIRED';
  end if;

  for item in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%role%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%coordinator%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%therapist%'
      and pg_catalog.pg_get_constraintdef(oid) ilike '%receptionist%'
  loop
    execute format('alter table public.invitations drop constraint %I', item.conname);
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::regclass
      and conname = 'invitations_role_v2'
  ) then
    alter table public.invitations
      add constraint invitations_role_v2
      check (role in ('director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller'));
  end if;
end;
$invitation_role_constraint$;

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
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_invitation public.invitations%rowtype;
  v_email text := lower(trim(coalesce(p_verified_email, '')));
  v_status text;
  v_role text;
  v_raw_specialty text;
  v_specialty text;
  v_existing_membership public.clinic_memberships%rowtype;
  v_invited_by uuid;
begin
  if p_invitation_id is null or p_user_id is null or v_email = '' then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_INVALID';
  end if;

  select invitation.*
    into v_invitation
    from public.invitations invitation
   where invitation.id = p_invitation_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_NOT_FOUND';
  end if;

  if lower(trim(coalesce(v_invitation.email::text, ''))) <> v_email then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_EMAIL_MISMATCH';
  end if;

  v_status := lower(trim(coalesce(v_invitation.status::text, '')));
  v_role := lower(trim(coalesce(v_invitation.role::text, '')));

  if v_role not in ('director', 'coordinator', 'supervisor', 'therapist', 'receptionist', 'biller') then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_ROLE_INVALID';
  end if;

  v_raw_specialty := coalesce(
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialty'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialtyName'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialty_name'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'professionalTitle'), ''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'professional_title'), '')
  );

  v_specialty := case lower(coalesce(v_raw_specialty, ''))
    when lower('Psicoterapeuta') then 'Psicoterapeuta'
    when lower('Fonoaudiólogo') then 'Fonoaudiólogo'
    when lower('Terapeuta Ocupacional') then 'Terapeuta Ocupacional'
    when lower('Nutricionista') then 'Nutricionista'
    when lower('Psicomotricista') then 'Psicomotricista'
    when lower('Psicopedagogo') then 'Psicopedagogo'
    when lower('Arteterapeuta') then 'Arteterapeuta'
    when lower('Musicoterapeuta') then 'Musicoterapeuta'
    when lower('Fisioterapeuta') then 'Fisioterapeuta'
    else null
  end;

  select membership.*
    into v_existing_membership
    from public.clinic_memberships membership
   where membership.user_id = p_user_id
     and membership.clinic_id = v_invitation.clinic_id
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

  if v_role = 'therapist' and v_specialty is null then
    raise exception using errcode = 'P0001', message = 'CLINIC_INVITATION_SPECIALTY_INVALID';
  end if;

  -- A pending invitation created before an explicit unlink cannot reactivate
  -- the old membership. A new invitation must be created after the unlink.
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

  if coalesce(v_invitation.invited_by::text, '') ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_invited_by := v_invitation.invited_by::text::uuid;
  else
    v_invited_by := null;
  end if;

  insert into public.clinic_memberships as membership (
    user_id,
    clinic_id,
    role,
    status,
    invited_by,
    specialty,
    settings_updated_at,
    settings_updated_by,
    created_at,
    updated_at
  ) values (
    p_user_id,
    v_invitation.clinic_id,
    v_role,
    'active',
    v_invited_by,
    case when v_role = 'therapist' then v_specialty else null end,
    clock_timestamp(),
    v_invited_by,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (user_id, clinic_id)
  do update set
    role = excluded.role,
    status = 'active',
    invited_by = excluded.invited_by,
    specialty = case
      when excluded.role = 'therapist' then excluded.specialty
      else null
    end,
    settings_updated_at = clock_timestamp(),
    settings_updated_by = excluded.settings_updated_by,
    updated_at = clock_timestamp();

  update public.invitations invitation
     set status = 'accepted',
         accepted_at = coalesce(invitation.accepted_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where invitation.id = v_invitation.id
     and invitation.status = 'pending';

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
$function$;

revoke all on function public.accept_clinic_invitation_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_clinic_invitation_v1(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
