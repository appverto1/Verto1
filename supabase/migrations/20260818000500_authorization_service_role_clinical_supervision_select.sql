-- Verto authorization service-role clinical supervision read grant
-- Server-side authorization reads clinical_supervision_links to resolve supervised patient scope.
-- RLS remains enabled; no direct anon/authenticated grant is added.

begin;

grant select on table public.clinical_supervision_links to service_role;

commit;
