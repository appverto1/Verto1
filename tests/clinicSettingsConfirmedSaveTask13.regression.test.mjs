import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const service = readFileSync('src/services/dataService.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const dashboard = readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const onboarding = readFileSync('src/components/ProfessionalOnboarding.tsx', 'utf8');
const server = readFileSync('server.ts', 'utf8');

const serviceStart = service.indexOf('async saveUserProfile(userId: string, profile: any) {');
const serviceEnd = service.indexOf('\n  },\n\n  /**', serviceStart);
assert.ok(serviceStart !== -1 && serviceEnd > serviceStart, 'canonical saveUserProfile method must exist');
const method = service.slice(serviceStart, serviceEnd).replace(
  'async saveUserProfile(userId: string, profile: any) {',
  'async function saveUserProfile(userId, profile) {',
) + '\n}';

// Exercise the actual saveUserProfile implementation using stubbed network and
// outbox dependencies: no Supabase account, network or clinical data is touched.
function makeSave({ response, networkError } = {}) {
  const calls = { network: [], outbox: [] };
  const fetchWithAuthRetry = async (url, options) => {
    calls.network.push({ url, options });
    if (networkError) throw new Error('network failed');
    return response || { ok: true, payload: { success: true, user: { clinicSettings: { clinicName: 'Confirmada' } } } };
  };
  const getAuthHeaders = async () => ({ Authorization: 'Bearer synthetic-test-token', 'Content-Type': 'application/json' });
  const safeJson = async (res) => res.payload;
  const saveOfflineFirst = async (...args) => {
    calls.outbox.push(args);
    return { pending: true, success: true };
  };
  const factory = new Function(
    'fetchWithAuthRetry', 'getAuthHeaders', 'safeJson', 'saveOfflineFirst',
    method + '\nreturn saveUserProfile;',
  );
  return { save: factory(fetchWithAuthRetry, getAuthHeaders, safeJson, saveOfflineFirst), calls };
}

test('clinic Save waits for exactly one authenticated authoritative backend response', async () => {
  const { save, calls } = makeSave();
  const result = await save('director-1', {
    profileSaveScope: 'clinic',
    clinicSettings: { clinicName: 'Confirmada' },
  });
  assert.equal(result.success, true);
  assert.equal(result.user.clinicSettings.clinicName, 'Confirmada');
  assert.equal(calls.network.length, 1);
  assert.equal(calls.network[0].url, '/api/profile/director-1');
  assert.equal(calls.network[0].options.method, 'POST');
  assert.equal(calls.network[0].options.credentials, 'include');
  assert.equal(calls.network[0].options.headers.Authorization, 'Bearer synthetic-test-token');
  assert.equal(JSON.parse(calls.network[0].options.body).profileSaveScope, 'clinic');
  assert.equal(calls.outbox.length, 0, 'clinic configuration is never an offline queue acknowledgement');
});

test('403 permission rejection, business rejection and network loss never claim clinic Save', async () => {
  for (const scenario of [
    { response: { ok: false, payload: { success: false, error: 'CLINIC_SETTINGS_EDIT_DENIED' } } },
    { response: { ok: true, payload: { success: false, message: 'Database write rejected' } } },
    { networkError: true },
  ]) {
    const { save, calls } = makeSave(scenario);
    const result = await save('director-1', {
      profileSaveScope: 'clinic',
      clinicSettings: { clinicName: 'Não persistida' },
    });
    assert.equal(result.success, false, 'unconfirmed clinic write must fail closed');
    assert.equal(calls.outbox.length, 0);
    assert.equal(calls.network.length, 1);
  }
});

test('personal profile retains its existing durable offline-first flow', async () => {
  const { save, calls } = makeSave();
  const result = await save('professional-1', { profileSaveScope: 'professional', name: 'Profissional' });
  assert.equal(result.pending, true);
  assert.equal(result.queued, true);
  assert.equal(calls.network.length, 0);
  assert.equal(calls.outbox.length, 1);
});

test('clinic success toast and log are emitted only after confirmed Save', () => {
  const from = dashboard.indexOf('const handleSaveClinicSettings = async');
  const to = dashboard.indexOf('const normalizeAnamnesisTemplateForEditor', from);
  const saveHandler = dashboard.slice(from, to);
  assert.match(saveHandler, /if \(clinicSettingsSaveInFlightRef\.current\) return;/);
  assert.match(saveHandler, /clinicSettingsSaveInFlightRef\.current = true;/);
  assert.match(saveHandler, /const clinicSaveResult = await onUpdateProfile\(/);
  assert.match(saveHandler, /clinicSaveResult\?\.success !== true \|\| clinicSaveResult\?\.pending \|\| clinicSaveResult\?\.queued/);
  assert.ok(saveHandler.indexOf('const clinicSaveResult = await onUpdateProfile') < saveHandler.indexOf('onAddActivityLog('));
  assert.ok(saveHandler.indexOf('if (clinicSaveResult?.success !== true') < saveHandler.indexOf('Configurações da clínica salvas.'));
  assert.match(saveHandler, /finally \{\s*clinicSettingsSaveInFlightRef\.current = false;/);
});

test('app updates saved clinic context without F5 only after server confirmation', () => {
  const begin = app.indexOf('onUpdateProfile={(data: any) => {');
  const finish = app.indexOf('onUpdatePatient={handleUpdatePatient}', begin);
  const handler = app.slice(begin, finish);
  assert.ok(begin !== -1 && finish > begin);
  assert.match(handler, /const profileSaveScope = data\?\.profileSaveScope === 'clinic' \? 'clinic' : 'professional'/);
  assert.match(handler, /if \(profileSaveScope !== 'clinic'\) \{[\s\S]*?setUser\(nextUser\)/);
  assert.match(handler, /const saveResult = await dataService\.saveUserProfile\(user\.id, persistencePayload\)/);
  assert.match(handler, /profileSaveScope === 'clinic' && saveResult\?\.success === true && !saveResult\?\.pending && !saveResult\?\.queued/);
  assert.match(handler, /setUser\(\(previous: any\) => \(\{[\s\S]*?saveResult\.user\?\.clinicSettings/);
  assert.match(handler, /if \(data\?\.profileSaveScope === 'clinic'\) \{\s*return \{ success: false/);
  assert.ok(handler.indexOf('const saveResult = await dataService.saveUserProfile') < handler.indexOf("if (profileSaveScope === 'clinic' && saveResult?.success"));
});

test('onboarding saves only when clicking Finish and restores the same confirmed clinic type', () => {
  const finish = onboarding.match(/const finish = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.match(finish, /dataService\.completeProfessionalOnboarding\(/);
  assert.match(finish, /if \(!result\?\.success\) \{\s*throw new Error/);
  assert.match(finish, /localStorage\.removeItem\(draftKey\)/);
  assert.ok(finish.indexOf('if (!result?.success)') < finish.indexOf('localStorage.removeItem(draftKey)'));
  assert.match(finish, /onComplete\(\{[\s\S]*?\.\.\.\(result\.user\?\.clinicSettings \|\| \{\}\)/);
  assert.match(onboarding, /metadata\?\.clinicOperationType \|\| user\?\.clinicSettings\?\.clinicOperationType/);
  assert.match(onboarding, /authoritativeContext\.onboardingMode === 'clinic_owner'/);
  assert.match(onboarding, /disabled=\{loading \|\| !clinicName\.trim\(\)\} onClick=\{finish\}/);
});

test('tenant and role authorization stay server-authoritative for clinic writes', () => {
  const start = server.indexOf("app.post('/api/profile/:userId', checkAuth");
  const end = server.indexOf("app.get('/api/tasks/:patientId'", start);
  const route = server.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /req\.session\.user\.id !== req\.params\.userId/);
  assert.match(route, /resolveClinicCapabilityContext\(req\.session\.user\)/);
  assert.match(route, /\['director', 'coordinator'\]\.includes\(activeClinicRole\)/);
  assert.match(route, /capabilities\?\.has\('clinic\.settings\.edit'\)/);
  assert.match(route, /CLINIC_SETTINGS_EDIT_DENIED/);
  assert.match(route, /await patchTableSafely\('clinics'/);
  assert.match(route, /await new Promise<void>\(\(resolve, reject\) => \{\s*req\.session\.save/);
  assert.match(route, /success: true,\s*user: buildSessionUserPayload\(req\.session\.user\)/);
});
