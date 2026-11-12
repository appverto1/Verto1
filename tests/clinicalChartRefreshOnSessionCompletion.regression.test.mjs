import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cache = readFileSync('src/services/clinicalAnalyticsQueryCache.ts', 'utf8');
const service = readFileSync('src/services/dataService.ts', 'utf8');
const offline = readFileSync('src/services/localDb.ts', 'utf8');
const session = readFileSync('src/components/SessionMode.tsx', 'utf8');
const chart = readFileSync('src/components/ClinicalOutcomesDashboard.tsx', 'utf8');
const aba = readFileSync('src/components/AbaV3ClinicalChartPanel.tsx', 'utf8');
const cmv3 = readFileSync('src/components/ClinicalMeasurementV3Panel.tsx', 'utf8');

assert.match(cache, /invalidationVersion: number/, 'cache must track invalidation separately from read completion time');
assert.match(cache, /entry\.invalidationVersion \+= 1/g, 'local and cross-tab invalidations must increment generation');
assert.match(cache, /const invalidationVersionAtStart = entry\.invalidationVersion/, 'read must retain start generation');
assert.match(cache, /entry\.invalidationVersion === invalidationVersionAtStart[\s\S]*entry\.updatedAt = Date\.now\(\);[\s\S]*entry\.invalidatedAt = 0/, 'only current reads can clear an invalidation');
assert.match(cache, /else \{[\s\S]*entry\.updatedAt = 0;[\s\S]*\}[\s\S]*return result;/, 'late responses must remain stale for a follow-up fetch');
assert.match(cache, /if \(entry\.promise\) return entry\.promise/, 'identical in-flight requests must be deduplicated');
assert.match(cache, /if \(!enabled \|\| currentEntry\.invalidatedAt <= currentEntry\.updatedAt\) return;/, 'only invalidated mounted charts can refetch');
assert.match(cache, /patientHash: clinicalAnalyticsPatientHash\(scope\.patientId\)/);
assert.match(cache, /BroadcastChannel\('verto-clinical-analytics-v3'\)/);

const abaStart = service.indexOf('  async completeAbaSession(');
const abaEnd = service.indexOf('  async reopenAppointmentNoShow(', abaStart);
assert.ok(abaStart >= 0 && abaEnd > abaStart);
const completion = service.slice(abaStart, abaEnd);
assert.match(completion, /if \(completionAttempt\.response\.ok\)/);
assert.match(completion, /completionAttempt\.result\?\.success === true && completionAttempt\.result\?\.pending !== true/);
assert.match(completion, /notifyClinicalOutcomesChanged\(String\(payload\?\.patient_id \|\| payload\?\.patientId \|\| ''\)\)/);
assert.ok(completion.indexOf('notifyClinicalOutcomesChanged') > completion.indexOf('if (completionAttempt.response.ok)'),
  'ABA graphs refresh only after the server acknowledges the closure');
assert.doesNotMatch(completion.slice(completion.indexOf('const queueCompletion = async'), completion.indexOf('const queuedBeforeCompletion =')),
  /notifyClinicalOutcomesChanged/, 'queued offline completions cannot imply persisted graph evidence');

const conventionalStart = service.indexOf('  async completeConventionalSession(');
const conventionalEnd = service.indexOf('  async saveAbaSessionSummary(', conventionalStart);
assert.ok(conventionalStart >= 0 && conventionalEnd > conventionalStart);
const conventional = service.slice(conventionalStart, conventionalEnd);
assert.match(conventional, /if \(response\.ok && result\?\.success === true\) notifyClinicalOutcomesChanged\(patientId\)/,
  'adult conventional charts refresh only after acknowledged completion');
const conventionalNotes = service.slice(service.indexOf('  async saveConventionalSessionNote('), conventionalStart);
assert.doesNotMatch(conventionalNotes, /notifyClinicalOutcomesChanged/,
  'editing a draft note alone must not report a finished clinical session');

const syncAt = offline.indexOf('const runOfflineSync = async');
const syncEnd = offline.indexOf('export const syncOfflineData', syncAt);
assert.ok(syncAt >= 0 && syncEnd > syncAt);
const sync = offline.slice(syncAt, syncEnd);
assert.match(sync, /if \(isSessionCompletionQueueRecord\(record\)\)[\s\S]*hasUnresolvedSessionPredecessor/,
  'offline session closure must wait for earlier attempts, events and clinical writes');
const syncSuccess = sync.indexOf("await markRecordSyncStatus(record.id, 'synced');");
const syncFailure = sync.indexOf('} else if (response.ok', syncSuccess);
assert.ok(syncSuccess > 0 && syncFailure > syncSuccess);
const ackOnly = sync.slice(syncSuccess, syncFailure);
assert.match(ackOnly, /if \(isSessionCompletionQueueRecord\(record\)\)/);
assert.match(ackOnly, /invalidateClinicalAnalyticsPatient\(completedPatientId, 'all'\)/);
assert.match(ackOnly, /await import\('\.\/clinicalAnalyticsQueryCache'\)/);
assert.doesNotMatch(sync.slice(syncFailure, syncEnd), /invalidateClinicalAnalyticsPatient/,
  'failed or deferred replays cannot refresh confirmed graphs');

assert.match(session, /const completionPending = completionResult\?\.pending === true \|\| completionResult\?\.offline === true/);
assert.match(session, /syncStatus: completionPending \|\| hasDeferredOfflineWrites \? 'local' : 'synced'/,
  'offline and deferred session results must retain their pending label');
assert.match(chart, /family: 'clinical-outcomes-dashboard'/);
assert.match(aba, /family: 'aba-v3-series-bundle'/);
assert.match(cmv3, /family: 'clinical-measurement-v3-view'/);

console.log('clinicalChartRefreshOnSessionCompletion.regression.test.mjs: ok');
