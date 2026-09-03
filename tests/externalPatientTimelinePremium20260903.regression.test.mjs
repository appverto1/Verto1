import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  externalTimelineYears,
  groupExternalTimelineItemsByMonth,
  normalizeExternalTimelineMonthKey,
} from '../src/utils/externalPatientTimelinePresentation.mjs';

const timeline = fs.readFileSync(new URL('../src/components/ExternalPatientTimeline.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const careNetwork = fs.readFileSync(new URL('../src/components/PatientCareNetworkPanel.tsx', import.meta.url), 'utf8');

assert.equal(normalizeExternalTimelineMonthKey('2026-09-01'), '2026-09');
assert.equal(normalizeExternalTimelineMonthKey('2026-09'), '2026-09');
assert.equal(normalizeExternalTimelineMonthKey('MÊS'), '');

const groups = groupExternalTimelineItemsByMonth([
  { grantId: 'sep-03', monthKey: '2026-09-01', createdAt: '2026-09-03T10:00:00Z' },
  { grantId: 'aug-29', monthKey: '2026-08-01', createdAt: '2026-08-29T10:00:00Z' },
  { grantId: 'sep-25', monthKey: '2026-09-01', createdAt: '2026-09-25T10:00:00Z' },
  { grantId: 'sep-12', monthKey: '2026-09-01', createdAt: '2026-09-12T10:00:00Z' },
  { grantId: 'jul-01', monthKey: '2025-07-01', createdAt: '2025-07-01T10:00:00Z' },
]);
assert.deepEqual(groups.map((group) => group.key), ['2026-09', '2026-08', '2025-07']);
assert.deepEqual(groups[0].items.map((item) => item.grantId), ['sep-25', 'sep-12', 'sep-03']);
assert.equal(groups.filter((group) => group.key === '2026-09').length, 1);
assert.deepEqual(externalTimelineYears(groups), ['2026', '2025']);

const activeOnlyGroups = groupExternalTimelineItemsByMonth([
  { grantId: 'sep-active', monthKey: '2026-09-01', createdAt: '2026-09-03T10:00:00Z' },
  { grantId: 'jul-active', monthKey: '2026-07-01', createdAt: '2026-07-03T10:00:00Z' },
]);
assert.deepEqual(activeOnlyGroups.map((group) => group.key), ['2026-09', '2026-07']);

// Canonical DATE month_key is normalized before labels/chips are derived; no literal fallback MÊS.
assert.match(timeline, /normalizeExternalTimelineMonthKey/);
assert.doesNotMatch(timeline, /compact \? 'MÊS'/);
assert.doesNotMatch(timeline, /Período compartilhado/);
assert.match(timeline, /groupExternalTimelineItemsByMonth/);

// Navigation scales by authorized years/months only.
assert.match(timeline, /years\.length > 1/);
assert.match(timeline, /visibleMonthGroups/);
assert.match(timeline, /overflow-x-auto/);
assert.match(timeline, /sticky top-0/);
assert.match(timeline, /scrollIntoView\(\{ behavior: 'smooth'/);

// Patient dominates the page hierarchy; no partner greeting in the patient timeline.
assert.match(timeline, /uppercase leading-tight/);
assert.match(timeline, /Timeline compartilhada/);
assert.match(timeline, /pluralRecords\(totalItems\)/);
assert.doesNotMatch(timeline, /Olá,/);

// Comments are collapsed by default and permissions remain per item.
assert.match(timeline, /openComments/);
assert.match(timeline, /item\.canComment \?/);
assert.match(timeline, /'Comentar'/);
assert.match(timeline, /Comentários desabilitados/);
assert.doesNotMatch(timeline, /Nenhum comentário nesta autorização/);
assert.match(timeline, /Sua devolutiva/);

// Attachments are compact, but existing signed URL path remains unchanged.
assert.match(timeline, /Paperclip/);
assert.match(timeline, /attachmentTypeLabel/);
assert.match(timeline, /\/file\/\$\{encodeURIComponent\(item\.timelineItemId\)\}/);

// Read receipts remain viewport-granular, not page-wide.
assert.match(timeline, /IntersectionObserver/);
assert.match(timeline, /intersectionRatio < 0\.35/);
assert.match(timeline, /items\/\$\{encodeURIComponent\(grantId\)\}\/view/);

// Read DTO adds author/sender names through one batch query, never one query per item.
const loadStart = server.indexOf('const loadExternalPatientTimeline');
const loadEnd = server.indexOf("app.get('/api/external/care-network/shared'", loadStart);
const loadBody = server.slice(loadStart, loadEnd);
assert.match(loadBody, /created_by_user_id/);
assert.match(loadBody, /const actorIds = Array\.from\(new Set/);
assert.match(loadBody, /supabase\.from\('users'\)\.select\('id,name'\)\.in\('id', actorIds\)/);
assert.match(loadBody, /authorName:/);
assert.match(loadBody, /senderName:/);
assert.equal((loadBody.match(/supabase\.from\('users'\)/g) || []).length, 1);

// Patient can revoke care-network links from a dedicated Danger zone using the existing atomic delete path.
assert.match(careNetwork, /Danger zone/);
assert.match(careNetwork, /Revogar acesso de um profissional/);
assert.match(careNetwork, /Desfazer vínculo/);
assert.match(careNetwork, /archivePatientSelfCareNetworkContact/);

console.log('externalPatientTimelinePremium20260903.regression: PASS');
