import assert from 'node:assert/strict';
import { APPOINTMENT_CANCELLATION_REASONS, buildAppointmentCancellationNote } from '../src/utils/appointmentCancellationReasons';

assert.ok(APPOINTMENT_CANCELLATION_REASONS.includes('Paciente ou responsável solicitou cancelamento'));
assert.equal(buildAppointmentCancellationNote('Paciente ou responsável solicitou cancelamento',''), 'Paciente ou responsável solicitou cancelamento');
assert.equal(buildAppointmentCancellationNote('Profissional indisponível','Reagendar depois'), 'Profissional indisponível — Reagendar depois');
assert.equal(buildAppointmentCancellationNote('Outro motivo', '  Compromisso escolar  '), 'Compromisso escolar');
assert.equal(buildAppointmentCancellationNote('Outro motivo',''), '');
assert.equal(buildAppointmentCancellationNote('', 'Observação solta'), '');
assert.equal(buildAppointmentCancellationNote('motivo inventado',''), '');
assert.ok(buildAppointmentCancellationNote('Conflito de horário', 'x'.repeat(2000)).length <= 1200);
console.log('appointmentCancellationReasons.test.ts: ok');
