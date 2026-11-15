-- One active operational definition per behavior name, patient and clinic.
-- This protects the CRUD from concurrent duplicate creates/renames without
-- changing or deleting any historical ABA behavior observations.
CREATE UNIQUE INDEX IF NOT EXISTS aba_behavior_definitions_patient_active_name_unique
ON public.aba_behavior_definitions (clinic_id, patient_id, lower(btrim(name)))
WHERE status = 'active' AND is_active = true;
