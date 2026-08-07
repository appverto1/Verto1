import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const server = read('server.ts');
const sessionMode = read('src/components/SessionMode.tsx');
const patientDetail = read('src/components/PatientDetailView.tsx');
const settingsPanel = read('src/components/ClinicGlobalSettingsPanel.tsx');
const settingsRoutes = read('services/clinicAppointmentPolicyRoutes.ts');
const noShowService = read('services/appointmentNoShowService.ts');
const dataService = read('src/services/dataService.ts');
const migration = read('supabase/migrations/20260807010000_session_completion_and_no_show_policy.sql');

// The frontend has one canonical close command, including sessions with no ABA goals.
assert.match(sessionMode, /dataService\.completeAbaSession\(sessionId/);
assert.match(sessionMode, /&& !showSessionSummary/);
assert.match(sessionMode, /Nenhuma meta trabalhada nesta sessão/);
assert.match(sessionMode, /ATTENDED[\s\S]*LATE[\s\S]*PARTIAL[\s\S]*NO_SHOW/);
assert.match(sessionMode, /endedAt,\s*createdAt: endedAt,/);
assert.match(server, /createdAt: endedAt/);
assert.doesNotMatch(patientDetail, /showSessionEndConfirm/);

// Completion is atomic and the legacy PATCH route cannot independently mark a session completed.
assert.match(server, /app\.post\('\/api\/aba\/sessions\/:sessionId\/complete'/);
assert.match(server, /complete_aba_session_atomic_v1/);
assert.match(server, /code: 'USE_ATOMIC_SESSION_COMPLETION'/);
assert.match(server, /const attended = \['ATTENDED', 'LATE', 'PARTIAL'\]\.includes\(attendanceStatus\)/);
assert.match(server, /if \(attended\) \{[\s\S]*runTissPipelineForAppointment/);
assert.match(server, /\? 'NOT_BILLABLE'[\s\S]*: 'PENDING_REVIEW'/);

// No-show policy is tenant configurable, bounded, server-side and race-safe.
assert.match(settingsPanel, /Política de ausência e falta/);
assert.match(settingsPanel, /min=\{5\}/);
assert.match(settingsPanel, /max=\{180\}/);
assert.match(settingsRoutes, /no_show_tolerance_minutes/);
assert.match(settingsRoutes, /set_clinic_appointment_policy_v2/);
assert.match(noShowService, /classify_overdue_appointments_no_show_v1/);
assert.match(noShowService, /cron\.schedule\([\s\S]*'\* \* \* \* \*'/);
assert.match(migration, /no_show_tolerance_minutes between 5 and 180/);
assert.match(migration, /for update of appointment skip locked/i);
assert.match(migration, /appointment\.no_show_review_required_at is null/);
assert.match(migration, /no_show_reopened_at \+ interval '15 minutes'/);
assert.match(migration, /v_summary_id := 'summary-' \|\| p_session_id/);
assert.match(migration, /'therapistId', coalesce\(nullif\(v_session\.therapist_id/);
assert.match(migration, /claim_appointment_for_session_start_v1/);
assert.match(migration, /complete_aba_session_atomic_v1/);
assert.match(migration, /appointment_attendance_audit_events/);

// A late arrival can only be reopened through an audited, idempotent server operation.
assert.match(patientDetail, /APPOINTMENT_NO_SHOW_REOPEN_REQUIRED/);
assert.match(patientDetail, /dataService\.reopenAppointmentNoShow/);
assert.match(patientDetail, /Reabrir e iniciar/);
assert.match(dataService, /\/api\/appointments\/\$\{encodeURIComponent\(String\(appointmentId\)\)\}\/reopen-no-show/);
assert.match(server, /app\.post\('\/api\/appointments\/:appointmentId\/reopen-no-show'/);
assert.match(server, /requireRoles\('coordinator', 'admin', 'owner'\)/);
assert.match(migration, /reopen_appointment_no_show_v1/);
assert.match(migration, /NO_SHOW_REOPEN_IDEMPOTENCY_CONFLICT/);

console.log('sessionCompletionNoShow.regression: ok');
