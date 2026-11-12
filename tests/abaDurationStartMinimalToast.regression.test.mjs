import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const feedback = readFileSync('src/utils/abaSessionFeedback.ts', 'utf8');
const session = readFileSync('src/components/SessionMode.tsx', 'utf8');

const durationStartAt = feedback.indexOf("if (input.action === 'duration_start')");
const durationEndAt = feedback.indexOf("if (input.action === 'duration_end')", durationStartAt);
assert.ok(durationStartAt > 0 && durationEndAt > durationStartAt, 'duration toast cases should remain independent');
const startToast = feedback.slice(durationStartAt, durationEndAt);
const endToast = feedback.slice(durationEndAt, feedback.indexOf("if (input.action === 'trial')", durationEndAt));
assert.match(startToast, /minimal:\s*true/, 'duration start confirmation should use minimal presentation');
assert.match(startToast, /compactTitle:\s*`⏱ \$\{input\.behaviorName\} iniciado`/, 'duration start confirmation should identify the behavior');
assert.doesNotMatch(endToast, /minimal:\s*true/, 'duration end confirmation should keep the existing presentation');

assert.match(session, /const subtitle = toast\.minimal \? null : compact \?/, 'minimal confirmation should take only one line');
assert.match(session, /const actionToastMinimal = Boolean\(actionToast\?\.minimal\)/);
assert.match(session, /compact=\{intervalToastCompact \|\| actionToastMinimal\}/, 'only opt-in and existing interval toasts should render compactly');
assert.match(session, /const actionToastPositionClass = actionToastMinimal\s*\? 'top-\[calc\(4\.75rem/, 'minimal confirmation should not obscure the collection area');
assert.match(session, /intervalToastCompact \|\| toast\.minimal \? 1500 : 2000/, 'minimal confirmation should disappear quickly');

assert.match(session, /setOpenDurations\(\(prev\) => \[openEvent, \.\.\.prev\]\)/, 'duration start still opens a timed event');
assert.match(session, /void saveBehaviorEvent\(payload/, 'clinical event persistence remains in place');
assert.match(session, /const endDuration = async/, 'duration stop handler must remain present');

console.log('abaDurationStartMinimalToast.regression.test.mjs: ok');
