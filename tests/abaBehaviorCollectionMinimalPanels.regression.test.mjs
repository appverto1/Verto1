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
const sessionContent = session.slice(session.indexOf('const sessionModeContent ='));
const mainHeaderAt = sessionContent.indexOf('data-aba-session-compact-header');
const durationHeaderAt = sessionContent.indexOf('data-aba-active-duration-pinned-header');
const scrollContainerAt = sessionContent.indexOf('ref={sessionScrollRef}');
assert.ok(mainHeaderAt >= 0 && mainHeaderAt < durationHeaderAt && durationHeaderAt < scrollContainerAt,
  'active duration controls must stay below the session header and outside the scrolling collection area');
const pinnedDurationArea = sessionContent.slice(mainHeaderAt, scrollContainerAt);
assert.match(pinnedDurationArea, /shrink-0/, 'duration header must remain visible while the collection area scrolls');
assert.match(pinnedDurationArea, /max-h-\[32dvh\].*overflow-y-auto/, 'multiple durations must not cover the entire viewport');
assert.match(pinnedDurationArea, /\{openDurationsPanel\}/, 'the shared Stop and ABC controls remain mounted during collection');
assert.doesNotMatch(sessionContent.slice(scrollContainerAt), /\{(?:!intervalRun && |intervalRun && )?openDurationsPanel\}/,
  'duration controls must not be duplicated inside a scrolling pane');

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
