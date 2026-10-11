begin;
CREATE OR REPLACE FUNCTION public.verto_request_deployment_env_v1()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_claims jsonb;
  v_headers jsonb;
  v_env text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if coalesce(v_claims->>'role', '') <> 'service_role' then
    return null;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  v_env := lower(trim(coalesce(v_headers->>'x-verto-deployment-env', '')));
  if v_env in ('staging','production') then
    return v_env;
  end if;
  return null;
end;
$function$;
NOTIFY pgrst, 'reload schema';
commit;
