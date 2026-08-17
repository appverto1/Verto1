import { evaluateTargetMastery } from '../src/utils/abaMasteryEngine';
import { isTherapeuticMasteryCriteriaCompatible, therapeuticMeasurementDefaultMasteryMeasure } from '../src/utils/therapeuticPlan';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const measurementTrial = (sessionId: string, measurementType: string, measurementValue: number) => ({
  id: `${sessionId}-${measurementType}-${measurementValue}`,
  session_id: sessionId,
  target_id: 'target-1',
  target_name: 'Olhar nos olhos',
  correct: false,
  independent: false,
  occurred_at: '2026-08-17T12:00:00.000Z',
  raw_payload: {
    therapeuticMeasurement: true,
    source: 'therapeutic_program_measurement',
    measurementType,
    measurementValue,
  },
});

assert(!isTherapeuticMasteryCriteriaCompatible('duration', { minAccuracyPercent: 80, requiredSessions: 3 }), 'duração não pode usar acurácia como critério');
assert(isTherapeuticMasteryCriteriaCompatible('duration', { type: 'custom_measure', measure: 'duration_seconds', value: 30 }), 'duração deve aceitar critério temporal');
assert(therapeuticMeasurementDefaultMasteryMeasure('duration') === 'duration_seconds', 'duração deve sugerir duração como medida de domínio');

const durationReady = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-3',
  targetId: 'target-1',
  targetName: 'Olhar nos olhos',
  criteria: { type: 'custom_measure', measure: 'duration_seconds', operator: 'gte', value: 30, requiredSessions: 3, sessionMode: 'consecutive' },
  trials: [measurementTrial('session-3', 'duration', 35)],
  previousEvaluations: [
    { id: 'eval-2', session_id: 'session-2', status: 'READY_FOR_REVIEW', evaluated_at: '2026-08-16T12:00:00.000Z' },
    { id: 'eval-1', session_id: 'session-1', status: 'MET_TODAY', evaluated_at: '2026-08-15T12:00:00.000Z' },
  ],
  evaluatedAt: '2026-08-17T12:00:00.000Z',
});
assert(durationReady.status === 'READY_FOR_REVIEW', 'terceira sessão temporal válida deve liberar revisão');
assert(durationReady.successfulSessions === 3, 'critério deve contar sessões, não converter sessões em dias');
assert(durationReady.criterionProgressKind === 'sessions', 'progresso deve ser exibido em sessões');

const incompatible = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-1',
  targetId: 'target-1',
  targetName: 'Olhar nos olhos',
  criteria: { minAccuracyPercent: 80, requiredSessions: 3 },
  trials: [measurementTrial('session-1', 'duration', 35)],
  previousEvaluations: [],
  evaluatedAt: '2026-08-17T12:00:00.000Z',
});
assert(incompatible.status === 'INSUFFICIENT_DATA', 'critério incompatível não pode marcar domínio');
assert(incompatible.reasons.some((reason) => reason.code === 'MEASUREMENT_CRITERION_MISMATCH'), 'incompatibilidade deve ser explícita');

const percentage = evaluateTargetMastery({
  organizationId: 'clinic-1',
  patientId: 'patient-1',
  sessionId: 'session-1',
  targetId: 'target-1',
  targetName: 'Olhar nos olhos',
  criteria: { type: 'custom_measure', measure: 'accuracy_percent', operator: 'gte', value: 80, requiredSessions: 1 },
  trials: [measurementTrial('session-1', 'percentage', 100)],
  previousEvaluations: [],
  evaluatedAt: '2026-08-17T12:00:00.000Z',
});
assert(percentage.status === 'READY_FOR_REVIEW', 'coleta percentual deve avaliar o percentual registrado, não flags correct/independent');

console.log('abaMasteryMeasurementMethods.test.ts: ok');
