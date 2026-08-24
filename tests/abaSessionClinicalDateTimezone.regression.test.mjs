import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const patientDetail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');

assert.match(server, /const sessionLocationTimezone = sanitizeString\(/, 'session start must resolve one frozen timezone');
assert.match(server, /formatDateInAppointmentTimezone\(persistedSessionStartedAt, sessionLocationTimezone\)/, 'reference_date must be server-derived from session-start instant in the frozen timezone');
assert.match(server, /reference_date: serverReferenceDate/, 'ABA session persistence must use the server-derived clinical date');
assert.doesNotMatch(server.slice(server.indexOf("app.post('/api/aba/sessions'"), server.indexOf("app.patch('/api/aba/sessions/:sessionId'")), /reference_date: sanitizeDate\(req\.body\?\.reference_date/, 'session start must not trust a client-provided clinical date');
assert.match(server, /locationTimezone: sessionLocationTimezone/, 'the same timezone must be frozen in the session location snapshot');

assert.match(patientDetail, /referenceDate: formatDateInAppointmentTimezone\(startedAt\)/, 'optimistic UI state must not derive the date from UTC ISO slicing');
assert.match(patientDetail, /const serverReferenceDate = savedSession\.reference_date \|\| savedSession\.referenceDate \|\| nextSession\.referenceDate/, 'frontend must reconcile to the server clinical date after session creation');
assert.match(patientDetail, /referenceDate: serverReferenceDate,\n\s*reference_date: serverReferenceDate/, 'both session date aliases must be updated together');

console.log('abaSessionClinicalDateTimezone.regression.test.mjs: ok');
