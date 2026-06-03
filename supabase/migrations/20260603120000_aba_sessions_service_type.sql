-- Persist service type on ABA sessions linked to appointments.

alter table public.aba_sessions
  add column if not exists service_type text;

create index if not exists idx_aba_sessions_org_service_started
  on public.aba_sessions (organization_id, service_type, started_at desc)
  where service_type is not null;
