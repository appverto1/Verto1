-- #256 invitation authority hardening after AUDIT_FAIL_POS_PRIVILEGE_ESCALATION_CONFUSED_DEPUTY
-- Forward-only, staging-first.
-- Rollback classification: SECURITY_AUTHORITY_HARDENING / do not rollback while the
-- #256 contract relies on invitation rows as server-authoritative acceptance input.

begin;

-- Fail closed instead of inventing a timestamp for an impossible historical row.
-- Existing Verto-Staging evidence before this migration: zero rows with created_at IS NULL.
do $created_at_precondition$
begin
  if exists (
    select 1
    from public.invitations
    where created_at is null
  ) then
    raise exception 'INVITATION_CREATED_AT_NULL_PRECONDITION_FAILED';
  end if;
end
$created_at_precondition$;

alter table public.invitations
  alter column created_at set not null;

-- Invitation mutation is server-owned. Browser sessions keep only the reads already
-- constrained by the existing SELECT RLS policies; privileged server flows keep using
-- service_role and the service-role-only acceptance RPC.
revoke insert, update, delete, truncate, references, trigger
  on table public.invitations
  from authenticated;

grant select
  on table public.invitations
  to authenticated;

drop policy if exists invitations_write_for_manager
  on public.invitations;

commit;
