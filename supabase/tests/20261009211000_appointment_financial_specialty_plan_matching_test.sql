-- Run after the 20261009211000 migration; no data is written.
do $$
begin
  if public.appointment_financial_service_key_v1('Fonoaudiólogo') <>
     public.appointment_financial_service_key_v1('Fonoaudiologia') or
     public.appointment_financial_service_key_v1('Fonoaudiólogo') <>
     public.appointment_financial_service_key_v1('SPEECH_THERAPY') then
    raise exception 'SPEECH_THERAPY_ALIAS_REGRESSION';
  end if;
  if public.appointment_financial_service_key_v1('Terapeuta Ocupacional') <>
     public.appointment_financial_service_key_v1('Terapia ocupacional') then
    raise exception 'OCCUPATIONAL_THERAPY_ALIAS_REGRESSION';
  end if;
  if public.appointment_financial_service_key_v1('Psicoterapeuta') <>
     public.appointment_financial_service_key_v1('Psicologia') then
    raise exception 'PSYCHOLOGY_ALIAS_REGRESSION';
  end if;
  if public.appointment_financial_service_key_v1('Fonoaudiólogo') =
     public.appointment_financial_service_key_v1('Psicologia') then
    raise exception 'FINANCIAL_SPECIALTY_CROSS_MATCH';
  end if;
  if public.appointment_financial_service_key_v1('ABA') =
     public.appointment_financial_service_key_v1('Psicologia') then
    raise exception 'ABA_NOT_A_SPECIALTY';
  end if;
end;
$$;
