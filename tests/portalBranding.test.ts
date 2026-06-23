import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const patientDashboardCode = readFileSync(join(root, 'src/components/PatientDashboard.tsx'), 'utf8');
const pushServiceCode = readFileSync(join(root, 'services/pushNotificationService.ts'), 'utf8');
const cronServiceCode = readFileSync(join(root, 'services/cronService.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const confirmationRouteSlice = serverCode.slice(
  serverCode.indexOf("app.get('/api/appointments/:appointmentId/confirmation'"),
  serverCode.indexOf('const handleAppointmentStatusUpdate')
);

const portalAppointmentSlice = serverCode.slice(
  serverCode.indexOf('const serializePortalAppointment ='),
  serverCode.indexOf("app.post('/api/portal/sessions/:sessionId/sign'")
);

test('appointment confirmation branding is clinic-first and never falls back to actor clinic settings', () => {
  assert.match(serverCode, /const readClinicBrandingForFamilyView = async/);
  assert.match(serverCode, /\.from\('clinics'\)[\s\S]*?\.select\(columns\)/);
  assert.match(serverCode, /read\('id,name,display_name,legal_name,logo_url'\)/);
  assert.match(serverCode, /clinic\?\.display_name \|\| clinic\?\.legal_name \|\| clinic\?\.name/);
  assert.match(confirmationRouteSlice, /buildFamilyAppointmentDisplayContext/);
  assert.doesNotMatch(confirmationRouteSlice, /actor\?\.clinicSettings\?\.clinicName/);
  assert.doesNotMatch(confirmationRouteSlice, /actor\?\.clinicSettings\?\.clinicLogoUrl/);
});

test('confirmation response exposes safe clinic, patient and professional context', () => {
  assert.match(confirmationRouteSlice, /clinic:\s*displayContext\.clinic/);
  assert.match(confirmationRouteSlice, /patient:\s*displayContext\.patient/);
  assert.match(confirmationRouteSlice, /professionalName:\s*displayContext\.professionalName/);
  assert.match(serverCode, /professionalName:\s*'Profissional a definir'/);
});

test('portal appointment serialization returns branding and action results', () => {
  assert.match(portalAppointmentSlice, /serializePortalAppointmentForFamilyView/);
  assert.match(portalAppointmentSlice, /buildPortalAppointmentActionResult/);
  assert.match(portalAppointmentSlice, /buildActionResultPayload\(\{/);
  assert.match(portalAppointmentSlice, /action:\s*'confirmed_by_family'/);
  assert.match(portalAppointmentSlice, /action:\s*'reschedule_requested_by_family'/);
  assert.match(portalAppointmentSlice, /action:\s*'cancel_requested_by_family'/);
  assert.match(portalAppointmentSlice, /readPersistedAppointmentRows\(\[appointment\.id\]/);
  assert.match(portalAppointmentSlice, /acknowledgePortalAppointmentNotifications/);
});

test('portal appointment actions do not depend on broad selects or false local success', () => {
  assert.doesNotMatch(portalAppointmentSlice, /\.select\(['"]\*['"]\)/);
  assert.match(portalAppointmentSlice, /\.update\(safePatch\)[\s\S]*?\.select\('id'\)/);
  assert.match(portalAppointmentSlice, /Não foi possível confirmar a persistência da resposta/);
  assert.match(appCode, /const resultAppointment = result\?\.item \|\| result\?\.appointment/);
  assert.match(appCode, /if \(!result\?\.success\)/);
});

test('family popup uses neutral branding, logo initials fallback and no pre-confirmed green text', () => {
  assert.match(appCode, /getClinicInitials/);
  assert.match(appCode, /Lembrete de consulta/);
  assert.match(appCode, /Confirmar presença/);
  assert.match(appCode, /professionalName/);
  assert.match(appCode, /patientName/);
  assert.doesNotMatch(appCode, /Presença na consulta confirmada/);
  assert.doesNotMatch(appCode, /Lembrete de Consulta - Verto/);
  assert.doesNotMatch(appCode, /bg-gradient-to-br from-violet-600 via-fuchsia-500 to-blue-500/);
});

test('patient portal still exposes appointment action controls and notification services use clinic branding', () => {
  assert.match(patientDashboardCode, /Confirmar presença/);
  assert.match(patientDashboardCode, /Solicitar remarcação/);
  assert.match(patientDashboardCode, /Solicitar cancelamento/);
  assert.match(pushServiceCode, /clinicName/);
  assert.match(pushServiceCode, /clinicLogoUrl/);
  assert.match(cronServiceCode, /resolveReminderClinicBranding/);
  assert.doesNotMatch(pushServiceCode, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(cronServiceCode, /\.select\(['"]\*['"]\)/);
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

console.log(`${passed}/${tests.length} portal branding tests passed`);
