import assert from 'node:assert/strict';
import {
  buildIntervalAggregateSummary,
  buildIntervalCancelAudit,
  getIntervalRunStatus,
  isActiveIntervalCollection,
  pauseIntervalRunState,
  resumeIntervalRunState
} from '../src/utils/abaIntervalLifecycle.ts';
import { calculateSessionSummary, canCloseAbaSession } from '../src/utils/abaSessionSummary.ts';

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const baseRun = {
  id: 'interval-run-1',
  behaviorName: 'Estereotipia',
  behaviorId: 'stereotypy',
  measurementType: 'partial_interval',
  method: 'partial_interval',
  startedAt: '2026-05-24T10:00:00.000Z',
  intervalStartedAt: '2026-05-24T10:01:00.000Z',
  intervalEndsAt: '2026-05-24T10:01:30.000Z',
  intervalSeconds: 30,
  intervalIndex: 3,
  totalIntervals: 10,
  completedCount: 2,
  occurredCount: 1,
  awaitingResponse: false,
  paused: false
};

test('pausar coleta mantém respostas anteriores', () => {
  const paused = pauseIntervalRunState(baseRun, {
    nowMs: Date.parse('2026-05-24T10:01:10.000Z'),
    pausedAt: '2026-05-24T10:01:10.000Z'
  });

  assert.equal(getIntervalRunStatus(paused), 'PAUSED');
  assert.equal(paused.completedCount, 2);
  assert.equal(paused.occurredCount, 1);
  assert.equal(paused.intervalIndex, 3);
  assert.equal(paused.pauseRemainingMs, 20000);
});

test('retomar continua do intervalo correto', () => {
  const paused = pauseIntervalRunState(baseRun, {
    nowMs: Date.parse('2026-05-24T10:01:10.000Z'),
    pausedAt: '2026-05-24T10:01:10.000Z'
  });
  const resumed = resumeIntervalRunState(paused, { resumedAt: '2026-05-24T10:03:00.000Z' });

  assert.equal(getIntervalRunStatus(resumed), 'RUNNING');
  assert.equal(resumed.intervalIndex, 3);
  assert.equal(resumed.completedCount, 2);
  assert.equal(resumed.occurredCount, 1);
  assert.equal(resumed.intervalEndsAt, '2026-05-24T10:03:20.000Z');
});

test('finalizar agora cria resumo parcial', () => {
  const summary = buildIntervalAggregateSummary(baseRun, {
    answeredIntervals: 4,
    yesCount: 2,
    endedAt: '2026-05-24T10:04:00.000Z',
    status: 'PARTIALLY_COMPLETED',
    endReason: 'mudanca_atividade'
  });

  assert.equal(summary.status, 'PARTIALLY_COMPLETED');
  assert.equal(summary.plannedIntervals, 10);
  assert.equal(summary.answeredIntervals, 4);
  assert.equal(summary.totalIntervals, 4);
  assert.equal(summary.yesCount, 2);
  assert.equal(summary.noCount, 2);
  assert.equal(summary.occurrencePercent, 50);
  assert.equal(summary.endedEarlyAt, '2026-05-24T10:04:00.000Z');
});

test('resumo parcial calcula percentual corretamente', () => {
  const summary = buildIntervalAggregateSummary(baseRun, {
    answeredIntervals: 3,
    yesCount: 2,
    endedAt: '2026-05-24T10:04:00.000Z'
  });

  assert.equal(summary.status, 'PARTIALLY_COMPLETED');
  assert.equal(summary.noCount, 1);
  assert.equal(summary.occurrencePercent, 67);
});

test('cancelar não entra no resumo clínico', () => {
  const audit = buildIntervalCancelAudit(baseRun, {
    cancelledAt: '2026-05-24T10:05:00.000Z',
    cancelReason: 'erro_configuracao'
  });
  const summary = calculateSessionSummary('session-1', {
    behaviorEvents: [
      {
        sessionId: 'session-1',
        behaviorName: 'Estereotipia',
        measurementType: 'partial_interval',
        intervalAggregate: true,
        totalIntervals: audit.totalIntervals,
        occurredCount: audit.occurredCount,
        collectionStatus: audit.collectionStatus,
        cancelledAt: audit.cancelledAt
      }
    ]
  });

  assert.equal(audit.status, 'CANCELLED');
  assert.equal(summary.intervalSummary.length, 0);
});

test('sessão não encerra com coleta RUNNING', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: { ...baseRun, status: 'RUNNING' } });

  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'open_interval_collection');
});

test('sessão não encerra com coleta PAUSED sem decisão', () => {
  const result = canCloseAbaSession({ openDurations: [], intervalRun: { ...baseRun, status: 'PAUSED', paused: true } });

  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0].key, 'open_interval_collection');
});

test('SIM/NÃO continuam prioritários durante AWAITING_RESPONSE', () => {
  const awaiting = { ...baseRun, status: 'AWAITING_RESPONSE', awaitingResponse: true };

  assert.equal(getIntervalRunStatus(awaiting), 'AWAITING_RESPONSE');
  assert.equal(isActiveIntervalCollection(awaiting), true);
  assert.equal(awaiting.awaitingResponse, true);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
