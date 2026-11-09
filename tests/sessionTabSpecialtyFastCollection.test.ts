import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePatientPortalKind } from '../src/utils/patientProfileType';
import { sessionTabSpecialtyOptions } from '../src/utils/sessionTabSpecialtyOptions';
import { createSessionTrialWriteQueue } from '../src/utils/sessionTrialWriteQueue';

const plans = [
  { id: 'fono-active', mode: 'specialty', status: 'active', specialty: 'Fonoaudiólogo', title: 'Plano Fono', canEdit: true },
  { id: 'to-active', mode: 'specialty', status: 'active', specialty: 'Terapia Ocupacional', title: 'Plano TO', canEdit: true },
  { id: 'paused', mode: 'specialty', status: 'paused', specialty: 'Psicologia', canEdit: true },
  { id: 'no-permission', mode: 'specialty', status: 'active', specialty: 'Nutricionista', canEdit: false },
  { id: 'pts', mode: 'interdisciplinary', status: 'active', specialty: 'Fonoaudiologia', canEdit: true },
  { id: 'legacy', mode: 'legacy', status: 'active', specialty: 'Fonoaudiologia', canEdit: true },
];
assert.deepEqual(sessionTabSpecialtyOptions(plans).map(p => p.id), ['fono-active', 'to-active']);
assert.deepEqual(sessionTabSpecialtyOptions(plans, { service_type: 'Fonoaudiologia' }).map(p => p.id), ['fono-active']);
assert.deepEqual(sessionTabSpecialtyOptions(plans, { service_type: 'Terapia Ocupacional' }).map(p => p.id), ['to-active']);
assert.deepEqual(sessionTabSpecialtyOptions(plans, { service_type: 'ABA' }), []);
assert.deepEqual(sessionTabSpecialtyOptions(plans, { specialty: 'Fonoaudiologia', service_type: 'Terapia Ocupacional' }), []);
assert.deepEqual(sessionTabSpecialtyOptions(null), []);
assert.deepEqual(sessionTabSpecialtyOptions([{ ...plans[0], id: '' }]), []);
assert.equal(sessionTabSpecialtyOptions([...plans, plans[0]]).length, 2, 'repeat plan cannot duplicate an option');

// Adult category wins over an unset placeholder age; pediatrics remain pediatric.
assert.equal(resolvePatientPortalKind({ patient_group: 'adulto', patient_profile_type: 'ADULT', age: 0 }), 'ADULT_CONVENTIONAL');
assert.equal(resolvePatientPortalKind({ patient_group: 'adulto', patient_profile_type: 'ABA', age: 0 }), 'ADULT_ABA');
assert.equal(resolvePatientPortalKind({ patient_group: 'infantil', patient_profile_type: 'KIDS', age: 0 }), 'KIDS');
assert.equal(resolvePatientPortalKind({ patient_group: 'infantil', patient_profile_type: 'ADULT', age: 8 }), 'KIDS');

const events: string[] = [];
const enqueue = createSessionTrialWriteQueue();
let firstRelease = () => {};
const firstGate = new Promise<void>(resolve => { firstRelease = resolve; });
const first = enqueue(async () => {
  events.push('first:start');
  await firstGate;
  events.push('first:done');
  return 'first result';
});
const second = enqueue(async () => {
  events.push('second:start');
  events.push('second:done');
  return 'second result';
});
await Promise.resolve();
assert.deepEqual(events, ['first:start'], 'second tap is queued but not discarded during first sync');
firstRelease();
assert.deepEqual(await Promise.all([first, second]), ['first result', 'second result']);
assert.deepEqual(events, ['first:start', 'first:done', 'second:start', 'second:done']);

await assert.rejects(enqueue(async () => { throw new Error('network failed'); }), /network failed/);
assert.equal(await enqueue(async () => 'retry worked'), 'retry worked', 'failure must not freeze subsequent writes');

// Integration contract: the tab prompts before creating a session, while
// Agenda still uses its existing server-scope checks.
const detail = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const mode = readFileSync('src/components/SessionMode.tsx', 'utf8');
assert.match(detail, /id="tab-session"[^\n]+onClick=\{\(\) => void openSessionFromTab\(\)\}/);
assert.match(detail, /sessionTabSpecialtyOptions\(result\.data\.planScopes, scheduledSessionForPatient\)/);
assert.match(detail, /role="dialog" aria-modal="true" aria-labelledby="session-specialty-title"/);
assert.match(detail, /requestSessionStart\('fullscreen', \{ therapeuticPlanId: selected\.id, specialty: selected\.specialty \}\)/);
assert.match(detail, /sessionPlanMatchesAppointmentSpecialty\(selected, scheduledSessionForPatient\)/);
assert.match(detail, /label: \`\$\{appointmentSpecialty\} · agendamento \(sem plano ativo\)\`/,
  'legacy adult appointments remain usable only through the confirmed appointment specialty');
assert.match(detail, /activeSessionLiveRef\.current \|\| activeSession/,
  'multiple asynchronous trial acknowledgements must not overwrite session counts');
assert.match(detail, /startConventionalSession\(String\(patient\?\.id \|\| ''\), appointmentId/);
assert.match(detail, /void requestSessionStart\('fullscreen'\);/, 'Agenda continues using existing safe preflight');
assert.match(mode, /legacyTrialWriteQueueRef\.current\(\(\) => Promise\.resolve\(onRecordTrial/);
assert.match(mode, /if \(!lockAction\(trialLockKey, 90\)\) return;/);
assert.match(mode, /if \(!lockAction\(frequencyLockKey, 90\)\) return;/);
assert.match(mode, /if \(!lockAction\(\`rate:\$\{currentRateWindow\.id\}\`, 90\)\) return;/);
assert.match(mode, /const currentRateWindow = rateWindowRef\.current;/);
assert.match(mode, /setRateWindow\(\{ \.\.\.currentRateWindow, count: nextRateCount \}\)/);
assert.doesNotMatch(mode, /if \(!lockAction\(trialLockKey, 600\)\) return;/);

console.log('sessionTabSpecialtyFastCollection.test.ts: PASS');
