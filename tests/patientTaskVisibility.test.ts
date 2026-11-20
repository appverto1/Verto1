import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derivePatientTaskVisibility } from '../src/utils/patientTaskVisibility';
const parse = (value: any) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const now = new Date('2026-11-20T20:00:00.000Z');
const tasks = [
  { id: 'due', scheduledAt: '2026-11-20T19:59:59.000Z' },
  { id: 'next', scheduled_at: '2026-11-20T20:00:05.000Z' },
  { id: 'later', scheduled_at: '2026-11-21T10:00:00.000Z' },
  { id: 'completed', completed: true, scheduledAt: '2026-11-20T19:00:00.000Z' },
  { id: 'status-completed', status: 'completed', scheduledAt: '2026-11-20T19:00:00.000Z' },
  { id: 'unscheduled' },
  { id: 'invalid', scheduledAt: 'not-a-date' },
];
const first = derivePatientTaskVisibility(tasks, false, now, parse);
assert.deepEqual(first.visibleTasks.map(t => t.id), ['due'], 'adult portal keeps only due, unfinished tasks');
assert.equal(first.nextDueAt, new Date('2026-11-20T20:00:05.000Z').getTime());
const notYet = derivePatientTaskVisibility(tasks, false, new Date('2026-11-20T20:00:04.999Z'), parse);
assert.deepEqual(notYet.visibleTasks.map(t => t.id), ['due'], 'task not released prematurely');
const ready = derivePatientTaskVisibility(tasks, false, new Date('2026-11-20T20:00:05.000Z'), parse);
assert.deepEqual(ready.visibleTasks.map(t => t.id), ['due', 'next'], 'task released at the exact persisted instant');
assert.equal(ready.nextDueAt, new Date('2026-11-21T10:00:00.000Z').getTime());
const none = derivePatientTaskVisibility([{ id: 'done', completed: true }], false, now, parse);
assert.equal(none.nextDueAt, Infinity, 'no future task = no clock-state rerender');
const kids = derivePatientTaskVisibility(tasks, true, now, parse);
assert.strictEqual(kids.visibleTasks, tasks, 'kids profile keeps the untouched original list reference');
assert.equal(kids.nextDueAt, Infinity);
assert.deepEqual(derivePatientTaskVisibility(null, false, now, parse), { visibleTasks: [], nextDueAt: Infinity });
const panel = readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
assert.match(panel, /nextPatientTaskDueAtRef\.current/);
assert.match(panel, /Date\.now\(\) >= nextPatientTaskDueAtRef\.current/);
assert.match(panel, /setCurrentTime\(new Date\(\)\)/);
assert.doesNotMatch(panel, /setInterval\(\(\) => setCurrentTime\(new Date\(\)\), 5000\)/);
assert.match(panel, /derivePatientTaskVisibility\(tasks, isKidsProfile, currentTime, parseScheduledTaskDate\)/);
console.log('patientTaskVisibility: PASS (due boundaries, legacy behavior, idle clock, kids)');
