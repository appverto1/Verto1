-- Verto — hotfix versionado da validação autoritativa de sessão distribuída.
-- Preserva a semântica existente e evita deadlock de promoção FOR SHARE -> UPDATE.

begin;

create or replace function public.runtime_validate_active_session_v2(
  p_user_id text,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if coalesce(btrim(p_user_id), '') = '' then
    return false;
  end if;

  if coalesce(btrim(p_token_hash), '') !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  select true
    into v_valid
  from public.runtime_active_sessions
  where user_id = btrim(p_user_id)
    and token_hash = lower(btrim(p_token_hash))
    and revoked_at is null
    and expires_at > v_now
  for update;

  if coalesce(v_valid, false) then
    update public.runtime_active_sessions
    set last_seen_at = v_now,
        updated_at = v_now
    where user_id = btrim(p_user_id)
      and token_hash = lower(btrim(p_token_hash))
      and revoked_at is null
      and expires_at > v_now
      and last_seen_at < v_now - interval '5 minutes';
  end if;

  return coalesce(v_valid, false);
end;
$$;

revoke all on function public.runtime_validate_active_session_v2(text, text) from public, anon, authenticated;
grant execute on function public.runtime_validate_active_session_v2(text, text) to service_role;

comment on function public.runtime_validate_active_session_v2(text, text) is
  'Valida a sessão autoritativa e toca last_seen_at no máximo a cada 5 minutos, serializando a linha por usuário para evitar deadlock de lock upgrade.';

commit;
