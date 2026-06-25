import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const patientDashboardCode = readFileSync(join(root, 'src/components/PatientDashboard.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const serviceWorkerCode = readFileSync(join(root, 'public/sw.js'), 'utf8');
const pushServiceCode = readFileSync(join(root, 'services/pushNotificationService.ts'), 'utf8');
const cronServiceCode = readFileSync(join(root, 'services/cronService.ts'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260529110000_appointment_confirmation_signature.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('migration creates action requests, signatures, audit logs, indexes and RLS', () => {
  assert.match(migrationCode, /create table if not exists public\.appointment_action_requests/);
  assert.match(migrationCode, /create table if not exists public\.session_signatures/);
  assert.match(migrationCode, /create table if not exists public\.appointment_status_audit_logs/);
  assert.match(migrationCode, /idx_appointment_action_requests_appointment_status/);
  assert.match(migrationCode, /idx_session_signatures_appointment_status/);
  assert.match(migrationCode, /idx_appointment_status_audit_logs_appointment_performed/);
  assert.match(migrationCode, /alter table public\.appointment_action_requests enable row level security/);
  assert.match(migrationCode, /alter table public\.session_signatures enable row level security/);
  assert.match(migrationCode, /alter table public\.appointment_status_audit_logs enable row level security/);
  assert.match(migrationCode, /RESCHEDULE_REQUESTED/);
  assert.match(migrationCode, /CANCEL_REQUESTED/);
});

test('portal endpoints are authenticated, rate limited and use explicit selects', () => {
  for (const marker of [
    "app.get('/api/portal/appointments'",
    "app.get('/api/portal/appointments/:appointmentId'",
    "app.post('/api/portal/appointments/:appointmentId/confirm'",
    "app.post('/api/portal/appointments/:appointmentId/request-reschedule'",
    "app.post('/api/portal/appointments/:appointmentId/request-cancel'",
    "app.post('/api/portal/sessions/:sessionId/sign'",
    "app.get('/api/appointments/:appointmentId/action-requests'",
    "app.post('/api/appointments/action-requests/:requestId/approve'",
    "app.post('/api/appointments/action-requests/:requestId/reject'"
  ]) {
    const start = serverCode.indexOf(marker);
    assert.ok(start >= 0, `${marker} deve existir.`);
    const signature = serverCode.slice(start, start + 260);
    assert.match(signature, /checkAuth/, `${marker} deve exigir autenticacao.`);
  }
  assert.match(serverCode, /portalActionLimiter, checkAuth/);
  assert.match(serverCode, /const PORTAL_APPOINTMENT_SELECT = \[/);
  assert.match(serverCode, /const APPOINTMENT_ACTION_REQUEST_SELECT = \[/);
  assert.match(serverCode, /const SESSION_SIGNATURE_SELECT = \[/);
  const portalSlice = serverCode.slice(serverCode.indexOf('const PORTAL_SESSION_CONSENT_TEXT_VERSION'), serverCode.indexOf("app.post('/api/calendar/events/check-conflicts'"));
  assert.doesNotMatch(portalSlice, /\.select\('\*'\)/);
  assert.match(portalSlice, /canPortalUserAccessPatient/);
  assert.match(portalSlice, /writeAppointmentStatusAuditLog/);
});

test('closure reads responsible signatures and action states affect readiness', () => {
  assert.match(serverCode, /\.from\('session_signatures'\)[\s\S]*?\.select\(SESSION_SIGNATURE_SELECT\)/m);
  assert.match(serverCode, /signature:\s*\(context as any\)\.signature/);
  assert.match(readFileSync(join(root, 'src/services/closureReadinessEngine.ts'), 'utf8'), /reschedule_requested/);
  assert.match(readFileSync(join(root, 'src/services/closureReadinessEngine.ts'), 'utf8'), /cancel_requested/);
});

test('notifications open app without native browser action buttons', () => {
  assert.doesNotMatch(serviceWorkerCode, /actions/);
  assert.doesNotMatch(serviceWorkerCode, /notification_action/);
  assert.doesNotMatch(serviceWorkerCode, /persistAppointmentResponse/);
  assert.doesNotMatch(serviceWorkerCode, /\/api\/notifications\/appointments\/.*\/respond/);
  assert.match(serviceWorkerCode, /focusOrOpen\(targetUrl\)/);
  assert.match(pushServiceCode, /buildPatientReminderNotificationPayload/);
  assert.match(cronServiceCode, /buildPatientReminderNotificationPayload/);
  assert.doesNotMatch(pushServiceCode, /Toque para abrir a Verto/);
  assert.doesNotMatch(cronServiceCode, /Toque para abrir a Verto/);
  assert.doesNotMatch(pushServiceCode, /\.select\('\*'\)/);
  assert.doesNotMatch(cronServiceCode, /\.select\('\*'\)/);
  assert.match(serverCode, /source === 'push_notification_action'[\s\S]*?Ação de notificação expirada/m);
});

test('appointment reminder popup is clinic-branded and neutral', () => {
  assert.match(serverCode, /clinicName/);
  assert.match(serverCode, /clinicLogoUrl/);
  assert.match(serverCode, /\.from\('clinics'\)/);
  assert.match(serverCode, /read\('id,name,display_name,legal_name,logo_url'\)/);
  assert.match(serverCode, /clinic\?\.display_name \|\| clinic\?\.legal_name \|\| clinic\?\.name/);
  assert.match(appCode, /buildPatientReminderModalViewModel/);
  assert.match(appCode, /appointmentConfirmationViewModel\?\.brandName/);
  assert.match(appCode, /appointmentConfirmationViewModel\?\.brandLogoUrl/);
  assert.match(appCode, /border-b border-slate-100 bg-slate-50/);
  assert.doesNotMatch(appCode, /Lembrete de Consulta - Verto/);
  assert.doesNotMatch(appCode, /bg-gradient-to-br from-violet-600 via-fuchsia-500 to-blue-500/);
});

test('portal appointment response buttons keep requests pending for clinic decision', () => {
  const portalActionsSlice = serverCode.slice(
    serverCode.indexOf("app.post('/api/portal/appointments/:appointmentId/confirm'"),
    serverCode.indexOf("app.post('/api/portal/sessions/:sessionId/sign'")
  );
  assert.match(portalActionsSlice, /status:\s*'confirmed'/);
  assert.doesNotMatch(portalActionsSlice, /status:\s*'reschedule'/);
  assert.doesNotMatch(portalActionsSlice, /status:\s*'cancelled'/);
  assert.match(portalActionsSlice, /patient_confirmation_status:\s*'confirmed'/);
  assert.match(portalActionsSlice, /patient_confirmation_status:\s*'RESCHEDULE_REQUESTED'/);
  assert.match(portalActionsSlice, /patient_confirmation_status:\s*'CANCEL_REQUESTED'/);
  assert.match(portalActionsSlice, /patient_response:\s*'cancel_requested'/);
  assert.doesNotMatch(portalActionsSlice, /patient_response:\s*'cancelled'/);
  assert.match(serverCode, /hasMissingFinancialSchema\(error\) \|\| isMissingRelationError\(error\)/);
});

test('agenda recebe status canonico de resposta do paciente', () => {
  assert.match(serverCode, /const CALENDAR_EVENT_SELECT = \[[\s\S]*?'patient_confirmation_status'/);
  assert.match(serverCode, /normalizePatientConfirmationStatusForAgenda/);
  assert.match(serverCode, /patientConfirmationLabel: getPatientConfirmationLabelForAgenda/);
  assert.match(calendarCode, /getAppointmentPatientConfirmationVisualState/);
  assert.match(calendarCode, /detailStatusColor = getAppointmentPatientConfirmationVisualState\(detailEvent\)/);
  assert.match(calendarCode, /Consulta confirmada pelo respons/);
});

test('frontend exposes portal actions and clinic agenda request decisions without technical ids', () => {
  assert.match(dataServiceCode, /async getPortalAppointments/);
  assert.match(dataServiceCode, /async confirmPortalAppointment/);
  assert.match(dataServiceCode, /async requestPortalAppointmentReschedule/);
  assert.match(dataServiceCode, /async requestPortalAppointmentCancel/);
  assert.match(dataServiceCode, /async signPortalSession/);
  assert.match(patientDashboardCode, /Minhas consultas/);
  assert.match(patientDashboardCode, /Confirmar presença/);
  assert.match(patientDashboardCode, /Solicitar remarcação/);
  assert.match(patientDashboardCode, /Solicitar cancelamento/);
  assert.match(patientDashboardCode, /Assinar sessão/);
  assert.match(calendarCode, /actionRequests/);
  assert.match(calendarCode, /approveAppointmentActionRequest/);
  assert.match(calendarCode, /rejectAppointmentActionRequest/);
  assert.match(calendarCode, /Cancelar consulta/);
  assert.match(calendarCode, /Remarcar consulta/);
  assert.match(calendarCode, /Manter horário/);
  assert.doesNotMatch(calendarCode, /Aprovar cancelamento/);
  assert.doesNotMatch(calendarCode, /Recusar/);
  assert.doesNotMatch(patientDashboardCode, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(patientDashboardCode, /PostgREST|Railway|schema cache/i);
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    passed += 1;
    console.log(`ok - ${entry.name}`);
  } catch (error) {
    console.error(`not ok - ${entry.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} appointment confirmation and signature tests passed`);
