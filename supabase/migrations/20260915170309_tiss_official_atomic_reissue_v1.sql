-- Issue #170 / contract v4 / H22 Data gate.
-- Immutable, retry-safe TISS-06 reissue. The replaced official XML row is never updated.

create or replace function public.reissue_tiss_official_document_v1(
  p_organization_id uuid,
  p_replaced_document_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
set row_security = off
as $function$
declare
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_fingerprint text;
  v_old_document public.tiss_official_documents%rowtype;
  v_new_document public.tiss_official_documents%rowtype;
  v_old_tracking public.tiss_official_document_tracking%rowtype;
  v_new_tracking public.tiss_official_document_tracking%rowtype;
  v_existing_event public.tiss_official_tracking_events%rowtype;
  v_existing_document public.tiss_official_documents%rowtype;
  v_pre_guide_versions jsonb;
  v_xml_content text;
  v_xml_hash text;
  v_batch_number text;
  v_guide_count integer;
  v_total_amount integer;
  v_selected_count integer;
  v_invalid_count integer;
  v_old_previous_status text;
begin
  if p_organization_id is null or p_replaced_document_id is null or p_actor_id is null then
    raise exception using errcode='22023',message='TISS_REISSUE_SCOPE_INVALID';
  end if;
  if length(v_key)<16 or length(v_key)>200 or jsonb_typeof(v_payload)<>'object' then
    raise exception using errcode='22023',message='TISS_REISSUE_REQUEST_INVALID';
  end if;

  if not exists (
    select 1 from public.clinics c
    where c.id=p_organization_id and (c.owner_user_id=p_actor_id or public.is_platform_admin(p_actor_id))
  ) and not exists (
    select 1 from public.clinic_memberships cm
    where cm.clinic_id=p_organization_id and cm.user_id=p_actor_id
      and lower(coalesce(cm.status,'active'))='active'
  ) then
    raise exception using errcode='42501',message='TISS_REISSUE_ACTOR_MEMBERSHIP_DENIED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_key,0));
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'replaced_document_id',p_replaced_document_id,
    'actor_id',p_actor_id,'payload',v_payload
  )::text,'UTF8'),'sha256'),'hex');

  select e.* into v_existing_event
  from public.tiss_official_tracking_events e
  where e.clinic_id=p_organization_id and e.idempotency_key=v_key
  limit 1;
  if found then
    if v_existing_event.event_type<>'official_xml_replaced'
       or v_existing_event.official_document_id<>p_replaced_document_id
       or coalesce(v_existing_event.metadata->>'request_fingerprint','')<>v_fingerprint then
      raise exception using errcode='23505',message='TISS_REISSUE_IDEMPOTENCY_KEY_REUSED';
    end if;
    select d.* into v_existing_document from public.tiss_official_documents d
    where d.organization_id=p_organization_id
      and d.id=nullif(v_existing_event.metadata->>'replacement_document_id','')::uuid;
    return jsonb_build_object('ok',true,'idempotentReplay',true,
      'replacedDocumentId',p_replaced_document_id,
      'document',case when v_existing_document.id is null then null else to_jsonb(v_existing_document) end,
      'eventId',v_existing_event.id);
  end if;

  select d.* into v_old_document from public.tiss_official_documents d
  where d.id=p_replaced_document_id and d.organization_id=p_organization_id and d.status='validated'
  for update;
  if not found then raise exception using errcode='P0002',message='TISS_REISSUE_DOCUMENT_NOT_FOUND'; end if;

  select t.* into v_old_tracking from public.tiss_official_document_tracking t
  where t.organization_id=p_organization_id and t.official_document_id=p_replaced_document_id
  for update;
  if not found then raise exception using errcode='P0002',message='TISS_REISSUE_TRACKING_NOT_FOUND'; end if;
  if v_old_tracking.status in ('cancelled','replaced') then
    raise exception using errcode='P0001',message='TISS_REISSUE_TRACKING_TERMINAL';
  end if;

  v_xml_content:=coalesce(v_payload->>'xml_content','');
  v_xml_hash:=lower(btrim(coalesce(v_payload->>'xml_hash','')));
  v_batch_number:=btrim(coalesce(v_payload->>'batch_number',''));
  v_pre_guide_versions:=coalesce(v_payload->'pre_guide_versions','{}'::jsonb);
  if v_xml_content='' or v_xml_hash!~'^[a-f0-9]{64}$' or v_batch_number=''
     or jsonb_typeof(v_pre_guide_versions)<>'object' then
    raise exception using errcode='22023',message='TISS_REISSUE_REQUIRED_FIELDS_INVALID';
  end if;
  if encode(extensions.digest(convert_to(v_xml_content,'UTF8'),'sha256'),'hex')<>v_xml_hash then
    raise exception using errcode='22023',message='TISS_REISSUE_XML_HASH_MISMATCH';
  end if;
  if v_batch_number=v_old_document.batch_number then
    raise exception using errcode='22023',message='TISS_REISSUE_BATCH_NUMBER_MUST_CHANGE';
  end if;

  perform 1 from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids)
  order by pg.id for update;

  select count(*)::integer,count(*) filter(
    where pg.official_document_id is distinct from p_replaced_document_id
       or pg.status<>'valid'
       or coalesce(array_length(pg.validation_error_codes,1),0)>0
       or not (v_pre_guide_versions?pg.id::text)
       or pg.updated_at is distinct from (v_pre_guide_versions->>pg.id::text)::timestamptz
  )::integer
  into v_selected_count,v_invalid_count
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);
  if v_selected_count<>cardinality(v_old_document.generated_from_pre_guide_ids) or v_invalid_count>0 then
    raise exception using errcode='P0001',message='TISS_REISSUE_PRE_GUIDE_SCOPE_OR_VERSION_INVALID';
  end if;

  if exists(select 1 from public.tiss_official_documents d
    where d.organization_id=p_organization_id and d.idempotency_key=v_key) then
    raise exception using errcode='23505',message='TISS_REISSUE_IDEMPOTENCY_KEY_REUSED';
  end if;

  select count(*)::integer,coalesce(sum(coalesce(pg.total_amount_cents,0)),0)::integer
  into v_guide_count,v_total_amount
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);

  insert into public.tiss_official_documents(
    organization_id,clinic_id,payer_id,competence_month,guide_type,document_type,
    communication_version,content_structure_version,tuss_version,schema_root_file,
    schema_manifest_checksum,batch_number,status,xml_content,xml_hash,
    generated_from_pre_guide_ids,idempotency_key,validation_summary,metadata,
    guide_count,total_amount_cents,generated_by,generated_at
  ) values (
    p_organization_id,p_organization_id,v_old_document.payer_id,v_old_document.competence_month,
    v_old_document.guide_type,v_old_document.document_type,v_old_document.communication_version,
    v_old_document.content_structure_version,v_old_document.tuss_version,v_old_document.schema_root_file,
    v_old_document.schema_manifest_checksum,v_batch_number,'validated',v_xml_content,v_xml_hash,
    v_old_document.generated_from_pre_guide_ids,v_key,coalesce(v_payload->'validation_summary','{}'::jsonb),
    coalesce(v_old_document.metadata,'{}'::jsonb)||jsonb_build_object(
      'reissueOfOfficialDocumentId',p_replaced_document_id,'reissuedBy',p_actor_id,
      'reissuedAt',now(),'reissueReason',nullif(left(coalesce(v_payload->>'reason',''),1200),'')
    ),v_guide_count,v_total_amount,p_actor_id,now()
  ) returning * into v_new_document;

  insert into public.tiss_official_document_tracking(
    organization_id,clinic_id,official_document_id,payer_id,competence_month,batch_number,status,
    total_sent_amount_cents,total_paid_amount_cents,total_glossed_amount_cents,total_pending_amount_cents,
    metadata,created_by
  ) values (
    p_organization_id,p_organization_id,v_new_document.id,v_new_document.payer_id,
    v_new_document.competence_month,v_new_document.batch_number,'generated',v_total_amount,0,0,v_total_amount,
    jsonb_build_object('initializedFromReissue',true,'reissueOfOfficialDocumentId',p_replaced_document_id),p_actor_id
  ) returning * into v_new_tracking;

  insert into public.tiss_official_guide_tracking(
    organization_id,clinic_id,official_document_id,official_tracking_id,pre_guide_id,appointment_id,
    patient_id,payer_id,provider_guide_number,operator_guide_number,authorization_code,patient_name,
    scheduled_start,tuss_code,procedure_name,status,sent_amount_cents,paid_amount_cents,
    glossed_amount_cents,pending_amount_cents,metadata
  )
  select p_organization_id,p_organization_id,v_new_document.id,v_new_tracking.id,pg.id,pg.appointment_id,
    pg.patient_id,pg.payer_id,
    nullif(coalesce(pg.snapshot_data#>>'{authorization,providerGuideNumber}',pg.snapshot_data#>>'{authorization,provider_guide_number}',pg.guide_number),''),
    nullif(coalesce(pg.snapshot_data#>>'{authorization,operatorGuideNumber}',pg.snapshot_data#>>'{authorization,operator_guide_number}',pg.guide_number),''),
    nullif(pg.authorization_code,''),nullif(pg.patient_name_snapshot,''),pg.scheduled_start,
    nullif(coalesce(pg.tuss_code,pg.internal_procedure_code),''),
    nullif(coalesce(pg.tuss_description,pg.internal_procedure_name),''),'sent',coalesce(pg.total_amount_cents,0),0,0,
    coalesce(pg.total_amount_cents,0),jsonb_build_object('createdFromReissue',true,'reissueOfOfficialDocumentId',p_replaced_document_id)
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);

  update public.appointment_tiss_pre_guides pg set
    official_document_id=v_new_document.id,revenue_cycle_state='official_xml_validated',
    revenue_cycle_state_reason='XML TISS oficial reemitido como novo documento imutável.',
    updated_at=now(),updated_by=p_actor_id
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);

  insert into public.tiss_revenue_cycle_events(
    organization_id,clinic_id,patient_id,appointment_id,pre_guide_id,official_document_id,payer_id,
    event_type,previous_state,new_state,reason,performed_by,performed_at,metadata,idempotency_key
  )
  select p_organization_id,p_organization_id,pg.patient_id,pg.appointment_id,pg.id,v_new_document.id,
    v_new_document.payer_id,'TISS_OFFICIAL_XML_GENERATED','official_xml_validated','official_xml_validated',
    'XML TISS oficial reemitido como novo artefato; documento anterior preservado.',p_actor_id,now(),
    jsonb_build_object('officialDocumentId',v_new_document.id,'reissueOfOfficialDocumentId',p_replaced_document_id,
      'batchNumber',v_batch_number,'xmlHash',v_xml_hash,'notSentToPayer',true),
    v_key||':pg:'||pg.id::text
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);

  v_old_previous_status:=v_old_tracking.status;
  update public.tiss_official_document_tracking t set status='replaced',updated_at=now()
  where t.id=v_old_tracking.id returning t.* into v_old_tracking;

  insert into public.tiss_official_tracking_events(
    organization_id,clinic_id,official_document_id,official_tracking_id,user_id,event_type,
    previous_status,new_status,metadata,idempotency_key
  ) values (
    p_organization_id,p_organization_id,p_replaced_document_id,v_old_tracking.id,p_actor_id,
    'official_xml_replaced',v_old_previous_status,'replaced',jsonb_build_object(
      'replacement_document_id',v_new_document.id,'replacement_tracking_id',v_new_tracking.id,
      'replacement_batch_number',v_batch_number,'replacement_xml_hash',v_xml_hash,'request_fingerprint',v_fingerprint
    ),v_key
  );

  insert into public.tiss_official_tracking_events(
    organization_id,clinic_id,official_document_id,official_tracking_id,user_id,event_type,
    previous_status,new_status,metadata,idempotency_key
  ) values (
    p_organization_id,p_organization_id,v_new_document.id,v_new_tracking.id,p_actor_id,
    'official_xml_tracking_created',null,'generated',jsonb_build_object(
      'reissueOfOfficialDocumentId',p_replaced_document_id,'totalSentAmountCents',v_total_amount,'guideCount',v_guide_count
    ),v_key||':replacement_tracking'
  );

  return jsonb_build_object('ok',true,'idempotentReplay',false,'replacedDocumentId',p_replaced_document_id,
    'document',to_jsonb(v_new_document),'tracking',to_jsonb(v_new_tracking),'eventId',(
      select e.id from public.tiss_official_tracking_events e
      where e.clinic_id=p_organization_id and e.idempotency_key=v_key limit 1
    ));
end;
$function$;

revoke all on function public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb)
  to service_role;
comment on function public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb) is
  'Service-role-only immutable TISS reissue boundary; creates a new official document and projections while preserving the replaced document.';

notify pgrst,'reload schema';
