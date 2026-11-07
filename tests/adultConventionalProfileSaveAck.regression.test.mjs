import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const dataService = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const handler = dashboard.match(/  const handleSavePatientSettings = async \(\) => \{[\s\S]*?\n  \};/);
assert.ok(handler, 'Patient portal profile save handler must exist');
assert.match(dashboard, /const isConventionalAdult = patientPortalKind === 'ADULT_CONVENTIONAL'/);
assert.match(dashboard, /const patientSettingsSaveInFlightRef = useRef\(false\)/);
assert.match(dataService, /async updatePatientSelfProfile[\s\S]*?saveOfflineFirst\('profile:self'/,
  'Existing offline outbox contract is not modified by this UI-only fix');

const compiled = ts.transpileModule(handler[0], {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(save, options = {}) {
  const state = {
    message: '', name: 'Anterior', picture: null, saving: false,
    form: { name: options.name ?? 'Nome sintético', address: 'Rua sintética', profilePicture: '', profilePicturePath: '' },
    timers: [], closed: false,
  };
  const ctx = {
    isSavingSettings: false,
    patientSettingsSaveInFlightRef: { current: false },
    portalAnamnesisContextRef: { current: 'patient-A:clinic-A' },
    settingsForm: state.form,
    portalPatientId: 'patient-A',
    dataService: { updatePatientSelfProfile: save },
    setIsSavingSettings: (value) => { state.saving = value; },
    setSettingsMessage: (value) => { state.message = value; },
    setDisplayName: (value) => { state.name = value; },
    setProfilePicture: (value) => { state.picture = value; },
    setSettingsForm: (updater) => { state.form = updater(state.form); },
    setIsSettingsOpen: (value) => { if (value === false) state.closed = true; },
    setTimeout: (callback) => { state.timers.push(callback); },
  };
  vm.createContext(ctx);
  vm.runInContext(compiled + '\nglobalThis.invoke = handleSavePatientSettings;', ctx);
  return { ctx, state };
}

for (const result of [
  undefined, null, {}, { success: false, error: 'Erro simulado' },
  { success: true, queued: true }, { success: true, pending: true },
  { success: true, offline: true }, { success: false, queued: true },
]) {
  const { ctx, state } = harness(async () => result);
  await ctx.invoke();
  assert.equal(state.name, 'Anterior', 'Unconfirmed save cannot mutate displayed profile');
  assert.equal(state.form.name, 'Nome sintético', 'Draft must survive unconfirmed save');
  assert.equal(state.timers.length, 0, 'Unconfirmed save cannot schedule modal close');
  assert.ok(state.message, 'User must see an error/pending message');
  assert.equal(state.saving, false);
  assert.equal(ctx.patientSettingsSaveInFlightRef.current, false);
}

{
  const { ctx, state } = harness(async () => { throw new Error('Falha de rede'); });
  await ctx.invoke();
  assert.match(state.message, /Falha de rede/);
  assert.equal(state.name, 'Anterior');
  assert.equal(state.timers.length, 0);
  assert.equal(ctx.patientSettingsSaveInFlightRef.current, false);
}

{
  let calls = 0;
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  const { ctx, state } = harness((payload) => {
    calls += 1;
    assert.equal(payload.patientId, 'patient-A', 'Patient identity is supplied by portal context');
    return pending;
  });
  const first = ctx.invoke();
  const duplicate = ctx.invoke();
  assert.equal(calls, 1, 'Double click cannot issue two PATCH requests before rerender');
  resolveSave({ success: true, data: { name: 'Nome persistido', profilePicturePath: 'canonical/path' } });
  await Promise.all([first, duplicate]);
  assert.equal(state.name, 'Nome persistido');
  assert.equal(state.form.name, 'Nome persistido');
  assert.equal(state.form.profilePicturePath, 'canonical/path');
  assert.equal(state.timers.length, 1);
  state.timers[0]();
  assert.equal(state.closed, true);
  assert.equal(ctx.patientSettingsSaveInFlightRef.current, false);
}

{
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  const { ctx, state } = harness(() => pending);
  const first = ctx.invoke();
  ctx.portalAnamnesisContextRef.current = 'patient-B:clinic-B';
  resolveSave({ success: true, data: { name: 'Dados de outra clínica' } });
  await first;
  assert.equal(state.name, 'Anterior', 'Late response must not cross patient/clinic context');
  assert.equal(state.timers.length, 0);
  assert.equal(ctx.patientSettingsSaveInFlightRef.current, false);
}

{
  let calls = 0;
  const { ctx, state } = harness(async () => { calls += 1; return { success: true }; }, { name: ' ' });
  await ctx.invoke();
  assert.equal(calls, 0, 'Empty name must not send mutation');
  assert.ok(state.message);
}

console.log('adultConventionalProfileSaveAck.regression.test.mjs: ok');
