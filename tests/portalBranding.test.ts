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
const familyBrandingSlice = serverCode.slice(
  serverCode.indexOf('const readClinicBrandingForFamilyView = async'),
  serverCode.indexOf('const parseAppointmentSourcePayloadForFamilyView')
);

test('appointment confirmation branding is clinic-first and never falls back to actor clinic settings', () => {
  assert.match(serverCode, /const readClinicBrandingForFamilyView = async/);
  assert.match(serverCode, /\.from\('clinics'\)[\s\S]*?\.select\(columns\)/);
  assert.match(serverCode, /read\('id,name,display_name,legal_name,logo_url'\)/);
  assert.match(familyBrandingSlice, /readProfileBranding\('clinic_name,clinic_logo_url,updated_at'\)/);
  assert.match(familyBrandingSlice, /isGenericClinicBrandingName/);
  assert.match(familyBrandingSlice, /clinic_name,clinic_logo_url,metadata,updated_at/);
  assert.match(familyBrandingSlice, /sanitizeSessionUrl\(clinic\?\.logo_url\) \|\| profileLogoUrl/);
  assert.match(serverCode, /institutionalProfile\?\.clinic_name/);
  assert.match(serverCode, /clinic\?\.display_name \|\| clinic\?\.legal_name \|\| clinic\?\.name/);
  assert.ok(
    familyBrandingSlice.indexOf('clinicDisplayName ||') < familyBrandingSlice.indexOf('institutionalProfile?.clinic_name'),
    'Nome institucional da clinica deve ter prioridade sobre professional_profiles.clinic_name.'
  );
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

test('portal notifications derive clinic branding from linked patient when notification lacks clinic id', () => {
  const notificationRouteSlice = serverCode.slice(
    serverCode.indexOf("app.get('/api/portal/notifications'"),
    serverCode.indexOf("app.patch('/api/portal/notifications/:notificationId'")
  );
  const notificationClinicResolutionSlice = notificationRouteSlice.slice(
    notificationRouteSlice.indexOf('const clinicId = sanitizeString('),
    notificationRouteSlice.indexOf('const branding = await resolveNotificationClinicBranding(clinicId);')
  );
  const patientNameResolutionStart = notificationRouteSlice.indexOf('const patientName =');
  const notificationPatientNameResolutionSlice = notificationRouteSlice.slice(
    patientNameResolutionStart,
    notificationRouteSlice.indexOf('const scheduledAt =', patientNameResolutionStart)
  );
  assert.match(notificationRouteSlice, /patientClinicIdsById/);
  assert.match(notificationRouteSlice, /appointmentContextById/);
  assert.match(notificationRouteSlice, /queryPortalAppointmentsWithSchemaFallback/);
  assert.match(notificationRouteSlice, /\.select\(selectColumns\)/);
  assert.match(notificationRouteSlice, /isPatientAppointmentNotificationActionable/);
  assert.match(serverCode, /patient_confirmation_status/);
  assert.match(serverCode, /RESCHEDULE_REQUESTED/);
  assert.match(serverCode, /CANCEL_REQUESTED/);
  assert.match(notificationRouteSlice, /\.select\('id,name,email,clinic_id'\)/);
  assert.match(notificationRouteSlice, /appointmentContext\?\.patientId/);
  assert.match(notificationRouteSlice, /appointmentContext\?\.clinicId/);
  assert.match(notificationRouteSlice, /patientClinicIdsById\.get\(patientId\)/);
  assert.match(notificationRouteSlice, /isGenericCalendarPatientName\(metadataPatientName\)/);
  assert.ok(
    notificationRouteSlice.indexOf('const patientId = sanitizeString(row?.patient_id || metadata.patientId || metadata.patient_id || appointmentContext?.patientId, 120);') <
      notificationRouteSlice.indexOf('const branding = await resolveNotificationClinicBranding(clinicId);'),
    'Branding da notificacao deve poder usar o paciente antes do fallback institucional.'
  );
  assert.ok(
    notificationClinicResolutionSlice.indexOf('patientClinicIdsById.get(patientId)') <
      notificationClinicResolutionSlice.indexOf('row?.organization_id'),
    'organization_id nao deve ganhar do clinic_id do paciente.'
  );
  assert.ok(
    notificationPatientNameResolutionSlice.indexOf('patientNamesById.get(patientId)') <
      notificationPatientNameResolutionSlice.indexOf('metadataPatientName'),
    'Nome real do cadastro do paciente deve ganhar de metadados incompletos da notificacao.'
  );
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
  assert.match(pushServiceCode, /allowProfessionalFallback:\s*false/);
  assert.match(cronServiceCode, /resolveReminderClinicBranding/);
  assert.match(cronServiceCode, /DEFAULT_CLINIC_NOTIFICATION_NAME = 'Clínica'/);
  assert.match(cronServiceCode, /isGenericClinicNotificationName/);
  assert.match(cronServiceCode, /allowProfessionalFallback:\s*false/);
  assert.match(cronServiceCode, /appointment: brandedAppointment/);
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
