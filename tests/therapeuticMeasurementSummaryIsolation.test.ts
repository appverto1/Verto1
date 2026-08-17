import assert from 'node:assert/strict';
import { calculateSessionSummary } from '../src/utils/abaSessionSummary';

const sessionId = 'session-therapeutic-measurement-test';
const base = {
  sessionId,
  patientId: 'patient-test',
  therapistId: 'therapist-test',
  startedAt: '2026-08-17T10:00:00.000Z',
  endedAt: '2026-08-17T10:10:00.000Z',
};

const legacyTrial = {
  id: 'trial-legacy',
  session_id: sessionId,
  target_id: 'target-legacy',
  target_name: 'Responder ao nome',
  collection_type: 'dtt',
  response_score: 1,
  max_score: 1,
  correct: true,
  independent: true,
  prompt_level_key: 'independent',
};

const durationMeasurement = {
  id: 'measurement-duration',
  session_id: sessionId,
  target_id: 'target-duration',
  target_name: 'Olhar nos olhos',
  collection_type: 'dtt',
  correct: false,
  independent: false,
  raw_payload: {
    source: 'therapeutic_program_measurement',
    therapeuticMeasurement: true,
    measurementType: 'duration',
    measurementValue: 42,
    measurementUnit: 'seconds',
  },
};

const mixed = calculateSessionSummary(sessionId, {
  ...base,
  trials: [legacyTrial, durationMeasurement],
});
assert.equal(mixed.totalTrials, 1, 'medida de duração não deve incrementar total de tentativas Legacy');
assert.equal(mixed.independentTrials, 1);
assert.equal(mixed.errorTrials, 0, 'medida de duração não pode virar erro ABA');
assert.equal(mixed.accuracyPercent, 100);

const onlyMeasurement = calculateSessionSummary(sessionId, {
  ...base,
  trials: [durationMeasurement],
});
assert.equal(onlyMeasurement.totalTrials, 0);
assert.equal(onlyMeasurement.errorTrials, 0);
assert.equal(onlyMeasurement.accuracyPercent, 0);

console.log('therapeuticMeasurementSummaryIsolation.test.ts: ok');
