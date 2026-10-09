-- Clinic specialties are offered exclusively by active therapist memberships.
-- No historical appointment, membership or financial row is migrated.
-- Rollback: DROP TRIGGER appointments_active_specialty_guard_v1 ON public.appointments;
-- DROP FUNCTION public.guard_appointment_active_specialty_v1();
-- DROP FUNCTION public.clinic_scheduling_specialties_v1(uuid);
-- DROP FUNCTION public.appointment_clinical_specialty_key_v1(text);
BEGIN;

CREATE OR REPLACE FUNCTION public.appointment_clinical_specialty_key_v1(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $fn$
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
$fn$;

-- Authenticated users may enumerate eligible members only in their own active clinic.
-- No SECURITY DEFINER function accepts an arbitrary tenant without this check.
CREATE OR REPLACE FUNCTION public.clinic_scheduling_specialties_v1(p_clinic_id uuid)
RETURNS TABLE(user_id uuid, specialty text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF p_clinic_id IS NULL OR auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clinic_memberships caller
    WHERE caller.clinic_id = p_clinic_id
      AND caller.user_id = auth.uid()
      AND caller.status = 'active'
  ) THEN
    RAISE EXCEPTION 'CLINIC_SPECIALTIES_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT member.user_id, member.specialty
    FROM public.clinic_memberships member
    WHERE member.clinic_id = p_clinic_id
      AND member.role = 'therapist'
      AND member.status = 'active'
      AND public.appointment_clinical_specialty_key_v1(member.specialty) IS NOT NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.clinic_scheduling_specialties_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinic_scheduling_specialties_v1(uuid) TO authenticated;

-- Database-authoritative guard: protects service-role and direct API writes,
-- locks the membership during the transaction to serialize concurrent revocation.
CREATE OR REPLACE FUNCTION public.guard_appointment_active_specialty_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_membership_specialty text;
  v_appointment_key text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.clinic_id IS NOT DISTINCT FROM NEW.clinic_id
    AND OLD.therapist_id IS NOT DISTINCT FROM NEW.therapist_id
    AND OLD.service_type IS NOT DISTINCT FROM NEW.service_type
    AND OLD.scheduled_at IS NOT DISTINCT FROM NEW.scheduled_at
  THEN RETURN NEW; END IF;

  IF NEW.clinic_id IS NULL OR NEW.therapist_id IS NULL THEN
    RAISE EXCEPTION 'APPOINTMENT_ACTIVE_PROFESSIONAL_REQUIRED' USING ERRCODE = '23514';
  END IF;

  SELECT member.specialty INTO v_membership_specialty
  FROM public.clinic_memberships member
  WHERE member.clinic_id = NEW.clinic_id
    AND member.user_id = NEW.therapist_id
    AND member.role = 'therapist'
    AND member.status = 'active'
  LIMIT 1 FOR SHARE;

  v_appointment_key := public.appointment_clinical_specialty_key_v1(COALESCE(NULLIF(NEW.service_type,''), NEW.approach));
  IF v_membership_specialty IS NULL
    OR v_appointment_key IS NULL
    OR public.appointment_clinical_specialty_key_v1(v_membership_specialty) IS DISTINCT FROM v_appointment_key
  THEN
    RAISE EXCEPTION 'APPOINTMENT_CLINIC_SPECIALTY_NOT_AVAILABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS appointments_active_specialty_guard_v1 ON public.appointments;
CREATE TRIGGER appointments_active_specialty_guard_v1
BEFORE INSERT OR UPDATE OF clinic_id, therapist_id, service_type, scheduled_at
ON public.appointments FOR EACH ROW
EXECUTE FUNCTION public.guard_appointment_active_specialty_v1();
COMMIT;
