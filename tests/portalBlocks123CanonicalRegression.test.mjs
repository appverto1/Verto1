import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../src/utils/patientProfileType.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const resilience = fs.readFileSync(new URL('../src/utils/clinicalPostResilience.ts', import.meta.url), 'utf8');

assert.match(profile, /export type PatientPortalKind = 'KIDS' \| 'ADULT_ABA' \| 'ADULT_CONVENTIONAL'/);
assert.match(profile, /export const resolvePatientPortalKind/);
assert.match(app, /resolvePatientPortalKind\(patient\) !== 'KIDS'/);
assert.doesNotMatch(app, /adultAssignedResult[\s\S]{0,1000}dataService\.addTask\(/, 'adult writes must not silently fall back to legacy tasks');

assert.match(app, /stableUuidFromString\(`patient-checkin:\$\{patientId\}:\$\{clinicDate\}:\$\{metricKind\}`\)/);
assert.match(app, /score: undefined,[\s\S]{0,120}energy: persistedEnergy/);
assert.match(app, /tagId,[\s\S]{0,100}tagLabel/);
assert.match(app, /const patientAuthoredType = actorKind === 'patient' \? 'patient_note' : 'family_note'/);
assert.match(app, /const type = isPhotoRecord \? 'photo' : patientAuthoredType/);
assert.match(app, /isDailyReminder: Boolean\(t\.isDailyReminder \|\| t\.is_daily_reminder\)/);
assert.match(dashboard, /cleanupPatientPhotoUpload/);
assert.match(server, /cleanup-upload/);
assert.match(server, /create_patient_portal_history_entry_v1/);
assert.doesNotMatch(server, /p_quota_date_group/, 'HTTP layer must not control the atomic photo quota day');
assert.doesNotMatch(app.slice(app.indexOf('const handleMoodCheckin'), app.indexOf('const handleCompleteTask')), /addPatientLog|patient_logs/);
assert.match(dashboard, /dailyCheckinDone/);
assert.match(dashboard, /metricKind/);
assert.match(dashboard, /scheduledAt <= currentTime/);
assert.match(dashboard, /15 \* 60_000/);
assert.match(dashboard, /Quanto esforço essa atividade exigiu/);
assert.match(detail, /Esforço percebido após a atividade/);
assert.match(detail, /is_daily_reminder: planType === 'intervention' \? isDailyReminder : false/);

assert.match(server, /complete_patient_assigned_task_v2/);
const assignedTaskCompletionRoute = server.slice(server.indexOf("app.post('/api/assigned-tasks/:taskId/complete'"), server.indexOf("app.post('/api/assigned-tasks/:taskId/review'"));
assert.match(assignedTaskCompletionRoute, /canPortalSessionAccessPatient/, 'task completion must use the canonical clinic-scoped portal authorization');
assert.match(assignedTaskCompletionRoute, /p_expected_patient_id: sanitizeString\(existing\.patient_id, 120\)/, 'atomic completion must bind the RPC to the patient scope that was authorized');
assert.doesNotMatch(assignedTaskCompletionRoute, /canAccessByEmail|getPatientIdsByEmailAcrossClinics/, 'task completion must not authorize a guessed task id by cross-clinic email fallback');
assert.doesNotMatch(assignedTaskCompletionRoute, /patient_logs/);
assert.match(server, /patientPortalPatientId[\s\S]{0,300}activeAccessContext/);
assert.match(resilience, /context\.dateGroup \|\| input\?\.date_group/);

console.log('portalBlocks123CanonicalRegression: PASS');
