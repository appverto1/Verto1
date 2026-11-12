import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const session = readFileSync('src/components/SessionMode.tsx', 'utf8');
const feedback = readFileSync('src/utils/abaSessionFeedback.ts', 'utf8');

const durationStart = session.indexOf('const openDurationsPanel = openDurations.length > 0 ? (');
const durationEnd = session.indexOf('const getDockButtonClass', durationStart);
assert.ok(durationStart >= 0 && durationEnd > durationStart, 'shared duration UI must exist');
const durationPanel = session.slice(durationStart, durationEnd);
assert.match(durationPanel, /data-aba-active-duration-panel/);
assert.match(durationPanel, /openDurations\.map\(\(event\) =>/, 'must support every active behavior, not just choro');
assert.match(durationPanel, /formatElapsed\(event.startedAt, nowMs\)/, 'timer stays visible');
assert.match(durationPanel, /onClick=\{\(\) => endDuration\(event.id\)\}/, 'Stop retains existing clinical handler');
assert.match(durationPanel, /onClick=\{\(\) => openAbcModalForBehaviorName\(event.behaviorName\)\}/, 'ABC keeps behavior-specific binding');
assert.match(durationPanel, /disabled=\{Boolean\(actionLocks\[`duration:end:\$\{event.id\}`\]\)\}/, 'prevent duplicate stops');
assert.doesNotMatch(durationPanel, /sticky top-0|fixed inset-0|backdrop-blur/, 'ongoing timers must not block trial inputs');
assert.match(session, /\{!intervalRun && openDurationsPanel\}/, 'shared compact UI must be used in normal collection');
assert.match(session, /\{intervalRun && openDurationsPanel\}/, 'shared compact UI must be used in parallel with intervals');

const abcStart = session.indexOf('const abcModal = abcModalOpen ? (');
const abcEnd = session.indexOf('if (sessionCompleted && postClosureSummary', abcStart);
assert.ok(abcStart >= 0 && abcEnd > abcStart, 'ABC form must exist');
const abc = session.slice(abcStart, abcEnd);
assert.match(abc, /data-aba-abc-nonblocking=\{sessionCompleted \? undefined : 'true'\}/);
assert.match(abc, /pointer-events-none fixed/, 'ABC must not intercept taps outside its panel');
assert.match(abc, /pointer-events-auto w-full/, 'ABC form controls remain interactive');
assert.match(abc, /setAbcPanelMinimized\(\(minimized\) => !minimized\)/, 'ABC panel may be reduced while attempts continue');
for (const field of ['abcBehaviorId', 'abcAntecedent', 'abcConsequence', 'abcLocation', 'abcSeverity', 'abcNote']) {
  assert.ok(abc.includes(`value={${field}}`), `ABC clinical field ${field} must be preserved`);
}
assert.match(abc, /onClick=\{\(\) => void saveAbcEvent\(\)\}/, 'only explicit Save persists ABC');
assert.match(session, /if \(!sessionCompleted\) setClinicalDockSheetOpen\(false\);\s*setAbcModalOpen\(true\);/, 'opening ABC must close blocking quick-register sheet');
assert.match(session, /const saveAbcEvent = async/, 'save handler must remain');

for (const action of ['frequency', 'duration_start', 'duration_end', 'interval', 'abc']) {
  const start = feedback.indexOf(`if (input.action === '${action}')`);
  assert.ok(start >= 0, `missing behavior toast: ${action}`);
  const end = feedback.indexOf('\n  if (input.action === ', start + 1);
  assert.match(feedback.slice(start, end < 0 ? undefined : end), /minimal:\s*true/, `${action} toast should be minimal`);
}
assert.doesNotMatch(feedback.slice(feedback.indexOf("if (input.action === 'session_end')")), /minimal:\s*true/, 'session-end feedback retains original style');
assert.match(session, /data-aba-trial-type-chips/, 'trial entry remains in the collection layout');

console.log('abaBehaviorCollectionMinimalPanels.regression.test.mjs: ok');
