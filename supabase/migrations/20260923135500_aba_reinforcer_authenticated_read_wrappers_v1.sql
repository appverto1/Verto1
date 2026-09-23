-- Issue #208 — authenticated read wrappers for patient-scoped ABA reinforcers v1.
-- Additive DATA transport only. Existing internal RPCs remain canonical authorities.
begin;

create or replace function public.list_aba_patient_reinforcers_authenticated_v1(
  p_patient_id uuid,
  p_include_inactive boolean default false,
  p_limit integer default 100
)
returns table(reinforcer_id uuid,label text,category text,note text,is_active boolean,updated_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_organization_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,100), 200));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_PATIENT_SCOPE_REQUIRED'; end if;
  select p.clinic_id into v_organization_id from public.patients p where p.id=p_patient_id;
  if not found or v_organization_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_PATIENT_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,p_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.list_aba_patient_reinforcers_v1(v_organization_id,p_patient_id,v_actor_id,coalesce(p_include_inactive,false),v_limit);
end;$function$;

create or replace function public.list_recent_aba_patient_reinforcers_authenticated_v1(
  p_patient_id uuid,
  p_limit integer default 6,
  p_lookback_days integer default 90
)
returns table(reinforcer_id uuid,label text,category text,last_delivered_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_organization_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,6), 20));
  v_lookback_days integer := greatest(1, least(coalesce(p_lookback_days,90), 365));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_PATIENT_SCOPE_REQUIRED'; end if;
  select p.clinic_id into v_organization_id from public.patients p where p.id=p_patient_id;
  if not found or v_organization_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_PATIENT_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,p_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.list_recent_aba_patient_reinforcers_v1(v_organization_id,p_patient_id,v_actor_id,v_limit,v_lookback_days);
end;$function$;

create or replace function public.list_aba_session_reinforcer_events_authenticated_v1(
  p_session_id text,
  p_limit integer default 200
)
returns table(event_id uuid,reinforcer_id uuid,label_snapshot text,category_snapshot text,occurred_at timestamptz,received_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_session public.aba_sessions%rowtype;
  v_organization_id uuid;
  v_patient_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,200), 500));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_session_id is null or length(trim(p_session_id))=0 then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_REQUIRED'; end if;
  select * into v_session from public.aba_sessions s where s.id=trim(p_session_id);
  if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  begin v_organization_id:=v_session.clinic_id::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end;
  v_patient_id:=v_session.patient_id;
  if v_organization_id is null or v_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,v_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.list_aba_session_reinforcer_events_v1(v_organization_id,v_patient_id,trim(p_session_id),v_actor_id,v_limit);
end;$function$;

create or replace function public.get_aba_session_reinforcer_summary_authenticated_v1(
  p_session_id text,
  p_limit integer default 100
)
returns table(reinforcer_id uuid,label_snapshot text,category_snapshot text,delivery_count bigint,last_delivered_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_session public.aba_sessions%rowtype;
  v_organization_id uuid;
  v_patient_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,100), 200));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_session_id is null or length(trim(p_session_id))=0 then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_REQUIRED'; end if;
  select * into v_session from public.aba_sessions s where s.id=trim(p_session_id);
  if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  begin v_organization_id:=v_session.clinic_id::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end;
  v_patient_id:=v_session.patient_id;
  if v_organization_id is null or v_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,v_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.get_aba_session_reinforcer_summary_v1(v_organization_id,v_patient_id,trim(p_session_id),v_actor_id,v_limit);
end;$function$;

revoke all on function public.list_aba_patient_reinforcers_authenticated_v1(uuid,boolean,integer) from public, anon, service_role;
revoke all on function public.list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer) from public, anon, service_role;
revoke all on function public.list_aba_session_reinforcer_events_authenticated_v1(text,integer) from public, anon, service_role;
revoke all on function public.get_aba_session_reinforcer_summary_authenticated_v1(text,integer) from public, anon, service_role;
grant execute on function public.list_aba_patient_reinforcers_authenticated_v1(uuid,boolean,integer) to authenticated;
grant execute on function public.list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer) to authenticated;
grant execute on function public.list_aba_session_reinforcer_events_authenticated_v1(text,integer) to authenticated;
grant execute on function public.get_aba_session_reinforcer_summary_authenticated_v1(text,integer) to authenticated;

comment on function public.list_aba_patient_reinforcers_authenticated_v1(uuid,boolean,integer) is 'Issue #208 authenticated patient-scoped catalog transport; organization and actor are server-derived.';
comment on function public.list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer) is 'Issue #208 authenticated bounded Recentes transport; organization and actor are server-derived.';
comment on function public.list_aba_session_reinforcer_events_authenticated_v1(text,integer) is 'Issue #208 authenticated session history transport; patient, organization and actor are server-derived.';
comment on function public.get_aba_session_reinforcer_summary_authenticated_v1(text,integer) is 'Issue #208 authenticated derived session summary transport; patient, organization and actor are server-derived.';

commit;
