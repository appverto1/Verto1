-- Hardening for operational closure check materialization.
-- Additive only: keeps the module as pre-billing/conference.

create unique index if not exists idx_appointment_closure_checks_org_appointment_conflict
  on public.appointment_closure_checks(organization_id, appointment_id);

alter table public.appointment_closure_audit_logs
  drop constraint if exists appointment_closure_audit_logs_action_check;

alter table public.appointment_closure_audit_logs
  add constraint appointment_closure_audit_logs_action_check
  check (action in (
    'CHECK_GENERATED',
    'CHECK_REGENERATED',
    'ISSUE_RESOLVED',
    'STATUS_CHANGED',
    'MANUAL_OVERRIDE',
    'MARKED_NOT_BILLABLE',
    'VIEWED_DETAIL',
    'EXPORTED',
    'CONFERENCE_VIEWED',
    'CONFERENCE_FILTERED',
    'EXPORT_GENERATED',
    'EXPORT_FAILED',
    'SESSION_DETAIL_VIEWED',
    'CHECKLIST_OPENED',
    'PERIOD_REVALIDATED',
    'REVALIDATED_FROM_CLOSURE',
    'REVALIDATED_FROM_CONFERENCE',
    'CONFERENCE_STATUS_REVIEWED',
    'CONFERENCE_STATUS_EXPORTED',
    'CONFERENCE_STATUS_REOPENED'
  ));
