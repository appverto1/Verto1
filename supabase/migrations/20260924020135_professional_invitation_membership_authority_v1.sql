-- #256 professional invitation membership authority hardening v1
-- Forward-only, staging-first. Keeps invitations as invite authority and
-- clinic_memberships(user_id, clinic_id) as the sole clinic membership authority.

begin;

alter table public.invitations
  add column if not exists expires_at timestamptz,
  add column if not exists accepted_user_id uuid references public.users(id) on delete set null;

alter table public.invitations
  alter column expires_at set default (now() + interval '7 days');

do $status_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.invitations'::regclass
      and conname='invitations_status_v1'
  ) then
    alter table public.invitations
      add constraint invitations_status_v1
      check (status in ('pending','accepted','canceled'));
  end if;
end
$status_constraint$;

create index if not exists idx_invitations_target_pending_expiry
  on public.invitations (clinic_id, lower(email), expires_at)
  where status='pending';

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
#variable_conflict use_column
declare
  v_invitation public.invitations%rowtype;
  v_user public.users%rowtype;
  v_email text := lower(trim(coalesce(p_verified_email, '')));
  v_status text;
  v_role text;
  v_raw_specialty text;
  v_specialty text;
  v_existing_membership public.clinic_memberships%rowtype;
  v_invited_by uuid;
  v_effective_expiry timestamptz;
begin
  if p_invitation_id is null or p_user_id is null or v_email = '' then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_INVALID';
  end if;

  select u.* into v_user
  from public.users u
  where u.id=p_user_id;

  if not found then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_USER_NOT_FOUND';
  end if;

  if lower(trim(coalesce(v_user.email,''))) <> v_email then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_IDENTITY_EMAIL_MISMATCH';
  end if;

  select invitation.* into v_invitation
  from public.invitations invitation
  where invitation.id=p_invitation_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_NOT_FOUND';
  end if;

  if v_invitation.clinic_id is null then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_CLINIC_INVALID';
  end if;

  if lower(trim(coalesce(v_invitation.email,''))) <> v_email then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_EMAIL_MISMATCH';
  end if;

  v_status := lower(trim(coalesce(v_invitation.status,'')));
  v_role := lower(trim(coalesce(v_invitation.role,'')));
  v_effective_expiry := coalesce(
    v_invitation.expires_at,
    coalesce(v_invitation.created_at, clock_timestamp()) + interval '7 days'
  );

  if v_role not in ('director','coordinator','supervisor','therapist','receptionist','biller') then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_ROLE_INVALID';
  end if;

  v_raw_specialty := coalesce(
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialty'),''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialtyName'),''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'specialty_name'),''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'professionalTitle'),''),
    nullif(trim(v_invitation.required_onboarding_fields ->> 'professional_title'),'')
  );
  v_specialty := case lower(coalesce(v_raw_specialty,''))
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

  select membership.* into v_existing_membership
  from public.clinic_memberships membership
  where membership.user_id=p_user_id
    and membership.clinic_id=v_invitation.clinic_id
  limit 1
  for update;

  if v_status='accepted' then
    if v_invitation.accepted_user_id is not null
       and v_invitation.accepted_user_id <> p_user_id then
      raise exception using errcode='P0001', message='CLINIC_INVITATION_ALREADY_USED';
    end if;
    if v_existing_membership.user_id is null
       or lower(trim(coalesce(v_existing_membership.status,''))) <> 'active' then
      raise exception using errcode='P0001', message='CLINIC_INVITATION_ALREADY_USED';
    end if;
    return query select v_invitation.id,v_invitation.clinic_id,
      v_existing_membership.role::text,v_status,
      v_existing_membership.status::text,true;
    return;
  end if;

  if v_status <> 'pending' then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_NOT_AVAILABLE';
  end if;

  if v_effective_expiry <= clock_timestamp() then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_EXPIRED';
  end if;

  if v_role='therapist' and v_specialty is null then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_SPECIALTY_INVALID';
  end if;

  if v_existing_membership.user_id is not null
     and lower(trim(coalesce(v_existing_membership.status,''))) <> 'active'
     and coalesce(v_invitation.created_at,'-infinity'::timestamptz)
         <= coalesce(v_existing_membership.updated_at,v_existing_membership.created_at,'infinity'::timestamptz) then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_ALREADY_USED';
  end if;

  if coalesce(v_invitation.invited_by,'') ~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_invited_by := v_invitation.invited_by::uuid;
  else
    v_invited_by := null;
  end if;

  insert into public.clinic_memberships as membership (
    user_id,clinic_id,role,status,invited_by,specialty,
    settings_updated_at,settings_updated_by,created_at,updated_at
  ) values (
    p_user_id,v_invitation.clinic_id,v_role,'active',v_invited_by,
    case when v_role='therapist' then v_specialty else null end,
    clock_timestamp(),v_invited_by,clock_timestamp(),clock_timestamp()
  )
  on conflict (user_id,clinic_id)
  do update set
    role=excluded.role,
    status='active',
    invited_by=excluded.invited_by,
    specialty=case when excluded.role='therapist' then excluded.specialty else null end,
    settings_updated_at=clock_timestamp(),
    settings_updated_by=excluded.settings_updated_by,
    updated_at=clock_timestamp();

  update public.invitations invitation
  set status='accepted',
      accepted_at=coalesce(invitation.accepted_at,clock_timestamp()),
      accepted_user_id=p_user_id,
      updated_at=clock_timestamp()
  where invitation.id=v_invitation.id
    and invitation.status='pending';

  if not found then
    raise exception using errcode='P0001', message='CLINIC_INVITATION_CONCURRENT_UPDATE';
  end if;

  return query select v_invitation.id,v_invitation.clinic_id,v_role,
    'accepted'::text,'active'::text,false;
end;
$function$;

revoke all on function public.accept_clinic_invitation_v1(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.accept_clinic_invitation_v1(uuid,uuid,text)
  to service_role;

notify pgrst, 'reload schema';
commit;

-- Rollback classification: FORWARD_FIX_ONLY after accepted_user_id is populated.
