BEGIN;

-- Preserve authorization epochs for external evolution shares.
-- A revoked grant is immutable historical authorization. Re-sharing the same
-- timeline item with the same normalized recipient creates a brand-new grant.

DO $preflight$
DECLARE
  v_table regclass := to_regclass('public.patient_evolution_share_grants');
  v_index_oid oid;
  v_is_unique boolean;
  v_is_constraint_backing boolean;
  v_index_predicate text;
  v_index_expression text;
  v_timeline_attnum smallint;
  v_first_key smallint;
  v_second_key smallint;
  v_nkeyatts smallint;
  v_natts smallint;
  v_active_duplicate record;
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_TABLE_MISSING';
  END IF;

  -- This corrective migration intentionally depends only on the columns used
  -- by the epoch contract. Missing columns indicate that the preceding feature
  -- migration is not actually present and must not be guessed/replayed here.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'timeline_item_id' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'recipient_email' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'status' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'first_viewed_at' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'last_viewed_at' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'view_count' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'revoked_at' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'revoked_by_user_id' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'revocation_reason' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_REQUIRED_COLUMNS_MISSING';
  END IF;

  -- Validate the historical global unique index before replacing it. Never
  -- issue DROP INDEX against an unexpected object/definition.
  SELECT c.oid
  INTO v_index_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'patient_evolution_share_grants_item_email_uidx';

  IF v_index_oid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indexrelid = v_index_oid AND i.indrelid = v_table
    ) THEN
      RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_INDEX_NAME_COLLISION';
    END IF;

    SELECT i.indisunique,
           EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conindid = i.indexrelid),
           pg_get_expr(i.indpred, i.indrelid),
           pg_get_expr(i.indexprs, i.indrelid),
           i.indkey[0],
           i.indkey[1],
           i.indnkeyatts::smallint,
           i.indnatts::smallint
    INTO v_is_unique, v_is_constraint_backing, v_index_predicate, v_index_expression, v_first_key, v_second_key, v_nkeyatts, v_natts
    FROM pg_index i
    WHERE i.indexrelid = v_index_oid;

    SELECT attnum::smallint INTO v_timeline_attnum
    FROM pg_attribute
    WHERE attrelid = v_table AND attname = 'timeline_item_id' AND NOT attisdropped;

    IF NOT v_is_unique
       OR v_is_constraint_backing
       OR v_nkeyatts IS DISTINCT FROM 2
       OR v_natts IS DISTINCT FROM 2
       OR v_first_key IS DISTINCT FROM v_timeline_attnum
       OR v_second_key IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_INDEX_UNEXPECTED';
    END IF;

    -- Accept only either the exact legacy global expression or the desired
    -- partial ACTIVE expression. PostgreSQL exposes only expression keys in
    -- pg_get_expr(indexprs), therefore this comparison is deliberately narrow.
    IF regexp_replace(lower(coalesce(v_index_expression, '')), '\s+', '', 'g') NOT IN (
         'lower(recipient_email)',
         'lower(btrim(recipient_email))'
       ) THEN
      RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_INDEX_UNEXPECTED';
    END IF;

    IF v_index_predicate IS NOT NULL
       AND regexp_replace(lower(v_index_predicate), '[\s\(\)]', '', 'g') NOT IN (
         'status=''active''::text',
         'status=''active'''
       ) THEN
      RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_INDEX_UNEXPECTED';
    END IF;
  END IF;

  -- The normalized ACTIVE-only uniqueness may expose legacy values that the
  -- old lower(email) index did not consider duplicates because of whitespace.
  -- Never merge or pick a winner silently.
  SELECT timeline_item_id, lower(btrim(recipient_email)) AS normalized_email, count(*) AS duplicate_count
  INTO v_active_duplicate
  FROM public.patient_evolution_share_grants
  WHERE status = 'ACTIVE'
  GROUP BY timeline_item_id, lower(btrim(recipient_email))
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'EXTERNAL_SHARE_GRANT_EPOCH_PREFLIGHT_ACTIVE_DUPLICATE item=% email=% count=%',
      v_active_duplicate.timeline_item_id,
      v_active_duplicate.normalized_email,
      v_active_duplicate.duplicate_count;
  END IF;
END
$preflight$;

DO $replace_index$
DECLARE
  v_table regclass := 'public.patient_evolution_share_grants'::regclass;
  v_index_oid oid;
  v_predicate text;
  v_expression text;
BEGIN
  SELECT c.oid
  INTO v_index_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'patient_evolution_share_grants_item_email_uidx';

  IF v_index_oid IS NOT NULL THEN
    SELECT pg_get_expr(i.indpred, i.indrelid), pg_get_expr(i.indexprs, i.indrelid)
    INTO v_predicate, v_expression
    FROM pg_index i
    WHERE i.indexrelid = v_index_oid AND i.indrelid = v_table;

    -- If this is still the historical global index, replace it transactionally.
    -- If it is already the desired partial index, leave it untouched for reruns.
    IF v_predicate IS NULL
       AND regexp_replace(lower(coalesce(v_expression, '')), '\s+', '', 'g') IN (
         'lower(recipient_email)',
         'lower(btrim(recipient_email))'
       ) THEN
      EXECUTE 'DROP INDEX public.patient_evolution_share_grants_item_email_uidx';
      v_index_oid := NULL;
    END IF;
  END IF;

  IF to_regclass('public.patient_evolution_share_grants_item_email_uidx') IS NULL THEN
    EXECUTE $ddl$
      CREATE UNIQUE INDEX patient_evolution_share_grants_item_email_uidx
      ON public.patient_evolution_share_grants (
        timeline_item_id,
        lower(btrim(recipient_email))
      )
      WHERE status = 'ACTIVE'
    $ddl$;
  END IF;
END
$replace_index$;

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

  SELECT * INTO v_contact
  FROM public.patient_care_network_contacts
  WHERE id = p_care_network_contact_id
    AND clinic_id = p_clinic_id
    AND patient_id = p_patient_id
    AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CARE_NETWORK_CONTACT_NOT_FOUND'; END IF;

  v_email := nullif(lower(btrim(coalesce(v_contact.email, ''))), '');
  IF v_email IS NULL THEN RAISE EXCEPTION 'CARE_NETWORK_CONTACT_EMAIL_REQUIRED'; END IF;

  -- Serialize the exact authorization scope. This works together with the
  -- ACTIVE-only unique index and makes concurrent explicit shares converge.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || v_email, 0));

  SELECT id INTO v_account_id
  FROM public.external_professional_accounts
  WHERE normalized_email = v_email;

  -- Only the current ACTIVE epoch may be updated. REVOKED epochs are never
  -- selected, mutated or reactivated by this write path.
  SELECT * INTO v_grant
  FROM public.patient_evolution_share_grants
  WHERE timeline_item_id = p_item_id
    AND lower(btrim(recipient_email)) = v_email
    AND status = 'ACTIVE'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant.id IS NOT NULL THEN
    UPDATE public.patient_evolution_share_grants
    SET recipient_email = v_email,
        care_network_contact_id = v_contact.id,
        external_account_id = coalesce(external_account_id, v_account_id),
        can_comment = coalesce(p_can_comment, false),
        authorization_statement_version = p_authorization_statement_version,
        authorization_declared_by = p_actor_id,
        authorization_declared_at = v_now,
        updated_at = v_now
    WHERE id = v_grant.id
    RETURNING * INTO v_grant;
  ELSE
    -- A new explicit share is a new authorization epoch. Historical VIEWED
    -- state/comments remain attached to the prior revoked grant_id.
    INSERT INTO public.patient_evolution_share_grants (
      public_id,
      timeline_item_id,
      clinic_id,
      patient_id,
      recipient_email,
      status,
      purpose,
      authorization_statement_version,
      authorization_declared_by,
      authorization_declared_at,
      created_by_user_id,
      created_at,
      updated_at,
      care_network_contact_id,
      external_account_id,
      can_comment,
      first_viewed_at,
      last_viewed_at,
      view_count,
      revoked_at,
      revoked_by_user_id,
      revocation_reason
    ) VALUES (
      gen_random_uuid(),
      p_item_id,
      p_clinic_id,
      p_patient_id,
      v_email,
      'ACTIVE',
      'CONTINUITY_OF_CARE',
      p_authorization_statement_version,
      p_actor_id,
      v_now,
      p_actor_id,
      v_now,
      v_now,
      v_contact.id,
      v_account_id,
      coalesce(p_can_comment, false),
      NULL,
      NULL,
      0,
      NULL,
      NULL,
      NULL
    )
    RETURNING * INTO v_grant;
  END IF;

  RETURN jsonb_build_object(
    'id', v_grant.id,
    'publicId', v_grant.public_id,
    'recipientEmail', v_grant.recipient_email,
    'status', v_grant.status,
    'canComment', v_grant.can_comment,
    'careNetworkContactId', v_grant.care_network_contact_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,boolean,text)
  TO service_role;

COMMENT ON FUNCTION public.upsert_patient_evolution_share_grant_v2(uuid,uuid,uuid,uuid,uuid,boolean,text) IS
  'Creates a new authorization epoch when no ACTIVE grant exists. REVOKED grants remain immutable historical records and are never reactivated.';

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
