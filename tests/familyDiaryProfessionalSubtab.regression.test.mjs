import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const card = readFileSync('src/components/History.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

const diarySubset = detail.slice(
  detail.indexOf('const familyDiaryEntries = useMemo('),
  detail.indexOf('const normalizeNoteText =', detail.indexOf('const familyDiaryEntries = useMemo('))
);
const diaryPanel = detail.slice(
  detail.indexOf("historySubtab === 'family' ? ("),
  detail.indexOf('              </React.Fragment>', detail.indexOf("historySubtab === 'family' ? ("))
);
const timeline = detail.slice(
  detail.indexOf('              <React.Fragment>', detail.indexOf("historySubtab === 'family' ? (")),
  detail.indexOf(") : activeTab === 'notes' ? (")
);

// Existing history is retained; the family view is a subtab, not another top-level area.
assert.match(detail, /role="tablist" aria-label="Seções do histórico"/);
assert.match(detail, /\(\['timeline', 'family'\] as const\)\.map/);
assert.match(detail, /historySubtab === 'family'/);
assert.match(detail, /isKidsProfile && historySubtab === 'family'/);
assert.match(timeline, /Relatórios de sessão/);
assert.match(timeline, /familyItems\.map/);

// One canonical, already-loaded patient history: never a second query or copy of clinical records.
assert.match(diarySubset, /visibleHistoryWithFamilyNotes\.filter/);
assert.match(diarySubset, /recordPatientId === currentPatientId/);
assert.match(diarySubset, /item\?\.type === 'family_note' \|\| item\?\.type === 'photo'/);
assert.doesNotMatch(diarySubset, /fetch\(|dataService\.|\.insert\(|\.upsert\(/);
assert.match(detail, /const scopedFamilyNotes = \(Array\.isArray\(notes\) \? notes : \[\]\)\.filter/);
assert.match(detail, /return Boolean\(currentPatientId && notePatientId && notePatientId === currentPatientId\)/);
assert.doesNotMatch(detail.slice(detail.indexOf('const scopedFamilyNotes ='), detail.indexOf('const milestoneBySource =')), /patientEmail|noteEmail/, 'guardian email must not authorize cross-patient diary notes');
assert.match(detail, /scopedFamilyNotes\.forEach/);
assert.match(detail, /const familyNotes = scopedFamilyNotes/);

// Media, star controls and read permissions reuse the existing scoped history UI.
assert.match(diaryPanel, /familyDiaryEntries\.map/);
assert.match(diaryPanel, /<HistoryCard/);
assert.match(diaryPanel, /onEvaluate=\{onEvaluateHistoryItem\}/);
assert.match(diaryPanel, /\['director', 'coordinator', 'supervisor', 'therapist'\]\.includes\(effectiveCaseTeamRole\)/);
assert.match(card, /<SecureImage src=\{familyImageSource\}/);
assert.match(card, /Validar Marco ⭐/);
assert.match(diaryPanel, /renderHistoryTimelineControls\(\)/);
assert.match(diaryPanel, /historyPagination\.hasMore/);
assert.match(diaryPanel, /requestPatientHistoryPage\(historyPagination\.nextCursor\)/);
assert.match(diaryPanel, /historyPagination\.error/);
assert.match(app, /onRefreshPatientHistory=\{refreshPatientHistoryForProfessional\}/);
console.log('familyDiaryProfessionalSubtab.regression.test.mjs: ok');
