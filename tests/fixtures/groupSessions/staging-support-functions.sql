CREATE OR REPLACE FUNCTION public.appointment_clinical_specialty_key_v1(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('psicoterapeuta','psicologia','psicoterapia','psicologo','psicologa') THEN 'psychotherapy'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('fonoaudiologo','fonoaudiologa','fonoaudiologia','fono') THEN 'speech_therapy'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('terapeuta ocupacional','terapia ocupacional','to') THEN 'occupational_therapy'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('nutricionista','nutricao') THEN 'nutrition'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('psicomotricista','psicomotricidade') THEN 'psychomotricity'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('psicopedagogo','psicopedagoga','psicopedagogia') THEN 'psychopedagogy'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('arteterapeuta','arteterapia') THEN 'art_therapy'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('musicoterapeuta','musicoterapia') THEN 'music_therapy'
    WHEN lower(trim(translate(coalesce(p_value,''), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç', 'AAAAEEIOOOUUCaaaaeeiooouuc'))) IN
      ('fisioterapeuta','fisioterapia') THEN 'physiotherapy'
    ELSE NULL END
$function$;
CREATE OR REPLACE FUNCTION public.appointment_financial_service_key_v1(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with key as (
    select trim(both '_' from regexp_replace(
      translate(lower(trim(coalesce(p_value,''))),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9]+','_','g')) as v
  )
  select case
    when v in ('fonoaudiologo','fonoaudiologa','fonoaudiologia','fono','speech_therapy') then 'SPEECH_THERAPY'
    when v in ('terapeuta_ocupacional','terapia_ocupacional','occupational_therapy','to') then 'OCCUPATIONAL_THERAPY'
    when v in ('psicoterapeuta','psicoterapia','psicologo','psicologa','psicologia','psychology') then 'PSYCHOLOGY'
    when v in ('psicopedagogo','psicopedagoga','psicopedagogia','psychopedagogy') then 'PSYCHOPEDAGOGY'
    when v in ('fisioterapeuta','fisioterapia','physiotherapy') then 'PHYSIOTHERAPY'
    when v in ('nutricionista','nutricao','nutrition') then 'NUTRITION'
    when v in ('psicomotricista','psicomotricidade','psychomotricity') then 'PSYCHOMOTRICITY'
    when v in ('arteterapeuta','arteterapia','art_therapy') then 'ART_THERAPY'
    when v in ('musicoterapeuta','musicoterapia','music_therapy') then 'MUSIC_THERAPY'
    else upper(v)
  end from key;
$function$;
CREATE OR REPLACE FUNCTION public.private_finance_actor_role_v2(p_actor_id uuid, p_organization_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select lower(trim(membership.role))
  from public.clinic_memberships membership
  where membership.user_id = p_actor_id
    and membership.clinic_id = p_organization_id
    and lower(trim(coalesce(membership.status, ''))) = 'active'
    and lower(trim(coalesce(membership.role, ''))) in ('director', 'coordinator', 'receptionist')
  order by membership.updated_at desc nulls last, membership.created_at desc nulls last
  limit 1
$function$;
CREATE OR REPLACE FUNCTION public.private_session_due_date_v1(p_due_rule text, p_due_offset_days integer, p_due_day integer, p_session_date date)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_rule text := upper(coalesce(nullif(trim(p_due_rule), ''), 'SESSION_DATE'));
  v_offset integer := greatest(coalesce(p_due_offset_days, 0), 0);
  v_last_day integer;
begin
  if p_session_date is null then
    raise exception 'PRIVATE_SESSION_DATE_REQUIRED';
  end if;
  if v_rule = 'DAYS_BEFORE' then
    return p_session_date - v_offset;
  elsif v_rule = 'DAYS_AFTER' then
    return p_session_date + v_offset;
  elsif v_rule = 'FIXED_DAY' then
    v_last_day := extract(day from (date_trunc('month', p_session_date) + interval '1 month - 1 day'))::integer;
    return make_date(
      extract(year from p_session_date)::integer,
      extract(month from p_session_date)::integer,
      least(greatest(coalesce(p_due_day, 1), 1), v_last_day)
    );
  end if;
  return p_session_date;
end;
$function$;