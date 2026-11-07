import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const handler = dashboard.match(/  const handleConfirmMood = async \(\) => \{[\s\S]*?\n  \};/);
assert.ok(handler, 'Adult portal energy check-in handler must exist');
assert.match(dashboard, /const moodSubmitInFlightRef = useRef\(false\)/);
assert.match(app, /const result = await dataService\.savePatientSelfWellbeingCheckin\(/);
assert.match(app, /if \(!result\?\.success \|\| !result\?\.data\)/);

const compiled = ts.transpileModule(handler[0], {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const harness = (onMoodCheckin, readOnly = false) => {
  const state = { error: '', success: false, closed: false, checkins: [], mood: 'draft', saving: false };
  const ctx = {
    isReadOnlyMode: readOnly,
    selectedMood: { value: 65, emoji: '⚡' },
    isMoodSaving: false,
    moodSubmitInFlightRef: { current: false },
    moodNote: 'Registro sintético',
    selectedTag: 'energia',
    onMoodCheckin,
    setIsMoodSaving: (value) => { state.saving = value; },
    setMoodSaveError: (value) => { state.error = value; },
    setWellbeingCheckins: (updater) => { state.checkins = updater(state.checkins); },
    setShowMoodSuccess: (value) => { if (value) state.success = true; },
    setIsMoodModalOpen: (value) => { if (value === false) state.closed = true; },
    setMoodNote: (value) => { state.mood = value; },
    setSelectedMood: () => {},
    setSelectedTag: () => {},
    window: { setTimeout: () => 0 },
  };
  vm.createContext(ctx);
  vm.runInContext(compiled + '\nglobalThis.invoke = handleConfirmMood;', ctx);
  return { ctx, state };
};

for (const result of [undefined, null, {}, { success: false, error: 'Falha simulada' }]) {
  const { ctx, state } = harness(async () => result);
  await ctx.invoke();
  assert.equal(state.success, false, 'No false success on absent/negative ACK');
  assert.equal(state.closed, false, 'Keep modal open on failed save');
  assert.ok(state.error, 'Explain failed save');
  assert.equal(state.saving, false, 'Unlock UI on failed save');
  assert.equal(ctx.moodSubmitInFlightRef.current, false, 'Unlock synchronous guard');
}

{
  const { ctx, state } = harness(async () => { throw new Error('offline'); });
  await ctx.invoke();
  assert.equal(state.success, false);
  assert.equal(state.closed, false);
  assert.ok(state.error);
  assert.equal(ctx.moodSubmitInFlightRef.current, false);
}

{
  let resolveSave;
  let calls = 0;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  const { ctx, state } = harness(() => { calls += 1; return pending; });
  const first = ctx.invoke();
  const duplicate = ctx.invoke();
  assert.equal(calls, 1, 'Double click cannot trigger a second save before rerender');
  resolveSave({ success: true, data: { id: 'synthetic-checkin', metric_kind: 'energy' } });
  await Promise.all([first, duplicate]);
  assert.equal(state.success, true);
  assert.equal(state.closed, true);
  assert.equal(state.checkins.length, 1);
  assert.equal(ctx.moodSubmitInFlightRef.current, false);
}

{
  let calls = 0;
  const { ctx } = harness(async () => { calls += 1; return { success: true }; }, true);
  await ctx.invoke();
  assert.equal(calls, 0, 'Read-only portal cannot submit check-ins');
}

console.log('adultAbaEnergySaveAck.regression.test.mjs: ok');
