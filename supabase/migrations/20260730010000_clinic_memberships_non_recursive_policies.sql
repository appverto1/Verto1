-- Replace the recursive clinic_memberships policy with narrow, non-recursive
-- policies. Additive and idempotent; no membership row is modified.

begin;

do $policy_audit$
declare
  unexpected_policies text;
begin
  select string_agg(
    format(
      '%I [cmd=%s roles=%s using=%s check=%s]',
      policyname,
      cmd,
      coalesce(array_to_string(roles, ','), ''),
      coalesce(qual, ''),
      coalesce(with_check, '')
    ),
    E'\n'
    order by policyname
  )
  into unexpected_policies
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'clinic_memberships'
    and policyname not in (
      'clinic_memberships_access',
      'clinic_memberships_select_v2',
      'clinic_memberships_insert_v2',
      'clinic_memberships_update_v2',
      'clinic_memberships_delete_v2'
    );

  if unexpected_policies is not null then
    raise exception 'CLINIC_MEMBERSHIPS_UNKNOWN_POLICIES'
      using detail = unexpected_policies;
  end if;
end;
$policy_audit$;

alter table public.clinic_memberships enable row level security;

drop policy if exists clinic_memberships_access
  on public.clinic_memberships;
drop policy if exists clinic_memberships_select_v2
  on public.clinic_memberships;
drop policy if exists clinic_memberships_insert_v2
  on public.clinic_memberships;
drop policy if exists clinic_memberships_update_v2
  on public.clinic_memberships;
drop policy if exists clinic_memberships_delete_v2
  on public.clinic_memberships;

drop function if exists
  public.clinic_membership_actor_can_manage_v1(uuid, uuid);
drop function if exists
  public.clinic_membership_actor_is_global_v1(uuid);

create or replace function public.clinic_membership_current_actor_is_global_v1()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.users actor
    where actor.id = auth.uid()
      and lower(actor.role) in ('admin', 'owner')
  );
$$;

create or replace function public.clinic_membership_current_actor_can_manage_v1(
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select
    public.clinic_membership_current_actor_is_global_v1()
    or exists (
      select 1
      from public.clinic_memberships manager_membership
      where manager_membership.clinic_id = p_clinic_id
        and manager_membership.user_id = auth.uid()
        and manager_membership.status = 'active'
        and manager_membership.role = 'coordinator'
    );
$$;

revoke all on function
  public.clinic_membership_current_actor_is_global_v1()
  from public, anon;
revoke all on function
  public.clinic_membership_current_actor_can_manage_v1(uuid)
  from public, anon;
grant execute on function
  public.clinic_membership_current_actor_can_manage_v1(uuid)
  to authenticated;

create policy clinic_memberships_select_v2
on public.clinic_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.clinic_membership_current_actor_can_manage_v1(clinic_id)
);

create policy clinic_memberships_insert_v2
on public.clinic_memberships
for insert
to authenticated
with check (
  public.clinic_membership_current_actor_can_manage_v1(clinic_id)
);

create policy clinic_memberships_update_v2
on public.clinic_memberships
for update
to authenticated
using (
  public.clinic_membership_current_actor_can_manage_v1(clinic_id)
)
with check (
  public.clinic_membership_current_actor_can_manage_v1(clinic_id)
);

create policy clinic_memberships_delete_v2
on public.clinic_memberships
for delete
to authenticated
using (
  public.clinic_membership_current_actor_can_manage_v1(clinic_id)
);

notify pgrst, 'reload schema';

commit;
