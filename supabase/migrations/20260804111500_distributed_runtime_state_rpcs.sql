-- Verto — Fase 2 de estabilização
-- Operações atômicas para rate limits e leases distribuídos.

begin;

create or replace function public.runtime_rate_limit_increment_v1(
  p_scope text,
  p_key_hash text,
  p_window_ms bigint
)
returns table(total_hits integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window interval;
begin
  if coalesce(btrim(p_scope), '') = '' then
    raise exception 'RUNTIME_RATE_LIMIT_SCOPE_REQUIRED';
  end if;
  if p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'RUNTIME_RATE_LIMIT_KEY_INVALID';
  end if;
  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'RUNTIME_RATE_LIMIT_WINDOW_INVALID';
  end if;

  v_window := make_interval(secs => p_window_ms::double precision / 1000.0);

  return query
  insert into public.runtime_rate_limits as current_limit (
    scope,
    key_hash,
    total_hits,
    reset_at,
    created_at,
    updated_at
  ) values (
    btrim(p_scope),
    p_key_hash,
    1,
    clock_timestamp() + v_window,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (scope, key_hash) do update
  set total_hits = case
        when current_limit.reset_at <= clock_timestamp() then 1
        else current_limit.total_hits + 1
      end,
      reset_at = case
        when current_limit.reset_at <= clock_timestamp() then clock_timestamp() + v_window
        else current_limit.reset_at
      end,
      updated_at = clock_timestamp()
  returning current_limit.total_hits, current_limit.reset_at;
end;
$$;

create or replace function public.runtime_rate_limit_decrement_v1(
  p_scope text,
  p_key_hash text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.runtime_rate_limits
  set total_hits = greatest(0, total_hits - 1),
      updated_at = clock_timestamp()
  where scope = btrim(p_scope)
    and key_hash = p_key_hash
    and reset_at > clock_timestamp();
$$;

create or replace function public.runtime_try_acquire_job_lease_v1(
  p_job_key text,
  p_owner_id text,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired boolean := false;
begin
  if coalesce(btrim(p_job_key), '') = '' or coalesce(btrim(p_owner_id), '') = '' then
    return false;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 3600 then
    return false;
  end if;

  insert into public.runtime_job_leases as lease (
    job_key,
    owner_id,
    acquired_at,
    lease_until,
    updated_at
  ) values (
    btrim(p_job_key),
    btrim(p_owner_id),
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => p_lease_seconds),
    clock_timestamp()
  )
  on conflict (job_key) do update
  set owner_id = excluded.owner_id,
      acquired_at = clock_timestamp(),
      lease_until = excluded.lease_until,
      updated_at = clock_timestamp()
  where lease.lease_until <= clock_timestamp()
     or lease.owner_id = excluded.owner_id
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.runtime_release_job_lease_v1(
  p_job_key text,
  p_owner_id text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.runtime_job_leases
  where job_key = btrim(p_job_key)
    and owner_id = btrim(p_owner_id);
$$;

create or replace function public.runtime_cleanup_distributed_state_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions integer := 0;
  v_limits integer := 0;
  v_leases integer := 0;
begin
  delete from public.runtime_active_sessions
  where expires_at < clock_timestamp() - interval '1 day'
     or revoked_at < clock_timestamp() - interval '1 day';
  get diagnostics v_sessions = row_count;

  delete from public.runtime_rate_limits
  where reset_at < clock_timestamp() - interval '1 hour';
  get diagnostics v_limits = row_count;

  delete from public.runtime_job_leases
  where lease_until < clock_timestamp() - interval '1 hour';
  get diagnostics v_leases = row_count;

  return jsonb_build_object(
    'active_sessions_deleted', v_sessions,
    'rate_limits_deleted', v_limits,
    'job_leases_deleted', v_leases
  );
end;
$$;

revoke all on function public.runtime_rate_limit_increment_v1(text, text, bigint) from public, anon, authenticated;
revoke all on function public.runtime_rate_limit_decrement_v1(text, text) from public, anon, authenticated;
revoke all on function public.runtime_try_acquire_job_lease_v1(text, text, integer) from public, anon, authenticated;
revoke all on function public.runtime_release_job_lease_v1(text, text) from public, anon, authenticated;
revoke all on function public.runtime_cleanup_distributed_state_v1() from public, anon, authenticated;

grant execute on function public.runtime_rate_limit_increment_v1(text, text, bigint) to service_role;
grant execute on function public.runtime_rate_limit_decrement_v1(text, text) to service_role;
grant execute on function public.runtime_try_acquire_job_lease_v1(text, text, integer) to service_role;
grant execute on function public.runtime_release_job_lease_v1(text, text) to service_role;
grant execute on function public.runtime_cleanup_distributed_state_v1() to service_role;

commit;
