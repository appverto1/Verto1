-- Issue #208 — authenticated wrapper for factual ABA reinforcer delivery v1.
begin;
create or replace function public.record_aba_reinforcer_delivery_authenticated_v1(p_session_id text,p_reinforcer_id uuid,p_client_event_id text,p_occurred_at timestamptz)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp set row_security = off
as $function$
declare v_actor_id uuid := auth.uid(); v_session public.aba_sessions%rowtype; v_organization_id uuid; v_patient_id uuid; v_reinforcer public.aba_patient_reinforcers%rowtype;
begin
 if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
 if p_session_id is null or length(trim(p_session_id))=0 or p_reinforcer_id is null or p_occurred_at is null then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_SCOPE_REQUIRED'; end if;
 if length(trim(coalesce(p_client_event_id,'')))<1 or length(trim(coalesce(p_client_event_id,'')))>240 then raise exception using errcode='P0001',message='ABA_REINFORCER_CLIENT_EVENT_ID_INVALID'; end if;
 select * into v_session from public.aba_sessions s where s.id=trim(p_session_id) for share;
 if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
 begin v_organization_id:=v_session.clinic_id::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end;
 v_patient_id:=v_session.patient_id;
 if v_organization_id is null or v_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
 if lower(coalesce(v_session.status,''))<>'active' or v_session.ended_at is not null then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_SESSION_CLOSED'; end if;
 if not public.aba_reinforcer_actor_can_write_v1(v_actor_id,v_organization_id,v_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_ACTOR_FORBIDDEN'; end if;
 select * into v_reinforcer from public.aba_patient_reinforcers r where r.id=p_reinforcer_id and r.organization_id=v_organization_id and r.patient_id=v_patient_id for share;
 if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_CATALOG_SCOPE_INVALID'; end if;
 if not v_reinforcer.is_active then raise exception using errcode='P0001',message='ABA_REINFORCER_INACTIVE'; end if;
 return public.record_aba_reinforcer_delivery_v1(v_organization_id,v_patient_id,trim(p_session_id),p_reinforcer_id,trim(p_client_event_id),p_occurred_at,v_actor_id);
end;$function$;
revoke all on function public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamptz) from public, anon;
grant execute on function public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamptz) to authenticated;
comment on function public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamptz) is 'Issue #208 authenticated delivery wrapper. Actor derives from auth.uid(); organization/patient derive from session; delegates to record_aba_reinforcer_delivery_v1.';
commit;