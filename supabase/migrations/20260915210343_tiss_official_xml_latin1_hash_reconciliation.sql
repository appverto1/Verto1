-- Issue #170 / H29: reconcile official TISS XML hashes with canonical ISO-8859-1 bytes.
-- Forward-only: no historical XML/document rows are rewritten.

do $migration$
declare
  v_create regprocedure := 'public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid)'::regprocedure;
  v_reissue regprocedure := 'public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure;
  v_create_def text;
  v_reissue_def text;
  v_create_acl aclitem[];
  v_reissue_acl aclitem[];
  v_create_old constant text := $match$if p_xml_hash <> encode(extensions.digest(p_xml_content::text, 'sha256'::text), 'hex') then$match$;
  v_create_new constant text := $match$if p_xml_hash <> encode(extensions.digest(convert_to(p_xml_content, 'LATIN1'), 'sha256'::text), 'hex') then$match$;
  v_reissue_old constant text := $match$if encode(extensions.digest(convert_to(v_xml_content,'UTF8'),'sha256'),'hex')<>v_xml_hash then$match$;
  v_reissue_new constant text := $match$if encode(extensions.digest(convert_to(v_xml_content,'LATIN1'),'sha256'),'hex')<>v_xml_hash then$match$;
begin
  select pg_get_functiondef(p.oid), p.proacl
    into v_create_def, v_create_acl
  from pg_proc p where p.oid = v_create;

  select pg_get_functiondef(p.oid), p.proacl
    into v_reissue_def, v_reissue_acl
  from pg_proc p where p.oid = v_reissue;

  if v_create_def is null or v_reissue_def is null then
    raise exception 'TISS_LATIN1_HASH_REQUIRED_FUNCTION_MISSING';
  end if;

  if (length(v_create_def) - length(replace(v_create_def, v_create_old, ''))) / length(v_create_old) <> 1 then
    raise exception 'TISS_LATIN1_HASH_CREATE_FUNCTION_DRIFT';
  end if;
  if (length(v_reissue_def) - length(replace(v_reissue_def, v_reissue_old, ''))) / length(v_reissue_old) <> 1 then
    raise exception 'TISS_LATIN1_HASH_REISSUE_FUNCTION_DRIFT';
  end if;

  execute replace(v_create_def, v_create_old, v_create_new);
  execute replace(v_reissue_def, v_reissue_old, v_reissue_new);

  if (select p.proacl from pg_proc p where p.oid = v_create) is distinct from v_create_acl then
    raise exception 'TISS_LATIN1_HASH_CREATE_GRANTS_CHANGED';
  end if;
  if (select p.proacl from pg_proc p where p.oid = v_reissue) is distinct from v_reissue_acl then
    raise exception 'TISS_LATIN1_HASH_REISSUE_GRANTS_CHANGED';
  end if;
end;
$migration$;

comment on function public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb) is
  'Service-role-only immutable TISS reissue boundary; XML hash validation uses canonical ISO-8859-1 bytes.';
