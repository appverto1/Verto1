begin;

-- #259 A12: make notification listing clinic-scoped before pagination.
-- Forward-only fix after review finding REVIEW_FAIL_CLINIC_NOTIFICATION_REQUEST_SCOPE_AND_PAGINATION.

create index if not exists clinic_communication_mentions_target_clinic_created_idx
  on public.clinic_communication_mentions(mentioned_user_id, clinic_id, created_at desc, id desc)
  where mentioned_user_id is not null;

drop function public.list_clinic_communication_notifications_v1(integer,timestamptz,uuid);

create function public.list_clinic_communication_notifications_v1(
  p_clinic_id uuid,
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
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
  v_next_created timestamptz;
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
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode='22023', message='COMMUNICATION_CURSOR_INVALID';
  end if;

  with page as (
    select m.*
    from public.clinic_communication_mentions m
    where m.mentioned_user_id=v_actor
      and m.clinic_id=p_clinic_id
      and (
        p_before_created_at is null
        or (m.created_at,m.id) < (p_before_created_at,p_before_id)
      )
    order by m.created_at desc,m.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'mentionId',p.id,
      'clinicId',p.clinic_id,
      'threadId',p.thread_id,
      'createdAt',p.created_at,
      'readAt',p.notification_read_at,
      'copy','Você foi mencionado em uma atualização da clínica.'
    ) order by p.created_at desc,p.id desc
  ),'[]'::jsonb)
  into v_items
  from page p;

  select m.created_at,m.id into v_next_created,v_next_id
  from public.clinic_communication_mentions m
  where m.mentioned_user_id=v_actor
    and m.clinic_id=p_clinic_id
    and (
      p_before_created_at is null
      or (m.created_at,m.id) < (p_before_created_at,p_before_id)
    )
  order by m.created_at desc,m.id desc
  offset greatest(v_limit-1,0) limit 1;

  return jsonb_build_object(
    'items',coalesce(v_items,'[]'::jsonb),
    'nextCursor',case when v_next_id is null then null else jsonb_build_object(
      'createdAt',v_next_created,'id',v_next_id
    ) end
  );
end;
$function$;

revoke all on function public.list_clinic_communication_notifications_v1(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_clinic_communication_notifications_v1(uuid,integer,timestamptz,uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
