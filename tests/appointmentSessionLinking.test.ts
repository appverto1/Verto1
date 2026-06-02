import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const patientDetailCode = readFileSync(join(root, 'src/components/PatientDetailView.tsx'), 'utf8');
const sessionModeCode = readFileSync(join(root, 'src/components/SessionMode.tsx'), 'utf8');
const migrationSql = readFileSync(join(root, 'supabase/migrations/20260602153000_aba_clinical_records_appointment_link.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('ABA session start is idempotent for an appointment', () => {
  assert.match(serverCode, /fetchInProgressAbaSessionForAppointment[\s\S]*?\.eq\('appointment_id', appointmentId\)[\s\S]*?\.in\('status', \['active', 'in_progress', 'IN_PROGRESS'\]\)/);
  assert.match(serverCode, /const sessionId = sanitizeString\(existingInProgressSession\?\.id \|\| requestedSessionId, 180\)/);
  assert.match(serverCode, /return res\.json\(\{ success: true, idempotent: Boolean\(existingInProgressSession\?\.id\), data, session: data \}\)/);
});

test('ABA session writes update appointment and closure readiness', () => {
  assert.match(serverCode, /patchAppointmentOperationalFromAbaSession[\s\S]*?status: 'IN_PROGRESS' \| 'COMPLETED'/);
  assert.match(serverCode, /appointmentStatus = payload\.status === 'completed'[\s\S]*?'COMPLETED'[\s\S]*?isAbaSessionInProgressStatus\(payload\.status\)[\s\S]*?'IN_PROGRESS'/);
  assert.match(serverCode, /await regenerateClosureForAppointments\(\s*\[payload\.appointment_id\],[\s\S]*?'aba_session_saved'/);
  assert.match(serverCode, /await regenerateClosureForAppointments\(\s*\[appointmentIdForClosure\],[\s\S]*?'aba_session_updated'/);
});

test('clinical records inherit appointment_id from session or request', () => {
  assert.match(serverCode, /resolveAbaAppointmentIdForClinicalWrite[\s\S]*?readAbaSessionAppointmentLink/);
  assert.match(serverCode, /fetchAppointmentForAbaSessionLink\(requestedAppointmentId, params\.clinicId, params\.user\)/);
  assert.match(serverCode, /sanitizeString\(appointment\.patient_id, 120\) !== patientId/);
  for (const route of [
    '/api/aba/trials',
    '/api/aba/behavior-events',
    '/api/aba/interval-records',
    '/api/aba/interval-summaries',
    '/api/aba/abc-events',
    '/api/aba/mastery-evaluations',
    '/api/aba/maintenance-probe-results',
    '/api/aba/session-summaries'
  ]) {
    const routeStart = serverCode.indexOf(`app.post('${route}'`);
    assert.ok(routeStart >= 0, `${route} route exists`);
    const routeEnd = serverCode.indexOf('\n  app.', routeStart + 20);
    const block = serverCode.slice(routeStart, routeEnd > routeStart ? routeEnd : routeStart + 9000);
    assert.match(block, /appointment_id:/, `${route} persists appointment_id`);
  }
});

test('frontend accepts canonical session id and sends appointment_id with records', () => {
  assert.match(patientDetailCode, /const saveResult = await dataService\.saveAbaSession/);
  assert.match(patientDetailCode, /const savedSession = saveResult\?\.session \|\| saveResult\?\.data/);
  assert.match(patientDetailCode, /id: String\(savedSession\.id\)/);
  assert.match(dataServiceCode, /fields\.appointment_id = appointmentId[\s\S]*?fields\.appointmentId = appointmentId/);
  assert.match(sessionModeCode, /appointment_id: activeAppointmentId \|\| undefined/);
  assert.match(sessionModeCode, /appointmentId: activeAppointmentId \|\| undefined/);
});

test('migration adds appointment_id to ABA clinical records with scoped indexes', () => {
  assert.match(migrationSql, /aba_sessions_status_check[\s\S]*?'in_progress'/);
  for (const table of [
    'aba_session_summaries',
    'aba_trials',
    'aba_behavior_events',
    'aba_interval_records',
    'aba_interval_summaries',
    'aba_abc_events',
    'aba_mastery_evaluations',
    'aba_maintenance_probe_results'
  ]) {
    assert.match(migrationSql, new RegExp(`alter table public\\.${table}[\\s\\S]*?add column if not exists appointment_id uuid references public\\.appointments`, 'i'));
    assert.match(migrationSql, new RegExp(`idx_${table}_appointment|idx_${table.replace('aba_', 'aba_')}_appointment`, 'i'));
  }
});

test('no broad select star is introduced', () => {
  assert.doesNotMatch(serverCode, /select\('\*'\)/);
});

let passed = 0;
for (const item of tests) {
  item.fn();
  passed += 1;
  console.log(`[ok] ${item.name}`);
}

console.log(`[ok] appointment-session linking checks: ${passed}/${tests.length}`);
