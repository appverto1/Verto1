import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  externalTimelineClinicalDateLabel,
  externalTimelineComparisonGroups,
  externalTimelineInitialMonth,
  externalTimelineNavigationMonths,
  externalTimelineUnreadCount,
  externalTimelineYears,
  groupExternalTimelineItemsByMonth,
  updateExternalTimelineComparisonSelection,
} from '../src/utils/externalPatientTimelinePresentation.mjs';

const timeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const central = fs.readFileSync(new URL('../src/components/ExternalCareNetworkCentral.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

// Temporal semantics: month competence is clinical truth; technical createdAt is metadata only.
const mayGroup = groupExternalTimelineItemsByMonth([
  { grantId: 'may-technical-september', monthKey: '2026-05-01', createdAt: '2026-09-03T11:50:00Z', sharedAt: '2026-09-03T11:50:00Z' },
]);
assert.equal(mayGroup[0].key, '2026-05');
assert.equal(externalTimelineClinicalDateLabel(undefined), '');
assert.equal(externalTimelineClinicalDateLabel('2026-05-25'), '25 MAI');
assert.match(timeline, /externalTimelineClinicalDateLabel\(item\.clinicalDate\)/);
assert.doesNotMatch(timeline, /formatEvolutionDate\(item\.createdAt\)/);
assert.match(timeline, /Compartilhado em/);

// Available month navigation is calendar-ascending while backend-filtered groups remain reverse clinical order.
const months = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, '0');
  return { grantId: `grant-${month}`, monthKey: `2026-${month}-01`, slot: 1, firstViewedAt: '2026-09-01T00:00:00Z' };
});
const groups = groupExternalTimelineItemsByMonth(months);
assert.equal(groups.length, 12);
assert.deepEqual(groups.map((group) => group.key), ['2026-12','2026-11','2026-10','2026-09','2026-08','2026-07','2026-06','2026-05','2026-04','2026-03','2026-02','2026-01']);
assert.deepEqual(externalTimelineNavigationMonths(groups, '2026').map((group) => group.key), ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']);
assert.deepEqual(externalTimelineYears(groups), ['2026']);

// Unread overrides latest competence: a new May share opens May even if September exists and was already viewed.
const unreadGroups = groupExternalTimelineItemsByMonth([
  { grantId: 'sep-viewed', monthKey: '2026-09-01', sharedAt: '2026-09-01T10:00:00Z', firstViewedAt: '2026-09-01T10:10:00Z' },
  { grantId: 'may-new', monthKey: '2026-05-01', sharedAt: '2026-09-03T11:50:00Z', firstViewedAt: null },
]);
assert.equal(externalTimelineInitialMonth(unreadGroups), '2026-05');
assert.equal(externalTimelineUnreadCount(unreadGroups.find((group) => group.key === '2026-05')?.items), 1);

// Comparison selects at most two visible period keys and preserves explicit A/B order.
let selection = [];
selection = updateExternalTimelineComparisonSelection(selection, '2026-05-01');
selection = updateExternalTimelineComparisonSelection(selection, '2026-09-01');
assert.deepEqual(selection, ['2026-05', '2026-09']);
selection = updateExternalTimelineComparisonSelection(selection, '2026-07-01');
assert.deepEqual(selection, ['2026-05', '2026-07']);
assert.deepEqual(externalTimelineComparisonGroups(groups, ['2026-05', '2026-09']).map((group) => group.key), ['2026-05', '2026-09']);

// Timeline normal mode is a real filter: only activeGroup items are rendered in the clinical area.
assert.match(timeline, /const activeGroup = useMemo/);
assert.match(timeline, /activeGroup\.items\.map\(\(item, index\) => renderTimelineItem/);
assert.doesNotMatch(timeline, /visibleMonthGroups\.map\(\(group\) =>/);
assert.match(timeline, /externalTimelineUnreadCount\(group\.items\)/);
assert.match(timeline, /Novo/);
assert.match(timeline, /firstViewedAt: item\.firstViewedAt \|\| view\.firstViewedAt/);
assert.match(timeline, /viewedThisVisit/);

// Comparison remains client-side over the already authorized payload.
assert.match(timeline, /comparisonMode === 'selecting'/);
assert.match(timeline, /externalTimelineComparisonGroups\(monthGroups, comparisonSelection\)/);
assert.match(timeline, /lg:grid-cols-2/);
assert.match(timeline, /Período \{groupIndex === 0 \? 'A' : 'B'\}/);
assert.match(timeline, /A Verto apresenta os períodos sem interpretar evolução, melhora ou regressão/);
assert.doesNotMatch(timeline, /fetch\([^\n]*monthKey/);

// Central is oriented to unread content and keeps pagination truthful.
assert.match(central, /const unreadRows = useMemo/);
assert.match(central, /patient\.unreadCount \+= 1/);
assert.match(central, /Novo · \{patient\.unreadCount\}/);
assert.match(central, /const hasNextPage = nextOffset !== null/);
assert.match(central, /\{hasNextPage && !searchTerm\.trim\(\)/);
assert.match(central, /latestUnreadMonth/);
assert.match(central, /Conteúdos ainda não visualizados/);

// Read model remains ACTIVE-grant scoped; no new authorization source was introduced.
const loadStart = server.indexOf('const loadExternalPatientTimeline');
const loadEnd = server.indexOf("app.get('/api/external/care-network/shared'", loadStart);
const loadBody = server.slice(loadStart, loadEnd);
assert.match(loadBody, /\.eq\('status', 'ACTIVE'\)/);
assert.match(loadBody, /\.eq\('external_account_id', accountId\)/);
assert.match(loadBody, /\.eq\('clinic_id', clinicId\)/);
assert.match(loadBody, /\.eq\('patient_id', patientId\)/);

console.log('externalTimelineScalableComparison20260903.regression: PASS');
