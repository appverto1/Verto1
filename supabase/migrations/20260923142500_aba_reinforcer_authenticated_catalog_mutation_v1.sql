-- Issue #208 — authenticated patient-scoped reinforcer catalog mutation wrapper v1
begin;

create or replace function public.save_aba_patient_reinforcer_authenticated_v1(
  p_patient_id uuid,
  p_reinforcer_id uuid default null,
  p_label text default null,
  p_category text default null,
  p_note text default null,
  p_is_active boolean default true
)
returns public.aba_patient_reinforcers
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_organization uuid;
  v_existing public.aba_patient_reinforcers%rowtype;
begin
  if v_actor is null then
    raise exception using errcode='P0001', message='ABA_REINFORCER_AUTH_REQUIRED';
  end if;
  if p_patient_id is null then
    raise exception using errcode='P0001', message='ABA_REINFORCER_PATIENT_SCOPE_INVALID';
  end if;

  select p.clinic_id into v_organization
  from public.patients p
  where p.id = p_patient_id;
  if not found or v_organization is null then
    raise exception using errcode='P0001', message='ABA_REINFORCER_PATIENT_SCOPE_INVALID';
  end if;

  if not public.aba_reinforcer_actor_can_write_v1(v_actor, v_organization, p_patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_ACTOR_FORBIDDEN';
  end if;

  if p_reinforcer_id is not null then
    select * into v_existing
    from public.aba_patient_reinforcers r
    where r.id = p_reinforcer_id
      and r.organization_id = v_organization
      and r.patient_id = p_patient_id;
    if not found then
      raise exception using errcode='P0001', message='ABA_REINFORCER_NOT_FOUND';
    end if;
  end if;

  return public.save_aba_patient_reinforcer_v1(
    v_organization, p_patient_id, v_actor, p_reinforcer_id,
    p_label, p_category, p_note, p_is_active
  );
end;
$function$;

revoke all on function public.save_aba_patient_reinforcer_authenticated_v1(uuid,uuid,text,text,text,boolean) from public, anon, service_role;
grant execute on function public.save_aba_patient_reinforcer_authenticated_v1(uuid,uuid,text,text,text,boolean) to authenticated;

commit;
