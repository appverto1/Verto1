import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const fallback = fs.readFileSync('src/utils/routeSchemaFallbacks.ts', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');

// Existing notes remain the canonical row; read contract exposes the linkage/professional attribution fields.
assert.match(fallback, /NOTE_SELECT_COLUMNS[\s\S]{0,900}appointment_id/);
assert.match(fallback, /NOTE_SELECT_COLUMNS[\s\S]{0,900}therapist_id/);
assert.match(fallback, /NOTE_SELECT_COLUMNS[\s\S]{0,900}\btext\b/);
assert.match(fallback, /NOTE_OPTIONAL_COLUMNS[\s\S]{0,900}'appointment_id'/);

const routeStart = server.indexOf("app.get('/api/notes/:patientId'");
const routeEnd = server.indexOf('const writePatientArchiveStateWithSchemaFallback', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'notes GET route must exist');
const route = server.slice(routeStart, routeEnd);
const conventionalStart = route.indexOf('const conventionalNotes');
const mentionStart = route.indexOf('const mentionUserIdsByNote', conventionalStart);
assert.ok(conventionalStart >= 0 && mentionStart > conventionalStart, 'conventional-session read-model enrichment must exist');
const enrichment = route.slice(conventionalStart, mentionStart);

// At most one appointment batch + one users batch, both tenant/patient scoped.
assert.equal((enrichment.match(/\.from\('appointments'\)/g) || []).length, 1);
assert.equal((enrichment.match(/\.from\('users'\)/g) || []).length, 1);
assert.match(enrichment, /\.eq\('patient_id', patientId\)/);
assert.match(enrichment, /\.or\(`organization_id\.eq\.\$\{clinicId\},clinic_id\.eq\.\$\{clinicId\}`\)/);
assert.match(enrichment, /\.in\('id', appointmentIds\)/);
assert.match(enrichment, /\.eq\('clinic_id', clinicId\)[\s\S]{0,120}\.in\('id', userIds\)/);

// GET enrichment is read-only: no second note row and no note mutation.
assert.doesNotMatch(route, /\.from\('notes'\)[\s\S]{0,160}\.(insert|upsert|update|delete)\(/);
assert.match(route, /source !== 'conventional_session'/);
for (const field of [
  'appointment_date_time', 'appointment_scheduled_at', 'actual_duration_minutes', 'service_type',
  'therapist_id', 'therapist_name', 'author_id', 'author_name', 'appointment_id',
]) assert.match(route, new RegExp(field));

// Main History is the conventional-session surface; generic portable annotations explicitly exclude it.
assert.match(patientDetail, /const conventionalSessionEvolutions = useMemo/);
assert.match(patientDetail, /toLowerCase\(\) === 'conventional_session'\) return false/);
assert.match(patientDetail, />Evoluções de sessão</);
assert.match(patientDetail, />Evolução da sessão</);
assert.match(patientDetail, /Registrado por:/);
assert.match(patientDetail, /actual_duration_minutes/);
assert.match(patientDetail, /appointment_date_time/);
assert.match(patientDetail, /appointmentId/);

console.log('conventionalSessionHistoryReadModel.regression.test.mjs: OK');
