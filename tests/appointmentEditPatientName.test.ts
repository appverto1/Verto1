import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  resolveClinicalPatientDisplayName,
  resolvePortalPatientDisplayName,
} from '../src/utils/patientDisplayName';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const serverCode = read('server.ts');

test('nome clinico canonico e nome preferido do portal permanecem independentes', () => {
  const patient = {
    name: 'Pedro Henrique Alves de Santana',
    metadata: {
      portalDisplayName: 'Pedro',
    },
  };

  assert.equal(resolveClinicalPatientDisplayName(patient), 'Pedro Henrique Alves de Santana');
  assert.equal(resolvePortalPatientDisplayName(patient), 'Pedro');
  assert.equal(resolvePortalPatientDisplayName({ name: patient.name }), patient.name);
  assert.equal(
    resolvePortalPatientDisplayName({ name: patient.name, metadata: JSON.stringify({ preferred_name: 'Pedro Henrique' }) }),
    'Pedro Henrique',
  );
});

test('cada edicao de consulta recebe uma nova intencao idempotente', () => {
  assert.match(dataServiceCode, /createIdempotencyKey\('appointment-update', appointmentId\)/);
  assert.doesNotMatch(appCode, /`\$\{id\}:\$\{recurrenceScope\}`/);
  assert.match(serverCode, /`\$\{params\.eventType\}:\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(serverCode, /fetchPersistedAppointmentActionByIdempotencyKey/);
});

test('mudanca de horario limpa lembretes antigos e preserva o novo agendamento', () => {
  assert.match(serverCode, /const scheduleChangedAppointmentIds = new Set/);
  assert.match(serverCode, /acknowledgeStaleAppointmentReminderNotifications\(/);
  assert.match(serverCode, /appointment_reminder_24h/);
  assert.match(serverCode, /appointment_reminder_12h/);
  assert.match(serverCode, /triggerAppointmentReminderScan\(params\.eventType\)/);
});

test('agenda da clinica reidrata o nome canonico em lote', () => {
  const hydrateStart = serverCode.indexOf('const hydrateCalendarPatientNames = async');
  const hydrateEnd = serverCode.indexOf('const buildCalendarAppointmentStart', hydrateStart);
  assert.ok(hydrateStart >= 0 && hydrateEnd > hydrateStart);
  const hydrateCode = serverCode.slice(hydrateStart, hydrateEnd);

  assert.match(hydrateCode, /\.from\('patients'\)/);
  assert.match(hydrateCode, /\.select\('id, name'\)/);
  assert.match(hydrateCode, /\.eq\('clinic_id', safeClinicId\)/);
  assert.match(hydrateCode, /\.in\('id', idsNeedingHydration\)/);
  assert.match(hydrateCode, /patient_name: hydratedName/);
});

test('portal usa nome preferido e horario atual da consulta', () => {
  assert.match(serverCode, /resolvePortalPatientDisplayName/);
  assert.match(serverCode, /appointmentContext\?\.scheduledAt \|\| metadata\.scheduledAt/);
  assert.match(serverCode, /readPortalPatientContexts\(patientIds\)/);
  assert.match(serverCode, /authorizedPatientIdSet\.has\(rowPatientId\)/);
  assert.match(serverCode, /patient:\s*portalPatientContextsById\.get\(patientId\)/);
});

test('calendario do portal atualiza ao voltar ao app sem polling', () => {
  assert.match(patientDashboardCode, /portalAppointmentsLastLoadedAtRef/);
  assert.match(patientDashboardCode, /window\.addEventListener\('focus', refreshAppointmentsWhenVisible\)/);
  assert.match(patientDashboardCode, /document\.addEventListener\('visibilitychange', refreshAppointmentsWhenVisible\)/);
  assert.match(patientDashboardCode, /Date\.now\(\) - portalAppointmentsLastLoadedAtRef\.current < 30_000/);
  assert.doesNotMatch(patientDashboardCode, /setInterval\([^)]*loadPortalAppointments/);
});
