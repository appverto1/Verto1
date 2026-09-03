import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  externalTimelineClinicalDateLabel,
  externalTimelineComparisonGroups,
  externalTimelineLatestMonth,
  externalTimelineNavigationMonths,
  externalTimelineYears,
  groupExternalTimelineItemsByMonth,
  updateExternalTimelineComparisonSelection,
} from '../src/utils/externalPatientTimelinePresentation.mjs';

const timeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const central = fs.readFileSync(new URL('../src/components/ExternalCareNetworkCentral.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

// Temporal semantics: month competence is clinical truth; technical createdAt is never rendered as clinical day.
const mayGroup = groupExternalTimelineItemsByMonth([
  { grantId: 'may-technical-september', monthKey: '2026-05-01', createdAt: '2026-09-03T11:50:00Z', sharedAt: '2026-09-03T11:50:00Z' },
]);
assert.equal(mayGroup[0].key, '2026-05');
assert.equal(externalTimelineClinicalDateLabel(undefined), '');
assert.equal(externalTimelineClinicalDateLabel('2026-05-25'), '25 MAI');
assert.match(timeline, /externalTimelineClinicalDateLabel\(item\.clinicalDate\)/);
assert.doesNotMatch(timeline, /formatEvolutionDate\(item\.createdAt\)/);
assert.match(timeline, /Compartilhado em/);

// 12 authorized months: latest opens first, navigation is calendar-ascending, longitudinal groups remain reverse chronological.
const months = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, '0');
  return { grantId: `grant-${month}`, monthKey: `2026-${month}-01`, slot: 1 };
});
const groups = groupExternalTimelineItemsByMonth(months);
assert.equal(groups.length, 12);
assert.deepEqual(groups.map((group) => group.key), ['2026-12','2026-11','2026-10','2026-09','2026-08','2026-07','2026-06','2026-05','2026-04','2026-03','2026-02','2026-01']);
assert.equal(externalTimelineLatestMonth(groups, '2026'), '2026-12');
assert.deepEqual(externalTimelineNavigationMonths(groups, '2026').map((group) => group.key), ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']);
assert.deepEqual(externalTimelineYears(groups), ['2026']);

// Comparison selects at most two visible period keys and preserves explicit A/B order.
let selection = [];
selection = updateExternalTimelineComparisonSelection(selection, '2026-05-01');
selection = updateExternalTimelineComparisonSelection(selection, '2026-09-01');
assert.deepEqual(selection, ['2026-05', '2026-09']);
selection = updateExternalTimelineComparisonSelection(selection, '2026-07-01');
assert.deepEqual(selection, ['2026-05', '2026-07']);
assert.deepEqual(externalTimelineComparisonGroups(groups, ['2026-05', '2026-09']).map((group) => group.key), ['2026-05', '2026-09']);

// UI keeps one active month expanded, other chapters represented, and comparison is client-side over loaded groups.
assert.match(timeline, /const expanded = activeMonth === group\.key/);
assert.match(timeline, /aria-expanded=\{expanded\}/);
assert.match(timeline, /Ver período/);
assert.match(timeline, /comparisonMode === 'selecting'/);
assert.match(timeline, /aria-selected=/);
assert.match(timeline, /externalTimelineComparisonGroups\(monthGroups, comparisonSelection\)/);
assert.match(timeline, /lg:grid-cols-2/);
assert.match(timeline, /Período \{groupIndex === 0 \? 'A' : 'B'\}/);
assert.match(timeline, /A Verto apresenta os períodos sem interpretar evolução, melhora ou regressão/);
assert.doesNotMatch(timeline, /fetch\([^\n]*monthKey/);

// Historical comments stay visible even when new replies are disabled; comparison never renders the editor.
assert.match(timeline, /novas respostas desabilitadas/);
assert.match(timeline, /!comparison && item\.canComment/);

// Central refinements: compact hospitality banner, whole patient row is keyboard-native button, and pagination is truthful.
assert.match(central, /const hasNextPage = nextOffset !== null/);
assert.match(central, /\{hasNextPage && !searchTerm\.trim\(\)/);
assert.match(central, /onClick=\{\(\) => openPatientTimeline\(clinic\.clinicId, patient\.patientId\)\}/);
assert.match(central, /focus-visible:ring-2 focus-visible:ring-violet-300/);
assert.doesNotMatch(central, />Abrir timeline</);

// Read model remains ACTIVE-grant scoped; no new query/read path was added for comparison.
const loadStart = server.indexOf('const loadExternalPatientTimeline');
const loadEnd = server.indexOf("app.get('/api/external/care-network/shared'", loadStart);
const loadBody = server.slice(loadStart, loadEnd);
assert.match(loadBody, /\.eq\('status', 'ACTIVE'\)/);
assert.match(loadBody, /\.eq\('external_account_id', accountId\)/);
assert.match(loadBody, /\.eq\('clinic_id', clinicId\)/);
assert.match(loadBody, /\.eq\('patient_id', patientId\)/);

console.log('externalTimelineScalableComparison20260903.regression: PASS');
