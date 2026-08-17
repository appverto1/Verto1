import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const patientDashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const schools = fs.readFileSync('src/components/SchoolsManagement.tsx', 'utf8');
const schoolMeeting = fs.readFileSync('src/components/SchoolMeetingWorkspace.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260816234500_activity_logs_clinical_audit_context.sql', 'utf8');

// Canonical time: DB stores timestamptz plus a timezone snapshot; the UI derives
// one local string from that instant instead of trusting a preformatted server clock.
assert.match(migration, /timezone_snapshot text/);
assert.match(app, /formatActivityLogDateTime/);
assert.match(app, /raw\?\.timezone_snapshot/);
assert.match(app, /new Intl\.DateTimeFormat\('pt-BR',[\s\S]*?timeZone/);
assert.doesNotMatch(app, /time:\s*raw\?\.time\s*\|\|/);
assert.match(coordinator, /log\.timezone_snapshot/);
assert.match(coordinator, /new Intl\.DateTimeFormat\("pt-BR",[\s\S]*?timeZone/);
assert.doesNotMatch(coordinator, /if \(log\.time\) return log\.time/);

// Legacy anamnesis entries had the Railway UTC clock embedded in content. Only
// that redundant suffix is removed; the authoritative timestamp remains intact.
assert.match(migration, /title = 'Ficha de anamnese registrada'/);
assert.match(migration, /regexp_replace/);
assert.doesNotMatch(server, /registrou\/atualizou a ficha de anamnese[^\n]*new Date\(\)\.toLocaleString/);

// Audit context is append-only for sensitive clinical events and cannot be
// bypassed through a direct browser Supabase connection.
assert.match(migration, /immutable_audit boolean not null default false/);
assert.match(migration, /prevent_immutable_activity_log_mutation_v1/);
assert.match(migration, /alter table public\.activity_logs enable row level security/);
assert.match(migration, /revoke all on table public\.activity_logs from anon, authenticated/);
assert.match(migration, /activity_logs_idempotency_key_uidx/);

// Listing files returns metadata only. A signed URL is minted only after an
// audited VIEW/DOWNLOAD action, and access fails closed if the audit cannot be saved.
assert.match(server, /app\.post\('\/api\/patient-files\/:patientId\/:fileId\/access'/);
assert.match(server, /patient_file_viewed/);
assert.match(server, /patient_file_downloaded/);
assert.match(server, /AUDIT_LOG_UNAVAILABLE/);
assert.match(server, /requiresAuditedAccess:\s*true,[\s\S]*?signedUrl:\s*null,[\s\S]*?url:\s*null/);
assert.match(dataService, /async accessPatientFile\(patientId: string, fileId: string, action: 'view' \| 'download'\)/);
assert.match(patientDetail, /accessPatientFile\([^\n]*'view'\)/);
assert.match(patientDetail, /accessPatientFile\([^\n]*'download'\)/);
assert.match(patientDashboard, /accessPatientFile\([^\n]*'view'\)/);
assert.match(schools, /accessPatientFile\([^\n]*'view'\)/);
assert.match(schoolMeeting, /accessPatientFile\([^\n]*'view'\)/);

// File lifecycle and the clinically important session/anamnesis actions have
// structured immutable audit entries with patient/session/resource context.
for (const action of [
  'patient_file_uploaded',
  'patient_file_deleted',
  'patient_anamnesis_updated',
  'anamnesis_template_updated',
  'aba_session_report_viewed',
  'aba_session_document_updated',
  'aba_session_completed',
  'aba_trial_corrected',
  'aba_trial_voided',
  'aba_abc_recorded',
  'aba_abc_complement_added'
]) {
  assert.ok(server.includes(action), `missing audit action: ${action}`);
}
assert.match(server, /resourceType:\s*'patient_file'/);
assert.match(server, /resourceType:\s*'aba_session_report'/);
assert.match(server, /resourceType:\s*'aba_trial_v3'/);
assert.match(server, /timezone:\s*currentClinicTimeZone\(req\.session\.user\)/);
assert.match(server, /immutableAudit:\s*true/);

// Patient-originated file/anamnesis events remain visible to clinic audit users
// instead of being dropped by the patient non-agenda noise filter.
assert.match(server, /patientAuditVisibilityActions = new Set\([\s\S]*?'patient_file_uploaded'[\s\S]*?'patient_anamnesis_updated'/);

console.log('activityLogsClinicalAudit.test.mjs: ok');
