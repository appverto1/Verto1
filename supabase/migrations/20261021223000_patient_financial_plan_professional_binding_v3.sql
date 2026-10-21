-- P0 #352 — Store a clinic-scoped therapist assignment for each logical
-- financial plan without rewriting/versioning historic billing snapshots.
-- Staging candidate only; apply before deploying backend v3. No backfill.
begin;

create table if not exists public.patient_financial_plan_professional_bindings (
  organization_id uuid not null,
  patient_id uuid not null,
  logical_plan_id uuid not null,
  professional_user_id uuid not null,
  specialty_key text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, patient_id, logical_plan_id)
);
create index if not exists patient_financial_plan_professional_bindings_user_idx
  on public.patient_financial_plan_professional_bindings (organization_id, professional_user_id);
alter table public.patient_financial_plan_professional_bindings enable row level security;
revoke all on public.patient_financial_plan_professional_bindings from public, anon, authenticated;
grant select, insert, update, delete on public.patient_financial_plan_professional_bindings to service_role;

-- The service invokes one atomic reconciliation. The v2 financial-history
-- engine is untouched: it still versions price changes and preserves receipts.
-- No new endpoint, grant or client-direct privileged access is introduced.
create or replace function public.reconcile_patient_financial_plans_v3(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_plans jsonb,
  p_preserve_insurance_context boolean default false
)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_row jsonb;
  v_key text;
  v_requested_id uuid;
  v_user uuid;
  v_service_key text;
  v_current public.patient_financial_plans%rowtype;
  v_previous public.patient_financial_plans%rowtype;
  v_result jsonb;
  v_data jsonb;
begin
  if p_organization_id is null or p_patient_id is null or
     jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'FINANCIAL_PLAN_INPUT_INVALID';
  end if;

  -- Every new plan must have an explicit valid assignment. Existing unbound
  -- plans are grandfathered only with their unchanged canonical specialty.
  for v_row in select value from jsonb_array_elements(p_plans) loop
    v_key:=nullif(btrim(coalesce(v_row->>'client_plan_key','')),'');
    v_requested_id:=null;
    if coalesce(v_row->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$' then
      v_requested_id:=(v_row->>'id')::uuid;
    end if;
    v_service_key:=public.appointment_financial_service_key_v1(
      coalesce(nullif(v_row->>'service_name_snapshot',''),
        nullif(v_row->>'custom_service_name',''),v_row->>'service_type')
    );
    if nullif(v_service_key,'') is null then
      raise exception 'FINANCIAL_PLAN_SPECIALTY_INVALID';
    end if;
    v_user:=null;
    if nullif(btrim(coalesce(v_row->>'professional_user_id','')),'') is not null then
      if (v_row->>'professional_user_id') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$' then
        raise exception 'FINANCIAL_PLAN_PROFESSIONAL_INVALID';
      end if;
      v_user:=(v_row->>'professional_user_id')::uuid;
      perform 1 from public.clinic_memberships m
      where m.clinic_id=p_organization_id and m.user_id=v_user
        and m.role='therapist' and m.status='active'
        and public.appointment_financial_service_key_v1(m.specialty)=v_service_key
      for share;
      if not found then raise exception 'FINANCIAL_PLAN_PROFESSIONAL_NOT_ELIGIBLE'; end if;
    else
      select plan.* into v_previous from public.patient_financial_plans plan
      where plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
        and plan.status='ACTIVE'
        and ((v_requested_id is not null and plan.id=v_requested_id)
          or (v_key is not null and plan.client_plan_key=v_key))
      order by plan.version desc limit 1;
      if not found or public.appointment_financial_service_key_v1(
        coalesce(nullif(v_previous.service_name_snapshot,''),
          nullif(v_previous.custom_service_name,''),v_previous.service_type)
      ) is distinct from v_service_key then
        raise exception 'FINANCIAL_PLAN_PROFESSIONAL_REQUIRED';
      end if;
    end if;
  end loop;

  -- A PL/pgSQL function and the nested v2 function share one SQL transaction:
  -- an exception in the association phase rolls back the financial mutations.
  v_result:=public.reconcile_patient_financial_plans_v2(
    p_organization_id,p_patient_id,p_actor_id,p_plans,p_preserve_insurance_context
  );
  if v_result->>'success' is distinct from 'true' then return v_result; end if;

  for v_row in select value from jsonb_array_elements(p_plans) loop
    if nullif(btrim(coalesce(v_row->>'professional_user_id','')),'') is null then continue; end if;
    v_user:=(v_row->>'professional_user_id')::uuid;
    v_key:=nullif(btrim(coalesce(v_row->>'client_plan_key','')),'');
    v_requested_id:=null;
    if coalesce(v_row->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$' then
      v_requested_id:=(v_row->>'id')::uuid;
    end if;
    select plan.* into v_current from public.patient_financial_plans plan
    where plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
      and plan.status='ACTIVE'
      and ((v_requested_id is not null and plan.id=v_requested_id)
        or (v_key is not null and plan.client_plan_key=v_key))
    order by plan.version desc limit 1;
    if not found then raise exception 'FINANCIAL_PLAN_BINDING_NOT_PERSISTED'; end if;
    insert into public.patient_financial_plan_professional_bindings
      (organization_id,patient_id,logical_plan_id,professional_user_id,specialty_key,created_by)
    values(p_organization_id,p_patient_id,v_current.logical_plan_id,v_user,
      public.appointment_financial_service_key_v1(
        coalesce(nullif(v_current.service_name_snapshot,''),
          nullif(v_current.custom_service_name,''),v_current.service_type)
      ),p_actor_id)
    on conflict (organization_id,patient_id,logical_plan_id)
    do update set professional_user_id=excluded.professional_user_id,
      specialty_key=excluded.specialty_key,updated_at=now();
  end loop;

  select coalesce(jsonb_agg(to_jsonb(plan) ||
      jsonb_build_object('professional_user_id',binding.professional_user_id)
      order by plan.created_at asc),'[]'::jsonb)
    into v_data
  from public.patient_financial_plans plan
  left join public.patient_financial_plan_professional_bindings binding
    on binding.organization_id=plan.organization_id
      and binding.patient_id=plan.patient_id
      and binding.logical_plan_id=plan.logical_plan_id
  where plan.organization_id=p_organization_id and plan.patient_id=p_patient_id
    and plan.status='ACTIVE';

  return v_result || jsonb_build_object('data',v_data);
end;
$$;
revoke all on function public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)
  to service_role;

commit;
