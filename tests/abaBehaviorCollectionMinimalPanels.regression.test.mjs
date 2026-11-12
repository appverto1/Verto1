import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const session = readFileSync('src/components/SessionMode.tsx', 'utf8');
const panels = readFileSync('src/components/AbaSessionBehaviorPanels.tsx', 'utf8');
const feedback = readFileSync('src/utils/abaSessionFeedback.ts', 'utf8');

const durationStart = panels.indexOf('export const AbaActiveDurationsPanel =');
const durationEnd = panels.indexOf('type BehaviorOption', durationStart);
assert.ok(durationStart >= 0 && durationEnd > durationStart, 'shared duration component must exist');
const durationPanel = panels.slice(durationStart, durationEnd);
assert.match(durationPanel, /data-aba-active-duration-panel/);
assert.match(durationPanel, /events\.map\(\(event\) =>/, 'all active behaviors should use one compact panel');
assert.match(durationPanel, /elapsed\(event.startedAt, nowMs\)/, 'timer stays visible');
assert.match(durationPanel, /onClick=\{\(\) => onStop\(event.id\)\}/, 'Stop delegates to existing clinical handler');
assert.match(durationPanel, /onClick=\{\(\) => onOpenAbc\(event.behaviorName\)\}/, 'ABC preserves behavior binding');
assert.match(durationPanel, /disabled=\{Boolean\(lockedStops\[`duration:end:\$\{event.id\}`\]\)\}/, 'duplicate stop locks remain');
assert.doesNotMatch(durationPanel, /sticky top-0|fixed inset-0|backdrop-blur/, 'active behaviors must not create input-blocking overlays');
const durationBinding = session.slice(session.indexOf('const openDurationsPanel ='), session.indexOf('const getDockButtonClass'));
assert.match(durationBinding, /<AbaActiveDurationsPanel/);
assert.match(durationBinding, /events=\{openDurations\}/);
assert.match(durationBinding, /onStop=\{endDuration\}/);
assert.match(durationBinding, /onOpenAbc=\{openAbcModalForBehaviorName\}/);
assert.match(session, /\{!intervalRun && openDurationsPanel\}/, 'normal collection uses compact duration view');
assert.match(session, /\{intervalRun && openDurationsPanel\}/, 'interval collection uses compact duration view');

const abcStart = panels.indexOf('export const AbaQuickAbcPanel =');
assert.ok(abcStart >= 0, 'ABC editor should live in its own component');
const abc = panels.slice(abcStart);
assert.match(abc, /data-aba-abc-nonblocking=\{completed \? undefined : 'true'\}/);
assert.match(abc, /pointer-events-none fixed/, 'ABC should not intercept touches outside the editor');
assert.match(abc, /pointer-events-auto w-full/, 'ABC inputs remain interactive');
assert.match(abc, /onClick=\{onToggleMinimized\}/, 'ABC editor may be reduced while trials continue');
for (const field of ['behaviorId', 'antecedent', 'consequence', 'location', 'severity', 'note']) {
  assert.ok(abc.includes(`value={${field}}`), `ABC field ${field} must be preserved`);
}
assert.match(abc, /onClick=\{onSave\}/, 'save is an explicit editor action');
const abcBinding = session.slice(session.indexOf('const abcModal ='),session.indexOf('if (sessionCompleted && postClosureSummary'));
assert.match(abcBinding, /<AbaQuickAbcPanel/);
for (const binding of ['behaviorId={abcBehaviorId}', 'antecedent={abcAntecedent}', 'consequence={abcConsequence}', 'location={abcLocation}', 'severity={abcSeverity}', 'note={abcNote}']) {
  assert.ok(abcBinding.includes(binding), `ABC clinical state ${binding} must be passed through`);
}
assert.match(abcBinding, /onSave=\{\(\) => void saveAbcEvent\(\)\}/, 'existing Save persistence handler remains authoritative');
assert.match(abcBinding, /onClose=\{\(\) => setAbcModalOpen\(false\)\}/);
assert.match(session, /if \(!sessionCompleted\) setClinicalDockSheetOpen\(false\);\s*setAbcModalOpen\(true\);/, 'quick register sheet closes when ABC opens');
assert.match(session, /const saveAbcEvent = async/, 'clinical Save handler remains');
assert.match(session, /const endDuration = async/, 'duration Stop handler remains');
assert.doesNotMatch(panels, /dataService|supabase|saveAbaV3|fetch\(/, 'presentation must not perform data writes or network requests');

for (const action of ['frequency', 'duration_start', 'duration_end', 'interval', 'abc']) {
  const start = feedback.indexOf(`if (input.action === '${action}')`);
  assert.ok(start >= 0, `missing behavior feedback: ${action}`);
  const end = feedback.indexOf('\n  if (input.action === ', start + 1);
  assert.match(feedback.slice(start, end < 0 ? undefined : end), /minimal:\s*true/, `${action} feedback should be compact`);
}
assert.doesNotMatch(feedback.slice(feedback.indexOf("if (input.action === 'session_end')")), /minimal:\s*true/, 'end-of-session feedback unchanged');
assert.match(session, /data-aba-trial-type-chips/, 'trial selection stays in collection UI');

console.log('abaBehaviorCollectionMinimalPanels.regression.test.mjs: ok');
