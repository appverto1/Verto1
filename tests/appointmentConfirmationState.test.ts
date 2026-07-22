import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  hasAnyOwnProperty,
  readCanonicalNullableValue,
  resolveAppointmentConfirmationSnapshot,
  resolveAppointmentPatientDisplayStatus,
} from '../src/utils/appointmentConfirmationState';

const root = process.cwd();

test('canonical null reset does not restore a stale confirmed source payload', () => {
  const appointment = {
    patient_confirmation_status: null,
    patient_response: null,
    patient_confirmation_at: null,
  };
  const staleSource = {
    patient_confirmation_status: 'CONFIRMED',
    patient_response: 'confirmed',
  };

  assert.equal(
    readCanonicalNullableValue(
      appointment,
      ['patient_confirmation_status', 'patientConfirmationStatus'],
      staleSource,
      ['patient_confirmation_status', 'patientConfirmationStatus'],
      APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
    ),
    null,
  );
  assert.deepEqual(resolveAppointmentConfirmationSnapshot(appointment, staleSource), {
    hasCanonicalState: true,
    response: null,
    confirmationStatus: null,
    respondedAt: null,
    confirmationAt: null,
    source: null,
    label: null,
    color: null,
  });
  assert.equal(
    readCanonicalNullableValue(
      appointment,
      ['patient_response', 'patientResponse'],
      staleSource,
      ['patient_response', 'patientResponse'],
      APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
    ),
    null,
  );
});

test('canonical pending state wins over a stale local confirmed state', () => {
  const serverAppointment = { patientConfirmationStatus: 'pending' };
  const localAppointment = { patientConfirmationStatus: 'confirmed' };

  assert.equal(
    readCanonicalNullableValue(
      serverAppointment,
      ['patient_confirmation_status', 'patientConfirmationStatus'],
      localAppointment,
      ['patient_confirmation_status', 'patientConfirmationStatus'],
      APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
    ),
    'pending',
  );
});

test('a reschedule request is not displayed as confirmed even when the clinical status is still confirmed', () => {
  assert.equal(
    resolveAppointmentPatientDisplayStatus({
      status: 'CONFIRMED',
      patient_confirmation_status: 'RESCHEDULE_REQUESTED',
      patient_response: 'reschedule',
    }),
    'RESCHEDULE_REQUESTED',
  );
});

test('an approved reschedule returns to pending when canonical confirmation was cleared', () => {
  assert.equal(
    resolveAppointmentPatientDisplayStatus({
      status: 'SCHEDULED',
      patient_confirmation_status: null,
      patient_response: null,
    }),
    'SCHEDULED',
  );
});

test('legacy source remains readable only when canonical confirmation columns are absent', () => {
  const legacyAppointment = { id: 'legacy-appointment' };
  const legacySource = { patient_confirmation_status: 'CONFIRMED' };

  assert.equal(hasAnyOwnProperty(legacyAppointment, APPOINTMENT_CONFIRMATION_CANONICAL_KEYS), false);
  assert.equal(
    readCanonicalNullableValue(
      legacyAppointment,
      ['patient_confirmation_status', 'patientConfirmationStatus'],
      legacySource,
      ['patient_confirmation_status', 'patientConfirmationStatus'],
      APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
    ),
    'CONFIRMED',
  );
});

test('portal and clinic calendar consume the canonical confirmation resolver', () => {
  const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
  const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
  const patientDashboardCode = readFileSync(join(root, 'src/components/PatientDashboard.tsx'), 'utf8');

  assert.match(serverCode, /const explicitPatientConfirmation = confirmationSnapshot\.confirmationStatus \?\? confirmationSnapshot\.response/);
  const confirmationRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/appointments/:appointmentId/confirmation'"),
    serverCode.indexOf('const handleAppointmentStatusUpdate'),
  );
  assert.ok(
    confirmationRoute.indexOf('readPersistedAppointmentRows') < confirmationRoute.indexOf(".from('clinic_state')"),
    'O lembrete deve consultar appointments antes do espelho clinic_state.',
  );
  assert.match(calendarCode, /const serverConfirmationWasReset =/);
  assert.match(calendarCode, /patientConfirmationStatus:\s*confirmationSnapshot\.confirmationStatus/);
  assert.match(patientDashboardCode, /resolveAppointmentPatientDisplayStatus/);
  assert.match(patientDashboardCode, /const activePortalConfirmed = activePortalDisplayStatus\.includes\('CONFIRM'\)/);
  assert.doesNotMatch(patientDashboardCode, /activePortalStatus\.includes\('CONFIRM'\) \|\|/);
});
