-- GROUP branches use immutable reservation prices in both existing engines.
-- All individual branches are retained verbatim.
begin;
CREATE OR REPLACE FUNCTION public.resolve_appointment_financial_engine_v1(p_organization_id uuid, p_appointment_id uuid, p_patient_id uuid, p_service_type text, p_source jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_group_plan public.patient_financial_plans%rowtype;
  v_context_type text;
  v_payer_id uuid;
  v_source_payer text;
  v_service text:=nullif(trim(coalesce(p_service_type,'')),'');
  v_effective_at timestamptz;
  v_monthly_count integer:=0;
  v_has_explicit_context boolean:=false;
begin
  if p_organization_id is null or p_appointment_id is null or p_patient_id is null then return 'NONE'; end if;

  -- GROUP identity and price plan are frozen by the backend reservation RPC.
  -- An ended historical plan remains authoritative for this reservation.
  if upper(coalesce(p_source->>'sessionModality',''))='GROUP' then
    select plan.* into v_group_plan
    from public.patient_financial_plans plan
    join public.group_session_bookings booking
      on booking.id::text=p_source->>'sessionGroupId'
      and booking.organization_id=p_organization_id
    where plan.id::text=coalesce(
      (select participant.financial_plan_id::text from public.group_session_participants participant
       where participant.organization_id=p_organization_id and participant.appointment_id=p_appointment_id),
      p_source->>'groupFinancialPlanId')
      and plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
      and plan.billing_mode='PRIVATE';
    if not found then return 'NONE'; end if;
    if v_group_plan.billing_frequency='MONTHLY' and v_group_plan.pricing_unit='SESSION'
      and v_group_plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and v_group_plan.due_day between 1 and 31 then return 'MONTHLY_SESSION'; end if;
    return 'AT_SESSION';
  end if;

  select coalesce(a.scheduled_start_at,a.scheduled_at,a.actual_end_at)
  into v_effective_at
  from public.appointments a
  where a.id=p_appointment_id and coalesce(a.organization_id,a.clinic_id)=p_organization_id;
  if v_effective_at is null then return 'NONE'; end if;

  select upper(coalesce(nullif(trim(c.payer_type),''),'')), c.payer_id,
         (nullif(trim(coalesce(c.payer_type,'')),'') is not null or c.payer_id is not null)
  into v_context_type,v_payer_id,v_has_explicit_context
  from public.appointment_billing_contexts c
  where c.organization_id=p_organization_id and c.appointment_id=p_appointment_id
  order by c.updated_at desc nulls last limit 1;

  -- A deliberate removal is authoritative even when old appointment/source payload
  -- still carries PRIVATE/INSURANCE hints. A new explicit context clears this marker
  -- in the context trigger before synchronization.
  if not coalesce(v_has_explicit_context,false) and exists (
    select 1
    from public.appointment_billing_context_tombstones tombstone
    where tombstone.organization_id=p_organization_id
      and tombstone.appointment_id=p_appointment_id
      and tombstone.reason='BILLING_CONTEXT_REMOVED'
  ) then
    return 'NONE';
  end if;

  v_context_type:=upper(coalesce(
    nullif(v_context_type,''),
    nullif(trim(p_source->>'financialContextType'),''),
    nullif(trim(p_source->>'financial_context_type'),''),
    nullif(trim(p_source->>'payerType'),''),
    nullif(trim(p_source->>'payer_type'),''),
    ''
  ));
  if v_context_type='PARTICULAR' then v_context_type:='PRIVATE'; end if;
  if v_context_type in ('CONVENIO','CONVÊNIO') then v_context_type:='INSURANCE'; end if;

  if v_payer_id is null then
    v_source_payer:=coalesce(
      nullif(trim(p_source->>'insurancePayerId'),''),
      nullif(trim(p_source->>'insurance_payer_id'),''),
      nullif(trim(p_source->>'payerId'),''),
      nullif(trim(p_source->>'payer_id'),'')
    );
    if v_source_payer ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_payer_id:=v_source_payer::uuid;
    end if;
  end if;

  if v_context_type='' then
    select count(*)::integer into v_monthly_count
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=p_patient_id
      and plan.billing_mode in ('PRIVATE','INSURANCE')
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      );

    if v_monthly_count=1 then return 'MONTHLY_SESSION'; end if;
    if v_monthly_count>1 then return 'AMBIGUOUS'; end if;
    -- Preserve the proven legacy contract when no monthly-session rule exists.
    return 'AT_SESSION';
  end if;

  if v_context_type not in ('PRIVATE','INSURANCE') then return 'NONE'; end if;
  if v_context_type='INSURANCE' and v_payer_id is null then return 'NONE'; end if;

  select count(*)::integer into v_monthly_count
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.billing_mode=v_context_type
    and plan.billing_frequency='MONTHLY'
    and plan.pricing_unit='SESSION'
    and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
    and plan.amount_cents>0
    and plan.due_day between 1 and 31
    and plan.valid_from<=v_effective_at
    and (plan.valid_until is null or v_effective_at<plan.valid_until)
    and (v_context_type<>'INSURANCE' or plan.payer_id=v_payer_id)
    and (
      v_service is null
      or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
      or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
    );

  if v_monthly_count=1 then return 'MONTHLY_SESSION'; end if;
  if v_monthly_count>1 then return 'AMBIGUOUS'; end if;
  if v_context_type='PRIVATE' then return 'AT_SESSION'; end if;
  return 'NONE';
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_monthly_session_billing_for_appointment_v1(p_organization_id uuid, p_appointment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_appointment public.appointments%rowtype;
  v_plan public.patient_financial_plans%rowtype;
  v_existing_item public.payment_appointment_items%rowtype;
  v_existing_payment public.payments%rowtype;
  v_target_payment public.payments%rowtype;
  v_context_type text;
  v_context_payer_id uuid;
  v_context_payer_name text;
  v_context_service text;
  v_source jsonb;
  v_service text;
  v_service_key text;
  v_effective_at timestamptz;
  v_competence date;
  v_due_date date;
  v_group_key text;
  v_item_key text;
  v_unit_amount numeric(14,2);
  v_patient_name text;
  v_actor_id text;
  v_event_key text;
  v_completed boolean;
  v_candidate_count integer := 0;
  v_engine text;
  v_snapshot_material_equal boolean := false;
  v_snapshot_changed_same_group boolean := false;
begin
  if p_organization_id is null or p_appointment_id is null then
    return jsonb_build_object('success',false,'code','MONTHLY_SESSION_SCOPE_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':monthly-session:'||p_appointment_id::text,0));

  select * into v_appointment
  from public.appointments a
  where a.id=p_appointment_id
    and coalesce(a.organization_id,a.clinic_id)=p_organization_id
  for update;
  if not found or v_appointment.patient_id is null then
    return jsonb_build_object('success',true,'action','NO_APPOINTMENT');
  end if;

  select item.* into v_existing_item
  from public.payment_appointment_items item
  where item.organization_id=p_organization_id
    and item.appointment_id=p_appointment_id
    and item.billing_item_type='MONTHLY_SESSION'
    and item.active=true
  order by item.created_at desc limit 1 for update;

  v_completed:=lower(coalesce(v_appointment.status,''))='completed'
    and coalesce(v_appointment.is_active,true)=true
    and v_appointment.deleted_at is null;

  -- Reopen/cancel/no-show: remove from an open aggregate, never rewrite a settled payment.
  if not v_completed then
    if v_existing_item.id is null then return jsonb_build_object('success',true,'action','NOT_ELIGIBLE'); end if;
    select * into v_existing_payment from public.payments p where p.id::text=v_existing_item.payment_id::text for update;
    if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
      perform public.mark_monthly_session_adjustment_required_v1(
        v_existing_item.payment_id::text,p_appointment_id,
        'Sessão deixou de ser elegível após movimentação financeira; recebível liquidado não foi reescrito.',
        'monthly-session:'||p_appointment_id::text||':adjustment:'||coalesce(v_appointment.updated_at::text,'status')
      );
      return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
    end if;
    update public.payment_appointment_items
    set active=false,deactivated_at=now(),deactivation_reason='APPOINTMENT_NOT_COMPLETED',updated_at=now()
    where id=v_existing_item.id;
    perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
    insert into public.payment_audit_events (
      organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
    ) values (
      p_organization_id,p_organization_id::text,v_existing_item.payment_id::text,p_appointment_id,
      'MONTHLY_SESSION_REMOVED','{}'::jsonb,
      (select to_jsonb(p) from public.payments p where p.id::text=v_existing_item.payment_id::text),
      'Sessão deixou de ser COMPLETED e foi retirada da competência aberta.',
      'monthly-session:'||p_appointment_id::text||':removed:'||coalesce(v_appointment.updated_at::text,'status'),null
    ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('success',true,'action','REMOVED');
  end if;

  v_source:=coalesce(to_jsonb(v_appointment)->'source_payload','{}'::jsonb);
  v_service:=nullif(trim(coalesce(v_appointment.service_type,v_appointment.approach,v_source->>'serviceType',v_source->>'service_type','')),'');
  select upper(coalesce(nullif(trim(c.payer_type),''),'')),c.payer_id,c.payer_name_snapshot,nullif(trim(c.service_type),'')
  into v_context_type,v_context_payer_id,v_context_payer_name,v_context_service
  from public.appointment_billing_contexts c
  where c.organization_id=p_organization_id and c.appointment_id=p_appointment_id
  order by c.updated_at desc nulls last limit 1;
  v_context_type:=upper(coalesce(nullif(v_context_type,''),nullif(trim(v_source->>'financialContextType'),''),nullif(trim(v_source->>'financial_context_type'),''),nullif(trim(v_source->>'payerType'),''),nullif(trim(v_source->>'payer_type'),''),''));
  if v_context_type='PARTICULAR' then v_context_type:='PRIVATE'; end if;
  if v_context_type in ('CONVENIO','CONVÊNIO') then v_context_type:='INSURANCE'; end if;
  v_service:=coalesce(v_context_service,v_service);

  -- Competence is the canonical scheduled/performed session month, never payment_date.
  -- scheduled_start_at wins so a September session completed retroactively in October remains September.
  v_effective_at:=coalesce(v_appointment.scheduled_start_at,v_appointment.scheduled_at,v_appointment.actual_end_at,now());
  v_competence:=date_trunc('month',v_effective_at at time zone 'America/Sao_Paulo')::date;

  v_engine:=public.resolve_appointment_financial_engine_v1(
    p_organization_id,
    p_appointment_id,
    v_appointment.patient_id,
    v_service,
    v_source
  );

  -- A single canonical resolver owns the engine decision. The monthly engine never
  -- runs as a fallback beside the legacy engine, and ambiguity fails closed.
  if v_engine <> 'MONTHLY_SESSION' then
    if v_existing_item.id is not null then
      if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
        perform public.mark_monthly_session_adjustment_required_v1(
          v_existing_item.payment_id::text,p_appointment_id,
          'Motor financeiro aplicável à sessão mudou após movimentação financeira; recebível original preservado.',
          'monthly-session:'||p_appointment_id::text||':engine-change:'||coalesce(v_appointment.updated_at::text,v_engine)
        );
        return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED','engine',v_engine);
      end if;
      update public.payment_appointment_items
      set active=false,deactivated_at=now(),deactivation_reason='FINANCIAL_ENGINE_'||coalesce(v_engine,'NONE'),updated_at=now()
      where id=v_existing_item.id;
      perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
      insert into public.payment_audit_events (
        organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
      ) values (
        p_organization_id,p_organization_id::text,v_existing_item.payment_id::text,p_appointment_id,
        'MONTHLY_SESSION_REMOVED','{}'::jsonb,
        (select to_jsonb(p) from public.payments p where p.id::text=v_existing_item.payment_id::text),
        'Sessão deixou o motor mensal porque o motor canônico passou a '||coalesce(v_engine,'NONE')||'.',
        'monthly-session:'||p_appointment_id::text||':engine-removed:'||coalesce(v_appointment.updated_at::text,v_engine),null
      ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;
    end if;
    return jsonb_build_object('success',true,'action','ENGINE_NOOP','engine',v_engine);
  end if;

  if upper(coalesce(v_source->>'sessionModality',''))='GROUP' then
    select plan.* into v_plan from public.patient_financial_plans plan
    join public.group_session_participants participant on participant.financial_plan_id=plan.id
    where participant.organization_id=p_organization_id and participant.appointment_id=p_appointment_id
      and participant.patient_id=v_appointment.patient_id and plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id and plan.billing_mode='PRIVATE';
    if not found then raise exception 'GROUP_FINANCIAL_SNAPSHOT_REQUIRED'; end if;
  else
  if v_context_type in ('PRIVATE','INSURANCE') then
    if v_context_type='INSURANCE' and v_context_payer_id is null then
      return jsonb_build_object('success',true,'action','INSURANCE_PAYER_MISSING');
    end if;
    select plan.* into v_plan
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id
      and plan.billing_mode=v_context_type
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (v_context_type<>'INSURANCE' or plan.payer_id=v_context_payer_id)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      )
    order by plan.version desc,plan.valid_from desc
    limit 1;
  else
    -- Finance-only clinics do not need TISS/Agenda billing context to use this model.
    -- If exactly one monthly rule matches the session/service, the canonical patient plan
    -- itself supplies payer/source. Multiple matches fail closed instead of guessing.
    select count(*)::integer into v_candidate_count
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id
      and plan.billing_mode in ('PRIVATE','INSURANCE')
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      );
    if v_candidate_count <> 1 then
      return jsonb_build_object('success',true,'action',case when v_candidate_count=0 then 'NO_MONTHLY_PLAN' else 'MONTHLY_PLAN_AMBIGUOUS' end);
    end if;
    select plan.* into v_plan
    from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id
      and plan.patient_id=v_appointment.patient_id
      and plan.billing_mode in ('PRIVATE','INSURANCE')
      and plan.billing_frequency='MONTHLY'
      and plan.pricing_unit='SESSION'
      and plan.aggregation_method='ELIGIBLE_COMPLETED_SESSIONS'
      and plan.amount_cents>0
      and plan.due_day between 1 and 31
      and plan.valid_from<=v_effective_at
      and (plan.valid_until is null or v_effective_at<plan.valid_until)
      and (
        v_service is null
        or public.appointment_financial_service_key_v1(plan.service_type)=public.appointment_financial_service_key_v1(v_service)
        or public.appointment_financial_service_key_v1(coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type,''))=public.appointment_financial_service_key_v1(v_service)
      )
    order by plan.version desc,plan.valid_from desc
    limit 1;
    v_context_type:=v_plan.billing_mode;
    v_context_payer_id:=v_plan.payer_id;
    v_context_payer_name:=v_plan.payer_name_snapshot;
  end if;

  end if;

  if v_plan.id is null then
    -- If the appointment used to belong to this engine but no longer resolves to a
    -- monthly plan, treat it as a financial reversal while preserving settled money.
    if v_existing_item.id is not null then
      if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
        perform public.mark_monthly_session_adjustment_required_v1(
          v_existing_item.payment_id::text,p_appointment_id,
          'Regra financeira da sessão mudou após movimentação financeira; ajuste manual necessário.',
          'monthly-session:'||p_appointment_id::text||':plan-missing:'||coalesce(v_appointment.updated_at::text,'plan')
        );
        return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
      end if;
      update public.payment_appointment_items
      set active=false,deactivated_at=now(),deactivation_reason='MONTHLY_PLAN_NO_LONGER_APPLIES',updated_at=now()
      where id=v_existing_item.id;
      perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
    end if;
    return jsonb_build_object('success',true,'action','NO_MONTHLY_PLAN');
  end if;

  if v_plan.billing_mode='INSURANCE' and not exists (
    select 1 from public.clinic_payers payer
    where payer.id=v_plan.payer_id and payer.organization_id=p_organization_id
  ) then
    return jsonb_build_object('success',true,'action','PAYER_SCOPE_INVALID');
  end if;

  v_service_key:=lower(coalesce(nullif(trim(v_plan.service_type),''),nullif(trim(v_plan.custom_service_name),''),nullif(trim(v_plan.service_name_snapshot),''),'service'));
  v_due_date:=public.monthly_session_due_date_v1(v_competence,v_plan.due_day);
  v_group_key:=concat_ws('|',
    'monthly-session',v_appointment.patient_id::text,v_plan.logical_plan_id::text,v_competence::text,
    v_plan.billing_mode,coalesce(v_plan.payer_id::text,'PRIVATE'),v_service_key,
    coalesce(v_plan.due_day::text,''),coalesce(lower(v_plan.payment_method),'')
  );
  v_item_key:='monthly-session:'||p_appointment_id::text||':'||md5(v_group_key);
  if upper(coalesce(v_source->>'sessionModality',''))='GROUP' then
    select round(participant.unit_amount_cents::numeric/100,2) into strict v_unit_amount
    from public.group_session_participants participant
    where participant.organization_id=p_organization_id and participant.appointment_id=p_appointment_id;
  else
  v_unit_amount:=round(v_plan.amount_cents::numeric/100,2);
  end if;
  select p.name into v_patient_name from public.patients p where p.id=v_appointment.patient_id and p.clinic_id=p_organization_id;
  v_actor_id:=nullif(trim(coalesce(to_jsonb(v_appointment)->>'financial_event_actor_id','')),'');
  v_event_key:='monthly-session:'||p_appointment_id::text||':'||coalesce(v_appointment.updated_at::text,'completed');

  -- The group identity intentionally excludes price/version so a mid-month plan
  -- version can remain in one coherent receivable. Therefore equal billing_item_key
  -- is not sufficient for NOOP: the immutable financial snapshot must also match.
  if v_existing_item.id is not null and v_existing_item.billing_item_key=v_item_key then
    v_snapshot_material_equal :=
      v_existing_item.patient_financial_plan_id is not distinct from v_plan.id
      and v_existing_item.patient_financial_plan_logical_id is not distinct from v_plan.logical_plan_id
      and v_existing_item.patient_financial_plan_version is not distinct from v_plan.version
      and round(coalesce(v_existing_item.unit_amount,0)::numeric,2) is not distinct from round(v_unit_amount::numeric,2)
      and round(coalesce(v_existing_item.subtotal,0)::numeric,2) is not distinct from round(v_unit_amount::numeric,2)
      and v_existing_item.appointment_scheduled_at is not distinct from v_effective_at
      and v_existing_item.professional_id::text is not distinct from v_appointment.therapist_id::text
      and coalesce(v_existing_item.professional_name_snapshot,'') is not distinct from coalesce(v_appointment.therapist_name,'')
      and coalesce(v_existing_item.service_type_snapshot,'') is not distinct from coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type,'')
      and coalesce(v_existing_item.specialty_snapshot,'') is not distinct from coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type,'')
      and v_existing_item.payer_id_snapshot is not distinct from v_plan.payer_id
      and coalesce(v_existing_item.payer_name_snapshot,'') is not distinct from coalesce(v_plan.payer_name_snapshot,v_context_payer_name,'')
      and v_existing_item.competence_month is not distinct from v_competence
      and v_existing_item.completion_at is not distinct from v_appointment.actual_end_at;

    if v_snapshot_material_equal then
      return jsonb_build_object('success',true,'action','NOOP','paymentId',v_existing_item.payment_id);
    end if;

    if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
      perform public.mark_monthly_session_adjustment_required_v1(
        v_existing_item.payment_id::text,p_appointment_id,
        'Snapshot financeiro da sessão mudou após movimentação financeira; item e recebível originais preservados.',
        v_event_key||':snapshot-change'
      );
      return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED','paymentId',v_existing_item.payment_id);
    end if;
    v_snapshot_changed_same_group := true;
  end if;

  -- Material correction (payer/service/competence): detach from the old open group first.
  if v_existing_item.id is not null and v_existing_item.billing_item_key is distinct from v_item_key then
    if public.monthly_session_payment_locked_v1(v_existing_item.payment_id::text) then
      perform public.mark_monthly_session_adjustment_required_v1(
        v_existing_item.payment_id::text,p_appointment_id,
        'Dimensão material da cobrança mensal mudou após movimentação financeira; recebível liquidado preservado.',
        v_event_key||':material-change'
      );
      return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
    end if;
    update public.payment_appointment_items
    set active=false,deactivated_at=now(),deactivation_reason='MATERIAL_BILLING_GROUP_CHANGED',updated_at=now()
    where id=v_existing_item.id;
    perform public.refresh_monthly_session_payment_v1(v_existing_item.payment_id::text);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':monthly-group:'||v_group_key,0));
  select * into v_target_payment
  from public.payments p
  where p.organization_id=p_organization_id
    and p.source='MONTHLY_SESSION_AGGREGATE'
    and p.monthly_billing_group_key=v_group_key
  limit 1 for update;

  if v_target_payment.id is null then
    insert into public.payments (
      organization_id,clinic_id,patient_id,patient_name,appointment_id,professional_id,
      service_type,appointment_scheduled_at,payer_id,payer_name,competence_month,
      amount,original_amount,base_amount,additional_amount,discount_amount,paid_amount,refunded_amount,balance_amount,
      due_date,method,status,financial_status,source,idempotency_key,notes,created_by,created_at,updated_at,
      billing_frequency,pricing_unit,aggregation_method,monthly_billing_group_key,
      patient_financial_plan_logical_id,monthly_session_count,monthly_adjustment_required
    ) values (
      p_organization_id,p_organization_id::text,v_appointment.patient_id::text,v_patient_name,p_appointment_id,v_appointment.therapist_id,
      coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),v_effective_at,v_plan.payer_id,
      coalesce(v_plan.payer_name_snapshot,v_context_payer_name),v_competence,
      0,0,0,0,0,0,0,0,
      v_due_date,nullif(v_plan.payment_method,''),'pending','pending','MONTHLY_SESSION_AGGREGATE',
      'monthly-session-group:'||md5(v_group_key),
      'Faturamento mensal por sessões realizadas.',v_actor_id,now(),now(),
      'MONTHLY','SESSION','ELIGIBLE_COMPLETED_SESSIONS',v_group_key,
      v_plan.logical_plan_id,0,false
    ) returning * into v_target_payment;
  elsif public.monthly_session_payment_locked_v1(v_target_payment.id::text) then
    perform public.mark_monthly_session_adjustment_required_v1(
      v_target_payment.id::text,p_appointment_id,
      'Sessão elegível chegou a uma competência já movimentada financeiramente; valor liquidado não foi reescrito.',
      v_event_key||':late-session'
    );
    return jsonb_build_object('success',true,'action','ADJUSTMENT_REQUIRED');
  else
    update public.payments
    set canceled_at=null,canceled_by=null,due_date=v_due_date,
        payer_id=v_plan.payer_id,payer_name=coalesce(v_plan.payer_name_snapshot,v_context_payer_name),
        service_type=coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),
        updated_at=now()
    where id=v_target_payment.id
    returning * into v_target_payment;
  end if;

  insert into public.payment_appointment_items (
    organization_id,clinic_id,payment_id,appointment_id,patient_id,professional_id,
    patient_name_snapshot,professional_name_snapshot,service_type_snapshot,specialty_snapshot,
    appointment_scheduled_at,quantity,unit_amount,subtotal,active,created_at,
    billing_item_key,billing_item_type,patient_financial_plan_id,patient_financial_plan_logical_id,
    patient_financial_plan_version,payer_id_snapshot,payer_name_snapshot,competence_month,completion_at,
    updated_at,deactivated_at,deactivation_reason
  ) values (
    p_organization_id,p_organization_id::text,v_target_payment.id::text,p_appointment_id,v_appointment.patient_id,v_appointment.therapist_id,
    v_patient_name,v_appointment.therapist_name,
    coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),
    coalesce(v_plan.service_name_snapshot,v_plan.custom_service_name,v_plan.service_type),
    v_effective_at,1,v_unit_amount,v_unit_amount,true,now(),
    v_item_key,'MONTHLY_SESSION',v_plan.id,v_plan.logical_plan_id,v_plan.version,
    v_plan.payer_id,coalesce(v_plan.payer_name_snapshot,v_context_payer_name),v_competence,v_appointment.actual_end_at,
    now(),null,null
  )
  on conflict (organization_id,billing_item_key) where billing_item_type='MONTHLY_SESSION' and billing_item_key is not null
  do update set
    payment_id=excluded.payment_id,
    professional_id=excluded.professional_id,
    professional_name_snapshot=excluded.professional_name_snapshot,
    service_type_snapshot=excluded.service_type_snapshot,
    specialty_snapshot=excluded.specialty_snapshot,
    appointment_scheduled_at=excluded.appointment_scheduled_at,
    unit_amount=excluded.unit_amount,
    subtotal=excluded.subtotal,
    active=true,
    patient_financial_plan_id=excluded.patient_financial_plan_id,
    patient_financial_plan_logical_id=excluded.patient_financial_plan_logical_id,
    patient_financial_plan_version=excluded.patient_financial_plan_version,
    payer_id_snapshot=excluded.payer_id_snapshot,
    payer_name_snapshot=excluded.payer_name_snapshot,
    competence_month=excluded.competence_month,
    completion_at=excluded.completion_at,
    updated_at=now(),deactivated_at=null,deactivation_reason=null;

  perform public.refresh_monthly_session_payment_v1(v_target_payment.id::text);
  insert into public.payment_audit_events (
    organization_id,clinic_id,payment_id,appointment_id,event_type,before_state,after_state,notes,idempotency_key,created_by
  ) values (
    p_organization_id,p_organization_id::text,v_target_payment.id::text,p_appointment_id,
    case when v_snapshot_changed_same_group then 'MONTHLY_SESSION_RECONCILED' else 'MONTHLY_SESSION_INCLUDED' end,'{}'::jsonb,
    (select to_jsonb(p) from public.payments p where p.id::text=v_target_payment.id::text),
    case when v_snapshot_changed_same_group
      then 'Snapshot financeiro da sessão reconciliado dentro do mesmo grupo mensal aberto para '||to_char(v_unit_amount,'FM999999990D00')||'.'
      else 'Sessão COMPLETED incluída incrementalmente na competência '||v_competence::text||' por '||to_char(v_unit_amount,'FM999999990D00')||'.'
    end,
    v_event_key||case when v_snapshot_changed_same_group then ':reconciled' else ':included' end,v_actor_id
  ) on conflict (organization_id,idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object(
    'success',true,
    'action',case when v_snapshot_changed_same_group then 'RECONCILED' else 'INCLUDED' end,
    'paymentId',v_target_payment.id,
    'competenceMonth',v_competence
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_private_appointment_finance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_organization_id uuid := coalesce(new.organization_id, new.clinic_id);
  v_source jsonb := coalesce(to_jsonb(new)->'source_payload', '{}'::jsonb);
  v_old_source jsonb := case when tg_op = 'UPDATE' then coalesce(to_jsonb(old)->'source_payload', '{}'::jsonb) else '{}'::jsonb end;
  v_context_type text;
  v_service_type text := nullif(trim(coalesce(new.service_type, new.approach, v_source->>'serviceType', v_source->>'service_type', '')), '');
  v_service_catalog_id uuid;
  v_old_service_catalog_id uuid;
  v_actor_id uuid;
  v_scheduled_at timestamptz := coalesce(new.scheduled_start_at, new.scheduled_at);
  v_old_scheduled_at timestamptz := case when tg_op = 'UPDATE' then coalesce(old.scheduled_start_at, old.scheduled_at) end;
  v_care_setting text := upper(coalesce(nullif(trim(new.care_setting), ''), nullif(trim(v_source->>'careSetting'), ''), nullif(trim(v_source->>'care_setting'), ''), 'CLINIC'));
  v_old_care_setting text := case when tg_op = 'UPDATE' then upper(coalesce(nullif(trim(old.care_setting), ''), nullif(trim(v_old_source->>'careSetting'), ''), nullif(trim(v_old_source->>'care_setting'), ''), 'CLINIC')) end;
  v_manual_amount numeric;
  v_discount_amount numeric;
  v_zero_classification text;
  v_override_reason text;
  v_resolution jsonb;
  v_server_resolution jsonb;
  v_snapshot public.appointment_private_financial_snapshots%rowtype;
  v_previous_snapshot public.appointment_private_financial_snapshots%rowtype;
  v_charge public.payments%rowtype;
  v_payment_id text;
  v_payload jsonb;
  v_patient_name text;
  v_snapshot_version integer := 1;
  v_pricing_changed boolean := false;
  v_rescheduled boolean := false;
  v_event text;
  v_due_date date;
  v_free_until timestamptz;
  v_policy_amount numeric(14,2);
  v_policy_discount numeric(14,2);
  v_manual_policy_amount numeric(14,2) := new.financial_policy_decision_amount;
  v_manual_policy_event text := upper(coalesce(nullif(trim(new.financial_policy_decision_event), ''), ''));
  v_reschedule_financial_decision text;
  v_reschedule_previous_amount numeric(14,2);
  v_reschedule_credit_amount numeric(14,2) := 0;
  v_actor_role text;
  v_before jsonb;
  v_charge_key text;
begin
  if session_user = 'authenticator'
    and coalesce(auth.role()::text, '') <> 'service_role' then
    raise exception 'PRIVATE_SESSION_BACKEND_ONLY';
  end if;

  if v_organization_id is null or new.id is null or new.patient_id is null then
    return new;
  end if;

  select upper(coalesce(nullif(trim(context.payer_type), ''), ''))
  into v_context_type
  from public.appointment_billing_contexts context
  where context.organization_id = v_organization_id
    and context.appointment_id = new.id
  order by context.updated_at desc nulls last
  limit 1;
  v_context_type := upper(coalesce(
    nullif(v_context_type, ''),
    nullif(trim(v_source->>'financialContextType'), ''),
    nullif(trim(v_source->>'financial_context_type'), ''),
    nullif(trim(v_source->>'payerType'), ''),
    nullif(trim(v_source->>'payer_type'), ''),
    ''
  ));
  if v_context_type not in ('PRIVATE', 'PARTICULAR') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_organization_id::text || ':private-appointment-finance:' || new.id::text, 0
  ));

  if coalesce(v_source->>'privateServiceCatalogId', v_source->>'private_service_catalog_id', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_service_catalog_id := coalesce(v_source->>'privateServiceCatalogId', v_source->>'private_service_catalog_id')::uuid;
  end if;
  if coalesce(v_old_source->>'privateServiceCatalogId', v_old_source->>'private_service_catalog_id', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_old_service_catalog_id := coalesce(v_old_source->>'privateServiceCatalogId', v_old_source->>'private_service_catalog_id')::uuid;
  end if;
  if coalesce(v_source->>'privatePricingActorId', v_source->>'private_pricing_actor_id', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_actor_id := coalesce(v_source->>'privatePricingActorId', v_source->>'private_pricing_actor_id')::uuid;
  else
    v_actor_id := new.financial_event_actor_id;
  end if;
  if coalesce(v_source->>'privateManualAmount', v_source->>'private_manual_amount', '') ~ '^\d+(\.\d{1,2})?$' then
    v_manual_amount := coalesce(v_source->>'privateManualAmount', v_source->>'private_manual_amount')::numeric;
  end if;
  if coalesce(v_source->>'privateDiscountAmount', v_source->>'private_discount_amount', '') ~ '^\d+(\.\d{1,2})?$' then
    v_discount_amount := coalesce(v_source->>'privateDiscountAmount', v_source->>'private_discount_amount')::numeric;
  end if;
  v_zero_classification := nullif(upper(trim(coalesce(
    v_source->>'privateZeroClassification',
    v_source->>'private_zero_classification',
    ''
  ))), '');
  v_override_reason := nullif(trim(coalesce(
    v_source->>'privatePricingReason',
    v_source->>'private_pricing_reason',
    new.financial_event_reason,
    ''
  )), '');
  v_reschedule_financial_decision := nullif(upper(trim(coalesce(
    v_source->>'privateRescheduleFinancialDecision',
    v_source->>'private_reschedule_financial_decision',
    ''
  ))), '');
  v_server_resolution := coalesce(
    v_source->'privatePricingResolution',
    v_source->'private_pricing_resolution'
  );

  select snapshot.* into v_previous_snapshot
  from public.appointment_private_financial_snapshots snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.appointment_id = new.id
  order by snapshot.snapshot_version desc
  limit 1;

  select payment.* into v_charge
  from public.payment_appointment_items item
  join public.payments payment on payment.id::text = item.payment_id::text
  where item.organization_id = v_organization_id
    and item.appointment_id = new.id
  order by item.created_at
  limit 1
  for update of payment;

  if tg_op = 'UPDATE' then
    v_rescheduled := v_old_scheduled_at is distinct from v_scheduled_at;
    v_pricing_changed :=
      lower(coalesce(old.service_type, old.approach, '')) is distinct from lower(coalesce(new.service_type, new.approach, ''))
      or v_old_service_catalog_id is distinct from v_service_catalog_id
      or v_old_care_setting is distinct from v_care_setting
      or coalesce(v_old_source->>'privateManualAmount', v_old_source->>'private_manual_amount', '') is distinct from
        coalesce(v_source->>'privateManualAmount', v_source->>'private_manual_amount', '')
      or coalesce(v_old_source->>'privateDiscountAmount', v_old_source->>'private_discount_amount', '') is distinct from
        coalesce(v_source->>'privateDiscountAmount', v_source->>'private_discount_amount', '')
      or coalesce(v_old_source->>'privateZeroClassification', v_old_source->>'private_zero_classification', '') is distinct from
        coalesce(v_source->>'privateZeroClassification', v_source->>'private_zero_classification', '');
  end if;

  if v_previous_snapshot.id is null or v_pricing_changed then
    if v_previous_snapshot.id is not null
      and v_charge.id is not null
      and greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_PAID_PRICING_IMMUTABLE';
    end if;

    if upper(coalesce(v_source->>'sessionModality',''))='GROUP' and (
      jsonb_typeof(v_server_resolution) is distinct from 'object'
      or v_server_resolution->>'session_modality' is distinct from 'GROUP'
      or v_server_resolution->>'legacy_patient_financial_plan_id' is distinct from v_source->>'groupFinancialPlanId'
    ) then raise exception 'GROUP_FINANCIAL_SNAPSHOT_REQUIRED'; end if;

    if jsonb_typeof(v_server_resolution) = 'object'
      and coalesce((v_server_resolution->>'valid')::boolean, false)
      and nullif(v_server_resolution->>'organization_id', '')::uuid = v_organization_id
      and nullif(v_server_resolution->>'patient_id', '')::uuid = new.patient_id
      and nullif(v_server_resolution->>'created_by', '')::uuid = v_actor_id
      and nullif(v_server_resolution->>'scheduled_at', '')::timestamptz = v_scheduled_at then
      v_resolution := v_server_resolution;
    else
      v_resolution := public.resolve_private_session_price_v1(
        v_organization_id,
        new.patient_id,
        v_service_type,
        v_service_catalog_id,
        v_scheduled_at,
        v_care_setting,
        v_manual_amount,
        v_discount_amount,
        v_zero_classification,
        v_override_reason,
        v_actor_id
      );
    end if;
    v_snapshot_version := coalesce(v_previous_snapshot.snapshot_version, 0) + 1;
    v_charge_key := 'private-appointment:' || new.id::text || ':price:' || v_snapshot_version::text;

    if v_charge.id is null then
      if (v_resolution->>'final_amount')::numeric > 0 then
        v_payload := public.create_patient_financial_charge(
          v_organization_id,
          new.patient_id,
          jsonb_build_array(jsonb_build_object(
            'appointmentId', new.id,
            'unitAmount', (v_resolution->>'final_amount')::numeric,
            'serviceType', coalesce(v_resolution->>'service_name', v_service_type, 'Consulta'),
            'specialty', v_resolution->>'specialty_name'
          )),
          (v_resolution->>'base_amount')::numeric,
          (v_resolution->>'location_surcharge')::numeric,
          (v_resolution->>'discount_amount')::numeric,
          (v_resolution->>'due_date')::date,
          v_resolution->>'expected_payment_method',
          'PRIVATE_APPOINTMENT_FORECAST',
          date_trunc('month', (v_resolution->>'due_date')::date)::date,
          'Previsão particular vinculada automaticamente à consulta; não representa pagamento recebido.',
          v_charge_key,
          v_actor_id::text
        );
        v_payment_id := nullif(v_payload #>> '{charge,id}', '');
        select * into v_charge
        from public.payments
        where id::text = v_payment_id
        for update;
      else
        select patient.name into v_patient_name
        from public.patients patient
        where patient.id = new.patient_id
          and patient.clinic_id = v_organization_id;
        insert into public.payments (
          organization_id, clinic_id, patient_id, patient_name, appointment_id,
          professional_id, service_type, specialty, appointment_scheduled_at,
          payer_id, payer_name, amount, original_amount, base_amount, additional_amount,
          discount_amount, paid_amount, refunded_amount, balance_amount, due_date,
          method, status, financial_status, is_courtesy, source, competence_month,
          idempotency_key, created_by, notes, created_at, updated_at,
          private_price_source, private_price_source_label,
          private_financial_classification, cancellation_free_until, pricing_override_reason
        ) values (
          v_organization_id, v_organization_id::text, new.patient_id::text, v_patient_name, new.id,
          new.therapist_id, coalesce(v_resolution->>'service_name', v_service_type),
          v_resolution->>'specialty_name', v_scheduled_at,
          nullif(v_resolution->>'payer_id', '')::uuid, v_resolution->>'payer_name',
          0, (v_resolution->>'base_amount')::numeric, (v_resolution->>'base_amount')::numeric,
          (v_resolution->>'location_surcharge')::numeric, (v_resolution->>'discount_amount')::numeric,
          0, 0, 0, (v_resolution->>'due_date')::date,
          nullif(v_resolution->>'expected_payment_method', ''),
          case when v_resolution->>'financial_classification' = 'COURTESY' then 'courtesy' else 'canceled' end,
          lower(v_resolution->>'financial_classification'),
          v_resolution->>'financial_classification' = 'COURTESY',
          'PRIVATE_APPOINTMENT_ZERO_AUTHORIZED',
          date_trunc('month', (v_resolution->>'due_date')::date)::date,
          v_charge_key, v_actor_id::text,
          'Valor zero autorizado: ' || coalesce(v_resolution->>'override_reason', v_resolution->>'financial_classification'),
          now(), now(),
          v_resolution->>'price_source', v_resolution->>'price_source_label',
          v_resolution->>'financial_classification',
          nullif(v_resolution->>'cancellation_free_until', '')::timestamptz,
          v_resolution->>'override_reason'
        )
        returning * into v_charge;
        v_payment_id := v_charge.id::text;

        insert into public.payment_appointment_items (
          organization_id, clinic_id, payment_id, appointment_id, patient_id,
          professional_id, patient_name_snapshot, professional_name_snapshot,
          service_type_snapshot, specialty_snapshot, appointment_scheduled_at,
          quantity, unit_amount, subtotal, active
        ) values (
          v_organization_id, v_organization_id::text, v_payment_id, new.id, new.patient_id,
          new.therapist_id, v_patient_name, new.therapist_name,
          coalesce(v_resolution->>'service_name', v_service_type),
          v_resolution->>'specialty_name', v_scheduled_at,
          1, 0, 0, true
        );
        insert into public.payment_audit_events (
          organization_id, clinic_id, payment_id, appointment_id, event_type,
          before_state, after_state, notes, idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_payment_id, new.id,
          'PRIVATE_ZERO_VALUE_AUTHORIZED', '{}'::jsonb, to_jsonb(v_charge),
          v_resolution->>'override_reason', v_charge_key || ':created', v_actor_id::text
        ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
      end if;
    else
      v_payment_id := v_charge.id::text;
      v_before := to_jsonb(v_charge);

      update public.payment_transactions
      set
        status = 'VOIDED',
        voided_at = now(),
        voided_by = v_actor_id::text
      where organization_id = v_organization_id
        and payment_id::text = v_payment_id
        and transaction_type = 'DISCOUNT'
        and status = 'POSTED'
        and idempotency_key like 'private-appointment:' || new.id::text || ':%';

      update public.payments
      set
        original_amount = (v_resolution->>'base_amount')::numeric,
        base_amount = (v_resolution->>'base_amount')::numeric,
        additional_amount = (v_resolution->>'location_surcharge')::numeric,
        discount_amount = 0,
        canceled_at = null,
        canceled_by = null,
        is_courtesy = false,
        status = 'forecast',
        financial_status = 'forecast',
        source = 'PRIVATE_APPOINTMENT_FORECAST',
        due_date = (v_resolution->>'due_date')::date,
        method = nullif(v_resolution->>'expected_payment_method', ''),
        updated_at = now()
      where id::text = v_payment_id;

      if (v_resolution->>'discount_amount')::numeric > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type,
          amount, transaction_at, status, document_status, notes,
          idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_payment_id, new.patient_id,
          'DISCOUNT', (v_resolution->>'discount_amount')::numeric, now(), 'POSTED',
          'PENDING', 'Desconto congelado no snapshot particular.',
          v_charge_key || ':discount', v_actor_id::text
        ) on conflict (organization_id, idempotency_key) do nothing;
      else
        perform public.refresh_patient_financial_charge(v_payment_id);
      end if;

      select * into v_charge from public.payments where id::text = v_payment_id for update;
      update public.payment_appointment_items
      set
        professional_id = new.therapist_id,
        professional_name_snapshot = coalesce(new.therapist_name, professional_name_snapshot),
        service_type_snapshot = coalesce(v_resolution->>'service_name', v_service_type),
        specialty_snapshot = v_resolution->>'specialty_name',
        appointment_scheduled_at = v_scheduled_at,
        unit_amount = (v_resolution->>'final_amount')::numeric,
        subtotal = (v_resolution->>'final_amount')::numeric,
        active = true
      where organization_id = v_organization_id
        and appointment_id = new.id;
      insert into public.payment_audit_events (
        organization_id, clinic_id, payment_id, appointment_id, event_type,
        before_state, after_state, notes, idempotency_key, created_by
      ) values (
        v_organization_id, v_organization_id::text, v_payment_id, new.id,
        'PRIVATE_PRICING_SNAPSHOT_REPLACED', v_before, to_jsonb(v_charge),
        v_resolution->>'override_reason', v_charge_key || ':replaced', v_actor_id::text
      ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
    end if;

    insert into public.appointment_private_financial_snapshots (
      organization_id, clinic_id, patient_id, appointment_id, payment_id,
      snapshot_version, snapshot_event, previous_snapshot_id,
      specialty_key, specialty_name, service_catalog_id, service_name,
      payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
      price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
      legacy_patient_financial_plan_id, price_rule_version,
      due_date, due_rule, due_offset_days, due_day,
      cancellation_free_until, cancellation_free_value, cancellation_free_unit,
      late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
      expected_payment_method, allow_partial_payment, allowed_payment_methods,
      allow_manual_override, discount_approval_required, financial_classification,
      created_by, override_reason, currency, timezone, resolution_payload
    ) values (
      v_organization_id, v_organization_id, new.patient_id, new.id, v_charge.id::text,
      v_snapshot_version,
      case when v_previous_snapshot.id is null then 'CREATED' else 'PRICING_CHANGED' end,
      v_previous_snapshot.id,
      v_resolution->>'specialty_key', v_resolution->>'specialty_name',
      nullif(v_resolution->>'service_catalog_id', '')::uuid, v_resolution->>'service_name',
      nullif(v_resolution->>'payer_id', '')::uuid, v_resolution->>'payer_name',
      (v_resolution->>'base_amount')::numeric,
      (v_resolution->>'location_surcharge')::numeric,
      (v_resolution->>'discount_amount')::numeric,
      (v_resolution->>'final_amount')::numeric,
      v_resolution->>'price_source', v_resolution->>'price_source_label',
      nullif(v_resolution->>'price_rule_id', '')::uuid,
      nullif(v_resolution->>'patient_pricing_agreement_id', '')::uuid,
      nullif(v_resolution->>'legacy_patient_financial_plan_id', '')::uuid,
      nullif(v_resolution->>'price_rule_version', '')::integer,
      (v_resolution->>'due_date')::date, v_resolution->>'due_rule',
      coalesce(nullif(v_resolution->>'due_offset_days', '')::integer, 0),
      nullif(v_resolution->>'due_day', '')::integer,
      nullif(v_resolution->>'cancellation_free_until', '')::timestamptz,
      coalesce(nullif(v_resolution->>'cancellation_free_value', '')::integer, 0),
      coalesce(v_resolution->>'cancellation_free_unit', 'HOURS'),
      coalesce(v_resolution->'late_cancellation_rule', '{}'::jsonb),
      coalesce(v_resolution->'no_show_rule', '{}'::jsonb),
      v_care_setting, new.location_type, v_scheduled_at,
      nullif(v_resolution->>'expected_payment_method', ''),
      coalesce((v_resolution->>'allow_partial_payment')::boolean, true),
      array(select jsonb_array_elements_text(coalesce(v_resolution->'allowed_payment_methods', '[]'::jsonb))),
      coalesce((v_resolution->>'allow_manual_override')::boolean, false),
      coalesce((v_resolution->>'discount_approval_required')::boolean, true),
      coalesce(v_resolution->>'financial_classification', 'STANDARD'),
      v_actor_id, v_resolution->>'override_reason', 'BRL', 'America/Sao_Paulo', v_resolution
    )
    returning * into v_snapshot;

    update public.payments
    set
      payer_id = v_snapshot.payer_id,
      payer_name = v_snapshot.payer_name,
      service_catalog_id = v_snapshot.service_catalog_id,
      private_price_rule_id = v_snapshot.price_rule_id,
      patient_pricing_agreement_id = v_snapshot.patient_pricing_agreement_id,
      financial_snapshot_id = v_snapshot.id,
      private_price_source = v_snapshot.price_source,
      private_price_source_label = v_snapshot.price_source_label,
      private_financial_classification = v_snapshot.financial_classification,
      cancellation_free_until = v_snapshot.cancellation_free_until,
      pricing_override_reason = v_snapshot.override_reason,
      appointment_scheduled_at = v_scheduled_at,
      professional_id = new.therapist_id,
      updated_at = now()
    where id::text = v_charge.id::text;
    if v_snapshot.final_amount = 0 then
      update public.payments
      set
        amount = 0,
        balance_amount = 0,
        status = case when v_snapshot.financial_classification = 'COURTESY' then 'courtesy' else 'canceled' end,
        financial_status = lower(v_snapshot.financial_classification),
        is_courtesy = v_snapshot.financial_classification = 'COURTESY',
        canceled_at = case when v_snapshot.financial_classification = 'COURTESY' then null else now() end,
        canceled_by = case when v_snapshot.financial_classification = 'COURTESY' then null else v_actor_id::text end,
        updated_at = now()
      where id::text = v_charge.id::text;
    end if;
  else
    v_snapshot := v_previous_snapshot;
    v_payment_id := v_charge.id::text;
  end if;

  if v_charge.id is null then
    select payment.* into v_charge
    from public.payments payment
    where payment.id::text = v_payment_id
    for update;
  end if;

  if v_rescheduled and not v_pricing_changed then
    if v_snapshot.id is null or v_charge.id is null then
      raise exception 'PRIVATE_SESSION_LEGACY_FINANCIAL_REVIEW_REQUIRED';
    end if;
    v_due_date := public.private_session_due_date_v1(
      v_snapshot.due_rule,
      v_snapshot.due_offset_days,
      v_snapshot.due_day,
      (v_scheduled_at at time zone v_snapshot.timezone)::date
    );
    v_free_until := v_scheduled_at - case
      when v_snapshot.cancellation_free_unit = 'DAYS'
        then make_interval(days => v_snapshot.cancellation_free_value)
      else make_interval(hours => v_snapshot.cancellation_free_value)
    end;
    v_snapshot_version := v_snapshot.snapshot_version + 1;
    insert into public.appointment_private_financial_snapshots (
      organization_id, clinic_id, patient_id, appointment_id, payment_id,
      snapshot_version, snapshot_event, previous_snapshot_id,
      specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
      payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
      price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
      legacy_patient_financial_plan_id, price_rule_version,
      due_date, due_rule, due_offset_days, due_day,
      cancellation_free_until, cancellation_free_value, cancellation_free_unit,
      late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
      expected_payment_method, allow_partial_payment, allowed_payment_methods,
      allow_manual_override, discount_approval_required, financial_classification,
      created_by, override_reason, currency, timezone, resolution_payload
    ) select
      organization_id, clinic_id, patient_id, appointment_id, payment_id,
      v_snapshot_version, 'RESCHEDULED', id,
      specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
      payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
      price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
      legacy_patient_financial_plan_id, price_rule_version,
      v_due_date, due_rule, due_offset_days, due_day,
      v_free_until, cancellation_free_value, cancellation_free_unit,
      late_cancellation_rule, no_show_rule, care_setting, new.location_type, v_scheduled_at,
      expected_payment_method, allow_partial_payment, allowed_payment_methods,
      allow_manual_override, discount_approval_required, financial_classification,
      coalesce(v_actor_id, created_by), v_override_reason, currency, timezone,
      resolution_payload || jsonb_build_object(
        'scheduled_at', v_scheduled_at,
        'due_date', v_due_date,
        'cancellation_free_until', v_free_until,
        'rescheduled_from', v_old_scheduled_at
      )
    from public.appointment_private_financial_snapshots
    where id = v_snapshot.id
    returning * into v_snapshot;

    update public.payments
    set
      financial_snapshot_id = v_snapshot.id,
      appointment_scheduled_at = v_scheduled_at,
      due_date = v_due_date,
      cancellation_free_until = v_free_until,
      professional_id = new.therapist_id,
      updated_at = now()
    where id::text = v_charge.id::text;
    update public.payment_appointment_items
    set
      appointment_scheduled_at = v_scheduled_at,
      professional_id = new.therapist_id,
      professional_name_snapshot = coalesce(new.therapist_name, professional_name_snapshot)
    where organization_id = v_organization_id
      and appointment_id = new.id;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      'PRIVATE_APPOINTMENT_RESCHEDULED',
      jsonb_build_object('scheduled_at', v_old_scheduled_at),
      jsonb_build_object('scheduled_at', v_scheduled_at, 'due_date', v_due_date, 'snapshot_id', v_snapshot.id),
      v_override_reason,
      'private-appointment:' || new.id::text || ':snapshot:' || v_snapshot.snapshot_version::text || ':rescheduled',
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  end if;

  if v_rescheduled
    and not v_pricing_changed
    and coalesce(v_charge.private_financial_classification, '') = 'LATE_CANCELLATION_CHARGE' then
    if v_reschedule_financial_decision not in (
      'KEEP_PREVIOUS_CHARGE',
      'CONVERT_TO_CREDIT',
      'EXEMPT_PREVIOUS_CHARGE',
      'CREATE_NEW_CHARGE',
      'TRANSFER_TO_RESCHEDULED_SESSION'
    ) then
      raise exception 'PRIVATE_SESSION_LATE_CANCELLATION_RESCHEDULE_DECISION_REQUIRED';
    end if;
    if v_actor_id is null or v_override_reason is null then
      raise exception 'PRIVATE_SESSION_RESCHEDULE_DECISION_ACTOR_REASON_REQUIRED';
    end if;
    v_actor_role := public.private_finance_actor_role_v2(v_actor_id, v_organization_id);
    if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
      raise exception 'PRIVATE_SESSION_RESCHEDULE_DECISION_FORBIDDEN';
    end if;
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_RESCHEDULE_DECISION_REQUIRES_REFUND';
    end if;

    v_before := to_jsonb(v_charge);
    v_reschedule_previous_amount := greatest(coalesce(v_charge.amount, 0), 0);

    if v_reschedule_financial_decision = 'TRANSFER_TO_RESCHEDULED_SESSION' then
      update public.payment_transactions
      set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and transaction_type in ('DISCOUNT', 'COURTESY')
        and status = 'POSTED';

      update public.payments
      set
        original_amount = v_snapshot.base_amount,
        base_amount = v_snapshot.base_amount,
        additional_amount = v_snapshot.location_surcharge,
        discount_amount = 0,
        canceled_at = null,
        canceled_by = null,
        is_courtesy = false,
        source = 'PRIVATE_RESCHEDULE_TRANSFERRED',
        private_financial_classification = 'STANDARD',
        pricing_override_reason = v_override_reason,
        updated_at = now()
      where id::text = v_charge.id::text;

      if v_snapshot.discount_amount > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type,
          amount, transaction_at, status, document_status, notes,
          idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_charge.id::text, new.patient_id,
          'DISCOUNT', v_snapshot.discount_amount, now(), 'POSTED', 'PENDING',
          'Desconto original restaurado na transferência para a sessão reagendada.',
          'private-appointment:' || new.id::text || ':reschedule:' || v_snapshot.snapshot_version::text || ':transfer-discount',
          v_actor_id::text
        ) on conflict (organization_id, idempotency_key) do nothing;
      else
        perform public.refresh_patient_financial_charge(v_charge.id::text);
      end if;

      update public.payments
      set status = 'forecast', financial_status = 'forecast', updated_at = now()
      where id::text = v_charge.id::text;
      update public.payment_appointment_items
      set
        active = true,
        unit_amount = v_snapshot.final_amount,
        subtotal = v_snapshot.final_amount,
        appointment_scheduled_at = v_scheduled_at
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and appointment_id = new.id;
      select * into v_charge from public.payments where id::text = v_charge.id::text for update;

    elsif v_reschedule_financial_decision in (
      'CONVERT_TO_CREDIT',
      'EXEMPT_PREVIOUS_CHARGE',
      'CREATE_NEW_CHARGE'
    ) then
      if v_reschedule_financial_decision = 'CONVERT_TO_CREDIT' then
        v_reschedule_credit_amount := least(v_reschedule_previous_amount, v_snapshot.final_amount);
      end if;

      update public.payment_appointment_items
      set active = false
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and appointment_id = new.id;

      if v_reschedule_financial_decision in ('CONVERT_TO_CREDIT', 'EXEMPT_PREVIOUS_CHARGE') then
        update public.payment_transactions
        set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
        where organization_id = v_organization_id
          and payment_id::text = v_charge.id::text
          and transaction_type in ('DISCOUNT', 'COURTESY')
          and status = 'POSTED';
        update public.payments
        set
          amount = 0,
          discount_amount = original_amount + coalesce(additional_amount, 0),
          balance_amount = 0,
          status = 'canceled',
          financial_status = case
            when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT' then 'voided'
            else 'exempt'
          end,
          private_financial_classification = case
            when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT' then 'CREDIT_TRANSFERRED'
            else 'EXEMPT'
          end,
          canceled_at = now(),
          canceled_by = v_actor_id::text,
          pricing_override_reason = v_override_reason,
          notes = concat_ws(' ', notes, case
            when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
              then 'Cobrança tardia convertida em crédito e aplicada à sessão reagendada.'
            else 'Cobrança tardia anterior isentada antes da criação da nova cobrança.'
          end),
          updated_at = now()
        where id::text = v_charge.id::text;
      end if;

      v_charge_key :=
        'private-appointment:' || new.id::text ||
        ':reschedule:' || v_snapshot.snapshot_version::text ||
        ':' || lower(v_reschedule_financial_decision) || ':new-charge';
      v_payload := public.create_patient_financial_charge(
        v_organization_id,
        new.patient_id,
        jsonb_build_array(jsonb_build_object(
          'appointmentId', new.id,
          'unitAmount', greatest(v_snapshot.final_amount - v_reschedule_credit_amount, 0),
          'serviceType', coalesce(v_snapshot.service_name, v_service_type, 'Consulta'),
          'specialty', v_snapshot.specialty_name
        )),
        v_snapshot.base_amount,
        v_snapshot.location_surcharge,
        v_snapshot.discount_amount + v_reschedule_credit_amount,
        v_snapshot.due_date,
        v_snapshot.expected_payment_method,
        'PRIVATE_APPOINTMENT_FORECAST',
        date_trunc('month', v_snapshot.due_date)::date,
        case
          when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
            then 'Nova cobrança da sessão reagendada com crédito da cobrança tardia aplicado.'
          when v_reschedule_financial_decision = 'EXEMPT_PREVIOUS_CHARGE'
            then 'Nova cobrança após isenção explícita da cobrança tardia anterior.'
          else 'Nova cobrança criada sem apagar a cobrança tardia anterior.'
        end,
        v_charge_key,
        v_actor_id::text
      );
      v_payment_id := nullif(v_payload #>> '{charge,id}', '');
      if v_payment_id is null then
        raise exception 'PRIVATE_SESSION_RESCHEDULE_NEW_CHARGE_FAILED';
      end if;

      v_snapshot_version := v_snapshot.snapshot_version + 1;
      insert into public.appointment_private_financial_snapshots (
        organization_id, clinic_id, patient_id, appointment_id, payment_id,
        snapshot_version, snapshot_event, previous_snapshot_id,
        specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
        payer_id, payer_name, base_amount, location_surcharge, discount_amount, final_amount,
        price_source, price_source_label, price_rule_id, patient_pricing_agreement_id,
        legacy_patient_financial_plan_id, price_rule_version,
        due_date, due_rule, due_offset_days, due_day,
        cancellation_free_until, cancellation_free_value, cancellation_free_unit,
        late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
        expected_payment_method, allow_partial_payment, allowed_payment_methods,
        allow_manual_override, discount_approval_required, financial_classification,
        created_by, override_reason, currency, timezone, resolution_payload
      ) select
        organization_id, clinic_id, patient_id, appointment_id, v_payment_id,
        v_snapshot_version, 'RESCHEDULE_FINANCIAL_DECISION', id,
        specialty_id, specialty_key, specialty_name, service_catalog_id, service_name,
        payer_id, payer_name, base_amount, location_surcharge,
        discount_amount + v_reschedule_credit_amount,
        greatest(final_amount - v_reschedule_credit_amount, 0),
        price_source,
        case
          when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
            then price_source_label || ' · crédito de cancelamento tardio aplicado'
          else price_source_label
        end,
        price_rule_id, patient_pricing_agreement_id,
        legacy_patient_financial_plan_id, price_rule_version,
        due_date, due_rule, due_offset_days, due_day,
        cancellation_free_until, cancellation_free_value, cancellation_free_unit,
        late_cancellation_rule, no_show_rule, care_setting, location_type, scheduled_at,
        expected_payment_method, allow_partial_payment, allowed_payment_methods,
        allow_manual_override, discount_approval_required,
        case
          when v_reschedule_financial_decision = 'CONVERT_TO_CREDIT'
            and greatest(final_amount - v_reschedule_credit_amount, 0) = 0 then 'EXEMPT'
          else 'STANDARD'
        end,
        v_actor_id, v_override_reason, currency, timezone,
        resolution_payload || jsonb_build_object(
          'reschedule_financial_decision', v_reschedule_financial_decision,
          'previous_late_cancellation_payment_id', v_charge.id::text,
          'previous_late_cancellation_amount', v_reschedule_previous_amount,
          'credit_applied', v_reschedule_credit_amount
        )
      from public.appointment_private_financial_snapshots
      where id = v_snapshot.id
      returning * into v_snapshot;

      update public.payments
      set
        payer_id = v_snapshot.payer_id,
        payer_name = v_snapshot.payer_name,
        service_catalog_id = v_snapshot.service_catalog_id,
        private_price_rule_id = v_snapshot.price_rule_id,
        patient_pricing_agreement_id = v_snapshot.patient_pricing_agreement_id,
        financial_snapshot_id = v_snapshot.id,
        private_price_source = v_snapshot.price_source,
        private_price_source_label = v_snapshot.price_source_label,
        private_financial_classification = v_snapshot.financial_classification,
        cancellation_free_until = v_snapshot.cancellation_free_until,
        pricing_override_reason = v_override_reason,
        status = case when v_snapshot.final_amount = 0 then 'canceled' else 'forecast' end,
        financial_status = case when v_snapshot.final_amount = 0 then 'exempt' else 'forecast' end,
        source = 'PRIVATE_APPOINTMENT_FORECAST',
        updated_at = now()
      where id::text = v_payment_id;
      select * into v_charge from public.payments where id::text = v_payment_id for update;
    end if;

    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      'PRIVATE_LATE_CANCELLATION_RESCHEDULE_DECISION',
      v_before,
      jsonb_build_object(
        'decision', v_reschedule_financial_decision,
        'active_payment', to_jsonb(v_charge),
        'previous_amount', v_reschedule_previous_amount,
        'credit_applied', v_reschedule_credit_amount,
        'snapshot_id', v_snapshot.id
      ),
      v_override_reason,
      'private-appointment:' || new.id::text || ':reschedule:' ||
        v_snapshot.snapshot_version::text || ':financial-decision',
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  end if;

  v_event := case lower(coalesce(new.status, 'scheduled'))
    when 'completed' then 'COMPLETED'
    when 'complete' then 'COMPLETED'
    when 'realizada' then 'COMPLETED'
    when 'cancelled' then 'CANCELED'
    when 'canceled' then 'CANCELED'
    when 'cancelado' then 'CANCELED'
    when 'no_show' then 'NO_SHOW'
    when 'missed' then 'NO_SHOW'
    when 'faltou' then 'NO_SHOW'
    else 'SCHEDULED'
  end;

  if v_event = 'CANCELED' then
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_CANCEL_REQUIRES_REFUND_OR_CREDIT';
    end if;
    v_before := to_jsonb(v_charge);
    if now() <= v_snapshot.cancellation_free_until
      or upper(coalesce(v_snapshot.late_cancellation_rule->>'type', 'NO_CHARGE')) = 'NO_CHARGE' then
      update public.payments
      set
        amount = 0,
        balance_amount = 0,
        status = 'canceled',
        financial_status = 'cancelled_no_charge',
        private_financial_classification = 'CANCELLED_NO_CHARGE',
        canceled_at = now(),
        canceled_by = v_actor_id::text,
        notes = concat_ws(' ', notes, 'Cancelamento sem cobrança: ' || coalesce(v_override_reason, 'dentro da política congelada.')),
        updated_at = now()
      where id::text = v_charge.id::text;
      v_event := 'CANCELLED_NO_CHARGE';
    else
      if upper(coalesce(v_snapshot.late_cancellation_rule->>'type', 'NO_CHARGE')) = 'MANUAL' then
        if v_manual_policy_event <> 'CANCELED'
          or v_manual_policy_amount is null
          or v_actor_id is null
          or v_override_reason is null then
          raise exception 'PRIVATE_SESSION_MANUAL_CANCELLATION_DECISION_REQUIRED';
        end if;
        if v_manual_policy_amount < 0 or v_manual_policy_amount > v_snapshot.final_amount then
          raise exception 'PRIVATE_SESSION_MANUAL_POLICY_AMOUNT_INVALID';
        end if;
        v_actor_role := public.private_finance_actor_role_v2(v_actor_id, v_organization_id);
        if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
          raise exception 'PRIVATE_SESSION_MANUAL_POLICY_DECISION_FORBIDDEN';
        end if;
        v_policy_amount := v_manual_policy_amount;
      else
        v_policy_amount := public.private_session_policy_amount_v1(
          v_snapshot.late_cancellation_rule, v_snapshot.final_amount
        );
      end if;
      if v_policy_amount <= 0 then
        update public.payments
        set
          amount = 0,
          balance_amount = 0,
          status = 'canceled',
          financial_status = 'cancelled_no_charge',
          private_financial_classification = 'CANCELLED_NO_CHARGE',
          canceled_at = now(),
          canceled_by = v_actor_id::text,
          notes = concat_ws(' ', notes, 'Cancelamento sem cobrança por decisão manual autorizada: ' || v_override_reason),
          updated_at = now()
        where id::text = v_charge.id::text;
        v_event := 'CANCELLED_NO_CHARGE';
      else
        v_policy_discount := greatest(v_snapshot.base_amount + v_snapshot.location_surcharge - v_policy_amount, 0);
        update public.payment_transactions
        set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
        where organization_id = v_organization_id
          and payment_id::text = v_charge.id::text
          and transaction_type = 'DISCOUNT'
          and status = 'POSTED';
        if v_policy_discount > 0 then
          insert into public.payment_transactions (
            organization_id, clinic_id, payment_id, patient_id, transaction_type,
            amount, transaction_at, status, document_status, notes,
            idempotency_key, created_by
          ) values (
            v_organization_id, v_organization_id::text, v_charge.id::text, new.patient_id,
            'DISCOUNT', v_policy_discount, now(), 'POSTED', 'PENDING',
            'Ajuste da regra congelada de cancelamento tardio.',
            'private-appointment:' || new.id::text || ':late-cancellation:discount',
            v_actor_id::text
          ) on conflict (organization_id, idempotency_key) do nothing;
        end if;
        update public.payments
        set
          canceled_at = null,
          canceled_by = null,
          status = case when due_date < current_date then 'overdue' else 'pending' end,
          financial_status = 'late_cancellation_charge',
          private_financial_classification = 'LATE_CANCELLATION_CHARGE',
          updated_at = now()
        where id::text = v_charge.id::text;
        v_event := 'LATE_CANCELLATION_CHARGE';
      end if;
    end if;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      v_event, v_before,
      (select to_jsonb(payment) from public.payments payment where payment.id::text = v_charge.id::text),
      v_override_reason,
      'private-appointment:' || new.id::text || ':' ||
        v_snapshot.snapshot_version::text || ':' || lower(v_event),
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  elsif v_event = 'NO_SHOW' then
    if greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) > 0 then
      raise exception 'PRIVATE_SESSION_NO_SHOW_PAID_REVIEW_REQUIRED';
    end if;
    v_before := to_jsonb(v_charge);
    if upper(coalesce(v_snapshot.no_show_rule->>'type', 'NO_CHARGE')) = 'MANUAL' then
      if v_manual_policy_event <> 'NO_SHOW'
        or v_manual_policy_amount is null
        or v_actor_id is null
        or v_override_reason is null then
        raise exception 'PRIVATE_SESSION_MANUAL_NO_SHOW_DECISION_REQUIRED';
      end if;
      if v_manual_policy_amount < 0 or v_manual_policy_amount > v_snapshot.final_amount then
        raise exception 'PRIVATE_SESSION_MANUAL_POLICY_AMOUNT_INVALID';
      end if;
      v_actor_role := public.private_finance_actor_role_v2(v_actor_id, v_organization_id);
      if coalesce(v_actor_role, '') not in ('director', 'coordinator', 'receptionist') then
        raise exception 'PRIVATE_SESSION_MANUAL_POLICY_DECISION_FORBIDDEN';
      end if;
      v_policy_amount := v_manual_policy_amount;
    else
      v_policy_amount := public.private_session_policy_amount_v1(
        v_snapshot.no_show_rule, v_snapshot.final_amount
      );
    end if;
    if v_policy_amount <= 0 then
      update public.payments
      set
        amount = 0,
        balance_amount = 0,
        status = 'canceled',
        financial_status = 'exempt',
        private_financial_classification = 'NO_SHOW_NO_CHARGE',
        canceled_at = now(),
        canceled_by = v_actor_id::text,
        updated_at = now()
      where id::text = v_charge.id::text;
      v_event := 'NO_SHOW_NO_CHARGE';
    else
      v_policy_discount := greatest(v_snapshot.base_amount + v_snapshot.location_surcharge - v_policy_amount, 0);
      update public.payment_transactions
      set status = 'VOIDED', voided_at = now(), voided_by = v_actor_id::text
      where organization_id = v_organization_id
        and payment_id::text = v_charge.id::text
        and transaction_type = 'DISCOUNT'
        and status = 'POSTED';
      if v_policy_discount > 0 then
        insert into public.payment_transactions (
          organization_id, clinic_id, payment_id, patient_id, transaction_type,
          amount, transaction_at, status, document_status, notes,
          idempotency_key, created_by
        ) values (
          v_organization_id, v_organization_id::text, v_charge.id::text, new.patient_id,
          'DISCOUNT', v_policy_discount, now(), 'POSTED', 'PENDING',
          'Ajuste da regra congelada de falta.',
          'private-appointment:' || new.id::text || ':no-show:discount',
          v_actor_id::text
        ) on conflict (organization_id, idempotency_key) do nothing;
      end if;
      update public.payments
      set
        canceled_at = null,
        canceled_by = null,
        status = case when due_date < current_date then 'overdue' else 'pending' end,
        financial_status = 'no_show_charge',
        private_financial_classification = 'NO_SHOW_CHARGE',
        updated_at = now()
      where id::text = v_charge.id::text;
      v_event := 'NO_SHOW_CHARGE';
    end if;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      v_event, v_before,
      (select to_jsonb(payment) from public.payments payment where payment.id::text = v_charge.id::text),
      coalesce(v_override_reason, new.notes),
      'private-appointment:' || new.id::text || ':' ||
        v_snapshot.snapshot_version::text || ':' || lower(v_event),
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  elsif v_event = 'COMPLETED'
    and coalesce(v_charge.financial_status, v_charge.status) = 'forecast'
    and coalesce(v_charge.private_financial_classification, 'STANDARD') = 'STANDARD' then
    update public.payments
    set
      status = case when due_date < current_date then 'overdue' else 'pending' end,
      financial_status = case when due_date < current_date then 'overdue' else 'pending' end,
      source = 'PRIVATE_APPOINTMENT_COMPLETED',
      updated_at = now()
    where id::text = v_charge.id::text;
    insert into public.payment_audit_events (
      organization_id, clinic_id, payment_id, appointment_id, event_type,
      before_state, after_state, notes, idempotency_key, created_by
    ) values (
      v_organization_id, v_organization_id::text, v_charge.id::text, new.id,
      'PRIVATE_RECEIVABLE_OPENED', to_jsonb(v_charge),
      (select to_jsonb(payment) from public.payments payment where payment.id::text = v_charge.id::text),
      'Sessão realizada; previsão convertida em conta a receber.',
      'private-appointment:' || new.id::text || ':receivable-opened',
      v_actor_id::text
    ) on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing;
  elsif v_event = 'SCHEDULED'
    and coalesce(v_charge.private_financial_classification, 'STANDARD') = 'STANDARD'
    and greatest(coalesce(v_charge.paid_amount, 0) - coalesce(v_charge.refunded_amount, 0), 0) = 0
    and v_charge.canceled_at is null then
    update public.payments
    set status = 'forecast', financial_status = 'forecast', source = 'PRIVATE_APPOINTMENT_FORECAST', updated_at = now()
    where id::text = v_charge.id::text;
  end if;

  return new;
end;
$function$;
-- Fail closed if a required existing financial trigger/engine is missing.
create or replace function public.assert_group_patient_finance_v1(p_organization_id uuid,p_appointment_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_participant public.group_session_participants%rowtype;
  v_appointment public.appointments%rowtype;
  v_engine text;
begin
  select * into strict v_participant from public.group_session_participants
  where organization_id=p_organization_id and appointment_id=p_appointment_id;
  select * into strict v_appointment from public.appointments where id=p_appointment_id and clinic_id=p_organization_id;
  v_engine:=public.resolve_appointment_financial_engine_v1(p_organization_id,p_appointment_id,
    v_appointment.patient_id,v_appointment.service_type,v_appointment.source_payload);
  if v_engine='AT_SESSION' then
    if not exists(select 1 from public.appointment_private_financial_snapshots snapshot
      join public.payment_appointment_items item on item.appointment_id=snapshot.appointment_id
        and item.payment_id::text=snapshot.payment_id::text and item.organization_id=snapshot.organization_id and item.active
      where snapshot.organization_id=p_organization_id and snapshot.appointment_id=p_appointment_id
        and snapshot.legacy_patient_financial_plan_id=v_participant.financial_plan_id
        and round(snapshot.final_amount*100)::int=v_participant.unit_amount_cents
        and round(item.unit_amount*100)::int=v_participant.unit_amount_cents
        and snapshot.resolution_payload->>'session_modality'='GROUP') then
      raise exception 'GROUP_FINANCIAL_PERSISTENCE_UNCONFIRMED';
    end if;
  elsif v_engine='MONTHLY_SESSION' then
    if exists(select 1 from public.appointment_private_financial_snapshots
      where organization_id=p_organization_id and appointment_id=p_appointment_id) then
      raise exception 'GROUP_FINANCIAL_ENGINE_DUPLICATED'; end if;
  else raise exception 'GROUP_FINANCIAL_ENGINE_UNSUPPORTED';
  end if;
end;
$$;
revoke all on function public.assert_group_patient_finance_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_group_patient_finance_v1(uuid,uuid) to service_role;
commit;
