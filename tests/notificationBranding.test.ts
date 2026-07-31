import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildPatientReminderModalViewModel,
  buildPatientReminderNotificationPayload,
  resolveBrandingContext,
  VERTO_NOTIFICATION_BADGE_URL,
  VERTO_NOTIFICATION_ICON_URL,
} from '../src/services/notificationBranding';

const serviceWorker = fs.readFileSync('public/sw.js', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const cron = fs.readFileSync('services/cronService.ts', 'utf8');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `início ausente: ${start}`);
  assert.notEqual(endIndex, -1, `fim ausente: ${end}`);
  return source.slice(startIndex, endIndex);
};

const branding = resolveBrandingContext({
  clinic: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Espaço Guiar',
    logo_url: 'https://www.appverto.com.br/api/public/notification-assets/clinic-logo?clinic_id=x',
  },
});
const payload = buildPatientReminderNotificationPayload({
  appointmentId: '00000000-0000-4000-8000-000000000002',
  patientName: 'Ana',
  dateLabel: '31/07',
  timeLabel: '16:00',
  reminderKind: '24h',
  branding,
  canRequestReschedule: false,
});

// O SO identifica o app pela Verto e exibe a clínica como imagem principal.
assert.equal(payload.icon, VERTO_NOTIFICATION_ICON_URL);
assert.equal(payload.badge, VERTO_NOTIFICATION_BADGE_URL);
assert.equal(payload.image, branding.logoUrl);
assert.equal(payload.data.brandLogoUrl, branding.logoUrl);
assert.equal(payload.allowedActions.canRequestReschedule, false);
assert.match(payload.body, /confirmar ou cancelar a sessão/);
assert.doesNotMatch(payload.body, /solicitar reagendamento/);

const fallbackPayload = buildPatientReminderNotificationPayload({
  appointmentId: '00000000-0000-4000-8000-000000000003',
  branding: resolveBrandingContext({ clinic: { id: '00000000-0000-4000-8000-000000000004', name: 'Clínica sem logo' } }),
  canRequestReschedule: true,
});
assert.equal(fallbackPayload.icon, VERTO_NOTIFICATION_ICON_URL);
assert.equal(fallbackPayload.image, VERTO_NOTIFICATION_ICON_URL);
assert.equal(fallbackPayload.allowedActions.canRequestReschedule, true);

// O popup interno mantém o mesmo contrato de texto e ações.
const modal = buildPatientReminderModalViewModel({
  appointmentId: '00000000-0000-4000-8000-000000000002',
  patientName: 'Ana',
  branding,
  canRequestReschedule: false,
});
assert.equal(modal.brandLogoUrl, branding.logoUrl);
assert.equal(modal.rescheduleLabel, null);
assert.equal(modal.allowedActions.canRequestReschedule, false);

// Service worker não aceita payload.icon como autoridade e recua sem image em caso de erro.
assert.match(serviceWorker, /const SW_VERSION = "verto-branding-v15"/);
assert.match(serviceWorker, /const iconUrl = asNotificationAssetUrl\(VERTO_NOTIFICATION_ICON\)/);
assert.match(serviceWorker, /const imageUrl = asNotificationAssetUrl\(payload\.image \|\| brandLogo \|\| VERTO_NOTIFICATION_ICON\)/);
assert.match(serviceWorker, /showNotification\(title, notificationOptions\)\.catch/);
assert.match(serviceWorker, /const \{ image: _failedImage, \.\.\.fallbackOptions \}/);
assert.doesNotMatch(serviceWorker, /brandLogo \|\| payloadIcon/);

// Logo privado recebe URL HTTPS estável assinada, sem signed URL temporária do Supabase.
assert.match(cron, /buildStableClinicNotificationLogoUrl/);
assert.match(cron, /createHmac\('sha256', secret\)/);
assert.match(cron, /verifyStableClinicNotificationLogoSignature/);
assert.match(cron, /\/api\/public\/notification-assets\/clinic-logo/);
assert.doesNotMatch(cron, /createSignedUrl\(/);

const publicLogoRoute = section(
  server,
  "app.get('/api/public/notification-assets/clinic-logo'",
  "app.get('/api/storage/patient-photos/view'",
);
assert.match(publicLogoRoute, /verifyStableClinicNotificationLogoSignature/);
assert.match(publicLogoRoute, /5 \* 1024 \* 1024/);
assert.match(publicLogoRoute, /detectNotificationLogoContentType/);
assert.match(publicLogoRoute, /X-Content-Type-Options/);
assert.match(publicLogoRoute, /stale-while-revalidate/);

// O endpoint manual resolve clínica pelo workspace e escopa atendimento/paciente no banco.
const manualPushRoute = section(
  server,
  "app.post('/api/push/appointment-reminder'",
  "app.get(\n    '/api/patients/:patientId/professional-links'",
);
assert.match(manualPushRoute, /const reminderClinicId = sanitizeString\(currentClinicId\(req\.session\.user\), 120\)/);
assert.match(manualPushRoute, /\.eq\('id', appointmentId\)[\s\S]*?\.eq\('clinic_id', reminderClinicId\)/);
assert.match(manualPushRoute, /reminderAppointmentContext\.patient_id[\s\S]*?!== patientId/);
assert.match(manualPushRoute, /resolvePushSafeClinicLogoUrl\([\s\S]*?reminderClinicId/);
assert.doesNotMatch(manualPushRoute, /req\.body\?\.clinicId|req\.body\?\.clinic_id|req\.body\?\.clinicLogoUrl|req\.body\?\.clinic_logo_url/);

console.log('notificationBranding.test.ts: ok');
