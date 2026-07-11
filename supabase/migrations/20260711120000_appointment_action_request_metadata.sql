-- Keeps structured portal action details outside the human-facing request note.
-- Existing rows remain readable through the legacy parser in the application.
alter table public.appointment_action_requests
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.appointment_action_requests.metadata is
  'Structured, tenant-scoped operational request metadata such as portal reschedule options.';
