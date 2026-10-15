-- Resolver de preco coletivo: exclusivamente plano canônico, nunca valor do navegador.
-- Esta função depende de group_amount_cents criada em 20261015162000.
-- SECURITY INVOKER, executável apenas pelo backend (service_role).
begin;

create or replace function public.resolve_group_patient_private_rate_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_specialty text,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_plan public.patient_financial_plans%rowtype;
  v_count integer := 0;
  v_specialty_key text;
begin
  if p_organization_id is null or p_patient_id is null
    or p_scheduled_at is null or nullif(btrim(coalesce(p_specialty, '')), '') is null then
    return jsonb_build_object('success',false,'code','GROUP_RATE_INPUT_INVALID');
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id=p_patient_id and p.clinic_id=p_organization_id
  ) then
    return jsonb_build_object('success',false,'code','GROUP_RATE_PATIENT_OUT_OF_SCOPE');
  end if;

  v_specialty_key := public.appointment_financial_service_key_v1(p_specialty);
  if nullif(v_specialty_key, '') is null then
    return jsonb_build_object('success',false,'code','GROUP_RATE_SPECIALTY_INVALID');
  end if;

  -- Select ALL matching active PRIVATE lines before deciding: ambiguity must
  -- never disappear merely because one matching line has no group price.
  select count(*)::integer into v_count
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.status='ACTIVE'
    and plan.billing_mode='PRIVATE'
    and plan.valid_from<=p_scheduled_at
    and (plan.valid_until is null or p_scheduled_at<plan.valid_until)
    and (plan.package_valid_until is null or plan.package_valid_until>=p_scheduled_at::date)
    and public.appointment_financial_service_key_v1(
      coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
    )=v_specialty_key;

  if v_count<>1 then
    return jsonb_build_object(
      'success',false,
      'code',case when v_count=0 then 'GROUP_RATE_PLAN_MISSING' else 'GROUP_RATE_PLAN_AMBIGUOUS' end
    );
  end if;

  select plan.* into v_plan
  from public.patient_financial_plans plan
  where plan.organization_id=p_organization_id
    and plan.patient_id=p_patient_id
    and plan.status='ACTIVE'
    and plan.billing_mode='PRIVATE'
    and plan.valid_from<=p_scheduled_at
    and (plan.valid_until is null or p_scheduled_at<plan.valid_until)
    and (plan.package_valid_until is null or plan.package_valid_until>=p_scheduled_at::date)
    and public.appointment_financial_service_key_v1(
      coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
    )=v_specialty_key;

  if coalesce(v_plan.group_amount_cents,0)<=0 then
    return jsonb_build_object('success',false,'code','GROUP_RATE_NOT_CONFIGURED');
  end if;

  return jsonb_build_object(
    'success',true,
    'organization_id',p_organization_id,
    'patient_id',p_patient_id,
    'modality','GROUP',
    'financial_plan_id',v_plan.id,
    'logical_plan_id',v_plan.logical_plan_id,
    'financial_plan_version',v_plan.version,
    'group_amount_cents',v_plan.group_amount_cents
  );
end;
$$;

revoke all on function public.resolve_group_patient_private_rate_v1(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_group_patient_private_rate_v1(uuid,uuid,text,timestamptz)
  to service_role;

commit;
