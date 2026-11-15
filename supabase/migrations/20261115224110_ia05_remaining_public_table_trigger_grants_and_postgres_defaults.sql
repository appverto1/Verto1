-- IA-05 complementary least privilege: remove table TRIGGER privilege from
-- untrusted roles on remaining public tables; prevent reintroduction by
-- postgres' public-schema default table ACL. Existing triggers and all DML
-- permissions stay untouched. Staging baseline audited on 2026-11-15.
DO $ia05_table_grants$
DECLARE
  v_table record;
  v_count integer;
  v_anon integer;
  v_auth integer;
  v_service integer;
  v_links integer;
BEGIN
  SELECT count(*),
    count(*) FILTER (WHERE has_table_privilege('anon',c.oid,'TRIGGER')),
    count(*) FILTER (WHERE has_table_privilege('authenticated',c.oid,'TRIGGER')),
    count(*) FILTER (WHERE has_table_privilege('service_role',c.oid,'TRIGGER'))
  INTO v_count,v_anon,v_auth,v_service
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF v_count <> 374 OR v_anon <> 120 OR v_auth <> 140 THEN
    RAISE EXCEPTION 'IA05_REMAINING_TABLE_TRIGGER_BASELINE_DRIFT:total=% anon=% auth=%',v_count,v_anon,v_auth;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (has_table_privilege('anon',c.oid,'TRIGGER')
        OR has_table_privilege('authenticated',c.oid,'TRIGGER'))
      AND pg_catalog.pg_get_userbyid(c.relowner)<>'postgres'
  ) THEN
    RAISE EXCEPTION 'IA05_TABLE_OWNER_DRIFT';
  END IF;

  SELECT count(DISTINCT grants.grantee) INTO v_count
  FROM pg_catalog.pg_default_acl def
  JOIN pg_catalog.pg_namespace n ON n.oid=def.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(def.defaclacl) grants
  WHERE n.nspname='public' AND def.defaclrole='postgres'::regrole
    AND def.defaclobjtype='r'
    AND grants.privilege_type='TRIGGER'
    AND grants.grantee IN ('anon'::regrole,'authenticated'::regrole);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'IA05_POSTGRES_DEFAULT_ACL_BASELINE_DRIFT:%',v_count;
  END IF;

  SELECT count(*) INTO v_links FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal;

  FOR v_table IN
    SELECT c.oid,c.relname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (has_table_privilege('anon',c.oid,'TRIGGER')
        OR has_table_privilege('authenticated',c.oid,'TRIGGER'))
    ORDER BY c.oid
  LOOP
    EXECUTE format('REVOKE TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',v_table.relname);
    IF has_table_privilege('anon',v_table.oid,'TRIGGER')
       OR has_table_privilege('authenticated',v_table.oid,'TRIGGER') THEN
      RAISE EXCEPTION 'IA05_REMAINING_TABLE_GRANT_REVOKE_FAILED:%',v_table.relname;
    END IF;
  END LOOP;

  -- Only the default table privilege TRIGGER changes, never DML grants.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRIGGER ON TABLES FROM PUBLIC, anon, authenticated';

  SELECT count(*) FILTER(WHERE has_table_privilege('anon',c.oid,'TRIGGER')),
         count(*) FILTER(WHERE has_table_privilege('authenticated',c.oid,'TRIGGER')),
         count(*) FILTER(WHERE has_table_privilege('service_role',c.oid,'TRIGGER'))
  INTO v_anon,v_auth,v_count
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF v_anon <> 0 OR v_auth <> 0 OR v_count <> v_service THEN
    RAISE EXCEPTION 'IA05_TABLE_GRANT_POSTCHECK:anon=% auth=% service_before=% service_after=%',v_anon,v_auth,v_service,v_count;
  END IF;

  SELECT count(DISTINCT grants.grantee) INTO v_count
  FROM pg_catalog.pg_default_acl def
  JOIN pg_catalog.pg_namespace n ON n.oid=def.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(def.defaclacl) grants
  WHERE n.nspname='public' AND def.defaclrole='postgres'::regrole
    AND def.defaclobjtype='r'
    AND grants.privilege_type='TRIGGER'
    AND grants.grantee IN ('anon'::regrole,'authenticated'::regrole);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'IA05_DEFAULT_TABLE_TRIGGER_STILL_GRANTED:%',v_count;
  END IF;

  SELECT count(*) INTO v_count FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal;
  IF v_count <> v_links THEN
    RAISE EXCEPTION 'IA05_EXISTING_TRIGGER_BINDING_CHANGED:%:%',v_links,v_count;
  END IF;
END
$ia05_table_grants$;
