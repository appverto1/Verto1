import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const closureEngineCode = readFileSync(join(root, 'src/services/closureReadinessEngine.ts'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('ABA session start updates the appointment operational state', () => {
  const routeStart = serverCode.indexOf("app.post('/api/aba/sessions'");
  const routeEnd = serverCode.indexOf("app.patch('/api/aba/sessions/:sessionId'", routeStart);
  const route = serverCode.slice(routeStart, routeEnd);
  assert.match(route, /patchAppointmentOperationalFromAbaSession[\s\S]*?status: appointmentStatus/);
  assert.match(route, /actualStartAt: payload\.actual_start_at \|\| payload\.started_at/);
  assert.match(route, /abaSessionId: payload\.id/);
  assert.match(route, /regenerateClosureForAppointments\(\s*\[payload\.appointment_id\]/);
});

test('operational summary stores planned and realized appointment fields', () => {
  assert.match(serverCode, /const persistAppointmentClosureCheck = async/);
  assert.match(serverCode, /\.from\('appointment_closure_checks'\)[\s\S]*?\.upsert\(\[storagePayload\], \{ onConflict: 'organization_id,appointment_id' \}\)/);
  assert.match(serverCode, /scheduled_start: evaluation\.summary\.scheduledStart/);
  assert.match(serverCode, /scheduled_end: evaluation\.summary\.scheduledEnd/);
  assert.match(serverCode, /actual_start: evaluation\.summary\.actualStart/);
  assert.match(serverCode, /actual_end: evaluation\.summary\.actualEnd/);
  assert.match(serverCode, /scheduled_minutes: evaluation\.summary\.scheduledMinutes/);
  assert.match(serverCode, /actual_minutes: evaluation\.summary\.actualMinutes/);
});

test('closure engine exposes planned versus realized summary values', () => {
  assert.match(closureEngineCode, /scheduledStart: string \| null/);
  assert.match(closureEngineCode, /actualStart: string \| null/);
  assert.match(closureEngineCode, /scheduledMinutes: number \| null/);
  assert.match(closureEngineCode, /actualMinutes: number \| null/);
});

test('closure detail materializes and returns the operational phase view', () => {
  assert.match(closureEngineCode, /scheduled_pre_session/);
  assert.match(closureEngineCode, /completed_pending_closure/);
  assert.match(closureEngineCode, /prefacturing_blocked/);
  assert.match(closureEngineCode, /operationalStatus/);
  assert.match(serverCode, /buildAppointmentClosureOperationalView/);
  assert.match(serverCode, /inferredOperationalPhase/);
  assert.match(serverCode, /requireAuthorizationBeforeSession: resolved\.requireAuthorization/);
  assert.match(serverCode, /requireGuideBeforeSession: false/);
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

console.log(`[ok] appointment operational summary checks: ${passed}/${tests.length}`);
