-- Structural smoke checks for ABA Measurement V3 PR6.
-- Intended to be run after migrations in an isolated test database.

do $$
begin
  if to_regclass('public.aba_maintenance_probes_v3') is null then
    raise exception 'PR6 maintenance probes missing';
  end if;
  if to_regclass('public.aba_target_clinical_states_v3') is null then
    raise exception 'PR6 clinical FSM missing';
  end if;
  if to_regprocedure('public.complete_aba_session_v3(uuid,uuid,uuid,text,uuid,text,timestamp with time zone,text,jsonb,text,text)') is null then
    raise exception 'PR6 atomic hybrid completion missing';
  end if;
  if has_function_privilege('authenticated','public.complete_aba_session_v3(uuid,uuid,uuid,text,uuid,text,timestamp with time zone,text,jsonb,text,text)','EXECUTE') then
    raise exception 'PR6 completion must remain browser-blocked';
  end if;
  if exists(select 1 from public.aba_measurement_rollout_states_v3 where allow_new_v3_sessions) then
    raise exception 'PR6 must not enable new V3 sessions';
  end if;
end $$;
