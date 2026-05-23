import assert from 'node:assert/strict';
import { calculateSessionSummary, canCloseAbaSession } from '../src/utils/abaSessionSummary.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('sessao sem pendencias pode ser encerrada', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: null });
  assert.equal(result.canClose, true);
  assert.deepEqual(result.blockers, []);
});

test('sessao com duracao aberta nao pode ser encerrada', () => {
  const result = canCloseAbaSession({ openDurations: [{ id: 'duration-1' }], intervalRun: null });
  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'open_duration');
});

test('sessao com coleta por intervalo aberta nao pode ser encerrada', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: { id: 'interval-1' } });
  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'open_interval_collection');
});

test('resumo de frequencia calcula corretamente', () => {
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

test('resumo de duracao calcula total, media e maximo', () => {
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

test('resumo de intervalo calcula SIM, NAO e percentual', () => {
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

test('tentativas calculam acuracia e independencia corretamente', () => {
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
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
