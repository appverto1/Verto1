-- #256 second forward-only hardening after post-migration ACL verification.
-- Server-owned invitation authority must not depend on RLS alone for anonymous DML.
-- Rollback classification: SECURITY_AUTHORITY_HARDENING / forward-only.

begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.invitations
  from anon;

grant select
  on table public.invitations
  to anon;

commit;
