-- Trusted recommendation context for therapeutic-program creation.
-- Additive only: historical recommendations and programs remain unchanged.

create extension if not exists pgcrypto;

create index if not exists idx_aba_programs_recommendation_origin_lookup
  on public.aba_programs (organization_id, patient_id, origin_id, created_at)
  where origin_type = 'recommendation' and origin_id is not null;

create index if not exists idx_aba_clinical_recommendations_target_lookup
  on public.aba_clinical_recommendations (organization_id, patient_id, target_id, created_at desc)
  where target_id is not null;

create or replace function public.guard_therapeutic_recommendation_conversion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(trim(coalesce(new.origin_type, ''))) <> 'recommendation'
    or nullif(trim(coalesce(new.origin_id, '')), '') is null then
    return new;
  end if;

  -- Existing historical rows remain editable; only a new or changed conversion key is guarded.
  if tg_op = 'UPDATE' then
    if old.organization_id is not distinct from new.organization_id
      and old.patient_id is not distinct from new.patient_id
      and old.origin_type is not distinct from new.origin_type
      and old.origin_id is not distinct from new.origin_id then
      return new;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'therapeutic-recommendation:' || new.organization_id || ':' || new.patient_id::text || ':' || new.origin_id,
    0
  ));

  if exists (
    select 1
    from public.aba_programs existing
    where existing.organization_id = new.organization_id
      and existing.patient_id = new.patient_id
      and existing.origin_type = 'recommendation'
      and existing.origin_id = new.origin_id
      and existing.id <> new.id
  ) then
    raise exception 'THERAPEUTIC_RECOMMENDATION_ALREADY_CONVERTED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_therapeutic_recommendation_conversion on public.aba_programs;
create trigger trg_guard_therapeutic_recommendation_conversion
before insert or update on public.aba_programs
for each row
execute function public.guard_therapeutic_recommendation_conversion();

create or replace function public.link_therapeutic_recommendation_target(
  p_organization_id text,
  p_patient_id uuid,
  p_recommendation_id text,
  p_target_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recommendation public.aba_clinical_recommendations%rowtype;
  v_target public.aba_targets%rowtype;
  v_existing_program_id text;
  v_now timestamptz := now();
begin
  if nullif(trim(coalesce(p_organization_id, '')), '') is null
    or p_patient_id is null
    or nullif(trim(coalesce(p_recommendation_id, '')), '') is null
    or nullif(trim(coalesce(p_target_id, '')), '') is null then
    raise exception 'THERAPEUTIC_RECOMMENDATION_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id::text = p_organization_id
      and patient.deleted_at is null
  ) then
    raise exception 'THERAPEUTIC_PLAN_PATIENT_SCOPE_INVALID';
  end if;

  select recommendation.*
  into v_recommendation
  from public.aba_clinical_recommendations recommendation
  where recommendation.id = p_recommendation_id
    and recommendation.organization_id = p_organization_id
    and recommendation.patient_id = p_patient_id
  for update;

  if v_recommendation.id is null then
    raise exception 'THERAPEUTIC_RECOMMENDATION_SCOPE_INVALID';
  end if;

  select program.id
  into v_existing_program_id
  from public.aba_programs program
  where program.organization_id = p_organization_id
    and program.patient_id = p_patient_id
    and program.origin_type = 'recommendation'
    and program.origin_id = p_recommendation_id
  order by program.created_at
  limit 1;

  if v_existing_program_id is not null then
    raise exception 'THERAPEUTIC_RECOMMENDATION_ALREADY_CONVERTED';
  end if;

  select target.*
  into v_target
  from public.aba_targets target
  where target.id = p_target_id
    and target.organization_id = p_organization_id
    and target.patient_id = p_patient_id;

  if v_target.id is null then
    raise exception 'THERAPEUTIC_RECOMMENDATION_TARGET_SCOPE_INVALID';
  end if;

  if v_recommendation.target_id is not null and v_recommendation.target_id <> v_target.id then
    raise exception 'THERAPEUTIC_RECOMMENDATION_ORIGIN_ALREADY_SET';
  end if;

  if v_recommendation.program_id is not null
    and v_target.program_id is not null
    and v_recommendation.program_id <> v_target.program_id then
    raise exception 'THERAPEUTIC_RECOMMENDATION_PROGRAM_MISMATCH';
  end if;

  if v_recommendation.target_id = v_target.id then
    return to_jsonb(v_recommendation);
  end if;

  update public.aba_clinical_recommendations recommendation
  set target_id = v_target.id,
      program_id = coalesce(v_target.program_id, recommendation.program_id),
      domain = coalesce(v_target.domain_name, recommendation.domain),
      evidence = coalesce(recommendation.evidence, '{}'::jsonb) || jsonb_build_object(
        'originLinkedBy', nullif(trim(coalesce(p_actor_id, '')), ''),
        'originLinkedAt', v_now,
        'originTargetId', v_target.id
      ),
      updated_at = v_now
  where recommendation.id = v_recommendation.id
  returning recommendation.* into v_recommendation;

  insert into public.aba_clinical_recommendation_audit_logs (
    id, organization_id, clinic_id, patient_id, recommendation_id, action,
    previous_status, new_status, performed_by, performed_at, metadata
  ) values (
    'audit-' || encode(digest(
      p_organization_id || ':' || p_patient_id::text || ':' || p_recommendation_id || ':origin:' || p_target_id,
      'sha256'
    ), 'hex'),
    p_organization_id,
    v_recommendation.clinic_id,
    p_patient_id,
    p_recommendation_id,
    'EDITED',
    v_recommendation.status,
    v_recommendation.status,
    nullif(trim(coalesce(p_actor_id, '')), ''),
    v_now,
    jsonb_build_object(
      'changeType', 'ORIGIN_LINKED',
      'targetId', v_target.id,
      'programId', v_target.program_id
    )
  ) on conflict (id) do nothing;

  return to_jsonb(v_recommendation);
end;
$$;

revoke all on function public.guard_therapeutic_recommendation_conversion() from public, anon, authenticated;
revoke all on function public.link_therapeutic_recommendation_target(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.guard_therapeutic_recommendation_conversion() to service_role;
grant execute on function public.link_therapeutic_recommendation_target(text, uuid, text, text, text) to service_role;
