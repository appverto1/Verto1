-- Issue #170 / contract v4 / H22 Data gate.
-- Atomic, retry-safe TISS-06 tracking/return/settlement/appeal mutations.

create or replace function public.apply_tiss_official_tracking_mutation_v1(
  p_organization_id uuid,
  p_official_document_id uuid,
  p_actor_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_fingerprint text;
  v_existing public.tiss_official_tracking_events%rowtype;
  v_tracking public.tiss_official_document_tracking%rowtype;
  v_guide public.tiss_official_guide_tracking%rowtype;
  v_guide_id uuid;
  v_event_type text;
  v_previous_status text;
  v_new_status text;
  v_event_metadata jsonb := '{}'::jsonb;
  v_settlements jsonb := '[]'::jsonb;
  v_input_count integer := 0;
  v_distinct_count integer := 0;
  v_affected_count integer := 0;
  v_guide_count integer := 0;
  v_sent integer := 0;
  v_paid integer := 0;
  v_glossed integer := 0;
  v_pending integer := 0;
  v_any_rejected boolean := false;
  v_any_glossed boolean := false;
  v_all_paid boolean := false;
  v_doc_status text;
  v_return_status text;
  v_appeal_status text;
  v_changed_guide_ids jsonb := '[]'::jsonb;
  v_replay_guide jsonb := null;
begin
  if p_organization_id is null or p_official_document_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'TISS_ATOMIC_SCOPE_INVALID';
  end if;
  if v_operation not in ('mark_sent','register_return','guide_settlement','appeal_update') then
    raise exception using errcode = '22023', message = 'TISS_ATOMIC_OPERATION_INVALID';
  end if;
  if length(v_key) < 16 or length(v_key) > 200 or jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'TISS_ATOMIC_REQUEST_INVALID';
  end if;

  if not exists (
    select 1 from public.clinics c
    where c.id = p_organization_id
      and (c.owner_user_id = p_actor_id or public.is_platform_admin(p_actor_id))
  ) and not exists (
    select 1 from public.clinic_memberships cm
    where cm.clinic_id = p_organization_id
      and cm.user_id = p_actor_id
      and lower(coalesce(cm.status,'active')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TISS_ATOMIC_ACTOR_MEMBERSHIP_DENIED';
  end if;

  if not exists (
    select 1 from public.tiss_official_documents d
    where d.id = p_official_document_id
      and d.organization_id = p_organization_id
      and d.status = 'validated'
  ) then
    raise exception using errcode = 'P0002', message = 'TISS_ATOMIC_DOCUMENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_key, 0));
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,
    'official_document_id',p_official_document_id,
    'actor_id',p_actor_id,
    'operation',v_operation,
    'payload',v_payload
  )::text,'UTF8'),'sha256'),'hex');

  select e.* into v_existing
  from public.tiss_official_tracking_events e
  where e.clinic_id = p_organization_id and e.idempotency_key = v_key
  limit 1;
  if found then
    if v_existing.official_document_id <> p_official_document_id
       or coalesce(v_existing.metadata->>'request_fingerprint','') <> v_fingerprint then
      raise exception using errcode = '23505', message = 'TISS_ATOMIC_IDEMPOTENCY_KEY_REUSED';
    end if;
    select t.* into v_tracking
    from public.tiss_official_document_tracking t
    where t.organization_id = p_organization_id and t.official_document_id = p_official_document_id;
    if v_existing.guide_tracking_id is not null then
      select to_jsonb(g) into v_replay_guide
      from public.tiss_official_guide_tracking g
      where g.organization_id = p_organization_id and g.id = v_existing.guide_tracking_id;
    end if;
    return jsonb_build_object(
      'ok',true,'idempotentReplay',true,'operation',v_operation,
      'tracking',case when v_tracking.id is null then null else to_jsonb(v_tracking) end,
      'guide',v_replay_guide,'affectedGuideCount',0,'eventId',v_existing.id
    );
  end if;

  select t.* into v_tracking
  from public.tiss_official_document_tracking t
  where t.organization_id = p_organization_id and t.official_document_id = p_official_document_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TISS_ATOMIC_TRACKING_NOT_FOUND';
  end if;
  if v_tracking.status in ('cancelled','replaced') then
    raise exception using errcode = 'P0001', message = 'TISS_ATOMIC_TRACKING_TERMINAL';
  end if;

  if v_operation = 'mark_sent' then
    if v_tracking.status not in ('generated','sent_to_operator','protocol_registered') then
      raise exception using errcode = 'P0001', message = 'TISS_ATOMIC_MARK_SENT_STATE_INVALID';
    end if;
    v_previous_status := v_tracking.status;
    v_new_status := case when nullif(btrim(coalesce(v_payload->>'operator_protocol','')),'') is null
      then 'sent_to_operator' else 'protocol_registered' end;
    update public.tiss_official_document_tracking t set
      status = v_new_status,
      sent_at = coalesce(nullif(v_payload->>'sent_at','')::timestamptz,now()),
      sent_channel = nullif(left(btrim(coalesce(v_payload->>'sent_channel','portal')),80),''),
      operator_protocol = nullif(left(btrim(coalesce(v_payload->>'operator_protocol','')),160),''),
      sent_registered_by = p_actor_id,
      expected_return_date = nullif(v_payload->>'expected_return_date','')::date,
      notes = case when v_payload ? 'notes' then nullif(left(v_payload->>'notes',1200),'') else t.notes end,
      updated_at = now()
    where t.id = v_tracking.id returning t.* into v_tracking;
    v_event_type := case when v_new_status = 'protocol_registered'
      then 'official_xml_protocol_registered' else 'official_xml_marked_sent' end;
    v_event_metadata := jsonb_build_object(
      'sent_at',v_tracking.sent_at,'sent_channel',v_tracking.sent_channel,
      'operator_protocol',v_tracking.operator_protocol,'expected_return_date',v_tracking.expected_return_date
    );

  elsif v_operation = 'register_return' then
    if v_tracking.status not in (
      'sent_to_operator','protocol_registered','under_review','paid','partially_paid',
      'denied_or_rejected','glossed','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected'
    ) then
      raise exception using errcode = 'P0001', message = 'TISS_ATOMIC_RETURN_STATE_INVALID';
    end if;
    v_return_status := lower(btrim(coalesce(v_payload->>'return_status','')));
    if v_return_status not in ('paid','partially_paid','glossed','denied_or_rejected','under_review') then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_RETURN_STATUS_INVALID';
    end if;
    v_settlements := coalesce(v_payload->'guide_settlements','[]'::jsonb);
    if jsonb_typeof(v_settlements) <> 'array' then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_GUIDE_SETTLEMENTS_INVALID';
    end if;

    perform 1 from public.tiss_official_guide_tracking g
    where g.organization_id = p_organization_id and g.official_document_id = p_official_document_id
    order by g.id for update;

    select count(*)::integer,count(distinct guide_id)::integer
    into v_input_count,v_distinct_count
    from jsonb_to_recordset(v_settlements) as x(
      guide_id uuid,paid_amount_cents integer,glossed_amount_cents integer,
      status text,return_date date,payment_date date
    );
    if v_input_count <> v_distinct_count then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_GUIDE_DUPLICATE';
    end if;
    if v_return_status = 'partially_paid' and v_input_count = 0 then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_PARTIAL_RETURN_REQUIRES_GUIDES';
    end if;

    if v_input_count = 0 and v_return_status in ('paid','glossed','denied_or_rejected') then
      update public.tiss_official_guide_tracking g set
        status = case v_return_status when 'paid' then 'paid' when 'glossed' then 'glossed' else 'rejected' end,
        paid_amount_cents = case when v_return_status = 'paid' then g.sent_amount_cents else 0 end,
        glossed_amount_cents = case when v_return_status = 'paid' then 0 else g.sent_amount_cents end,
        pending_amount_cents = 0,
        return_date = coalesce(nullif(v_payload->>'returned_at','')::timestamptz::date,current_date),
        payment_date = case when v_return_status = 'paid'
          then coalesce(nullif(v_payload->>'returned_at','')::timestamptz::date,current_date) else g.payment_date end,
        updated_at = now()
      where g.organization_id = p_organization_id and g.official_document_id = p_official_document_id;
      get diagnostics v_affected_count = row_count;
    elsif v_input_count > 0 then
      if exists (
        with input as (
          select * from jsonb_to_recordset(v_settlements) as x(
            guide_id uuid,paid_amount_cents integer,glossed_amount_cents integer,
            status text,return_date date,payment_date date
          )
        )
        select 1 from input i
        left join public.tiss_official_guide_tracking g
          on g.id=i.guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id
        where i.guide_id is null or g.id is null
           or coalesce(i.paid_amount_cents,g.paid_amount_cents) < 0
           or coalesce(i.glossed_amount_cents,g.glossed_amount_cents) < 0
           or coalesce(i.paid_amount_cents,g.paid_amount_cents)+coalesce(i.glossed_amount_cents,g.glossed_amount_cents) > g.sent_amount_cents
           or (nullif(lower(btrim(coalesce(i.status,''))),'') is not null
               and lower(btrim(i.status)) not in ('under_review','paid','partially_paid','glossed','rejected'))
      ) then
        raise exception using errcode = '22023', message = 'TISS_ATOMIC_GUIDE_SETTLEMENT_INVALID';
      end if;
      with input as (
        select * from jsonb_to_recordset(v_settlements) as x(
          guide_id uuid,paid_amount_cents integer,glossed_amount_cents integer,
          status text,return_date date,payment_date date
        )
      ), updated as (
        update public.tiss_official_guide_tracking g set
          paid_amount_cents = coalesce(i.paid_amount_cents,g.paid_amount_cents),
          glossed_amount_cents = coalesce(i.glossed_amount_cents,g.glossed_amount_cents),
          pending_amount_cents = g.sent_amount_cents-coalesce(i.paid_amount_cents,g.paid_amount_cents)-coalesce(i.glossed_amount_cents,g.glossed_amount_cents),
          status = case
            when nullif(lower(btrim(coalesce(i.status,''))),'') is not null then lower(btrim(i.status))
            when coalesce(i.glossed_amount_cents,g.glossed_amount_cents)>0 then 'glossed'
            when coalesce(i.paid_amount_cents,g.paid_amount_cents)>=g.sent_amount_cents then 'paid'
            when coalesce(i.paid_amount_cents,g.paid_amount_cents)>0 then 'partially_paid'
            else 'under_review' end,
          return_date = coalesce(i.return_date,nullif(v_payload->>'returned_at','')::timestamptz::date,g.return_date),
          payment_date = coalesce(i.payment_date,case when coalesce(i.paid_amount_cents,g.paid_amount_cents)>0
            then coalesce(nullif(v_payload->>'returned_at','')::timestamptz::date,current_date) else g.payment_date end),
          updated_at = now()
        from input i
        where g.id=i.guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id
        returning g.id
      ) select count(*)::integer into v_affected_count from updated;
    end if;

    select coalesce(jsonb_agg(to_jsonb(guide_id) order by guide_id::text),'[]'::jsonb)
    into v_changed_guide_ids from jsonb_to_recordset(v_settlements) as x(guide_id uuid);

    select count(*)::integer,coalesce(sum(sent_amount_cents),v_tracking.total_sent_amount_cents)::integer,
      coalesce(sum(paid_amount_cents),0)::integer,coalesce(sum(glossed_amount_cents),0)::integer,
      coalesce(bool_or(status='rejected'),false),coalesce(bool_or(status='glossed'),false),coalesce(bool_and(status='paid'),false)
    into v_guide_count,v_sent,v_paid,v_glossed,v_any_rejected,v_any_glossed,v_all_paid
    from public.tiss_official_guide_tracking
    where organization_id=p_organization_id and official_document_id=p_official_document_id;
    if v_guide_count=0 then v_sent:=v_tracking.total_sent_amount_cents; end if;
    v_pending:=greatest(0,v_sent-v_paid-v_glossed);
    v_doc_status:=case
      when v_guide_count>0 and v_all_paid then 'paid'
      when v_any_rejected then 'denied_or_rejected'
      when v_any_glossed and v_paid>0 then 'partially_paid'
      when v_any_glossed then 'glossed'
      when v_paid>0 then 'partially_paid'
      else 'under_review' end;
    if (v_return_status='paid' and v_doc_status<>'paid')
       or (v_return_status='glossed' and v_doc_status<>'glossed')
       or (v_return_status='denied_or_rejected' and v_doc_status<>'denied_or_rejected')
       or (v_return_status='partially_paid' and v_doc_status<>'partially_paid') then
      raise exception using errcode='22023',message='TISS_ATOMIC_RETURN_TOTALS_MISMATCH';
    end if;

    v_previous_status:=v_tracking.status;
    v_new_status:=case when v_return_status='under_review' then 'under_review' else v_doc_status end;
    update public.tiss_official_document_tracking t set
      status=v_new_status,
      returned_at=coalesce(nullif(v_payload->>'returned_at','')::timestamptz,now()),
      return_status=v_return_status,return_registered_by=p_actor_id,
      total_sent_amount_cents=v_sent,total_paid_amount_cents=v_paid,
      total_glossed_amount_cents=v_glossed,total_pending_amount_cents=v_pending,
      notes=case when v_payload?'notes' then nullif(left(v_payload->>'notes',1200),'') else t.notes end,
      updated_at=now()
    where t.id=v_tracking.id returning t.* into v_tracking;
    v_event_type:='official_xml_return_registered';
    v_event_metadata:=jsonb_build_object(
      'returned_at',v_tracking.returned_at,'return_status',v_return_status,
      'affected_guide_count',v_affected_count,'guide_ids',v_changed_guide_ids,
      'total_sent_amount_cents',v_sent,'total_paid_amount_cents',v_paid,
      'total_glossed_amount_cents',v_glossed,'total_pending_amount_cents',v_pending
    );

  elsif v_operation='guide_settlement' then
    if v_tracking.status not in (
      'sent_to_operator','protocol_registered','under_review','paid','partially_paid',
      'denied_or_rejected','glossed','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected'
    ) then
      raise exception using errcode='P0001',message='TISS_ATOMIC_SETTLEMENT_STATE_INVALID';
    end if;
    v_guide_id:=nullif(v_payload->>'guide_id','')::uuid;
    if v_guide_id is null then raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_ID_REQUIRED'; end if;
    select g.* into v_guide from public.tiss_official_guide_tracking g
    where g.id=v_guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id
    for update;
    if not found then raise exception using errcode='P0002',message='TISS_ATOMIC_GUIDE_NOT_FOUND'; end if;
    v_paid:=coalesce(nullif(v_payload->>'paid_amount_cents','')::integer,v_guide.paid_amount_cents);
    v_glossed:=coalesce(nullif(v_payload->>'glossed_amount_cents','')::integer,v_guide.glossed_amount_cents);
    if v_paid<0 or v_glossed<0 or v_paid+v_glossed>v_guide.sent_amount_cents then
      raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_AMOUNTS_INVALID';
    end if;
    v_previous_status:=v_guide.status;
    v_new_status:=nullif(lower(btrim(coalesce(v_payload->>'status',''))),'');
    if v_new_status is null then v_new_status:=case
      when v_glossed>0 then 'glossed' when v_paid>=v_guide.sent_amount_cents then 'paid'
      when v_paid>0 then 'partially_paid' else 'under_review' end; end if;
    if v_new_status not in ('under_review','paid','partially_paid','glossed','rejected') then
      raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_STATUS_INVALID';
    end if;
    update public.tiss_official_guide_tracking g set
      status=v_new_status,paid_amount_cents=v_paid,glossed_amount_cents=v_glossed,
      pending_amount_cents=g.sent_amount_cents-v_paid-v_glossed,
      denial_reason=case when v_payload?'denial_reason' then nullif(left(v_payload->>'denial_reason',800),'') else g.denial_reason end,
      operator_reason_code=case when v_payload?'operator_reason_code' then nullif(left(v_payload->>'operator_reason_code',120),'') else g.operator_reason_code end,
      internal_note=case when v_payload?'internal_note' then nullif(left(v_payload->>'internal_note',1200),'') else g.internal_note end,
      return_date=case when v_payload?'return_date' then nullif(v_payload->>'return_date','')::date else g.return_date end,
      payment_date=case when v_payload?'payment_date' then nullif(v_payload->>'payment_date','')::date else g.payment_date end,
      appeal_deadline=case when v_payload?'appeal_deadline' then nullif(v_payload->>'appeal_deadline','')::date else g.appeal_deadline end,
      updated_at=now()
    where g.id=v_guide.id returning g.* into v_guide;

    select count(*)::integer,coalesce(sum(sent_amount_cents),v_tracking.total_sent_amount_cents)::integer,
      coalesce(sum(paid_amount_cents),0)::integer,coalesce(sum(glossed_amount_cents),0)::integer,
      coalesce(bool_or(status='rejected'),false),coalesce(bool_or(status='glossed'),false),coalesce(bool_and(status='paid'),false)
    into v_guide_count,v_sent,v_paid,v_glossed,v_any_rejected,v_any_glossed,v_all_paid
    from public.tiss_official_guide_tracking where organization_id=p_organization_id and official_document_id=p_official_document_id;
    v_pending:=greatest(0,v_sent-v_paid-v_glossed);
    v_doc_status:=case when v_guide_count>0 and v_all_paid then 'paid' when v_any_rejected then 'denied_or_rejected'
      when v_any_glossed and v_paid>0 then 'partially_paid' when v_any_glossed then 'glossed'
      when v_paid>0 then 'partially_paid' else 'under_review' end;
    update public.tiss_official_document_tracking t set
      status=v_doc_status,total_sent_amount_cents=v_sent,total_paid_amount_cents=v_paid,
      total_glossed_amount_cents=v_glossed,total_pending_amount_cents=v_pending,updated_at=now()
    where t.id=v_tracking.id returning t.* into v_tracking;
    v_event_type:=case v_new_status when 'paid' then 'official_xml_guide_paid'
      when 'partially_paid' then 'official_xml_guide_partially_paid' when 'glossed' then 'official_xml_guide_glossed'
      when 'rejected' then 'official_xml_guide_rejected' else 'official_xml_guide_updated' end;
    v_event_metadata:=jsonb_build_object('paid_amount_cents',v_guide.paid_amount_cents,
      'glossed_amount_cents',v_guide.glossed_amount_cents,'pending_amount_cents',v_guide.pending_amount_cents,
      'document_status',v_doc_status);

  elsif v_operation='appeal_update' then
    if v_tracking.status not in ('partially_paid','denied_or_rejected','glossed','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='P0001',message='TISS_ATOMIC_APPEAL_STATE_INVALID';
    end if;
    v_guide_id:=nullif(v_payload->>'guide_id','')::uuid;
    if v_guide_id is null then raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_ID_REQUIRED'; end if;
    select g.* into v_guide from public.tiss_official_guide_tracking g
    where g.id=v_guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id for update;
    if not found then raise exception using errcode='P0002',message='TISS_ATOMIC_GUIDE_NOT_FOUND'; end if;
    if v_guide.status not in ('glossed','rejected','appeal_pending','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='22023',message='TISS_ATOMIC_APPEAL_GUIDE_NOT_ELIGIBLE';
    end if;
    v_appeal_status:=lower(btrim(coalesce(v_payload->>'appeal_status','appeal_prepared')));
    if v_appeal_status not in ('appeal_pending','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='22023',message='TISS_ATOMIC_APPEAL_STATUS_INVALID';
    end if;
    v_previous_status:=v_guide.status;
    v_new_status:=case v_appeal_status when 'appeal_sent' then 'appeal_sent' when 'appeal_accepted' then 'appeal_accepted'
      when 'appeal_rejected' then 'appeal_rejected' else 'appeal_pending' end;
    update public.tiss_official_guide_tracking g set
      status=v_new_status,appeal_status=v_appeal_status,
      appeal_deadline=case when v_payload?'appeal_deadline' then nullif(v_payload->>'appeal_deadline','')::date else g.appeal_deadline end,
      appeal_sent_at=case when v_appeal_status='appeal_sent' then coalesce(nullif(v_payload->>'appeal_sent_at','')::timestamptz,now()) else g.appeal_sent_at end,
      appeal_result=case when v_payload?'appeal_result' then nullif(left(v_payload->>'appeal_result',80),'') else g.appeal_result end,
      appeal_note=case when v_payload?'appeal_note' then nullif(left(v_payload->>'appeal_note',1200),'') else g.appeal_note end,
      updated_at=now()
    where g.id=v_guide.id returning g.* into v_guide;
    update public.tiss_official_document_tracking t set
      status=case v_appeal_status when 'appeal_sent' then 'appeal_sent' when 'appeal_accepted' then 'appeal_accepted'
        when 'appeal_rejected' then 'appeal_rejected' else 'appeal_prepared' end,updated_at=now()
    where t.id=v_tracking.id returning t.* into v_tracking;
    v_event_type:=case v_appeal_status when 'appeal_sent' then 'official_xml_appeal_sent'
      when 'appeal_accepted' then 'official_xml_appeal_resolved' when 'appeal_rejected' then 'official_xml_appeal_resolved'
      else 'official_xml_appeal_prepared' end;
    v_event_metadata:=jsonb_build_object('appeal_status',v_appeal_status,'appeal_deadline',v_guide.appeal_deadline,'appeal_result',v_guide.appeal_result);
  end if;

  v_event_metadata:=v_event_metadata||jsonb_build_object('operation',v_operation,'request_fingerprint',v_fingerprint);
  insert into public.tiss_official_tracking_events(
    organization_id,clinic_id,official_document_id,official_tracking_id,guide_tracking_id,pre_guide_id,
    user_id,event_type,previous_status,new_status,metadata,idempotency_key
  ) values (
    p_organization_id,p_organization_id,p_official_document_id,v_tracking.id,v_guide_id,
    case when v_guide_id is null then null else v_guide.pre_guide_id end,p_actor_id,v_event_type,
    v_previous_status,v_new_status,v_event_metadata,v_key
  );

  return jsonb_build_object('ok',true,'idempotentReplay',false,'operation',v_operation,
    'tracking',to_jsonb(v_tracking),'guide',case when v_guide_id is null then null else to_jsonb(v_guide) end,
    'affectedGuideCount',v_affected_count,'eventId',(
      select e.id from public.tiss_official_tracking_events e
      where e.clinic_id=p_organization_id and e.idempotency_key=v_key limit 1
    ));
end;
$function$;

revoke all on function public.apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb)
  to service_role;
comment on function public.apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb) is
  'Service-role-only atomic tenant-scoped TISS tracking mutation boundary; server capability must be checked before calling.';
