begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

-- A view retains table-style ACL entries even though administrative operations
-- have no application role. Do not change SELECT or other runtime grants.
revoke truncate, references, trigger
  on table public.patient_financial_appointment_summaries
  from anon, authenticated;

commit;
