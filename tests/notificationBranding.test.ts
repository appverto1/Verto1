import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPatientReminderModalViewModel,
  buildPatientReminderNotificationPayload,
  friendlyPatientNotificationError,
  resolveBrandingContext,
} from '../src/services/notificationBranding';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(12, 0, 0, 0);
const scheduledAt = tomorrow.toISOString();
const dateLabel = tomorrow.toLocaleDateString('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

const clinicBranding = resolveBrandingContext({
  clinic: {
    displayName: 'Clínica ABC',
    logoUrl: 'https://cdn.example.com/clinic-logo.png',
    primaryColor: '#0055AA',
  },
  professional: {
    displayName: 'Mateus Psicologia',
    logoUrl: 'https://cdn.example.com/professional.png',
  },
});

const clinicPush = buildPatientReminderNotificationPayload({
  appointmentId: 'appt-1',
  scheduledAt,
  dateLabel,
  timeLabel: '12:00',
  patientName: 'Pedro Henrique',
  reminderKind: '24h',
  branding: clinicBranding,
});

assert.equal(clinicBranding.sourceType, 'clinic');
assert.equal(clinicPush.title, 'Clínica ABC');
assert.equal(clinicPush.icon, 'https://cdn.example.com/clinic-logo.png');
assert.equal(clinicPush.badge, '/verto-3d-transparent.png');
assert.equal(clinicPush.image, 'https://cdn.example.com/clinic-logo.png');
assert.equal(clinicPush.data.brandLogoUrl, 'https://cdn.example.com/clinic-logo.png');
assert.equal((clinicPush as any).actions, undefined);
assert.match(clinicPush.body, /Pedro Henrique/);
assert.match(clinicPush.body, /Toque para confirmar, remarcar ou cancelar/);
assert.doesNotMatch(clinicPush.body, /Abra o painel para confirmar ou remarcar/);
assert.doesNotMatch(clinicPush.title, /Verto/);
assert.doesNotMatch(clinicPush.body, /abrir a Verto/i);

const ambiguousClinicBranding = resolveBrandingContext({
  clinic: {
    id: 'clinic-1',
    displayName: 'Mateus',
  },
  professional: {
    displayName: 'Terapeuta Mateus',
  },
  fallbackName: 'Clínica',
});

assert.equal(ambiguousClinicBranding.sourceType, 'verto_fallback');
assert.equal(ambiguousClinicBranding.displayName, 'Clínica');

const clinicModal = buildPatientReminderModalViewModel({
  appointmentId: 'appt-1',
  scheduledAt,
  dateLabel,
  timeLabel: '12:00',
  patientName: 'Pedro Henrique',
  status: 'pending',
  branding: clinicBranding,
});

assert.equal(clinicModal.brandName, 'Clínica ABC');
assert.equal(clinicModal.brandLogoUrl, 'https://cdn.example.com/clinic-logo.png');
assert.match(
  clinicModal.appointmentSummaryText,
  /Consulta de Pedro Henrique dia \d{2}\/\d{2} \(amanhã\) às 12:00\./,
);
assert.equal(clinicModal.confirmLabel, 'Confirmar presença');
assert.equal(clinicModal.rescheduleLabel, 'Remarcar consulta');
assert.equal(clinicModal.cancelLabel, 'Cancelar agendamento');

const professionalBranding = resolveBrandingContext({
  professional: {
    displayName: 'Mateus Psicologia',
    logoUrl: 'https://cdn.example.com/professional.png',
  },
});
const professionalPush = buildPatientReminderNotificationPayload({
  appointmentId: 'appt-2',
  timeLabel: '09:00',
  reminderKind: '12h',
  branding: professionalBranding,
});

assert.equal(professionalBranding.sourceType, 'verto_fallback');
assert.equal(professionalBranding.displayName, 'Clínica');
assert.equal(professionalPush.title, 'Clínica');
assert.equal(professionalPush.icon, '/verto-3d-transparent.png');
assert.equal(professionalPush.data.brandLogoUrl, '/verto-3d-transparent.png');
assert.doesNotMatch(professionalPush.title, /Mateus/);
assert.doesNotMatch(professionalPush.body, /Mateus/);

const fallbackBranding = resolveBrandingContext({});
assert.equal(fallbackBranding.sourceType, 'verto_fallback');
assert.equal(fallbackBranding.displayName, 'Clínica');

assert.equal(
  friendlyPatientNotificationError('Erro interno do servidor.'),
  'Não foi possível concluir sua solicitação agora. Tente novamente em alguns instantes.',
);

const pushServiceCode = read('services/pushNotificationService.ts');
const serviceWorkerCode = read('public/sw.js');
const appCode = read('src/App.tsx');
const cronCode = read('services/cronService.ts');
const docsCode = read('docs/notification-branding.md');

assert.match(pushServiceCode, /resolveBrandingContext/);
assert.match(pushServiceCode, /buildPatientReminderNotificationPayload/);
assert.match(pushServiceCode, /allowProfessionalFallback:\s*false/);
assert.match(pushServiceCode, /title:\s*notificationPayload\.title/);
assert.doesNotMatch(pushServiceCode, /title:\s*params\.title \|\| notificationPayload\.title/);
assert.match(pushServiceCode, /clinic:\s*\{[\s\S]*?id:\s*clinicId \|\| null/);
assert.match(serviceWorkerCode, /brandName/);
assert.doesNotMatch(serviceWorkerCode, /notification_action/);
assert.doesNotMatch(serviceWorkerCode, /\bactions\s*:/);
assert.doesNotMatch(serviceWorkerCode, /Lembrete de Consulta - Verto/);
assert.match(appCode, /buildPatientReminderModalViewModel/);
assert.match(appCode, /allowProfessionalFallback:\s*false/);
assert.match(appCode, /friendlyPatientNotificationError/);
assert.match(appCode, /Tentar novamente/);
assert.match(appCode, /appointmentConfirmationRetry/);
assert.match(cronCode, /\.select\('id, clinic_id, patient_id, patient_email, therapist_name, source_payload/);
assert.doesNotMatch(cronCode, /\.select\('id, clinic_id, patient_id, patient_name, patient_email, therapist_name, source_payload/);
assert.match(cronCode, /hydrateReminderAppointmentPatientNames/);
assert.match(cronCode, /allowProfessionalFallback:\s*false/);
assert.match(cronCode, /professionalDisplayName: appointment\.professionalDisplayName/);
assert.match(cronCode, /patientName: appointment\.patientName/);
assert.match(docsCode, /dominio\/origin/);
assert.match(docsCode, /nao tenta ocultar ou mascarar esse origin/);

console.log('notification branding checks passed');
