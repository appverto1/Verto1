-- Issue #170 / H31: preserve retry-safety for pre-LATIN1 official documents.
-- New documents still require the canonical LATIN1 hash; historical rows are never rewritten.

do $migration$
declare
  v_create regprocedure := 'public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid)'::regprocedure;
  v_definition text;
  v_acl aclitem[];
  v_old constant text := $match$if p_xml_hash <> encode(extensions.digest(convert_to(p_xml_content, 'LATIN1'), 'sha256'::text), 'hex') then$match$;
  v_new constant text := $match$perform convert_to(p_xml_content, 'LATIN1');

  if exists (
    select 1
    from public.tiss_official_documents d
    where d.organization_id = v_clinic_id
      and d.idempotency_key = p_idempotency_key
      and d.xml_content = p_xml_content
      and d.xml_hash = p_xml_hash
  ) then
    null; -- exact historical replay; existing idempotency checks below remain authoritative.
  elsif p_xml_hash <> encode(extensions.digest(convert_to(p_xml_content, 'LATIN1'), 'sha256'::text), 'hex') then$match$;
begin
  select pg_get_functiondef(p.oid), p.proacl into v_definition, v_acl
  from pg_proc p where p.oid = v_create;

  if v_definition is null then
    raise exception 'TISS_LATIN1_COMPAT_CREATE_FUNCTION_MISSING';
  end if;

  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'TISS_LATIN1_COMPAT_CREATE_FUNCTION_DRIFT';
  end if;

  execute replace(v_definition, v_old, v_new);

  if (select p.proacl from pg_proc p where p.oid = v_create) is distinct from v_acl then
    raise exception 'TISS_LATIN1_COMPAT_CREATE_GRANTS_CHANGED';
  end if;
end;
$migration$;

comment on function public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid) is
  'Creates immutable official TISS XML documents; new hashes use canonical ISO-8859-1 bytes and exact historical idempotent retries remain compatible.';