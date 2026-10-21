import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync('src/components/History.tsx', 'utf8');
const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const scope = readFileSync('src/utils/patientClinicalAccess.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

const historyRoute = server.slice(server.indexOf("app.patch('/api/history/:historyId'"), server.indexOf("app.delete('/api/history/:historyId'"));
assert.ok(historyRoute.includes('executeAuthorizedHistoryScoreMutation'));
assert.ok(historyRoute.includes("'write'"), 'star edits must use the patient link write scope');
assert.match(scope, /recordType === 'family_note' \|\| recordType === 'photo'/);
assert.match(scope, /score !== 0 && score !== 1/);
assert.match(scope, /if \(!params\.hasWriteAccess\)/);

// History-backed family records use the authorized history endpoint.
// Older synthetic note-only records are read-only until their distinct
// note PATCH endpoint enforces the same case-team write authority.
assert.match(card, /isTherapist && isFamilyEntry && \(/);
assert.match(card, /const \[isSavingMilestone, setIsSavingMilestone\] = useState\(false\)/);
assert.match(card, /if \(savingMilestoneRef\.current\) return/);
assert.match(card, /savingMilestoneRef\.current = true/);
assert.match(card, /savingMilestoneRef\.current = false/);
assert.match(card, /await emitEvaluate\(/);
assert.match(card, /disabled=\{isSavingMilestone\}/);
assert.match(card, /aria-busy=\{isSavingMilestone\}/);
assert.match(card, /Remover Estrelinha/);
assert.match(card, /Validar Marco ⭐/);
assert.match(detail, /isTherapist=\{\['director', 'coordinator', 'supervisor', 'therapist'\]\.includes\(effectiveCaseTeamRole\)\}/);
assert.match(app, /await dataService\.updateHistoryItem\(String\(rawId\)/);
assert.match(app, /setHistory\(previousHistory\)/);
console.log('familyDiaryMilestoneSafety.regression.test.mjs: ok');
