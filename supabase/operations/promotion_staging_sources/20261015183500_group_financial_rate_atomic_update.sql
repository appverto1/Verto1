-- Atomic group rate mutation for a single PRIVATE specialty plan.
-- Called by a capability-checked backend route, never directly by browser clients.
-- Depends on 20261015162000_group_session_specialty_rates.sql.
begin;

create or replace function public.update_patient_specialty_group_rate_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_plan_id uuid,
  p_actor_id uuid,
  p_group_amount_cents integer
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_requested public.patient_financial_plans%rowtype;
  v_current public.patient_financial_plans%rowtype;
  v_plans jsonb;
  v_result jsonb;
begin
  if p_organization_id is null or p_patient_id is null or p_plan_id is null or p_actor_id is null
    or p_group_amount_cents is null or p_group_amount_cents < 0 or p_group_amount_cents > 1000000000 then
    return jsonb_build_object('success',false,'code','GROUP_RATE_INPUT_INVALID');
  end if;

  if not exists (select 1 from public.clinic_memberships membership
    where membership.clinic_id=p_organization_id
      and membership.user_id=p_actor_id
      and lower(membership.status)='active') then
    return jsonb_build_object('success',false,'code','GROUP_RATE_ACTOR_DENIED');
  end if;
  if not exists (select 1 from public.patients patient
    where patient.id=p_patient_id and patient.clinic_id=p_organization_id) then
    return jsonb_build_object('success',false,'code','GROUP_RATE_PATIENT_OUT_OF_SCOPE');
  end if;

  -- Reuse the reconciliation lock so no concurrent global patient Save may
  -- overwrite this rate. All rate changes preserve the canonical plan history.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_patient_id::text,0));

  select plan.* into v_requested
  from public.patient_financial_plans plan
  where plan.id=p_plan_id
    and plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
  for update;
  if not found then
    return jsonb_build_object('success',false,'code','GROUP_RATE_PLAN_NOT_FOUND');
  end if;
  if v_requested.billing_mode<>'PRIVATE' then
    return jsonb_build_object('success',false,'code','GROUP_RATE_ONLY_PRIVATE_PLANS');
  end if;

  select plan.* into v_current
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.logical_plan_id=coalesce(v_requested.logical_plan_id,v_requested.id)
    and plan.status='ACTIVE'
  order by plan.version desc,plan.created_at desc
  limit 1
  for update;

  if v_current.id is null then
    return jsonb_build_object('success',false,'code','GROUP_RATE_ACTIVE_PLAN_NOT_FOUND');
  end if;
  if v_current.id <> p_plan_id then
    -- Network retry after a versioned save is harmless if the requested rate
    -- already matches; otherwise reject an old editor instead of overwriting it.
    if v_current.group_amount_cents is not distinct from p_group_amount_cents then
      return jsonb_build_object(
        'success',true,'financial_plan_id',v_current.id,
        'group_amount_cents',v_current.group_amount_cents,
        'version',v_current.version,'unchanged',true
      );
    end if;
    return jsonb_build_object('success',false,'code','GROUP_RATE_STALE_PLAN');
  end if;

  if v_current.group_amount_cents is not distinct from p_group_amount_cents then
    return jsonb_build_object(
      'success',true,'financial_plan_id',v_current.id,
      'group_amount_cents',v_current.group_amount_cents,
      'version',v_current.version,'unchanged',true
    );
  end if;

  -- One nested, transaction-local reconciliation call. INSURANCE plans are
  -- deliberately excluded and preserved by the existing v2 RPC contract.
  select coalesce(jsonb_agg(
      to_jsonb(plan) || case when plan.id=p_plan_id
        then jsonb_build_object('group_amount_cents',p_group_amount_cents)
        else '{}'::jsonb end
      order by plan.created_at,plan.id
    ),'[]'::jsonb)
    into v_plans
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.status='ACTIVE'
    and plan.billing_mode<>'INSURANCE';

  v_result:=public.reconcile_patient_financial_plans_v2(
    p_organization_id,p_patient_id,p_actor_id,v_plans,true
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then
    raise exception 'GROUP_RATE_RECONCILIATION_FAILED';
  end if;

  select plan.* into v_current
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.logical_plan_id=coalesce(v_requested.logical_plan_id,v_requested.id)
    and plan.status='ACTIVE'
  order by plan.version desc,plan.created_at desc
  limit 1;

  if v_current.id is null or v_current.group_amount_cents is distinct from p_group_amount_cents then
    raise exception 'GROUP_RATE_PERSISTENCE_VERIFY_FAILED';
  end if;
  return jsonb_build_object(
    'success',true,'financial_plan_id',v_current.id,
    'group_amount_cents',v_current.group_amount_cents,
    'version',v_current.version,'unchanged',false
  );
end;
$$;

revoke all on function public.update_patient_specialty_group_rate_v1(uuid,uuid,uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.update_patient_specialty_group_rate_v1(uuid,uuid,uuid,uuid,integer)
  to service_role;

commit;
