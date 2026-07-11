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
  assert.match(serverCode, /read\(clinicColumns\.join\(','\)\)/);
  assert.match(familyBrandingSlice, /clinicColumns = \['id', 'name', 'display_name', 'legal_name', 'logo_url', 'owner_user_id'\]/);
  assert.match(familyBrandingSlice, /clinicColumns = clinicColumns\.filter/);
  assert.match(familyBrandingSlice, /\.eq\('user_id', clinicOwnerUserId\)/);
  assert.match(familyBrandingSlice, /profileLogoUrl \|\| sanitizeClinicBrandImageUrl\(clinic\?\.logo_url\)/);
  assert.ok(
    familyBrandingSlice.indexOf(".eq('user_id', clinicOwnerUserId)") < familyBrandingSlice.indexOf('const displayName ='),
    'Schema legado deve ler branding institucional do perfil do proprietario antes de resolver o nome.'
  );
  assert.match(familyBrandingSlice, /readProfileBranding\('user_id,full_name,clinic_name,clinic_logo_url,updated_at'\)/);
  assert.match(familyBrandingSlice, /isGenericClinicBrandingName/);
  assert.match(familyBrandingSlice, /clinic_name,clinic_logo_url,metadata,updated_at/);
  assert.match(familyBrandingSlice, /profileLogoUrl \|\| sanitizeClinicBrandImageUrl\(clinic\?\.logo_url\)/);
  assert.match(familyBrandingSlice, /profileWithUsableName/);
  assert.match(familyBrandingSlice, /profileWithUsableLogo/);
  assert.match(serverCode, /profileNameSource\?\.clinic_name/);
  assert.match(serverCode, /clinic\?\.display_name \|\| clinic\?\.name \|\| clinic\?\.legal_name/);
  assert.ok(
    familyBrandingSlice.indexOf('const clinicDisplayName') < familyBrandingSlice.indexOf('const profileDisplayName'),
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

test('remarcacao aprovada nao volta a aparecer como solicitacao pendente', () => {
  const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
  assert.match(calendarCode, /if \(explicit === 'RESCHEDULE_REQUESTED'\) return 'RESCHEDULE_REQUESTED'/);
  assert.doesNotMatch(calendarCode, /explicit === 'RESCHEDULE_REQUESTED' \|\| explicit === 'RESCHEDULED'/);
  assert.match(serverCode, /RESCHEDULE_APPROVED/);
  assert.match(serverCode, /resolvedAppointmentIds/);
  assert.match(serverCode, /buildPortalAppointmentHistory/);
  assert.match(serverCode, /requestedAt > latestRescheduleApprovalAt/);
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
  assert.match(patientDashboardCode, /firstPortalLogoUrl/);
  assert.match(patientDashboardCode, /renderPortalClinicLogo/);
  assert.match(patientDashboardCode, /isGenericPortalClinicName/);
  assert.match(patientDashboardCode, /isVertoPortalFallbackAsset/);
  assert.match(patientDashboardCode, /candidates\.find\(\(value\) => !isGenericPortalClinicName\(value\)\)/);
  assert.doesNotMatch(patientDashboardCode, /getPortalClinicNameExclusions\(professionalName, notification\?\.title\)/);
  assert.match(
    patientDashboardCode,
    /getPortalClinicNameExclusions\(activePortalProfessionalName\),\s*activePortalAppointment\?\.clinicName/
  );
  assert.doesNotMatch(patientDashboardCode, /VERTO_NOTIFICATION_LOGO/);
  assert.match(pushServiceCode, /clinicName/);
  assert.match(pushServiceCode, /clinicLogoUrl/);
  assert.match(pushServiceCode, /allowProfessionalFallback:\s*false/);
  assert.match(cronServiceCode, /resolveReminderClinicBranding/);
  assert.match(cronServiceCode, /clinicColumns = \['id', 'name', 'display_name', 'legal_name', 'logo_url', 'owner_user_id'\]/);
  assert.match(cronServiceCode, /\.eq\('user_id', data\.owner_user_id\)/);
  assert.match(cronServiceCode, /clinicNameIsOwnerName/);
  assert.match(cronServiceCode, /DEFAULT_CLINIC_NOTIFICATION_NAME = 'Clínica'/);
  assert.match(cronServiceCode, /isGenericClinicNotificationName/);
  assert.match(cronServiceCode, /allowProfessionalFallback:\s*false/);
  assert.match(cronServiceCode, /appointment: brandedAppointment/);
  assert.doesNotMatch(pushServiceCode, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(cronServiceCode, /\.select\(['"]\*['"]\)/);
});

test('logo institucional privado pode ser lido apenas pela clinica vinculada ao paciente', () => {
  const helperStart = serverCode.indexOf('const canAccessCanonicalClinicLogo = async');
  const routeStart = serverCode.indexOf("app.get('/api/storage/patient-photos/view'", helperStart);
  assert.ok(helperStart >= 0 && routeStart > helperStart, 'Resolvedor seguro do logo institucional nao encontrado.');
  const helper = serverCode.slice(helperStart, routeStart);
  const route = serverCode.slice(routeStart, routeStart + 5200);
  assert.match(helper, /getPatientIdsByEmailAcrossClinics/);
  assert.match(helper, /\.from\('patients'\)[\s\S]*?\.select\('id,clinic_id'\)/);
  assert.match(helper, /\.from\('clinics'\)[\s\S]*?\.in\('id', scopedClinicIds\)/);
  assert.match(helper, /\.from\('professional_profiles'\)[\s\S]*?\.in\('user_id', ownerUserIds\)/);
  assert.match(helper, /extractPatientPhotosStoragePath\(reference\) === targetPath/);
  assert.match(route, /canAccessCanonicalClinicLogo/);
  assert.doesNotMatch(helper, /\.select\(['"]\*['"]\)/);
});

test('card e popup mantem branding hidratado e tipografia leve', () => {
  const detailStart = patientDashboardCode.indexOf('const portalAppointmentDetailModal =');
  const detailEnd = patientDashboardCode.indexOf('const portalActionSubmitDisabled', detailStart);
  assert.ok(detailStart >= 0 && detailEnd > detailStart, 'Popup de detalhes nao encontrado.');
  const detail = patientDashboardCode.slice(detailStart, detailEnd);
  assert.match(detail, /activePortalClinicLogoUrl/);
  assert.match(detail, /activePortalClinicName/);
  assert.doesNotMatch(detail, /font-black/);
  assert.doesNotMatch(detail, /uppercase/);
});

test('remarcacao guarda opcoes em metadata e nunca usa a nota tecnica como texto visivel', () => {
  const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
  const migrationCode = readFileSync(join(root, 'supabase/migrations/20260711120000_appointment_action_request_metadata.sql'), 'utf8');
  assert.match(serverCode, /buildRescheduleRequestMessage/);
  assert.match(serverCode, /metadata: \{ rescheduleOptions: selectedOptions, reschedulePayloadVersion: 1 \}/);
  assert.match(serverCode, /parseRescheduleRequestPayload\(row\?\.note, row\?\.metadata\)/);
  assert.match(calendarCode, /parseRescheduleRequestPayload\(request\.note, request\.metadata\)/);
  assert.doesNotMatch(calendarCode, /parsedRescheduleNote\.note \|\| request\.note/);
  assert.match(migrationCode, /add column if not exists metadata jsonb/);
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
