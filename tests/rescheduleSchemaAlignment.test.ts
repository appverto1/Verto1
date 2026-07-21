import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const server = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
const calendar = fs.readFileSync(path.join(root, 'src/components/Calendar.tsx'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721123000_reschedule_approval_schema_alignment.sql'),
  'utf8',
);
const repairMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721203000_reschedule_schema_probe_repair.sql'),
  'utf8',
);
const tasksMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721204000_tasks_contract_alignment.sql'),
  'utf8',
);
const invitationsMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721205000_invitations_contract_alignment.sql'),
  'utf8',
);
const capabilitiesMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721210000_reschedule_schema_capabilities.sql'),
  'utf8',
);
const reconciliationMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721211000_reschedule_appointment_contract_reconciliation.sql'),
  'utf8',
);

const preview = server.slice(
  server.indexOf('const buildRescheduleApprovalPreview'),
  server.indexOf('const buildPortalRescheduleDateWindow'),
);
const approvalRoute = server.slice(
  server.indexOf("app.post('/api/appointments/action-requests/:requestId/approve'"),
  server.indexOf("app.post('/api/appointments/action-requests/:requestId/reject'"),
);
const balanceReader = server.slice(
  server.indexOf('async function fetchPatientTissAuthorizationBalances'),
  server.indexOf('async function listAppointmentTissAuthorizationOptionsForBilling'),
);
const teamMirror = server.slice(
  server.indexOf('async function syncAppointmentProfessionalsMirrorRows'),
  server.indexOf('function normalizeBillingServiceMatchKey'),
);

test('canonical reschedule migration aligns schedule and confirmation columns before rebuilding RPCs', () => {
  assert.match(migration, /add column if not exists scheduled_start_at timestamptz/);
  assert.match(migration, /add column if not exists scheduled_end_at timestamptz/);
  assert.match(migration, /add column if not exists patient_confirmation_status text/);
  assert.match(migration, /to_jsonb\(v_appointment\) ->> 'patient_confirmation_status'/);
  assert.doesNotMatch(migration, /v_appointment\.patient_confirmation_status/);
  assert.match(migration, /'compatible', true,[\s\S]*?'schema_version', '20260721123000'/);
  assert.match(server, /validateCriticalAppointmentActionResolutionSchema/);
  assert.match(server, /APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION/);
  assert.match(migration, /update public\.appointments[\s\S]*?scheduled_start_at = p_scheduled_start/);
  assert.doesNotMatch(migration, /insert into public\.appointments/);
});

test('atomic approval validates financial context and preserves the same appointment', () => {
  assert.match(migration, /from public\.appointment_billing_contexts[\s\S]*?for update/);
  assert.match(migration, /from public\.patient_payer_authorizations[\s\S]*?for update/);
  assert.match(migration, /FINANCIAL_AUTHORIZATION_EXPIRED/);
  assert.match(migration, /FINANCIAL_AUTHORIZATION_NO_BALANCE/);
  assert.match(migration, /commitment_candidates[\s\S]*?group by appointment_id/);
  assert.match(migration, /timezone\(v_timezone, p_scheduled_start\)::date/);
  assert.match(migration, /FINANCIAL_PROFESSIONAL_REVIEW_REQUIRED/);
  assert.match(migration, /confirmationReset', true/);
  assert.match(migration, /source_payload = coalesce\(source_payload/);
});

test('team mirror no longer depends on the missing partial conflict target', () => {
  assert.doesNotMatch(migration, /on conflict \(appointment_id, professional_id\)/i);
  assert.match(migration, /update public\.appointment_professionals/);
  assert.match(migration, /select ap\.id into v_team_member_id[\s\S]*?if v_team_member_id is not null then[\s\S]*?else[\s\S]*?insert into public\.appointment_professionals/);
  assert.match(teamMirror, /select\('id,professional_id,professional_name,role,created_at'\)/);
  assert.match(teamMirror, /\.upsert\(rows, \{ onConflict: 'id' \}\)/);
  assert.match(teamMirror, /const staleIds/);
});

test('availability resolves names and rooms in batches and blocks unconfirmed finance', () => {
  assert.match(preview, /Promise\.all\(\[[\s\S]*?professional_profiles[\s\S]*?fetchConflictRooms[\s\S]*?fetchAppointmentBillingContextRow[\s\S]*?appointment_action_requests/);
  assert.match(preview, /roomSpecialtyName/);
  assert.match(preview, /roomDisplayName/);
  assert.match(preview, /Profissional não identificado/);
  assert.match(preview, /FINANCIAL_REVIEW_REQUIRED/);
  assert.match(preview, /approvalAllowed/);
  assert.match(preview, /professionalAlternativeEligible/);
  assert.match(preview, /roomAlternativeEligible/);
  assert.match(preview, /allowedProfessionalIds/);
  assert.doesNotMatch(preview, /for \(const option[\s\S]*?await supabase/);
});

test('authorization balance query uses canonical schedule columns only', () => {
  assert.match(balanceReader, /scheduled_at,scheduled_start_at,scheduled_end_at/);
  assert.doesNotMatch(balanceReader, /scheduled_start_at,date/);
  assert.doesNotMatch(balanceReader, /appointment\?\.date/);
});

test('schema mismatch degrades only reschedule routes and no longer crashes Railway startup', () => {
  assert.match(server, /const refreshAppointmentActionResolutionSchema/);
  assert.match(server, /const requireAppointmentActionResolutionSchema/);
  assert.match(server, /RESCHEDULE_SCHEMA_MIGRATION_REQUIRED/);
  assert.match(server, /temporariamente indisponível durante uma atualização técnica/);
  assert.match(server, /await validateCriticalAppointmentActionResolutionSchema\(\)/);
  assert.match(server, /Remarcações em modo degradado/);
  assert.doesNotMatch(server, /Schema crítico de remarcações incompatível[\s\S]*?throw new Error/);
  assert.match(server, /action-requests\/:requestId\/availability[\s\S]*?requireAppointmentActionResolutionSchema/);
  assert.match(server, /action-requests\/:requestId\/approve[\s\S]*?requireAppointmentActionResolutionSchema/);
});

test('approval route uses v2 RPC, typed conflicts and persisted readback', () => {
  assert.match(approvalRoute, /approve_appointment_reschedule_v2/);
  assert.match(migration, /approvedOptionIndex[\s\S]*?approvedStart[\s\S]*?approvedEnd/);
  assert.match(approvalRoute, /PROFESSIONAL_CONFLICT/);
  assert.match(approvalRoute, /ROOM_CONFLICT/);
  assert.match(approvalRoute, /FINANCIAL_REVIEW_REQUIRED/);
  assert.match(approvalRoute, /RESCHEDULE_APPROVAL_SCHEMA_INCOMPATIBLE/);
  assert.match(approvalRoute, /const confirmedAppointment/);
  assert.match(approvalRoute, /appointmentScheduleMatches\(confirmedAppointment/);
});

test('calendar presents real assignment labels and keeps invalid combinations disabled', () => {
  assert.match(calendar, /assignment\.roomDisplayName \|\| assignment\.roomName/);
  assert.match(calendar, /selectedRescheduleAssignmentIsApprovable/);
  assert.match(calendar, /Profissional, sala, guia, autorização e saldo foram revalidados/);
  assert.match(calendar, /!selectedRescheduleAssignmentIsApprovable \|\| rescheduleApprovalNeedsFinancialReview/);
  assert.doesNotMatch(calendar, /window\.location\.reload/);
});


test('repair migration is self-contained and exposes server-only probes', () => {
  assert.match(repairMigration, /add column if not exists scheduled_start_at timestamptz/);
  assert.match(repairMigration, /create or replace function public\.approve_appointment_reschedule_v2/);
  assert.match(repairMigration, /create or replace function public\.get_reschedule_schema_version\(\)/);
  assert.match(repairMigration, /select '20260721123000'::text/);
  assert.match(repairMigration, /revoke all on function public\.get_reschedule_schema_version\(\) from public, anon, authenticated/);
  assert.match(repairMigration, /grant execute on function public\.get_reschedule_schema_version\(\) to service_role/);
  assert.match(repairMigration, /create or replace function public\.get_verto_critical_schema_status\(\)/);
  assert.match(repairMigration, /notify pgrst, 'reload schema'/);
});

test('schema capability probe separates availability, approval, optional and legacy fields', () => {
  assert.match(capabilitiesMigration, /'availability_columns'/);
  assert.match(capabilitiesMigration, /'approval_columns'/);
  assert.match(capabilitiesMigration, /'optional_columns'/);
  assert.match(capabilitiesMigration, /'legacy_columns'/);
  assert.match(capabilitiesMigration, /revoke all on function public\.get_verto_critical_schema_status\(\) from public, anon, authenticated/);
  assert.match(capabilitiesMigration, /grant execute on function public\.get_verto_critical_schema_status\(\) to service_role/);
  assert.match(reconciliationMigration, /add column if not exists patient_confirmation_status text/);
  assert.match(reconciliationMigration, /add column if not exists source_payload jsonb not null default '\{\}'::jsonb/);
  assert.match(reconciliationMigration, /add column if not exists clinic_id uuid references public\.clinics/);
  assert.match(reconciliationMigration, /add column if not exists patient_id uuid references public\.patients/);
  assert.match(reconciliationMigration, /from public\.appointment_action_requests as request/);
  assert.match(reconciliationMigration, /having count\(distinct request\.organization_id\) = 1/);
  assert.match(reconciliationMigration, /to_jsonb\(appointment\) ->> 'duration_minutes'/);
  assert.doesNotMatch(reconciliationMigration, /\bdelete from\b|\btruncate\b|\bdrop column\b/i);
});

test('tasks and invitations alignment migrations only add confirmed current fields', () => {
  assert.match(tasksMigration, /add column if not exists max_score integer/);
  assert.match(tasksMigration, /add column if not exists is_active boolean/);
  assert.match(tasksMigration, /add column if not exists deleted_at timestamptz/);
  assert.match(tasksMigration, /tasks_max_score_range/);
  assert.doesNotMatch(tasksMigration, /drop column|delete from|truncate/i);

  assert.match(invitationsMigration, /add column if not exists clinic_name text/);
  assert.match(invitationsMigration, /add column if not exists invited_by text/);
  assert.match(invitationsMigration, /add column if not exists accepted_at timestamptz/);
  assert.match(invitationsMigration, /add column if not exists canceled_at timestamptz/);
  assert.match(invitationsMigration, /add column if not exists canceled_by text/);
  assert.doesNotMatch(invitationsMigration, /drop column|delete from|truncate/i);
});

test('frontend explains known schema maintenance without exposing database details', () => {
  assert.match(calendar, /Remarcação temporariamente indisponível/);
  assert.match(calendar, /Nenhuma solicitação foi perdida/);
  assert.doesNotMatch(calendar, /Supabase|migration|service_role/);
  assert.match(calendar, /forceSchemaCheck: rescheduleAvailabilityNonce > 0/);
  assert.match(calendar, /approvalSchemaReady/);
});
