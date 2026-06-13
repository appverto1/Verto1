import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateAppointmentClosureReadiness } from '../src/services/closureReadinessEngine';

const now = '2026-05-28T12:00:00.000Z';

const baseInput = {
  organizationId: 'org-1',
  appointmentId: 'appt-1',
  abaSessionId: 'session-1',
  patientId: 'patient-1',
  now,
  appointment: {
    id: 'appt-1',
    patient_id: 'patient-1',
    therapist_id: 'professional-1',
    service_type: 'ABA',
    status: 'completed',
    scheduled_start_at: '2026-05-28T09:00:00.000Z',
    scheduled_end_at: '2026-05-28T09:45:00.000Z',
    scheduled_duration_minutes: 45,
    actual_start_at: '2026-05-28T09:00:00.000Z',
    actual_end_at: '2026-05-28T09:45:00.000Z',
    actual_duration_minutes: 45,
    payer_id: 'payer-amil',
    payer_name_snapshot: 'Amil',
    location_type: 'clinica',
    room_name: 'Sala 1',
    updated_at: '2026-05-28T10:00:00.000Z'
  },
  abaSession: {
    id: 'session-1',
    status: 'completed',
    therapist_id: 'professional-1',
    updated_at: '2026-05-28T10:00:00.000Z'
  },
  sessionSummary: {
    session_id: 'session-1',
    session_note: 'Evolução preenchida.',
    duration_seconds: 2700,
    updated_at: '2026-05-28T10:05:00.000Z'
  },
  signature: true,
  patient: { id: 'patient-1', insuranceType: 'particular' },
  professional: { id: 'professional-1' }
};

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('sessão concluída com tudo presente vira READY', () => {
  const result = evaluateAppointmentClosureReadiness(baseInput);
  assert.equal(result.readinessStatus, 'READY');
  assert.equal(result.blockingIssuesCount, 0);
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.evidence?.present, true);
});

test('sem assinatura obrigatória vira PENDING', () => {
  const result = evaluateAppointmentClosureReadiness({ ...baseInput, signature: false });
  assert.equal(result.readinessStatus, 'PENDING');
  assert.ok(result.summary.mainIssues.some((message) => message.includes('Assinatura')));
});

test('sem relatório obrigatório vira PENDING', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    sessionSummary: { ...baseInput.sessionSummary, session_note: '' }
  });
  assert.equal(result.readinessStatus, 'PENDING');
  assert.ok(result.checklist.some((item) => item.key === 'report_present' && item.status === 'FAILED'));
});

test('duração real abaixo do planejado vira WARNING', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      actual_end_at: '2026-05-28T09:32:00.000Z',
      actual_duration_minutes: 32
    }
  });
  assert.equal(result.readinessStatus, 'WARNING');
  assert.ok(result.warningIssuesCount > 0);
});

test('cancelada vira NOT_BILLABLE', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, status: 'canceled' }
  });
  assert.equal(result.readinessStatus, 'NOT_BILLABLE');
});

test('futura vira DRAFT', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: {
      ...baseInput.appointment,
      status: 'scheduled',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:45:00.000Z',
      actual_start_at: null,
      actual_end_at: null,
      actual_duration_minutes: null
    },
    abaSession: null,
    sessionSummary: null,
    signature: null
  });
  assert.equal(result.readinessStatus, 'DRAFT');
});

test('sem profissional vira PENDING', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, therapist_id: null },
    abaSession: { ...baseInput.abaSession, therapist_id: null },
    professional: null
  });
  assert.equal(result.readinessStatus, 'PENDING');
});

test('sem paciente não passa como READY', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    patientId: null,
    appointment: { ...baseInput.appointment, patient_id: null },
    abaSession: { ...baseInput.abaSession, patient_id: null },
    patient: null
  });
  assert.notEqual(result.readinessStatus, 'READY');
});

test('payer_id real é a única verdade para convênio vinculado', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, payer_id: 'payer-real', payer_name_snapshot: 'Amil' },
    requirements: { payerId: 'payer-real', payerName: 'Amil' }
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(payerCheck?.status, 'PASSED');
  assert.equal(payerCheck?.message, 'Pagador informado para esta conferência.');
  assert.equal(payerCheck?.evidence?.present, true);
  assert.equal(payerCheck?.evidence?.suggested, false);
});

test('pagador sugerido pelo plano financeiro não vira convênio vinculado', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, payer_id: null, payer_name_snapshot: 'Amil' },
    requirements: { payerName: 'Amil' }
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(result.readinessStatus, 'PENDING');
  assert.equal(payerCheck?.status, 'FAILED');
  assert.equal(payerCheck?.message, 'Pagador sugerido pelo plano financeiro: Amil. Ainda não aplicado ao atendimento.');
  assert.equal(payerCheck?.evidence?.present, false);
  assert.equal(payerCheck?.evidence?.suggested, true);
  assert.equal(payerCheck?.evidence?.suggestedPayerName, 'Amil');
});

test('sem payer_id e sem sugestão mantém convênio pendente sem fallback visual', () => {
  const result = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, payer_id: null, payer_name_snapshot: null },
    requirements: {}
  });
  const payerCheck = result.checklist.find((item) => item.key === 'payer_linked');
  assert.equal(result.readinessStatus, 'PENDING');
  assert.equal(payerCheck?.status, 'FAILED');
  assert.equal(payerCheck?.message, 'Pagador não configurado para esta conferência.');
  assert.equal(payerCheck?.evidence?.present, false);
  assert.equal(payerCheck?.evidence?.suggested, false);
});

test('context hash evita recalcular sem mudança', () => {
  const first = evaluateAppointmentClosureReadiness(baseInput);
  const second = evaluateAppointmentClosureReadiness({ ...baseInput });
  const changed = evaluateAppointmentClosureReadiness({
    ...baseInput,
    appointment: { ...baseInput.appointment, updated_at: '2026-05-28T10:20:00.000Z' }
  });
  assert.equal(first.contextHash, second.contextHash);
  assert.notEqual(first.contextHash, changed.contextHash);
});

test('arquivos críticos não usam select star no módulo de fechamento', () => {
  const root = process.cwd();
  const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
  assert.doesNotMatch(serverCode, /\/api\/closure[\s\S]{0,9000}\.select\('\*'\)/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} closure readiness tests passed`);
