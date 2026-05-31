import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  behaviorAllowsMeasurement,
  formatBehaviorHistoryDetail,
  getBehaviorDefaultMeasurement,
  isDurationOnlyBehavior,
  resolveBehaviorMeasurementForAction
} from '../src/utils/abaBehaviorCapture.ts';
import { normalizeQuickBehaviorShortcuts } from '../src/utils/abaClinicalDock.ts';
import { buildSessionReport, calculateSessionSummary } from '../src/utils/abaSessionSummary.ts';

const root = process.cwd();
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const durationOnlyBehavior = {
  id: 'crying',
  name: 'Choro',
  defaultMeasurement: 'duration',
  allowedMeasurements: ['duration']
};

const frequencyBehavior = {
  id: 'aggression',
  name: 'Agressão',
  defaultMeasurement: 'frequency',
  allowedMeasurements: ['frequency']
};

test('duration-only behavior normalizes stale frequency actions back to duration', () => {
  assert.equal(isDurationOnlyBehavior(durationOnlyBehavior), true);
  assert.equal(getBehaviorDefaultMeasurement(durationOnlyBehavior), 'duration');
  assert.equal(behaviorAllowsMeasurement(durationOnlyBehavior, 'frequency'), false);
  assert.equal(resolveBehaviorMeasurementForAction(durationOnlyBehavior, 'frequency'), 'duration');
  assert.equal(resolveBehaviorMeasurementForAction(frequencyBehavior, 'frequency'), 'frequency');
});

test('dock shortcuts cannot force + frequency for Choro or Fuga when they are duration-only', () => {
  const shortcuts = normalizeQuickBehaviorShortcuts([
    { behaviorId: 'crying', label: 'Choro +1', method: 'frequency', priority: 1, visibleInDock: true },
    { behaviorId: 'escape', label: 'Fuga +1', method: 'frequency', priority: 2, visibleInDock: true },
    { behaviorId: 'aggression', label: 'Agressão +1', method: 'frequency', priority: 3, visibleInDock: true }
  ], [
    durationOnlyBehavior,
    { id: 'escape', name: 'Fuga da atividade', defaultMeasurement: 'duration', allowedMeasurements: ['duration'] },
    frequencyBehavior
  ]);
  assert.equal(shortcuts.find((shortcut) => shortcut.behaviorId === 'crying')?.method, 'duration');
  assert.equal(shortcuts.find((shortcut) => shortcut.behaviorId === 'escape')?.method, 'duration');
  assert.equal(shortcuts.find((shortcut) => shortcut.behaviorId === 'aggression')?.method, 'frequency');
});

test('duration history includes duration, severity and location in one human label', () => {
  assert.equal(formatBehaviorHistoryDetail({
    measurementType: 'duration',
    durationSeconds: 133,
    severity: 2,
    location: 'Mesa',
    status: 'COMPLETED'
  }), 'Duração 02:13 · severidade 2 · Mesa');
});

test('duration episodes derive occurrence counts without frequency duplication', () => {
  const summary = calculateSessionSummary('session-1', {
    behaviorEvents: [
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 80, status: 'COMPLETED', location: 'Mesa', severity: 2 },
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', durationSeconds: 40, status: 'COMPLETED', location: 'Mesa', severity: 4 },
      { sessionId: 'session-1', behaviorName: 'Choro', measurementType: 'duration', status: 'IN_PROGRESS', location: 'Mesa', severity: 3 },
      { sessionId: 'session-1', behaviorName: 'Agressão', measurementType: 'frequency', countDelta: 1, location: 'Sala', severity: 3 }
    ]
  });
  assert.equal(summary.durationSummary.find((item) => item.behaviorName === 'Choro')?.episodes, 2);
  assert.equal(summary.durationSummary.find((item) => item.behaviorName === 'Choro')?.totalSeconds, 120);
  assert.equal(summary.frequencySummary.find((item) => item.behaviorName === 'Choro'), undefined);
  assert.equal(summary.frequencySummary.find((item) => item.behaviorName === 'Agressão')?.occurrences, 1);

  const report = buildSessionReport(summary, {
    behaviorRecords: [
      { title: 'Choro', measurementType: 'duration', durationSeconds: 80, status: 'COMPLETED', location: 'Mesa', severity: 2 },
      { title: 'Choro', measurementType: 'duration', durationSeconds: 40, status: 'COMPLETED', location: 'Mesa', severity: 4 },
      { title: 'Choro', measurementType: 'duration', status: 'IN_PROGRESS', location: 'Mesa', severity: 3 },
      { title: 'Agressão', measurementType: 'frequency', countDelta: 1, location: 'Sala', severity: 3 }
    ]
  });
  const choroDuration = report.behaviorSummaries.duration.find((item) => item.behavior === 'Choro');
  assert.equal(choroDuration?.episodes, 2);
  assert.equal(choroDuration?.totalSeconds, 120);
  assert.equal(report.behaviorSummaries.frequency.find((item) => item.behavior === 'Choro'), undefined);
});

test('SessionMode renders duration-only actions without + ocorrência inside duration block', () => {
  assert.match(sessionModeCode, /id: 'crying'[\s\S]*?allowedMeasurements: \['duration'\]/m);
  assert.match(sessionModeCode, /id: 'escape'[\s\S]*?allowedMeasurements: \['duration'\]/m);
  const durationBlockStart = sessionModeCode.indexOf("{behaviorMeasurementType === 'duration'");
  const durationBlockEnd = sessionModeCode.indexOf("{behaviorMeasurementType === 'rate'", durationBlockStart);
  const durationBlock = sessionModeCode.slice(durationBlockStart, durationBlockEnd);
  assert.match(durationBlock, /Iniciar dura/);
  assert.match(durationBlock, /Encerrar/);
  assert.match(durationBlock, /ABC rapido/);
  assert.doesNotMatch(durationBlock, /\+ ocorr/);
  assert.match(sessionModeCode, /aria-pressed=\{selectedLocation === location\}/m);
  assert.match(sessionModeCode, /aria-pressed=\{selectedSeverity === severity\}/m);
});

for (const item of tests) {
  item.fn();
  console.log(`[ok] ${item.name}`);
}
