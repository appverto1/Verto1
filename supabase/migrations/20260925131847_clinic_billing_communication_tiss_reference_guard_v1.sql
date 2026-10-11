-- #259 recovery: clinic billing communication TISS reference guard v1
-- Reconstructed from the already-applied Verto-Staging migration state after
-- interrupted BR259-H09-20260925-P000-A2. Forward migration for fresh envs.

begin;

create or replace function private.clinic_billing_tiss_reference_access_v1(
  p_user_id uuid,
  p_clinic_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_role text;
  v_effect text;
begin
  if p_user_id is null or p_clinic_id is null then
    return false;
  end if;

  select cm.role into v_role
  from public.clinic_memberships cm
  where cm.user_id=p_user_id
    and cm.clinic_id=p_clinic_id
    and cm.status='active'
  limit 1;

  if v_role is null then
    return false;
  end if;

  select o.effect into v_effect
  from public.clinic_membership_permission_overrides o
  join public.clinic_memberships cm on cm.id=o.membership_id
  where cm.user_id=p_user_id
    and cm.clinic_id=p_clinic_id
    and cm.status='active'
    and o.permission_key='billing.xml.export'
  limit 1;

  if v_effect='deny' then
    return false;
  end if;

  return v_role in ('director','coordinator','biller');
end;
$function$;

revoke all on function private.clinic_billing_tiss_reference_access_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.guard_clinic_communication_tiss_reference_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if new.reference_type is null then
    return new;
  end if;

  if new.reference_type <> 'TISS_OFFICIAL_LOT'
     or new.reference_id is null
     or v_actor is null
     or not private.clinic_billing_tiss_reference_access_v1(v_actor,new.clinic_id)
     or not exists (
       select 1 from public.tiss_official_documents d
       where d.id=new.reference_id and d.clinic_id=new.clinic_id
     ) then
    raise exception using errcode='42501', message='COMMUNICATION_REFERENCE_UNAVAILABLE';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_clinic_communication_tiss_reference_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists clinic_communication_threads_tiss_reference_guard_v1
  on public.clinic_communication_threads;
create trigger clinic_communication_threads_tiss_reference_guard_v1
before insert or update of reference_type, reference_id, clinic_id
on public.clinic_communication_threads
for each row
execute function private.guard_clinic_communication_tiss_reference_v1();

create or replace function public.list_clinic_communication_threads_v1(
  p_clinic_id uuid,
  p_limit integer default 30,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,30),1),50);
  v_items jsonb;
  v_next_activity timestamptz;
  v_next_id uuid;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,p_clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;
  if (p_before_activity_at is null) <> (p_before_id is null) then
    raise exception using errcode='22023', message='COMMUNICATION_CURSOR_INVALID';
  end if;

  with page as (
    select
      t.*,
      greatest(t.last_sequence-coalesce(rs.last_read_sequence,0),0) as unread_count,
      exists (
        select 1 from public.tiss_official_documents d
        where d.id=t.reference_id and d.clinic_id=t.clinic_id
      ) as reference_exists,
      private.clinic_billing_tiss_reference_access_v1(v_actor,t.clinic_id) as can_access_tiss
    from public.clinic_communication_threads t
    left join public.clinic_communication_read_states rs
      on rs.thread_id=t.id and rs.user_id=v_actor
    where t.clinic_id=p_clinic_id
      and (
        p_before_activity_at is null
        or (t.last_activity_at,t.id) < (p_before_activity_at,p_before_id)
      )
    order by t.last_activity_at desc,t.id desc
    limit v_limit
  ), aggregated as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'clinicId',p.clinic_id,
        'subject',p.subject,
        'status',p.status,
        'referenceType',p.reference_type,
        'referenceId',case
          when p.reference_type='TISS_OFFICIAL_LOT' and p.reference_exists and p.can_access_tiss
            then p.reference_id
          else null
        end,
        'referenceState',case
          when p.reference_type is null then null
          when not p.reference_exists then 'UNAVAILABLE'
          when not p.can_access_tiss then 'RESTRICTED'
          else 'AVAILABLE'
        end,
        'lastActivityAt',p.last_activity_at,
        'lastSequence',p.last_sequence,
        'unreadCount',p.unread_count,
        'lastAuthorName',p.last_message_author_name_snapshot,
        'lastAuthorRole',p.last_message_author_role_snapshot,
        'lastMessageAt',p.last_message_at
      ) order by p.last_activity_at desc,p.id desc
    ),'[]'::jsonb) as items
    from page p
  )
  select a.items into v_items from aggregated a;

  select p.last_activity_at,p.id into v_next_activity,v_next_id
  from public.clinic_communication_threads p
  where p.clinic_id=p_clinic_id
    and (
      p_before_activity_at is null
      or (p.last_activity_at,p.id) < (p_before_activity_at,p_before_id)
    )
  order by p.last_activity_at desc,p.id desc
  offset greatest(v_limit-1,0) limit 1;

  return jsonb_build_object(
    'items',coalesce(v_items,'[]'::jsonb),
    'nextCursor',case when v_next_id is null then null else jsonb_build_object(
      'lastActivityAt',v_next_activity,'id',v_next_id
    ) end
  );
end;
$function$;

revoke all on function public.list_clinic_communication_threads_v1(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_clinic_communication_threads_v1(uuid,integer,timestamptz,uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;

-- Rollback classification: FORWARD_FIX_ONLY. This migration narrows exposure of
-- optional TISS references and must not be rolled back independently.