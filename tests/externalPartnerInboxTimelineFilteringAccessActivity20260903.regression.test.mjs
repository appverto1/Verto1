import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  externalTimelineInitialMonth,
  externalTimelineUnreadCount,
  groupExternalTimelineItemsByMonth,
} from '../src/utils/externalPatientTimelinePresentation.mjs';

const timeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const central = fs.readFileSync(new URL('../src/components/ExternalCareNetworkCentral.tsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/PatientEvolutionTimelinePanel.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

// Filter + pluralization fixtures: only ACTIVE payload rows participate because server is ACTIVE-scoped.
const groups = groupExternalTimelineItemsByMonth([
  { grantId: 'set-1', monthKey: '2026-09-01', sharedAt: '2026-09-03T11:50:00Z', firstViewedAt: null },
  { grantId: 'set-2', monthKey: '2026-09-01', sharedAt: '2026-09-02T10:00:00Z', firstViewedAt: '2026-09-02T10:05:00Z' },
  { grantId: 'set-3', monthKey: '2026-09-01', sharedAt: '2026-09-01T09:00:00Z', firstViewedAt: '2026-09-01T09:05:00Z' },
  { grantId: 'mai-1', monthKey: '2026-05-01', sharedAt: '2026-09-04T12:00:00Z', firstViewedAt: null },
]);
assert.deepEqual(groups.map((group) => group.key), ['2026-09', '2026-05']);
assert.equal(groups.find((group) => group.key === '2026-09')?.items.length, 3);
assert.equal(groups.find((group) => group.key === '2026-05')?.items.length, 1);
assert.equal(externalTimelineInitialMonth(groups), '2026-05');
assert.equal(externalTimelineUnreadCount(groups.find((group) => group.key === '2026-09')?.items), 1);

// Successful view mutates local read state; failure path removes viewedThisVisit and leaves NOVO intact.
assert.match(timeline, /if \(!response\.ok \|\| !result\?\.success\) \{ viewedThisVisit\.current\.delete\(grantId\); return; \}/);
assert.match(timeline, /firstViewedAt: item\.firstViewedAt \|\| view\.firstViewedAt \|\| now/);
assert.match(timeline, /viewCount: Math\.max/);
assert.match(timeline, /const isNew = !item\.firstViewedAt/);

// Central unread inbox is derived, not persisted separately.
assert.match(central, /rows\.filter\(\(row\) => !row\.firstViewedAt\)/);
assert.match(central, /unreadCount = unreadRows\.length/);
assert.match(central, /Tudo visto por aqui/);
assert.match(central, /bg-emerald-50/);
assert.match(central, /openPatientTimeline\(clinic\.clinicId, patient\.patientId, patient\.latestUnreadMonth\)/);
assert.match(central, /Menu size=\{19\}/);
assert.match(central, /text-rose-600/);

// Existing audit table is queried once in batch under the existing patient timeline route.
const timelineLoadStart = server.indexOf('const loadPatientEvolutionTimeline');
const timelineLoadEnd = server.indexOf("app.get(\n    '/api/patients/:patientId/evolution-timeline'", timelineLoadStart);
const timelineLoad = server.slice(timelineLoadStart, timelineLoadEnd);
assert.match(timelineLoad, /from\('patient_evolution_external_access_audit'\)/);
assert.match(timelineLoad, /\.in\('timeline_item_id', itemIds\)/);
assert.match(timelineLoad, /\.in\('action', \['VIEWED', 'FILE_ACCESSED'\]\)/);
assert.equal((timelineLoad.match(/from\('patient_evolution_external_access_audit'\)/g) || []).length, 1);
assert.match(timelineLoad, /accessActivity:/);
assert.match(timelineLoad, /previousAuthorization:/);
assert.doesNotMatch(server, /\/audit\/:grantId/);

// Internal UI renders historical activity without changing grant state or creating notifications per audit event.
assert.match(panel, /Ver atividade/);
assert.match(panel, /Atividade de acesso/);
assert.match(panel, /Acessou documento/);
assert.match(panel, /Visualizou/);
assert.match(panel, /compartilhamento anterior/);
assert.match(panel, /event\.fileName/);

console.log('externalPartnerInboxTimelineFilteringAccessActivity20260903.regression: PASS');
