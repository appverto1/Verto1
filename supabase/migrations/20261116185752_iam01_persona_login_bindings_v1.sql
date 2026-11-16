-- IAM-01: independent portal targets and login methods for one Supabase auth user.
-- Additive only: no backfill, no role change, no login behavior change.
-- Do not grant data API access to anon/authenticated. Only trusted server-side
-- code may create/update a binding after separately validating an invitation,
-- an active clinic membership, a patient link, or an approved partner account.
CREATE TABLE public.iam_persona_access_bindings_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portal text NOT NULL CHECK (portal IN ('professional', 'patient', 'partner')),
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  partner_account_id uuid REFERENCES public.verto_partner_accounts(id) ON DELETE CASCADE,
  allowed_login_method text NOT NULL CHECK (allowed_login_method IN ('password', 'google')),
  access_status text NOT NULL DEFAULT 'active'
    CHECK (access_status IN ('active', 'suspended', 'revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iam_persona_exactly_one_scoped_target_v1 CHECK (
    (portal = 'professional' AND clinic_id IS NOT NULL AND patient_id IS NULL AND partner_account_id IS NULL) OR
    (portal = 'patient' AND clinic_id IS NULL AND patient_id IS NOT NULL AND partner_account_id IS NULL) OR
    (portal = 'partner' AND clinic_id IS NULL AND patient_id IS NULL AND partner_account_id IS NOT NULL)
  )
);

-- Partial unique keys stop concurrent duplicate persona bindings, including
-- revoked rows. Reenabling a prior binding must be an explicit authorized update.
CREATE UNIQUE INDEX iam_persona_unique_professional_v1
  ON public.iam_persona_access_bindings_v1(auth_user_id, clinic_id)
  WHERE portal = 'professional';
CREATE UNIQUE INDEX iam_persona_unique_patient_v1
  ON public.iam_persona_access_bindings_v1(auth_user_id, patient_id)
  WHERE portal = 'patient';
CREATE UNIQUE INDEX iam_persona_unique_partner_v1
  ON public.iam_persona_access_bindings_v1(auth_user_id, partner_account_id)
  WHERE portal = 'partner';

-- One scoped lookup per authentication attempt; no per-clinic N+1.
CREATE INDEX iam_persona_user_portal_status_v1
  ON public.iam_persona_access_bindings_v1(auth_user_id, portal, access_status);

ALTER TABLE public.iam_persona_access_bindings_v1 ENABLE ROW LEVEL SECURITY;
-- There are deliberately no authenticated/anon policies. Never permit callers
-- to assign themselves roles, clinics, patients, partners or login methods.
REVOKE ALL ON TABLE public.iam_persona_access_bindings_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.iam_persona_access_bindings_v1 TO service_role;

COMMENT ON TABLE public.iam_persona_access_bindings_v1 IS
  'IAM persona/method bindings. Internal server-only; not a grant without current membership, patient relationship or partner approval and verified login method.';
COMMENT ON COLUMN public.iam_persona_access_bindings_v1.allowed_login_method IS
  'Configured login method for the portal. Google requires trusted provider-specific authentication attestation, not just JWT amr oauth.';

-- No historical data backfill. Do not infer a patient link from e-mail or
-- copy a director profile into the patient/partner role.
