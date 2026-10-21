import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const historyCard = readFileSync('src/components/History.tsx', 'utf8');
const dataService = readFileSync('src/services/dataService.ts', 'utf8');
const portal = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');

const routeStart = server.indexOf("app.patch('/api/notes/:noteId'");
const routeEnd = server.indexOf("app.delete('/api/notes/:noteId'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'notes PATCH must exist');
const notesPatch = server.slice(routeStart, routeEnd);
assert.match(notesPatch, /requireClinicCapability\('clinical\.notes\.create'\)/);
assert.match(notesPatch, /const notePatientId = sanitizeString\(existing\.patient_id, 120\)/);
assert.match(notesPatch, /canAccessPatientInCurrentClinic\(notePatientId, req\.session\.user, 'write'\)/,
  'case write scope is a backend authorization check, not a role passed by the browser');
assert.match(notesPatch, /existingFamilyNote \|\| targetsFamily \|\| scoreProvided/,
  'cannot bypass via existing note type, forged visibility or generic score updates');
assert.match(notesPatch, /Object\.prototype\.hasOwnProperty\.call\(req\.body \|\| \{\}, 'score'\)/);
assert.match(notesPatch, /req\.body\.score !== 0 && req\.body\.score !== 1/,
  'family star values must be exactly numeric 0 or 1');
assert.match(notesPatch, /return res\.status\(403\)/);
assert.match(notesPatch, /\.eq\('id', noteId\)/,
  'must load original server record instead of trusting patient ID from body');
assert.match(notesPatch, /if \(!existing\) return res\.status\(404\)/);

// No optimistic star or offline replay. Server persistence is the authority.
const start = app.indexOf("if (rawId.startsWith('note-family-'))");
const end = app.indexOf('const item = history.find', start);
const update = app.slice(start, end);
assert.match(update, /await dataService\.updateFamilyNoteStar/);
assert.match(update, /noteUpdateResult\?\.success !== true/);
assert.match(update, /Number\(persisted\?\.score\) !== \(starred \? 1 : 0\)/);
assert.ok(update.indexOf('await dataService.updateFamilyNoteStar') < update.indexOf('setTherapistNotes('));
assert.doesNotMatch(update, /dataService\.updateNote\(/);
assert.match(dataService, /async updateFamilyNoteStar/);
const updateStart = dataService.indexOf('async updateFamilyNoteStar');
const updateEnd = dataService.indexOf('async getHistory(', updateStart);
const serverOnly = dataService.slice(updateStart, updateEnd);
assert.match(serverOnly, /fetchWithAuthRetry/);
assert.doesNotMatch(serverOnly, /saveOfflineFirst|pending: true|queueOffline/);

// The existing, secured HistoryCard must not accidentally skip legacy note rows.
assert.match(historyCard, /isTherapist && isFamilyEntry && \(/);
assert.doesNotMatch(historyCard, /isTherapist && isFamilyEntry && !item\?\.isFromNotes/);
assert.match(historyCard, /disabled=\{isSavingMilestone\}/);
assert.match(detail, /const awarded = hasStoredScore \? storedScore >= 1/);
assert.match(detail, /const awarded = numericScore !== null && Number\.isFinite\(numericScore\)/);
assert.match(portal, /countCanonicalFamilyStars\(portalFamilyHistory, scopedSharedNotes, milestoneBySource\)/);
console.log('familyDiaryLegacyStarsSecurity.regression.test.mjs: ok');
