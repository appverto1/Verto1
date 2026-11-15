import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasCompletedPatientAnamnesis } from '../src/utils/patientCardPendingState';

test('only truly outstanding anamnesis appears as a patient-card pending state', () => {
  const patient = { anamnesisPending: true, onboardingStatus: 'ANAMNESIS_SENT' };
  for (const status of ['SENT', 'IN_PROGRESS', 'DRAFT']) {
    assert.equal(hasCompletedPatientAnamnesis(patient, { request: { status } }), false, status);
  }
  assert.equal(hasCompletedPatientAnamnesis(patient, null), false);
});

test('submitted and reviewed records show only the view action in the card', () => {
  for (const status of ['SUBMITTED', 'REVIEWED']) {
    assert.equal(hasCompletedPatientAnamnesis({}, { response: { status } }), true);
    assert.equal(hasCompletedPatientAnamnesis({}, { request: { status } }), true);
  }
  assert.equal(hasCompletedPatientAnamnesis({ onboarding_status: 'READY_FOR_CARE' }, null), true);
  assert.equal(hasCompletedPatientAnamnesis({ onboardingStatus: 'ANAMNESIS_REVIEWED' }, null), true);
});

test('a pending server request wins over a partially saved legacy patient record', () => {
  const record = { anamnesisPending: false, lastAnamnesisAt: '2026-11-14T13:00:00Z', anamnesisData: { motivoConsulta: 'Consulta' } };
  assert.equal(hasCompletedPatientAnamnesis(record, { request: { status: 'SENT' } }), false);
  assert.equal(hasCompletedPatientAnamnesis(record, { response: { status: 'DRAFT' } }), false);
  assert.equal(hasCompletedPatientAnamnesis(record, null), true);
});

test('a new registration or unsaved draft is not mistaken for a completed anamnesis', () => {
  assert.equal(hasCompletedPatientAnamnesis({ anamnesisData: { nome: 'Exemplo' } }, null), false);
  assert.equal(hasCompletedPatientAnamnesis({ lastAnamnesisAt: '2026-11-14', anamnesisPending: true, anamnesisData: { motivoConsulta: 'x' } }, null), false);
  assert.equal(hasCompletedPatientAnamnesis({ lastAnamnesisAt: '2026-11-14', anamnesisData: { formType: 'adult' } }, null), false);
});
