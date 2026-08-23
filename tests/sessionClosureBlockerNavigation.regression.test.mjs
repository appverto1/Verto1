import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..');
const sessionMode = fs.readFileSync(path.join(root, 'src/components/SessionMode.tsx'), 'utf8');

// Every closure blocker is rendered as an actionable control instead of passive text.
assert.match(sessionMode, /closureBlockers\.map\(\(item\) => \([\s\S]*?<button[\s\S]*?onClick=\{\(\) => resolveClosureBlocker\(item\)\}/);
assert.match(sessionMode, /Resolver <ArrowRight/);
assert.match(sessionMode, /aria-label=\{`Resolver bloqueio: \$\{item\.label\}`\}/);

// Blockers that can be resolved inside the closure screen jump to the exact control.
assert.match(sessionMode, /item\.key === 'open_duration'[\s\S]*scrollClosureRefIntoView\(closureDurationResolutionRef\)/);
assert.match(sessionMode, /item\.key === 'open_interval_collection'[\s\S]*scrollClosureRefIntoView\(closureIntervalResolutionRef\)/);
assert.match(sessionMode, /item\.key === 'absence_with_clinical_records'[\s\S]*scrollClosureRefIntoView\(closureAttendanceRef\)/);
assert.match(sessionMode, /item\.key === 'absence_reason_required'[\s\S]*scrollClosureRefIntoView\(closureNoteRef\)/);

// ABC is an optional complement and never blocks session closure merely because fields are absent.
assert.doesNotMatch(sessionMode, /required_abc_missing/);
assert.doesNotMatch(sessionMode, /ABC obrigatório pendente/);
assert.doesNotMatch(sessionMode, /abcMissingCounts/);
assert.doesNotMatch(sessionMode, /abcRequirement: 'REQUIRED'/);

// Sync blockers still return to the active session and focus the exact offending record.
assert.match(sessionMode, /v3_failed_trials_require_resolution'[\s\S]*server_sync_required'[\s\S]*unsaved_local_records'[\s\S]*setSessionHistoryOpen\(true\)[\s\S]*focusSessionHistoryRecord\(unsyncedRecord\.id\)/);
assert.match(sessionMode, /data-aba-session-record-id=\{record\.id\}/);

// Therapeutic timers and incomplete trials return directly to the active collection context.
assert.match(sessionMode, /item\.key === 'therapeutic_measurement_timer_open'[\s\S]*returnToActiveSession\(\)[\s\S]*focusTherapeuticTimerGoal\(timer\)/);
assert.match(sessionMode, /item\.key === 'incomplete_trial'[\s\S]*returnToActiveSession\(\)/);

console.log('sessionClosureBlockerNavigation.regression: ok');
