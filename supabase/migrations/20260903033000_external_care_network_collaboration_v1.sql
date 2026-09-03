BEGIN;

-- External care-network collaboration v1
-- Additive, backend-boundary schema. No historical grant or clinical row is deleted.
-- This migration is self-contained for the canonical patient care-network directory
-- because staging may legitimately have Timeline v2 without the historical care-network migration.

-- PRE-FLIGHT: fail before schema changes when a dependency/legacy contract cannot be
-- repaired additively and safely. The transaction remains all-or-nothing.
DO $preflight$
DECLARE
  v_missing text;
  v_bad_types text;
  v_has_rows boolean := false;
  v_dup record;
  v_relkind "char";
  v_index_def text;
  v_index_table regclass;
  v_index_unique boolean;
BEGIN
  IF to_regclass('public.clinics') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_MISSING_RELATION: public.clinics';
  END IF;
  IF to_regclass('public.patients') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_MISSING_RELATION: public.patients';
  END IF;
  IF to_regclass('public.patient_evolution_share_grants') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_MISSING_RELATION: public.patient_evolution_share_grants';
  END IF;
  IF to_regclass('public.patient_evolution_timeline_items') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_MISSING_RELATION: public.patient_evolution_timeline_items';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_MISSING_RELATION: auth.users';
  END IF;

  -- Required upstream columns used by this feature. They are not reinterpreted here.
  SELECT string_agg(req.column_name, ', ' ORDER BY req.column_name)
    INTO v_missing
  FROM (VALUES
    ('public','patients','id'),('public','patients','clinic_id'),('public','patients','is_active'),
    ('public','patients','deleted_at'),('public','patients','archived_at'),('public','patients','status'),
    ('public','patient_evolution_share_grants','id'),('public','patient_evolution_share_grants','public_id'),
    ('public','patient_evolution_share_grants','timeline_item_id'),('public','patient_evolution_share_grants','clinic_id'),
    ('public','patient_evolution_share_grants','patient_id'),('public','patient_evolution_share_grants','recipient_email'),
    ('public','patient_evolution_share_grants','status'),('public','patient_evolution_share_grants','created_by_user_id'),
    ('public','patient_evolution_share_grants','revoked_at'),('public','patient_evolution_share_grants','revoked_by_user_id'),
    ('public','patient_evolution_share_grants','updated_at'),
    ('public','patient_evolution_timeline_items','id'),('public','patient_evolution_timeline_items','clinic_id'),
    ('public','patient_evolution_timeline_items','patient_id'),('public','patient_evolution_timeline_items','archived_at')
  ) AS req(table_schema, table_name, column_name)
  LEFT JOIN information_schema.columns c
    ON c.table_schema=req.table_schema AND c.table_name=req.table_name AND c.column_name=req.column_name
  WHERE c.column_name IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_MISSING_UPSTREAM_COLUMNS: %', v_missing;
  END IF;

  IF to_regclass('public.patient_care_network_contacts') IS NOT NULL THEN
    SELECT c.relkind INTO v_relkind
    FROM pg_class c WHERE c.oid='public.patient_care_network_contacts'::regclass;
    IF v_relkind NOT IN ('r','p') THEN
      RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_RELATION_TYPE: public.patient_care_network_contacts';
    END IF;

    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.patient_care_network_contacts LIMIT 1)' INTO v_has_rows;

    -- Existing columns must have the canonical types. Type conversion is intentionally
    -- not attempted because it could reinterpret historical data.
    SELECT string_agg(exp.column_name || '=' || coalesce(c.data_type,'<missing>'), ', ' ORDER BY exp.column_name)
      INTO v_bad_types
    FROM (VALUES
      ('id','uuid'),('clinic_id','uuid'),('patient_id','uuid'),('clinic_name','text'),
      ('professional_name','text'),('specialty','text'),('phone','text'),('email','text'),
      ('source','text'),('created_by_user_id','uuid'),('updated_by_user_id','uuid'),
      ('created_at','timestamp with time zone'),('updated_at','timestamp with time zone'),
      ('archived_at','timestamp with time zone')
    ) AS exp(column_name, data_type)
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name='patient_care_network_contacts' AND c.column_name=exp.column_name
    WHERE c.data_type <> exp.data_type;
    IF v_bad_types IS NOT NULL THEN
      RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INCOMPATIBLE_COLUMN_TYPES: %', v_bad_types;
    END IF;

    SELECT string_agg(exp.column_name, ', ' ORDER BY exp.column_name)
      INTO v_missing
    FROM (VALUES
      ('id'),('clinic_id'),('patient_id'),('clinic_name'),('professional_name'),('specialty'),
      ('phone'),('email'),('source'),('created_by_user_id'),('updated_by_user_id'),
      ('created_at'),('updated_at'),('archived_at')
    ) AS exp(column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name='patient_care_network_contacts' AND c.column_name=exp.column_name
    WHERE c.column_name IS NULL;
    IF v_missing IS NOT NULL AND v_has_rows THEN
      RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_NONEMPTY_PARTIAL_TABLE: missing %', v_missing;
    END IF;

    -- Duplicate active normalized e-mails are an identity ambiguity. Never merge them silently.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='patient_care_network_contacts'
        AND column_name IN ('clinic_id','patient_id','email','archived_at')
      GROUP BY table_schema,table_name HAVING count(*)=4
    ) THEN
      NULL; -- empty/partial tables are repaired additively below
    ELSE
      EXECUTE $sql$
        SELECT clinic_id, patient_id, lower(btrim(email)) AS normalized_email, count(*) AS duplicate_count
        FROM public.patient_care_network_contacts
        WHERE archived_at IS NULL AND email IS NOT NULL AND btrim(email) <> ''
        GROUP BY clinic_id, patient_id, lower(btrim(email))
        HAVING count(*) > 1
        ORDER BY count(*) DESC
        LIMIT 1
      $sql$ INTO v_dup;
      IF v_dup.duplicate_count IS NOT NULL THEN
        RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_ACTIVE_EMAIL_DUPLICATE: clinic_id=%, patient_id=%, normalized_email=%, count=%',
          v_dup.clinic_id, v_dup.patient_id, v_dup.normalized_email, v_dup.duplicate_count;
      END IF;
    END IF;
  END IF;

  -- A same-name index on another table or with an incompatible definition must not
  -- be silently accepted by CREATE INDEX IF NOT EXISTS.
  FOR v_index_def, v_index_table, v_index_unique IN
    SELECT pg_get_indexdef(i.indexrelid), i.indrelid::regclass, i.indisunique
    FROM pg_index i
    JOIN pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=idx.relnamespace
    WHERE n.nspname='public' AND idx.relname='idx_patient_care_network_active_patient'
  LOOP
    IF v_index_table::text <> 'patient_care_network_contacts'
       OR lower(v_index_def) NOT LIKE '%(clinic_id, patient_id, created_at)%'
       OR lower(v_index_def) NOT LIKE '%where (archived_at is null)%'
       OR v_index_unique THEN
      RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INDEX_CONFLICT: idx_patient_care_network_active_patient';
    END IF;
  END LOOP;

  FOR v_index_def, v_index_table, v_index_unique IN
    SELECT pg_get_indexdef(i.indexrelid), i.indrelid::regclass, i.indisunique
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_namespace n ON n.oid=idx.relnamespace
    WHERE n.nspname='public' AND idx.relname='idx_patient_care_network_active_email'
  LOOP
    IF v_index_table::text <> 'patient_care_network_contacts'
       OR lower(v_index_def) NOT LIKE '%(clinic_id, patient_id, lower(email))%'
       OR lower(v_index_def) NOT LIKE '%archived_at is null%'
       OR v_index_unique THEN
      RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INDEX_CONFLICT: idx_patient_care_network_active_email';
    END IF;
  END LOOP;

  FOR v_index_def, v_index_table, v_index_unique IN
    SELECT pg_get_indexdef(i.indexrelid), i.indrelid::regclass, i.indisunique
    FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_namespace n ON n.oid=idx.relnamespace
    WHERE n.nspname='public' AND idx.relname='patient_care_network_contacts_active_email_uidx'
  LOOP
    IF v_index_table::text <> 'patient_care_network_contacts'
       OR lower(v_index_def) NOT LIKE '%(clinic_id, patient_id, lower(btrim(email)))%'
       OR lower(v_index_def) NOT LIKE '%archived_at is null%'
       OR NOT v_index_unique THEN
      RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INDEX_CONFLICT: patient_care_network_contacts_active_email_uidx';
    END IF;
  END LOOP;
END
$preflight$;

-- Canonical care-network directory bootstrap. Presence in this table is informational
-- and NEVER grants access to clinical data; explicit patient_evolution_share_grants remain mandatory.
CREATE TABLE IF NOT EXISTS public.patient_care_network_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_name text NULL,
  professional_name text NOT NULL,
  specialty text NULL,
  phone text NOT NULL,
  email text NULL,
  source text NOT NULL DEFAULT 'PATIENT_PORTAL',
  created_by_user_id uuid NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  professional_registry text NULL,
  archived_reason text NULL,
  patient_revoked_at timestamptz NULL,
  patient_revoked_by_user_id uuid NULL,
  supersedes_contact_id uuid NULL,
  CONSTRAINT patient_care_network_professional_name_length_chk CHECK (char_length(btrim(professional_name)) BETWEEN 1 AND 180),
  CONSTRAINT patient_care_network_phone_length_chk CHECK (char_length(btrim(phone)) BETWEEN 1 AND 60),
  CONSTRAINT patient_care_network_clinic_name_length_chk CHECK (clinic_name IS NULL OR char_length(btrim(clinic_name)) <= 180),
  CONSTRAINT patient_care_network_specialty_length_chk CHECK (specialty IS NULL OR char_length(btrim(specialty)) <= 120),
  CONSTRAINT patient_care_network_email_length_chk CHECK (email IS NULL OR char_length(btrim(email)) <= 254),
  CONSTRAINT patient_care_network_source_chk CHECK (source IN ('PATIENT_PORTAL','CLINIC')),
  CONSTRAINT patient_care_network_contacts_registry_len_ck CHECK (professional_registry IS NULL OR char_length(professional_registry) <= 120)
);

-- Empty partial tables may be repaired safely. Non-empty partial tables were rejected by preflight.
ALTER TABLE public.patient_care_network_contacts
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS clinic_id uuid NULL,
  ADD COLUMN IF NOT EXISTS patient_id uuid NULL,
  ADD COLUMN IF NOT EXISTS clinic_name text NULL,
  ADD COLUMN IF NOT EXISTS professional_name text NULL,
  ADD COLUMN IF NOT EXISTS specialty text NULL,
  ADD COLUMN IF NOT EXISTS phone text NULL,
  ADD COLUMN IF NOT EXISTS email text NULL,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'PATIENT_PORTAL',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS professional_registry text NULL,
  ADD COLUMN IF NOT EXISTS archived_reason text NULL,
  ADD COLUMN IF NOT EXISTS patient_revoked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS patient_revoked_by_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS supersedes_contact_id uuid NULL;

-- Existing canonical rows must already satisfy these invariants; no data is rewritten.
DO $care_contract$
DECLARE
  v_pk_cols text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE id IS NULL OR clinic_id IS NULL OR patient_id IS NULL OR professional_name IS NULL OR phone IS NULL OR source IS NULL OR created_at IS NULL OR updated_at IS NULL) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_REQUIRED_VALUE_NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE char_length(btrim(professional_name)) NOT BETWEEN 1 AND 180) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_PROFESSIONAL_NAME';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE char_length(btrim(phone)) NOT BETWEEN 1 AND 60) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_PHONE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE clinic_name IS NOT NULL AND char_length(btrim(clinic_name)) > 180) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_CLINIC_NAME';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE specialty IS NOT NULL AND char_length(btrim(specialty)) > 120) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_SPECIALTY';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE email IS NOT NULL AND char_length(btrim(email)) > 254) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_EMAIL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE source NOT IN ('PATIENT_PORTAL','CLINIC')) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_SOURCE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts WHERE professional_registry IS NOT NULL AND char_length(professional_registry) > 120) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_INVALID_REGISTRY';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts c LEFT JOIN public.clinics x ON x.id=c.clinic_id WHERE x.id IS NULL) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_ORPHAN_CLINIC';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts c LEFT JOIN public.patients p ON p.id=c.patient_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_ORPHAN_PATIENT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_care_network_contacts GROUP BY id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_DUPLICATE_ID';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v_pk_cols
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum,ord)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.conrelid='public.patient_care_network_contacts'::regclass AND c.contype='p';
  IF v_pk_cols IS NOT NULL AND v_pk_cols <> 'id' THEN
    RAISE EXCEPTION 'EXTERNAL_CARE_NETWORK_PREFLIGHT_UNEXPECTED_PRIMARY_KEY: %', v_pk_cols;
  END IF;
END
$care_contract$;

ALTER TABLE public.patient_care_network_contacts
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN clinic_id SET NOT NULL,
  ALTER COLUMN patient_id SET NOT NULL,
  ALTER COLUMN professional_name SET NOT NULL,
  ALTER COLUMN phone SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'PATIENT_PORTAL',
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $care_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_care_network_contacts'::regclass AND contype='p') THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_contacts_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.patient_care_network_contacts'::regclass AND c.contype='f'
      AND c.confrelid='public.clinics'::regclass
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.patient_care_network_contacts'::regclass AND attname='clinic_id')]::smallint[]
  ) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_contacts_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid='public.patient_care_network_contacts'::regclass AND c.contype='f'
      AND c.confrelid='public.patients'::regclass
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.patient_care_network_contacts'::regclass AND attname='patient_id')]::smallint[]
  ) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_contacts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_professional_name_length_chk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_professional_name_length_chk CHECK (char_length(btrim(professional_name)) BETWEEN 1 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_phone_length_chk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_phone_length_chk CHECK (char_length(btrim(phone)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_clinic_name_length_chk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_clinic_name_length_chk CHECK (clinic_name IS NULL OR char_length(btrim(clinic_name)) <= 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_specialty_length_chk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_specialty_length_chk CHECK (specialty IS NULL OR char_length(btrim(specialty)) <= 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_email_length_chk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_email_length_chk CHECK (email IS NULL OR char_length(btrim(email)) <= 254);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_source_chk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_source_chk CHECK (source IN ('PATIENT_PORTAL','CLINIC'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_contacts_registry_len_ck' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_contacts_registry_len_ck CHECK (professional_registry IS NULL OR char_length(professional_registry) <= 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_care_network_contacts_supersedes_fk' AND conrelid='public.patient_care_network_contacts'::regclass) THEN
    ALTER TABLE public.patient_care_network_contacts ADD CONSTRAINT patient_care_network_contacts_supersedes_fk FOREIGN KEY (supersedes_contact_id) REFERENCES public.patient_care_network_contacts(id) ON DELETE SET NULL;
  END IF;
END
$care_constraints$;

CREATE INDEX IF NOT EXISTS idx_patient_care_network_active_patient
  ON public.patient_care_network_contacts (clinic_id, patient_id, created_at)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_patient_care_network_active_email
  ON public.patient_care_network_contacts (clinic_id, patient_id, lower(email))
  WHERE archived_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patient_care_network_contacts_active_email_uidx
  ON public.patient_care_network_contacts(clinic_id, patient_id, lower(btrim(email)))
  WHERE archived_at IS NULL AND email IS NOT NULL AND btrim(email) <> '';

ALTER TABLE public.patient_care_network_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.patient_care_network_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patient_care_network_contacts TO service_role;
COMMENT ON TABLE public.patient_care_network_contacts IS
  'Care-network directory for a patient. Presence in this table never implies authorization to clinical data; every shared item requires an explicit grant.';
COMMENT ON COLUMN public.patient_care_network_contacts.email IS
  'External identity locator within clinic+patient. This value is not itself an authorization grant.';

CREATE TABLE IF NOT EXISTS public.external_professional_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL,
  normalized_email text NOT NULL,
  display_name text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NULL,
  CONSTRAINT external_professional_accounts_auth_user_fk
    FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT external_professional_accounts_email_ck
    CHECK (
      normalized_email = lower(btrim(normalized_email))
      AND char_length(normalized_email) BETWEEN 3 AND 254
      AND normalized_email LIKE '%@%'
    ),
  CONSTRAINT external_professional_accounts_display_name_ck
    CHECK (display_name IS NULL OR char_length(display_name) <= 180)
);

CREATE UNIQUE INDEX IF NOT EXISTS external_professional_accounts_auth_user_uidx
  ON public.external_professional_accounts(auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS external_professional_accounts_email_uidx
  ON public.external_professional_accounts(normalized_email);

ALTER TABLE public.patient_evolution_share_grants
  ADD COLUMN IF NOT EXISTS care_network_contact_id uuid NULL,
  ADD COLUMN IF NOT EXISTS external_account_id uuid NULL,
  ADD COLUMN IF NOT EXISTS can_comment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revocation_reason text NULL,
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reactivation_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_evolution_share_grants_care_contact_fk'
      AND conrelid = 'public.patient_evolution_share_grants'::regclass
  ) THEN
    ALTER TABLE public.patient_evolution_share_grants
      ADD CONSTRAINT patient_evolution_share_grants_care_contact_fk
      FOREIGN KEY (care_network_contact_id)
      REFERENCES public.patient_care_network_contacts(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_evolution_share_grants_external_account_fk'
      AND conrelid = 'public.patient_evolution_share_grants'::regclass
  ) THEN
    ALTER TABLE public.patient_evolution_share_grants
      ADD CONSTRAINT patient_evolution_share_grants_external_account_fk
      FOREIGN KEY (external_account_id)
      REFERENCES public.external_professional_accounts(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_evolution_share_grants_view_count_ck'
      AND conrelid = 'public.patient_evolution_share_grants'::regclass
  ) THEN
    ALTER TABLE public.patient_evolution_share_grants
      ADD CONSTRAINT patient_evolution_share_grants_view_count_ck
      CHECK (view_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_evolution_share_grants_reactivation_count_ck'
      AND conrelid = 'public.patient_evolution_share_grants'::regclass
  ) THEN
    ALTER TABLE public.patient_evolution_share_grants
      ADD CONSTRAINT patient_evolution_share_grants_reactivation_count_ck
      CHECK (reactivation_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_evolution_share_grants_view_dates_ck'
      AND conrelid = 'public.patient_evolution_share_grants'::regclass
  ) THEN
    ALTER TABLE public.patient_evolution_share_grants
      ADD CONSTRAINT patient_evolution_share_grants_view_dates_ck
      CHECK (first_viewed_at IS NULL OR last_viewed_at IS NULL OR last_viewed_at >= first_viewed_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS patient_evolution_share_grants_external_active_idx
  ON public.patient_evolution_share_grants(external_account_id, created_at DESC)
  WHERE status = 'ACTIVE' AND external_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS patient_evolution_share_grants_scope_email_active_idx
  ON public.patient_evolution_share_grants(clinic_id, patient_id, lower(btrim(recipient_email)), created_at DESC)
  WHERE status = 'ACTIVE';

-- The canonical care-network write path serializes by this same normalized key.
-- The partial unique index closes the remaining direct-write race without changing
-- or backfilling historical rows. If legacy active duplicates exist, the migration
-- fails transactionally so they can be reviewed instead of being merged silently.
CREATE UNIQUE INDEX IF NOT EXISTS patient_care_network_contacts_active_email_uidx
  ON public.patient_care_network_contacts(clinic_id, patient_id, lower(btrim(email)))
  WHERE archived_at IS NULL AND email IS NOT NULL AND btrim(email) <> '';

CREATE TABLE IF NOT EXISTS public.external_evolution_activation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.patient_evolution_share_grants(id) ON DELETE CASCADE,
  recipient_email_normalized text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_evolution_activation_tokens_hash_ck
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT external_evolution_activation_tokens_email_ck
    CHECK (recipient_email_normalized = lower(btrim(recipient_email_normalized))),
  CONSTRAINT external_evolution_activation_tokens_expiry_ck
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS external_evolution_activation_tokens_hash_uidx
  ON public.external_evolution_activation_tokens(token_hash);
CREATE INDEX IF NOT EXISTS external_evolution_activation_tokens_grant_idx
  ON public.external_evolution_activation_tokens(grant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.patient_evolution_external_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.patient_evolution_share_grants(id) ON DELETE RESTRICT,
  timeline_item_id uuid NOT NULL REFERENCES public.patient_evolution_timeline_items(id) ON DELETE RESTRICT,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  external_account_id uuid NOT NULL REFERENCES public.external_professional_accounts(id) ON DELETE RESTRICT,
  body text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_evolution_external_comments_body_ck
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT patient_evolution_external_comments_idempotency_ck
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_evolution_external_comments_idempotency_uidx
  ON public.patient_evolution_external_comments(grant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS patient_evolution_external_comments_grant_created_idx
  ON public.patient_evolution_external_comments(grant_id, created_at ASC);
CREATE INDEX IF NOT EXISTS patient_evolution_external_comments_external_created_idx
  ON public.patient_evolution_external_comments(external_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.clinical_inbox_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  timeline_item_id uuid NULL REFERENCES public.patient_evolution_timeline_items(id) ON DELETE SET NULL,
  grant_id uuid NULL REFERENCES public.patient_evolution_share_grants(id) ON DELETE SET NULL,
  comment_id uuid NULL REFERENCES public.patient_evolution_external_comments(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_label text NULL,
  read_at timestamptz NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_inbox_notifications_event_type_ck
    CHECK (event_type IN ('EXTERNAL_EVOLUTION_FIRST_VIEWED','EXTERNAL_EVOLUTION_COMMENTED')),
  CONSTRAINT clinical_inbox_notifications_actor_label_ck
    CHECK (actor_label IS NULL OR char_length(actor_label) <= 180),
  CONSTRAINT clinical_inbox_notifications_idempotency_ck
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 180)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clinical_inbox_notifications_recipient_user_fk'
      AND conrelid = 'public.clinical_inbox_notifications'::regclass
  ) THEN
    ALTER TABLE public.clinical_inbox_notifications
      ADD CONSTRAINT clinical_inbox_notifications_recipient_user_fk
      FOREIGN KEY (recipient_user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS clinical_inbox_notifications_idempotency_uidx
  ON public.clinical_inbox_notifications(idempotency_key);
CREATE INDEX IF NOT EXISTS clinical_inbox_notifications_recipient_created_idx
  ON public.clinical_inbox_notifications(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clinical_inbox_notifications_recipient_unread_idx
  ON public.clinical_inbox_notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.external_professional_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_evolution_activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_evolution_external_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_inbox_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.external_professional_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.external_evolution_activation_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.patient_evolution_external_comments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.clinical_inbox_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.external_professional_accounts TO service_role;
GRANT ALL ON TABLE public.external_evolution_activation_tokens TO service_role;
GRANT ALL ON TABLE public.patient_evolution_external_comments TO service_role;
GRANT ALL ON TABLE public.clinical_inbox_notifications TO service_role;

DROP POLICY IF EXISTS external_professional_accounts_service_role_all ON public.external_professional_accounts;
CREATE POLICY external_professional_accounts_service_role_all
  ON public.external_professional_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS external_evolution_activation_tokens_service_role_all ON public.external_evolution_activation_tokens;
CREATE POLICY external_evolution_activation_tokens_service_role_all
  ON public.external_evolution_activation_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS patient_evolution_external_comments_service_role_all ON public.patient_evolution_external_comments;
CREATE POLICY patient_evolution_external_comments_service_role_all
  ON public.patient_evolution_external_comments FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS clinical_inbox_notifications_service_role_all ON public.clinical_inbox_notifications;
CREATE POLICY clinical_inbox_notifications_service_role_all
  ON public.clinical_inbox_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.upsert_patient_care_network_contact_v2(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_contact_id uuid,
  p_clinic_name text,
  p_professional_name text,
  p_specialty text,
  p_professional_registry text,
  p_phone text,
  p_email text,
  p_source text,
  p_actor_id uuid,
  p_restore_after_patient_revocation boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_current_email text;
  v_current public.patient_care_network_contacts%ROWTYPE;
  v_existing public.patient_care_network_contacts%ROWTYPE;
  v_prior_reason text;
  v_result public.patient_care_network_contacts%ROWTYPE;
BEGIN
  IF p_source NOT IN ('PATIENT_PORTAL','CLINIC') THEN
    RAISE EXCEPTION 'CARE_NETWORK_SOURCE_INVALID';
  END IF;
  IF nullif(btrim(p_professional_name), '') IS NULL OR nullif(btrim(p_phone), '') IS NULL THEN
    RAISE EXCEPTION 'CARE_NETWORK_REQUIRED_FIELDS_MISSING';
  END IF;
  IF v_email IS NOT NULL AND (char_length(v_email) > 254 OR v_email NOT LIKE '%@%') THEN
    RAISE EXCEPTION 'CARE_NETWORK_EMAIL_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id AND p.clinic_id = p_clinic_id
      AND coalesce(p.is_active, true) = true
      AND p.deleted_at IS NULL
      AND p.archived_at IS NULL
      AND upper(coalesce(p.status, '')) <> 'ARCHIVED'
  ) THEN
    RAISE EXCEPTION 'CARE_NETWORK_PATIENT_INELIGIBLE';
  END IF;

  IF v_email IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_clinic_id::text || ':' || p_patient_id::text || ':' || v_email, 0));
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT * INTO v_current
    FROM public.patient_care_network_contacts
    WHERE id = p_contact_id AND clinic_id = p_clinic_id AND patient_id = p_patient_id AND archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CARE_NETWORK_CONTACT_NOT_FOUND'; END IF;
    v_current_email := nullif(lower(btrim(coalesce(v_current.email, ''))), '');

    IF v_current_email IS DISTINCT FROM v_email THEN
      -- A clinic cannot silently target an identity that the patient/responsible
      -- explicitly removed before. Old grants remain revoked; this only authorizes
      -- creation of a new relationship record after explicit confirmation.
      IF p_source = 'CLINIC' AND v_email IS NOT NULL THEN
        SELECT archived_reason INTO v_prior_reason
        FROM public.patient_care_network_contacts
        WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id
          AND lower(btrim(email)) = v_email AND archived_at IS NOT NULL
        ORDER BY archived_at DESC NULLS LAST, created_at DESC LIMIT 1;
        IF v_prior_reason = 'PATIENT_UNLINKED' AND NOT p_restore_after_patient_revocation THEN
          RAISE EXCEPTION 'CARE_NETWORK_PATIENT_REVOCATION_CONFIRMATION_REQUIRED';
        END IF;
      END IF;

      -- An existing e-mail is an identity boundary. Preserve the old relationship
      -- row and revoke grants addressed to it instead of retargeting history.
      IF v_current_email IS NOT NULL THEN
        UPDATE public.patient_care_network_contacts
        SET archived_at = v_now,
            archived_reason = 'EMAIL_CHANGED',
            updated_at = v_now,
            updated_by_user_id = p_actor_id
        WHERE id = v_current.id;

        UPDATE public.patient_evolution_share_grants
        SET status = 'REVOKED', revoked_at = v_now, revoked_by_user_id = p_actor_id,
            revocation_reason = 'CONTACT_EMAIL_CHANGED', updated_at = v_now
        WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND status = 'ACTIVE'
          AND lower(btrim(recipient_email)) = v_current_email;

        IF v_email IS NOT NULL THEN
          SELECT * INTO v_existing
          FROM public.patient_care_network_contacts
          WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND archived_at IS NULL
            AND lower(btrim(email)) = v_email AND id <> v_current.id
          ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
        END IF;

        IF v_existing.id IS NOT NULL THEN
          UPDATE public.patient_care_network_contacts
          SET clinic_name = nullif(btrim(p_clinic_name), ''),
              professional_name = btrim(p_professional_name),
              specialty = nullif(btrim(p_specialty), ''),
              professional_registry = nullif(btrim(p_professional_registry), ''),
              phone = btrim(p_phone), email = v_email,
              updated_at = v_now, updated_by_user_id = p_actor_id
          WHERE id = v_existing.id
          RETURNING * INTO v_result;
        ELSE
          INSERT INTO public.patient_care_network_contacts (
            clinic_id, patient_id, clinic_name, professional_name, specialty, professional_registry,
            phone, email, source, created_by_user_id, updated_by_user_id, supersedes_contact_id,
            created_at, updated_at, archived_at
          ) VALUES (
            p_clinic_id, p_patient_id, nullif(btrim(p_clinic_name), ''), btrim(p_professional_name),
            nullif(btrim(p_specialty), ''), nullif(btrim(p_professional_registry), ''), btrim(p_phone),
            v_email, p_source, p_actor_id, p_actor_id, v_current.id, v_now, v_now, NULL
          ) RETURNING * INTO v_result;
        END IF;
        RETURN to_jsonb(v_result);
      END IF;

      -- Completing a contact that previously had no e-mail does not have an old
      -- identity to preserve, but it must still deduplicate against an active one.
      IF v_email IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.patient_care_network_contacts
        WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND archived_at IS NULL
          AND lower(btrim(email)) = v_email AND id <> v_current.id
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
        IF v_existing.id IS NOT NULL THEN
          UPDATE public.patient_care_network_contacts
          SET archived_at = v_now, archived_reason = 'IDENTITY_MERGED', updated_at = v_now, updated_by_user_id = p_actor_id
          WHERE id = v_current.id;
          UPDATE public.patient_care_network_contacts
          SET clinic_name = coalesce(nullif(btrim(p_clinic_name), ''), clinic_name),
              professional_name = btrim(p_professional_name), specialty = coalesce(nullif(btrim(p_specialty), ''), specialty),
              professional_registry = coalesce(nullif(btrim(p_professional_registry), ''), professional_registry),
              phone = btrim(p_phone), updated_at = v_now, updated_by_user_id = p_actor_id
          WHERE id = v_existing.id RETURNING * INTO v_result;
          RETURN to_jsonb(v_result);
        END IF;
      END IF;
    END IF;

    UPDATE public.patient_care_network_contacts
    SET clinic_name = nullif(btrim(p_clinic_name), ''), professional_name = btrim(p_professional_name),
        specialty = nullif(btrim(p_specialty), ''), professional_registry = nullif(btrim(p_professional_registry), ''),
        phone = btrim(p_phone), email = v_email, updated_at = v_now, updated_by_user_id = p_actor_id
    WHERE id = v_current.id RETURNING * INTO v_result;
    RETURN to_jsonb(v_result);
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.patient_care_network_contacts
    WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND archived_at IS NULL
      AND lower(btrim(email)) = v_email
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF v_existing.id IS NOT NULL THEN
      UPDATE public.patient_care_network_contacts
      SET clinic_name = coalesce(nullif(btrim(p_clinic_name), ''), clinic_name),
          professional_name = btrim(p_professional_name), specialty = coalesce(nullif(btrim(p_specialty), ''), specialty),
          professional_registry = coalesce(nullif(btrim(p_professional_registry), ''), professional_registry),
          phone = btrim(p_phone), updated_at = v_now, updated_by_user_id = p_actor_id
      WHERE id = v_existing.id RETURNING * INTO v_result;
      RETURN to_jsonb(v_result);
    END IF;

    SELECT archived_reason INTO v_prior_reason
    FROM public.patient_care_network_contacts
    WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id
      AND lower(btrim(email)) = v_email AND archived_at IS NOT NULL
    ORDER BY archived_at DESC NULLS LAST, created_at DESC LIMIT 1;
    IF p_source = 'CLINIC' AND v_prior_reason = 'PATIENT_UNLINKED' AND NOT p_restore_after_patient_revocation THEN
      RAISE EXCEPTION 'CARE_NETWORK_PATIENT_REVOCATION_CONFIRMATION_REQUIRED';
    END IF;
  END IF;

  INSERT INTO public.patient_care_network_contacts (
    clinic_id, patient_id, clinic_name, professional_name, specialty, professional_registry,
    phone, email, source, created_by_user_id, updated_by_user_id, created_at, updated_at, archived_at
  ) VALUES (
    p_clinic_id, p_patient_id, nullif(btrim(p_clinic_name), ''), btrim(p_professional_name),
    nullif(btrim(p_specialty), ''), nullif(btrim(p_professional_registry), ''), btrim(p_phone),
    v_email, p_source, p_actor_id, p_actor_id, v_now, v_now, NULL
  ) RETURNING * INTO v_result;
  RETURN to_jsonb(v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_patient_care_network_contact_v2(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_contact_id uuid,
  p_actor_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_contact public.patient_care_network_contacts%ROWTYPE;
  v_email text;
  v_revoked integer := 0;
BEGIN
  IF p_reason NOT IN ('PATIENT_UNLINKED','CLINIC_UNLINKED') THEN RAISE EXCEPTION 'CARE_NETWORK_ARCHIVE_REASON_INVALID'; END IF;
  SELECT * INTO v_contact FROM public.patient_care_network_contacts
  WHERE id = p_contact_id AND clinic_id = p_clinic_id AND patient_id = p_patient_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CARE_NETWORK_CONTACT_NOT_FOUND'; END IF;
  v_email := nullif(lower(btrim(coalesce(v_contact.email, ''))), '');

  UPDATE public.patient_care_network_contacts
  SET archived_at = v_now, archived_reason = p_reason,
      patient_revoked_at = CASE WHEN p_reason = 'PATIENT_UNLINKED' THEN v_now ELSE patient_revoked_at END,
      patient_revoked_by_user_id = CASE WHEN p_reason = 'PATIENT_UNLINKED' THEN p_actor_id ELSE patient_revoked_by_user_id END,
      updated_at = v_now, updated_by_user_id = p_actor_id
  WHERE id = v_contact.id;

  IF v_email IS NOT NULL THEN
    UPDATE public.patient_evolution_share_grants
    SET status = 'REVOKED', revoked_at = v_now, revoked_by_user_id = p_actor_id,
        revocation_reason = p_reason, updated_at = v_now
    WHERE clinic_id = p_clinic_id AND patient_id = p_patient_id AND status = 'ACTIVE'
      AND lower(btrim(recipient_email)) = v_email;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('id', v_contact.id, 'archived', true, 'revokedGrantCount', v_revoked);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_patient_evolution_share_grant_v2(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_care_network_contact_id uuid,
  p_actor_id uuid,
  p_can_comment boolean,
  p_authorization_statement_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_contact public.patient_care_network_contacts%ROWTYPE;
  v_grant public.patient_evolution_share_grants%ROWTYPE;
  v_email text;
  v_account_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = p_patient_id AND p.clinic_id = p_clinic_id
      AND coalesce(p.is_active, true) = true AND p.deleted_at IS NULL AND p.archived_at IS NULL
      AND upper(coalesce(p.status, '')) <> 'ARCHIVED'
  ) THEN RAISE EXCEPTION 'EVOLUTION_SHARE_PATIENT_INELIGIBLE'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.patient_evolution_timeline_items i
    WHERE i.id = p_item_id AND i.clinic_id = p_clinic_id AND i.patient_id = p_patient_id AND i.archived_at IS NULL
  ) THEN RAISE EXCEPTION 'EVOLUTION_TIMELINE_ITEM_NOT_FOUND'; END IF;

  SELECT * INTO v_contact FROM public.patient_care_network_contacts
  WHERE id = p_care_network_contact_id AND clinic_id = p_clinic_id AND patient_id = p_patient_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CARE_NETWORK_CONTACT_NOT_FOUND'; END IF;
  v_email := nullif(lower(btrim(coalesce(v_contact.email, ''))), '');
  IF v_email IS NULL THEN RAISE EXCEPTION 'CARE_NETWORK_CONTACT_EMAIL_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || v_email, 0));

  SELECT id INTO v_account_id FROM public.external_professional_accounts WHERE normalized_email = v_email;
  SELECT * INTO v_grant FROM public.patient_evolution_share_grants
  WHERE timeline_item_id = p_item_id AND lower(btrim(recipient_email)) = v_email
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF v_grant.id IS NULL THEN
    INSERT INTO public.patient_evolution_share_grants (
      public_id, timeline_item_id, clinic_id, patient_id, recipient_email, status, purpose,
      authorization_statement_version, authorization_declared_by, authorization_declared_at,
      created_by_user_id, created_at, updated_at, care_network_contact_id, external_account_id, can_comment
    ) VALUES (
      gen_random_uuid(), p_item_id, p_clinic_id, p_patient_id, v_email, 'ACTIVE', 'CONTINUITY_OF_CARE',
      p_authorization_statement_version, p_actor_id, v_now, p_actor_id, v_now, v_now,
      v_contact.id, v_account_id, coalesce(p_can_comment, false)
    ) RETURNING * INTO v_grant;
  ELSIF v_grant.status = 'ACTIVE' THEN
    UPDATE public.patient_evolution_share_grants
    SET care_network_contact_id = v_contact.id, external_account_id = coalesce(external_account_id, v_account_id),
        can_comment = coalesce(p_can_comment, false), authorization_statement_version = p_authorization_statement_version,
        authorization_declared_by = p_actor_id, authorization_declared_at = v_now, updated_at = v_now
    WHERE id = v_grant.id RETURNING * INTO v_grant;
  ELSE
    UPDATE public.patient_evolution_share_grants
    SET public_id = gen_random_uuid(), status = 'ACTIVE', care_network_contact_id = v_contact.id,
        external_account_id = v_account_id, can_comment = coalesce(p_can_comment, false),
        authorization_statement_version = p_authorization_statement_version,
        authorization_declared_by = p_actor_id, authorization_declared_at = v_now, created_by_user_id = p_actor_id,
        revoked_at = NULL, revoked_by_user_id = NULL, revocation_reason = NULL,
        reactivated_at = v_now, reactivation_count = coalesce(reactivation_count,0) + 1,
        updated_at = v_now
    WHERE id = v_grant.id RETURNING * INTO v_grant;
  END IF;

  RETURN jsonb_build_object('id', v_grant.id, 'publicId', v_grant.public_id, 'recipientEmail', v_grant.recipient_email,
    'status', v_grant.status, 'canComment', v_grant.can_comment, 'careNetworkContactId', v_grant.care_network_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_patient_evolution_share_grant_v2(
  p_clinic_id uuid, p_patient_id uuid, p_item_id uuid, p_grant_id uuid, p_actor_id uuid, p_reason text DEFAULT 'CLINIC_MANUAL'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_grant public.patient_evolution_share_grants%ROWTYPE; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_grant FROM public.patient_evolution_share_grants
  WHERE id=p_grant_id AND clinic_id=p_clinic_id AND patient_id=p_patient_id AND timeline_item_id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVOLUTION_SHARE_GRANT_NOT_FOUND'; END IF;
  IF v_grant.status='ACTIVE' THEN
    UPDATE public.patient_evolution_share_grants SET status='REVOKED', revoked_at=v_now, revoked_by_user_id=p_actor_id,
      revocation_reason=coalesce(nullif(btrim(p_reason),''),'CLINIC_MANUAL'), updated_at=v_now WHERE id=v_grant.id RETURNING * INTO v_grant;
  END IF;
  RETURN jsonb_build_object('id',v_grant.id,'status',v_grant.status,'publicId',v_grant.public_id);
END; $$;

CREATE OR REPLACE FUNCTION public.issue_external_evolution_activation_token_v1(
  p_grant_id uuid, p_token_hash text, p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_grant public.patient_evolution_share_grants%ROWTYPE; v_token_id uuid; v_email text; v_now timestamptz := now();
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at <= v_now THEN RAISE EXCEPTION 'EXTERNAL_ACTIVATION_TOKEN_INVALID'; END IF;
  SELECT * INTO v_grant FROM public.patient_evolution_share_grants WHERE id=p_grant_id AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVOLUTION_SHARE_GRANT_NOT_ACTIVE'; END IF;
  v_email := lower(btrim(v_grant.recipient_email));
  IF v_grant.care_network_contact_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.patient_care_network_contacts c
    WHERE c.id=v_grant.care_network_contact_id AND c.clinic_id=v_grant.clinic_id AND c.patient_id=v_grant.patient_id
      AND c.archived_at IS NULL AND lower(btrim(c.email))=v_email
  ) THEN RAISE EXCEPTION 'EVOLUTION_SHARE_CARE_LINK_INACTIVE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.patients p WHERE p.id=v_grant.patient_id AND p.clinic_id=v_grant.clinic_id
      AND coalesce(p.is_active,true)=true AND p.deleted_at IS NULL AND p.archived_at IS NULL
      AND upper(coalesce(p.status,''))<>'ARCHIVED'
  ) THEN RAISE EXCEPTION 'EVOLUTION_SHARE_PATIENT_INELIGIBLE'; END IF;
  UPDATE public.external_evolution_activation_tokens SET invalidated_at=v_now
    WHERE grant_id=v_grant.id AND consumed_at IS NULL AND invalidated_at IS NULL;
  INSERT INTO public.external_evolution_activation_tokens(grant_id,recipient_email_normalized,token_hash,expires_at)
    VALUES(v_grant.id,v_email,p_token_hash,p_expires_at) RETURNING id INTO v_token_id;
  RETURN jsonb_build_object('id',v_token_id,'grantId',v_grant.id,'expiresAt',p_expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.consume_external_evolution_activation_token_v1(
  p_public_id uuid, p_token_hash text, p_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_now timestamptz:=now(); v_token public.external_evolution_activation_tokens%ROWTYPE;
  v_grant public.patient_evolution_share_grants%ROWTYPE; v_account public.external_professional_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_grant FROM public.patient_evolution_share_grants WHERE public_id=p_public_id AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVOLUTION_SHARE_GRANT_NOT_ACTIVE'; END IF;
  SELECT * INTO v_token FROM public.external_evolution_activation_tokens
    WHERE grant_id=v_grant.id AND token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_token.consumed_at IS NOT NULL OR v_token.invalidated_at IS NOT NULL OR v_token.expires_at <= v_now THEN
    RAISE EXCEPTION 'EXTERNAL_ACTIVATION_TOKEN_EXPIRED_OR_USED';
  END IF;
  SELECT * INTO v_account FROM public.external_professional_accounts WHERE id=p_account_id FOR UPDATE;
  IF NOT FOUND OR v_account.normalized_email <> lower(btrim(v_grant.recipient_email))
     OR v_token.recipient_email_normalized <> v_account.normalized_email THEN
    RAISE EXCEPTION 'EXTERNAL_ACTIVATION_IDENTITY_MISMATCH';
  END IF;
  IF EXISTS (SELECT 1 FROM public.patient_evolution_share_grants g WHERE g.status='ACTIVE'
      AND lower(btrim(g.recipient_email))=v_account.normalized_email AND g.external_account_id IS NOT NULL AND g.external_account_id<>v_account.id) THEN
    RAISE EXCEPTION 'EXTERNAL_EMAIL_ACCOUNT_CONFLICT';
  END IF;
  UPDATE public.external_evolution_activation_tokens SET consumed_at=v_now WHERE id=v_token.id;
  UPDATE public.patient_evolution_share_grants g SET external_account_id=v_account.id,updated_at=v_now
    WHERE g.status='ACTIVE' AND lower(btrim(g.recipient_email))=v_account.normalized_email
      AND (g.external_account_id IS NULL OR g.external_account_id=v_account.id)
      AND g.care_network_contact_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.patient_care_network_contacts c
        WHERE c.id=g.care_network_contact_id AND c.clinic_id=g.clinic_id AND c.patient_id=g.patient_id
          AND c.archived_at IS NULL AND lower(btrim(c.email))=v_account.normalized_email);
  RETURN jsonb_build_object('grantId',v_grant.id,'publicId',v_grant.public_id,'accountId',v_account.id);
END; $$;

CREATE OR REPLACE FUNCTION public.bind_external_professional_account_v1(
  p_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_account public.external_professional_accounts%ROWTYPE; v_bound integer := 0; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_account FROM public.external_professional_accounts WHERE id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXTERNAL_ACCOUNT_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.patient_evolution_share_grants g WHERE g.status='ACTIVE'
      AND lower(btrim(g.recipient_email))=v_account.normalized_email
      AND g.external_account_id IS NOT NULL AND g.external_account_id<>v_account.id) THEN
    RAISE EXCEPTION 'EXTERNAL_EMAIL_ACCOUNT_CONFLICT';
  END IF;
  UPDATE public.patient_evolution_share_grants g
  SET external_account_id=v_account.id, updated_at=v_now
  WHERE g.status='ACTIVE' AND lower(btrim(g.recipient_email))=v_account.normalized_email AND g.external_account_id IS NULL
    AND g.care_network_contact_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.patient_care_network_contacts c
      WHERE c.id=g.care_network_contact_id AND c.clinic_id=g.clinic_id AND c.patient_id=g.patient_id
        AND c.archived_at IS NULL AND lower(btrim(c.email))=v_account.normalized_email);
  GET DIAGNOSTICS v_bound = ROW_COUNT;
  UPDATE public.external_professional_accounts SET last_login_at=v_now,updated_at=v_now WHERE id=v_account.id;
  RETURN jsonb_build_object('accountId',v_account.id,'boundGrantCount',v_bound);
END; $$;

CREATE OR REPLACE FUNCTION public.record_external_evolution_view_v1(
  p_grant_id uuid, p_external_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_now timestamptz:=now(); v_grant public.patient_evolution_share_grants%ROWTYPE; v_first boolean;
  v_actor_label text; v_patient_name text;
BEGIN
  SELECT * INTO v_grant FROM public.patient_evolution_share_grants WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND OR v_grant.status<>'ACTIVE' OR v_grant.external_account_id IS DISTINCT FROM p_external_account_id THEN
    RAISE EXCEPTION 'EVOLUTION_SHARE_ACCESS_DENIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id=v_grant.patient_id AND p.clinic_id=v_grant.clinic_id
      AND coalesce(p.is_active,true)=true AND p.deleted_at IS NULL AND p.archived_at IS NULL
      AND upper(coalesce(p.status,''))<>'ARCHIVED') THEN RAISE EXCEPTION 'EVOLUTION_SHARE_PATIENT_INELIGIBLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patient_evolution_timeline_items i WHERE i.id=v_grant.timeline_item_id AND i.clinic_id=v_grant.clinic_id
      AND i.patient_id=v_grant.patient_id AND i.archived_at IS NULL) THEN RAISE EXCEPTION 'EVOLUTION_SHARE_ITEM_ARCHIVED'; END IF;
  IF v_grant.care_network_contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patient_care_network_contacts c WHERE c.id=v_grant.care_network_contact_id AND c.clinic_id=v_grant.clinic_id
      AND c.patient_id=v_grant.patient_id AND c.archived_at IS NULL AND lower(btrim(c.email))=lower(btrim(v_grant.recipient_email))
  ) THEN RAISE EXCEPTION 'EVOLUTION_SHARE_CARE_LINK_INACTIVE'; END IF;
  v_first := v_grant.first_viewed_at IS NULL;
  UPDATE public.patient_evolution_share_grants SET first_viewed_at=coalesce(first_viewed_at,v_now),last_viewed_at=v_now,
    view_count=coalesce(view_count,0)+1,updated_at=v_now WHERE id=v_grant.id RETURNING * INTO v_grant;
  IF v_first AND v_grant.created_by_user_id IS NOT NULL THEN
    SELECT professional_name INTO v_actor_label FROM public.patient_care_network_contacts WHERE id=v_grant.care_network_contact_id;
    INSERT INTO public.clinical_inbox_notifications(clinic_id,patient_id,recipient_user_id,timeline_item_id,grant_id,event_type,actor_label,idempotency_key)
    VALUES(v_grant.clinic_id,v_grant.patient_id,v_grant.created_by_user_id,v_grant.timeline_item_id,v_grant.id,
      'EXTERNAL_EVOLUTION_FIRST_VIEWED',coalesce(nullif(btrim(v_actor_label),''),'Profissional externo'),'external-first-view:'||v_grant.id::text)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('firstViewedAt',v_grant.first_viewed_at,'lastViewedAt',v_grant.last_viewed_at,'viewCount',v_grant.view_count,'firstView',v_first);
END; $$;

CREATE OR REPLACE FUNCTION public.append_external_evolution_comment_v1(
  p_grant_id uuid, p_external_account_id uuid, p_body text, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_grant public.patient_evolution_share_grants%ROWTYPE; v_comment_id uuid; v_created boolean:=false;
  v_body text:=btrim(coalesce(p_body,'')); v_key text:=btrim(coalesce(p_idempotency_key,'')); v_actor_label text; v_created_at timestamptz;
BEGIN
  IF char_length(v_body)<1 OR char_length(v_body)>4000 THEN RAISE EXCEPTION 'EXTERNAL_COMMENT_LENGTH_INVALID'; END IF;
  IF v_body ~ '<[^>]+>' THEN RAISE EXCEPTION 'EXTERNAL_COMMENT_HTML_NOT_ALLOWED'; END IF;
  IF char_length(v_key)<8 OR char_length(v_key)>120 THEN RAISE EXCEPTION 'EXTERNAL_COMMENT_IDEMPOTENCY_KEY_INVALID'; END IF;
  SELECT * INTO v_grant FROM public.patient_evolution_share_grants WHERE id=p_grant_id FOR UPDATE;
  IF NOT FOUND OR v_grant.status<>'ACTIVE' OR v_grant.external_account_id IS DISTINCT FROM p_external_account_id OR NOT v_grant.can_comment THEN
    RAISE EXCEPTION 'EXTERNAL_COMMENT_NOT_ALLOWED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patients p WHERE p.id=v_grant.patient_id AND p.clinic_id=v_grant.clinic_id
      AND coalesce(p.is_active,true)=true AND p.deleted_at IS NULL AND p.archived_at IS NULL AND upper(coalesce(p.status,''))<>'ARCHIVED') THEN
    RAISE EXCEPTION 'EVOLUTION_SHARE_PATIENT_INELIGIBLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.patient_evolution_timeline_items i WHERE i.id=v_grant.timeline_item_id
      AND i.clinic_id=v_grant.clinic_id AND i.patient_id=v_grant.patient_id AND i.archived_at IS NULL) THEN
    RAISE EXCEPTION 'EVOLUTION_SHARE_ITEM_ARCHIVED'; END IF;
  IF v_grant.care_network_contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.patient_care_network_contacts c
      WHERE c.id=v_grant.care_network_contact_id AND c.archived_at IS NULL AND c.clinic_id=v_grant.clinic_id AND c.patient_id=v_grant.patient_id) THEN
    RAISE EXCEPTION 'EVOLUTION_SHARE_CARE_LINK_INACTIVE'; END IF;
  INSERT INTO public.patient_evolution_external_comments(grant_id,timeline_item_id,clinic_id,patient_id,external_account_id,body,idempotency_key)
  VALUES(v_grant.id,v_grant.timeline_item_id,v_grant.clinic_id,v_grant.patient_id,p_external_account_id,v_body,v_key)
  ON CONFLICT (grant_id,idempotency_key) DO NOTHING RETURNING id,created_at INTO v_comment_id,v_created_at;
  IF v_comment_id IS NULL THEN
    SELECT id,created_at INTO v_comment_id,v_created_at FROM public.patient_evolution_external_comments
    WHERE grant_id=v_grant.id AND idempotency_key=v_key;
  ELSE
    v_created:=true;
    IF v_grant.created_by_user_id IS NOT NULL THEN
      SELECT professional_name INTO v_actor_label FROM public.patient_care_network_contacts WHERE id=v_grant.care_network_contact_id;
      INSERT INTO public.clinical_inbox_notifications(clinic_id,patient_id,recipient_user_id,timeline_item_id,grant_id,comment_id,event_type,actor_label,idempotency_key)
      VALUES(v_grant.clinic_id,v_grant.patient_id,v_grant.created_by_user_id,v_grant.timeline_item_id,v_grant.id,v_comment_id,
        'EXTERNAL_EVOLUTION_COMMENTED',coalesce(nullif(btrim(v_actor_label),''),'Profissional externo'),'external-comment:'||v_comment_id::text)
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN jsonb_build_object('id',v_comment_id,'createdAt',v_created_at,'created',v_created,'body',v_body);
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_external_grants_when_patient_ineligible_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_now timestamptz:=now();
BEGIN
  IF (coalesce(NEW.is_active,true)=false OR NEW.deleted_at IS NOT NULL OR NEW.archived_at IS NOT NULL OR upper(coalesce(NEW.status,''))='ARCHIVED') THEN
    UPDATE public.patient_evolution_share_grants SET status='REVOKED',revoked_at=v_now,revoked_by_user_id=NULL,
      revocation_reason='PATIENT_LEFT_CLINIC',updated_at=v_now
    WHERE clinic_id=NEW.clinic_id AND patient_id=NEW.id AND status='ACTIVE';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_revoke_external_grants_when_patient_ineligible_v1 ON public.patients;
CREATE TRIGGER trg_revoke_external_grants_when_patient_ineligible_v1
AFTER UPDATE OF is_active, deleted_at, archived_at, status ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.revoke_external_grants_when_patient_ineligible_v1();

REVOKE ALL ON FUNCTION public.upsert_patient_care_network_contact_v2(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_patient_care_network_contact_v2(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_external_evolution_activation_token_v1(uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_external_evolution_activation_token_v1(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bind_external_professional_account_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_external_evolution_view_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_external_evolution_comment_v1(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_external_grants_when_patient_ineligible_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_patient_care_network_contact_v2(uuid,uuid,uuid,text,text,text,text,text,text,text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_patient_care_network_contact_v2(uuid,uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_external_evolution_activation_token_v1(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_external_evolution_activation_token_v1(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_external_professional_account_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_external_evolution_view_v1(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_external_evolution_comment_v1(uuid,uuid,text,text) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
