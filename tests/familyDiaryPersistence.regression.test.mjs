import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const localDb = fs.readFileSync('src/services/localDb.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260828010000_portal_interaction_notification_jobs_v1.sql', 'utf8');

const historyHelperStart = dataService.indexOf('async getPatientSelfHistory(patientId?: string)');
const historyHelperEnd = dataService.indexOf('async addHistoryItem', historyHelperStart);
const historyHelper = dataService.slice(historyHelperStart, historyHelperEnd);
assert.ok(historyHelperStart > 0 && historyHelperEnd > historyHelperStart);
assert.match(historyHelper, /fetchWithAuthRetry\(endpointWithLimit\('\/api\/patient\/self\/history', 20\)/);
assert.match(historyHelper, /record\.sync_status !== 'synced'/);
assert.match(historyHelper, /localPatientId === canonicalPatientId/);
assert.match(historyHelper, /if \(id && !byId\.has\(id\)\) byId\.set\(id, row\)/);
assert.match(historyHelper, /String\(record\?\.data\?\.patient_id \|\| record\?\.data\?\.patientId \|\| ''\)\.trim\(\) === canonicalPatientId/);

assert.match(app, /dataService\.getPatientSelfHistory\(resolvedContextPatientId\)/);
assert.match(app, /const handleAddFamilyNote = async/);
assert.match(app, /patientAuthoredType = actorKind === 'patient' \? 'patient_note' : 'family_note'/);
assert.match(app, /await dataService\.addHistoryItem\(/);

assert.match(localDb, /Never destroy the canonical cache\/crypto material required to replay or/);
assert.match(localDb, /const hasUnsynced = userRows\.some\(\(row\) => row\.sync_status !== 'synced'\)/);

assert.match(migration, /create or replace function public\.create_patient_portal_history_entry_v1/);
assert.match(migration, /insert into public\.history/);
assert.match(migration, /on conflict \(id\) do update/);
assert.match(migration, /'portal-history:'\|\|p_id::text/);

console.log('familyDiaryPersistence.regression.test.mjs: ok');
