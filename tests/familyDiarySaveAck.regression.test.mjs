import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const diaryStart = dashboard.indexOf('  const handleConfirmFamilyNote = async () => {');
const noteStart = dashboard.indexOf('  const saveFamilyAnnotation = async () => {');
assert.ok(diaryStart >= 0 && noteStart >= 0, 'both save handlers must exist');
const diary = dashboard.slice(diaryStart, dashboard.indexOf('  const formatDiaryTimestamp =', diaryStart));
const note = dashboard.slice(noteStart, dashboard.indexOf('  const openPortalPatientFile =', noteStart));

for (const [label, handler, ref] of [['diary', diary, 'familySaveInFlightRef'], ['note', note, 'familyAnnotationInFlightRef']]) {
  assert.match(handler, new RegExp(ref + '\\.current'), label + ' must reject a synchronous duplicate');
  assert.match(handler, /\?\.success !== true/, label + ' must reject absent/ambiguous ACK');
  assert.match(handler, new RegExp(ref + '\\.current = false'), label + ' must release the guard');
}
assert.match(diary, /historyWriteAttempted = true;[\s\S]*await onAddFamilyNote/);
assert.match(diary, /uploadedPathThisAttempt && !historyWriteAttempted/, 'uncertain writes must preserve possibly referenced photos');
assert.match(note, /result\?\.pending === true \|\| result\?\.offline === true/, 'queued notes must not claim server delivery');
assert.match(note, /catch \(error: any\)/, 'a rejected note save must report error and retain draft');
console.log('familyDiarySaveAck.regression.test.mjs: ok');
