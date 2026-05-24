import assert from 'node:assert/strict';
import { buildSessionReport, calculateSessionSummary, canCloseAbaSession, canRecordInAbaSession } from '../src/utils/abaSessionSummary.ts';
import { isAbaV2Enabled, resolveFeatureFlag } from '../src/utils/featureFlags.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('sessão sem pendências pode ser encerrada', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: null });
  assert.equal(result.canClose, true);
  assert.deepEqual(result.blockers, []);
});

test('bloqueio por duração aberta', () => {
  const result = canCloseAbaSession({ openDurations: [{ id: 'duration-1' }], intervalRun: null });
  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'open_duration');
});

test('bloqueio por intervalo aberto', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: { id: 'interval-1' } });
  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'open_interval_collection');
});

test('sessão com dado ainda não salvo localmente não pode ser encerrada', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: null, unsavedLocalCount: 1 });
  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'unsaved_local_records');
});

test('encerramento permitido com avisos', () => {
  const summary = calculateSessionSummary('session-1', {
    warningItems: [{ key: 'recommended_abc_missing', label: 'ABC recomendado pendente' }]
  });
  const result = canCloseAbaSession({ openDurations: [], intervalRun: null });
  assert.equal(result.canClose, true);
  assert.equal(summary.warningItems.length, 1);
  assert.equal(summary.blockingItems.length, 0);
});

test('resumo de frequência calcula corretamente', () => {
  const summary = calculateSessionSummary('session-1', {
    startedAt: '2026-05-23T10:00:00.000Z',
    endedAt: '2026-05-23T11:00:00.000Z',
    behaviorEvents: [
      { sessionId: 'session-1', behaviorName: 'Agressao', measurementType: 'frequency', countDelta: 1 },
      { sessionId: 'session-1', behaviorName: 'Agressao', measurementType: 'frequency', countDelta: 2 }
    ]
  });
  assert.equal(summary.frequencySummary[0].behaviorName, 'Agressao');
  assert.equal(summary.frequencySummary[0].occurrences, 3);
});

test('resumo de duração calcula total, média e máximo', () => {
  const summary = calculateSessionSummary('session-1', {
    behaviorEvents: [
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 80 },
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 120 }
    ]
  });
  assert.equal(summary.durationSummary[0].episodes, 2);
  assert.equal(summary.durationSummary[0].totalSeconds, 200);
  assert.equal(summary.durationSummary[0].averageSeconds, 100);
  assert.equal(summary.durationSummary[0].maxSeconds, 120);
});

test('resumo de intervalo calcula SIM, NÃO e percentual', () => {
  const summary = calculateSessionSummary('session-1', {
    behaviorEvents: [
      { sessionId: 'session-1', behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: true },
      { sessionId: 'session-1', behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: false }
    ]
  });
  assert.equal(summary.intervalSummary[0].totalIntervals, 2);
  assert.equal(summary.intervalSummary[0].occurredCount, 1);
  assert.equal(summary.intervalSummary[0].notOccurredCount, 1);
  assert.equal(summary.intervalSummary[0].occurrencePercent, 50);
});

test('resumo de intervalo usa agregado sem duplicar intervalos individuais', () => {
  const summary = calculateSessionSummary('session-1', {
    behaviorEvents: [
      { sessionId: 'session-1', behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: true },
      { sessionId: 'session-1', behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: false },
      { sessionId: 'session-1', behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalAggregate: true, totalIntervals: 2, occurredCount: 1 }
    ]
  });
  assert.equal(summary.intervalSummary[0].totalIntervals, 2);
  assert.equal(summary.intervalSummary[0].occurredCount, 1);
  assert.equal(summary.intervalSummary[0].notOccurredCount, 1);
  assert.equal(summary.intervalSummary[0].occurrencePercent, 50);
});

test('tentativas calculam acerto e independência corretamente', () => {
  const summary = calculateSessionSummary('session-1', {
    trials: [
      { sessionId: 'session-1', targetName: 'Nomeia item', collectionType: 'dtt', trialOutcome: 'independent', score: 1 },
      { sessionId: 'session-1', targetName: 'Nomeia item', collectionType: 'net', trialOutcome: 'prompted', score: 0.5 },
      { sessionId: 'session-1', targetName: 'Nomeia item', collectionType: 'cold_probe', trialOutcome: 'error', score: 0 }
    ]
  });
  assert.equal(summary.totalTrials, 3);
  assert.equal(summary.independentTrials, 1);
  assert.equal(summary.promptedTrials, 1);
  assert.equal(summary.errorTrials, 1);
  assert.equal(summary.accuracyPercent, 67);
  assert.equal(summary.independencePercent, 33);
  assert.deepEqual(summary.teachingSummary.typesUsed, ['DTT', 'NET', 'Cold Probe']);
  assert.deepEqual(summary.trialTypesUsed, ['DTT', 'NET', 'Cold Probe']);
});

test('resumo persistente preserva bloqueios e avisos de encerramento separados', () => {
  const summary = calculateSessionSummary('session-1', {
    blockingItems: [{ key: 'open_duration', label: 'Duração aberta', blocking: true }],
    warningItems: [{ key: 'session_note_pending', label: 'Observação da sessão pendente' }],
    masterySummary: [{ name: 'Nomeia itens', criterion: '2/3 dias', performanceText: '2/2 acertos', contributes: true, status: 'critério atingido hoje' }],
    sessionNote: 'Sessão produtiva.'
  });
  assert.equal(summary.blockingItems.length, 1);
  assert.equal(summary.warningItems.length, 1);
  assert.equal(summary.pendingItems.length, 1);
  assert.equal(summary.pendingWarnings.length, 1);
  assert.equal(summary.masterySummary[0].status, 'critério atingido hoje');
  assert.equal(summary.sessionNote, 'Sessão produtiva.');
});

test('sessão COMPLETED não aceita novos registros', () => {
  assert.equal(canRecordInAbaSession({ status: 'COMPLETED' }), false);
  assert.equal(canRecordInAbaSession({ status: 'completed' }), false);
  assert.equal(canRecordInAbaSession({ sessionCompleted: true, status: 'active' }), false);
  assert.equal(canRecordInAbaSession({ sessionCompleted: false, status: 'active' }), true);
});

test('relatório da sessão deriva dados sem nova tabela ou duplicação clínica', () => {
  const summary = calculateSessionSummary('session-1', {
    patientId: 'patient-1',
    patientName: 'Paciente Teste',
    therapistId: 'therapist-1',
    startedAt: '2026-05-24T10:00:00.000Z',
    endedAt: '2026-05-24T11:00:00.000Z',
    sessionNote: 'Sessão produtiva.',
    warningItems: [{ key: 'guardian_signature_pending', label: 'Assinatura pendente', count: 1 }],
    trials: [
      { id: 't1', kind: 'trial', sessionId: 'session-1', title: 'Nomear cores', collectionType: 'dtt', promptLevelKey: 'independent', trialOutcome: 'independent', score: 1, correct: true, independent: true, programName: 'Comunicação' },
      { id: 't2', kind: 'trial', sessionId: 'session-1', title: 'Nomear cores', collectionType: 'dtt', promptLevelKey: 'visual', trialOutcome: 'prompted', score: 0.5, correct: true, independent: false, programName: 'Comunicação' },
      { id: 't3', kind: 'trial', sessionId: 'session-1', title: 'Imitação motora', collectionType: 'net', promptLevelKey: 'error', trialOutcome: 'error', score: 0, correct: false, independent: false, programName: 'Imitação' }
    ],
    behaviorEvents: [
      { id: 'b1', kind: 'behavior', sessionId: 'session-1', behaviorName: 'Agressao', measurementType: 'frequency', countDelta: 2, location: 'Sala', severity: 3, timestamp: '2026-05-24T10:10:00.000Z' },
      { id: 'b2', kind: 'behavior', sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 120, location: 'Mesa', severity: 2, timestamp: '2026-05-24T10:20:00.000Z' },
      { id: 'b3', kind: 'behavior', sessionId: 'session-1', behaviorName: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: true, intervalSeconds: 30, location: 'Sala', severity: 1, timestamp: '2026-05-24T10:30:00.000Z' },
      { id: 'b4', kind: 'behavior', sessionId: 'session-1', behaviorName: 'Recusa', measurementType: 'abc', antecedent: 'Demanda apresentada', consequence: 'Pausa breve', location: 'Mesa', severity: 2, notes: 'Redirecionado.' }
    ],
    masterySummary: [{ id: 'goal-1', name: 'Nomear cores', criterion: '2 acertos', performanceText: '2/2 acertos', contributes: true, status: 'critério atingido hoje' }]
  });
  const report = buildSessionReport({
    ...summary,
    therapistName: 'Terapeuta Teste',
    sourceRecords: [
      { id: 't1', kind: 'trial', title: 'Nomear cores', collectionType: 'dtt', promptLevelKey: 'independent', trialOutcome: 'independent', score: 1, correct: true, independent: true, programName: 'Comunicação' },
      { id: 't2', kind: 'trial', title: 'Nomear cores', collectionType: 'dtt', promptLevelKey: 'visual', trialOutcome: 'prompted', score: 0.5, correct: true, independent: false, programName: 'Comunicação' },
      { id: 't3', kind: 'trial', title: 'Imitação motora', collectionType: 'net', promptLevelKey: 'error', trialOutcome: 'error', score: 0, correct: false, independent: false, programName: 'Imitação' },
      { id: 'b1', kind: 'behavior', title: 'Agressao', measurementType: 'frequency', countDelta: 2, location: 'Sala', severity: 3, timestamp: '2026-05-24T10:10:00.000Z' },
      { id: 'b2', kind: 'behavior', title: 'Choro', measurementType: 'duration', durationSeconds: 120, location: 'Mesa', severity: 2, timestamp: '2026-05-24T10:20:00.000Z' },
      { id: 'b3', kind: 'behavior', title: 'Estereotipia', measurementType: 'partial_interval', intervalOccurred: true, intervalSeconds: 30, location: 'Sala', severity: 1, timestamp: '2026-05-24T10:30:00.000Z' },
      { id: 'b4', kind: 'behavior', title: 'Recusa', measurementType: 'abc', antecedent: 'Demanda apresentada', consequence: 'Pausa breve', location: 'Mesa', severity: 2, notes: 'Redirecionado.' }
    ]
  });
  assert.equal(report.header.patient, 'Paciente Teste');
  assert.equal(report.header.therapist, 'Terapeuta Teste');
  assert.equal(report.generalSummary.totalTeachingTrials, 3);
  assert.equal(report.teachingSummary.promptsUsed.some((prompt) => prompt.key === 'visual'), true);
  assert.equal(report.targetSummaries.find((target) => target.targetName === 'Nomear cores')?.masteryStatus, 'critério atingido hoje');
  assert.equal(report.behaviorSummaries.frequency[0].totalOccurrences, 2);
  assert.equal(report.behaviorSummaries.duration[0].totalSeconds, 120);
  assert.equal(report.behaviorSummaries.interval[0].intervalSeconds, 30);
  assert.equal(summary.abcSummary.find((item) => item.behaviorName === 'Recusa')?.completedEvents, 1);
  assert.equal(report.abcEvents.length, 1);
  assert.equal(report.pendingComplements.guardianSignature, 'pending');
});

test('aba_v2=false preserva o fluxo antigo fora da ABA V2', () => {
  assert.equal(isAbaV2Enabled({ overrides: { aba_v2: false } }), false);
  assert.equal(resolveFeatureFlag('aba_v2', { defaultValue: true, overrides: { VITE_FEATURE_ABA_V2: 'false' } }), false);
  assert.equal(isAbaV2Enabled({ overrides: { FEATURE_ABA_V2: 'true' } }), true);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
