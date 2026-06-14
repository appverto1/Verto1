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
assert.equal(clinicPush.badge, 'https://cdn.example.com/clinic-logo.png');
assert.match(clinicPush.body, /Pedro Henrique/);
assert.match(clinicPush.body, /confirmar, remarcar ou cancelar/);
assert.doesNotMatch(clinicPush.title, /Verto/);
assert.doesNotMatch(clinicPush.body, /abrir a Verto/i);

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
  /Consulta de Pedro Henrique com Clínica ABC dia \d{2}\/\d{2} \(amanhã\) às 12:00\./,
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

assert.equal(professionalBranding.sourceType, 'professional');
assert.equal(professionalPush.title, 'Mateus Psicologia');
assert.equal(professionalPush.icon, 'https://cdn.example.com/professional.png');

const fallbackBranding = resolveBrandingContext({});
assert.equal(fallbackBranding.sourceType, 'verto_fallback');
assert.equal(fallbackBranding.displayName, 'Verto');

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
assert.match(serviceWorkerCode, /brandName/);
assert.match(serviceWorkerCode, /notification_action/);
assert.doesNotMatch(serviceWorkerCode, /Lembrete de Consulta - Verto/);
assert.match(appCode, /buildPatientReminderModalViewModel/);
assert.match(appCode, /friendlyPatientNotificationError/);
assert.match(appCode, /Tentar novamente/);
assert.match(appCode, /appointmentConfirmationRetry/);
assert.match(cronCode, /patient_name, patient_email, therapist_name, source_payload/);
assert.match(cronCode, /professionalDisplayName: appointment\.professionalDisplayName/);
assert.match(cronCode, /patientName: appointment\.patientName/);
assert.match(docsCode, /dominio\/origin/);
assert.match(docsCode, /nao tenta ocultar ou mascarar esse origin/);

console.log('notification branding checks passed');
