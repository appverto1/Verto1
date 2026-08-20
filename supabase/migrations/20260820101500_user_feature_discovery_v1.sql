-- Persistent per-user discovery state for product features marked as new.
-- First access is immutable: insert once, read many.

create table if not exists public.user_feature_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null,
  first_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint user_feature_access_feature_key_v1
    check (feature_key ~ '^[a-z0-9_]{1,80}$'),
  constraint user_feature_access_pk_v1 primary key (user_id, feature_key)
);

alter table public.user_feature_access enable row level security;

revoke all on table public.user_feature_access from public, anon, authenticated;
grant select, insert on table public.user_feature_access to authenticated;
grant select, insert on table public.user_feature_access to service_role;

drop policy if exists user_feature_access_select_own_v1 on public.user_feature_access;
create policy user_feature_access_select_own_v1
  on public.user_feature_access
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_feature_access_insert_own_v1 on public.user_feature_access;
create policy user_feature_access_insert_own_v1
  on public.user_feature_access
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- No UPDATE or DELETE policy/grant is intentionally provided. Once a feature is
-- seen, the client cannot make it "new" again by changing or deleting the row.

create or replace function public.mark_user_feature_accessed_v1(
  p_user_id uuid,
  p_feature_key text
)
returns table(feature_key text, first_accessed_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_feature_key text := lower(trim(coalesce(p_feature_key, '')));
begin
  if p_user_id is null then
    raise exception 'USER_FEATURE_ACCESS_USER_REQUIRED';
  end if;
  if v_feature_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'USER_FEATURE_ACCESS_KEY_INVALID';
  end if;

  insert into public.user_feature_access(user_id, feature_key)
  values (p_user_id, v_feature_key)
  on conflict (user_id, feature_key) do nothing;

  return query
  select access_row.feature_key, access_row.first_accessed_at
  from public.user_feature_access access_row
  where access_row.user_id = p_user_id
    and access_row.feature_key = v_feature_key
  limit 1;
end;
$function$;

revoke all on function public.mark_user_feature_accessed_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_user_feature_accessed_v1(uuid, text) to service_role;

comment on table public.user_feature_access is
  'Immutable per-user first-access markers for Verto product discovery badges.';
