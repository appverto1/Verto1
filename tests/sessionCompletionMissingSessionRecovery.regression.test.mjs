import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const server = read('server.ts');
const dataService = read('src/services/dataService.ts');
const sessionMode = read('src/components/SessionMode.tsx');
const patientDetail = read('src/components/PatientDetailView.tsx');
const summary = read('src/utils/abaSessionSummary.ts');

// The server distinguishes a missing session (safe to recreate through the canonical
// start contract) from a missing appointment (never auto-healed).
assert.match(server, /SESSION_COMPLETION_SESSION_NOT_FOUND[\s\S]*missingResource: 'session'[\s\S]*recoverable: true/);
assert.match(server, /SESSION_COMPLETION_APPOINTMENT_NOT_FOUND[\s\S]*missingResource: 'appointment'[\s\S]*recoverable: false/);

// Starting an ABA session is server-authoritative. A locally queued session must
// never become the active clinical session before the server confirms persistence.
assert.match(dataService, /saveAbaSession\(session:[\s\S]*?requireServerAck: true/);
assert.doesNotMatch(patientDetail, /if \(!requiresServerIssuedPlanContext\) persistActiveSession\(nextSession\)/);
assert.match(patientDetail, /saveResult\?\.success === true[\s\S]*saveResult\?\.offline !== true[\s\S]*saveResult\?\.pending !== true[\s\S]*Boolean\(savedSession\?\.id\)[\s\S]*persistActiveSession\(\{[\s\S]*\.\.\.nextSession/);

// Completion recovery is deliberately narrow: only the explicit missing-session
// response may trigger one canonical save of the same session id.
assert.match(dataService, /response\.status === 404[\s\S]*code === 'SESSION_COMPLETION_NOT_FOUND'[\s\S]*missingResource === 'session'[\s\S]*recoverable === true/);
assert.match(dataService, /dataService\.saveAbaSession\(\{[\s\S]*id: safeSessionId[\s\S]*patient_id:[\s\S]*clinic_id:[\s\S]*appointment_id:[\s\S]*started_at: recoveryStartedAt/);
assert.match(dataService, /recoveryResult\?\.success === true[\s\S]*recoveryResult\?\.pending !== true[\s\S]*recoveryResult\?\.offline !== true/);
assert.match(dataService, /completionAttempt = await requestCompletion\(\);/);

// The close command carries the original start context required to safely recover
// an offline-first session without inventing patient, clinic or appointment scope.
assert.match(sessionMode, /completeAbaSession\(sessionId,[\s\S]*started_at:[\s\S]*scheduled_start:[\s\S]*reference_date:/);

// Missing ABC fields are no longer synthesized as post-closure pending work.
assert.doesNotMatch(summary, /abcMissingFromRecords/);
assert.doesNotMatch(summary, /abcMissingFromSummary/);
assert.doesNotMatch(summary, /pendingItems\.push\(\{ key: 'abc_missing'/);

console.log('sessionCompletionMissingSessionRecovery.regression: ok');
