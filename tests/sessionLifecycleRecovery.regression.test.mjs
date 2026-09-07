import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const server = read('server.ts');
const dataService = read('src/services/dataService.ts');
const patientDetail = read('src/components/PatientDetailView.tsx');
const sessionMode = read('src/components/SessionMode.tsx');
const lifecycleMigration = read('supabase/migrations/20260905163000_conventional_session_lifecycle.sql');
const noShowMigration = read('supabase/migrations/20260807010000_session_completion_and_no_show_policy.sql');
const monthlyMigration = read('supabase/migrations/20260905101500_monthly_session_patient_billing.sql');
const minUuidFix = read('supabase/migrations/20260905123000_monthly_session_payment_uuid_aggregate_fix.sql');

// P0-A: NO_SHOW stays a guarded clinical state and must be explicitly reopened.
assert.match(server, /code: 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED'/);
assert.match(server, /app\.post\('\/api\/appointments\/:appointmentId\/reopen-no-show'/);
assert.match(noShowMigration, /create or replace function public\.reopen_appointment_no_show_v1/);
assert.match(noShowMigration, /NO_SHOW_REOPENED/);
assert.match(noShowMigration, /no_show_reopened_at/);
assert.match(noShowMigration, /appointment_attendance_audit_events/);

// An already-open ABA SessionMode can recover directly from its linked appointment, without finding it in Agenda.
assert.match(sessionMode, /completionCode === 'APPOINTMENT_NO_SHOW_REOPEN_REQUIRED' && activeAppointmentId/);
assert.match(sessionMode, /dataService\.reopenAppointmentNoShow\(activeAppointmentId/);
assert.match(sessionMode, /calendar\.no_show\.record/);
assert.match(sessionMode, /Reabrir falta e concluir/);
assert.match(sessionMode, /await confirmEndSession\(\)/);
assert.match(dataService, /async reopenAppointmentNoShow\(appointmentId/);


// Agenda is a range-based operational surface; NO_SHOW is not deleted from the list query,
// but an old appointment can be outside the currently requested window. Recovery therefore
// uses the linked appointment id from the ABA session instead of requiring a range search.
const calendarListAt = server.indexOf("app.get('/api/calendar/events'");
const calendarListEnd = server.indexOf("app.get('/api/calendar/events/:eventId/detail'", calendarListAt);
const calendarList = server.slice(calendarListAt, calendarListEnd > calendarListAt ? calendarListEnd : calendarListAt + 9000);
assert.match(calendarList, /\.gte\('scheduled_at', range\.fromIso\)/);
assert.match(calendarList, /\.lte\('scheduled_at', range\.toIso\)/);
assert.ok(!calendarList.includes(".neq('status', 'no_show')"), 'calendar list must not hide NO_SHOW by status');

// The old min(uuid) failure remains fixed and the correction migration is preserved.
assert.doesNotMatch(minUuidFix, /min\s*\(\s*item\.appointment_id\s*\)/i);
assert.match(minUuidFix, /order by[\s\S]*appointment_scheduled_at[\s\S]*limit 1/i);

// P0-B: conventional sessions reuse appointments + notes instead of introducing a second session/finance engine.
assert.match(lifecycleMigration, /ALTER TABLE public\.notes[\s\S]*ADD COLUMN IF NOT EXISTS appointment_id uuid/);
assert.match(lifecycleMigration, /start_conventional_appointment_session_v1/);
assert.match(lifecycleMigration, /complete_conventional_appointment_session_v1/);
assert.match(lifecycleMigration, /appointment_attendance_audit_events/);
assert.match(lifecycleMigration, /status = 'in_progress'/);
assert.match(lifecycleMigration, /actual_start_at = v_started_at/);
assert.match(lifecycleMigration, /status = 'completed'/);
assert.match(lifecycleMigration, /actual_end_at = v_ended_at/);
assert.match(lifecycleMigration, /actual_duration_minutes = ceil/);
assert.match(lifecycleMigration, /source.*'conventional_session'/s);
assert.match(lifecycleMigration, /SECURITY DEFINER/);
assert.match(lifecycleMigration, /REVOKE ALL ON FUNCTION public\.start_conventional_appointment_session_v1[\s\S]*authenticated/);
assert.match(lifecycleMigration, /REVOKE ALL ON FUNCTION public\.complete_conventional_appointment_session_v1[\s\S]*authenticated/);
assert.match(lifecycleMigration, /GRANT EXECUTE ON FUNCTION public\.start_conventional_appointment_session_v1[\s\S]*service_role/);

// Server boundaries are patient + clinic scoped, capability protected and idempotent.
assert.match(server, /\/api\/patients\/:patientId\/conventional-session\/active/);
assert.match(server, /\/api\/patients\/:patientId\/appointments\/:appointmentId\/conventional-session\/start/);
assert.match(server, /\/api\/patients\/:patientId\/appointments\/:appointmentId\/conventional-session\/note/);
assert.match(server, /\/api\/patients\/:patientId\/appointments\/:appointmentId\/conventional-session\/complete/);
assert.match(server, /requireClinicCapability\('session\.start'\)/);
assert.match(server, /requireClinicCapability\('session\.data\.write'\)/);
assert.match(server, /requireClinicCapability\('session\.finish'\)/);
assert.match(server, /checkPatientAccess/);
assert.match(server, /rpc\('start_conventional_appointment_session_v1'/);
assert.match(server, /rpc\('complete_conventional_appointment_session_v1'/);
assert.match(server, /appointmentBelongsToProfessional/);

// Completing the conventional appointment delegates finance to the canonical appointment trigger; no manual charge is created.
const conventionalCompleteAt = server.indexOf("'/api/patients/:patientId/appointments/:appointmentId/conventional-session/complete'");
assert.ok(conventionalCompleteAt > 0);
const conventionalComplete = server.slice(conventionalCompleteAt, conventionalCompleteAt + 6500);
assert.doesNotMatch(conventionalComplete, /create_patient_financial_charge|sync_private_appointment_finance|payment_appointment_items.*insert/i);
assert.match(monthlyMigration, /sync_monthly_session_billing_for_appointment_v1/);
assert.match(monthlyMigration, /create trigger[\s\S]*sync_monthly_session_billing_for_appointment_v1/i);

// Reload restoration comes from persisted appointment timestamps; the timer itself is client-only.
assert.match(dataService, /async getActiveConventionalSession\(patientId/);
assert.match(patientDetail, /dataService\.getActiveConventionalSession\(String\(patient\.id\)\)/);
assert.match(patientDetail, /setInterval\(\(\) => setConventionalSessionNowMs\(Date\.now\(\)\), 1000\)/);
assert.match(patientDetail, /O cronômetro é apenas visual/);
assert.match(patientDetail, /dataService\.startConventionalSession/);
assert.match(patientDetail, /dataService\.saveConventionalSessionNote/);
assert.match(patientDetail, /dataService\.completeConventionalSession/);
assert.match(patientDetail, /Evolução da sessão/);
assert.match(patientDetail, /Finalizar sessão/);

// Maintenance Probe warning was a lexical-scope bug: the top-level mirror now uses an injected callback.
const mirrorStart = server.indexOf('async function syncAppointmentsTableFromClinicState');
const mirrorEnd = server.indexOf('async function ensureAppointmentMirrorForBillingContext', mirrorStart);
const mirrorBlock = server.slice(mirrorStart, mirrorEnd);
assert.match(mirrorBlock, /onAppointmentMirrored\?:/);
assert.match(mirrorBlock, /params\.onAppointmentMirrored/);
assert.doesNotMatch(mirrorBlock, /await flagPendingMaintenanceProbesForAppointment\(/);
assert.match(server, /onAppointmentMirrored: \(context\) => flagPendingMaintenanceProbesForAppointment\(context\)/);

console.log('sessionLifecycleRecovery.regression.test.mjs: ok');
