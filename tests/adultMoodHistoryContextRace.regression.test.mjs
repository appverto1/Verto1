import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const dashboard = fs.readFileSync(new URL('../src/components/PatientDashboard.tsx', import.meta.url), 'utf8');
const handler = dashboard.match(/  const handleConfirmMood = async \(\) => \{[\s\S]*?\n  \};/);
assert.ok(handler, 'Mood save handler must exist');
assert.match(dashboard, /const wellbeingLoadRevisionRef = useRef\(0\)/);
assert.match(dashboard, /const revisionAtStart = wellbeingLoadRevisionRef\.current/);
assert.match(dashboard, /revisionAtStart === wellbeingLoadRevisionRef\.current/);
assert.match(dashboard, /const persistedIds = new Set\(current\.map/);
assert.match(dashboard, /return \[\.\.\.current, \.\.\.fetched\.filter/);
assert.match(dashboard, /portalAnamnesisContextRef\.current !== portalAnamnesisContextKey/);
assert.match(dashboard, /\[isKidsProfile, portalAnamnesisContextKey, wellbeingPeriod\]/);
assert.match(dashboard, /setWellbeingCheckins\(\[\]\);\n    if \(isKidsProfile/);
const compiled = ts.transpileModule(handler[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(save) {
  const state = { checkins: [], success: false, closed: false, note: 'rascunho', error: '', saving: false };
  const ctx = {
    isReadOnlyMode: false,
    selectedMood: { value: 70, emoji: '🙂' },
    isMoodSaving: false,
    moodSubmitInFlightRef: { current: false },
    wellbeingLoadRevisionRef: { current: 0 },
    portalAnamnesisContextKey: 'patient-A:user-A:clinic-A',
    portalAnamnesisContextRef: { current: 'patient-A:user-A:clinic-A' },
    moodNote: 'rascunho',
    selectedTag: null,
    onMoodCheckin: save,
    setIsMoodSaving: (value) => { state.saving = value; },
    setMoodSaveError: (value) => { state.error = value; },
    setWellbeingCheckins: (updater) => { state.checkins = updater(state.checkins); },
    setShowMoodSuccess: (value) => { if (value) state.success = true; },
    setIsMoodModalOpen: (value) => { if (value === false) state.closed = true; },
    setMoodNote: (value) => { state.note = value; },
    setSelectedMood: () => {},
    setSelectedTag: () => {},
    window: { setTimeout: () => 0 },
  };
  vm.createContext(ctx);
  vm.runInContext(compiled + '\nglobalThis.invoke = handleConfirmMood;', ctx);
  return { ctx, state };
}

for (const response of [undefined, {}, { success: true }, { success: true, data: {} },
  { success: true, data: { id: 'x' }, pending: true },
  { success: true, data: { id: 'x' }, offline: true },
  { success: true, data: { id: 'x' }, queued: true }]) {
  const { ctx, state } = harness(async () => response);
  await ctx.invoke();
  assert.equal(state.success, false, 'Unconfirmed response must not show success');
  assert.equal(state.closed, false, 'Unconfirmed response must keep modal open');
  assert.equal(state.note, 'rascunho', 'Unconfirmed response must preserve draft');
  assert.equal(ctx.wellbeingLoadRevisionRef.current, 0, 'Failed save must not invalidate reads');
  assert.ok(state.error);
}

{
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const { ctx, state } = harness(() => pending);
  const save = ctx.invoke();
  ctx.portalAnamnesisContextRef.current = 'patient-B:user-A:clinic-B';
  resolve({ success: true, data: { id: 'patient-A-checkin' } });
  await save;
  assert.equal(state.checkins.length, 0, 'Late save must not contaminate another clinic');
  assert.equal(state.closed, false, 'Late save must not close another context modal');
  assert.equal(state.success, false);
  assert.equal(ctx.wellbeingLoadRevisionRef.current, 0);
}

{
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const { ctx, state } = harness(() => pending);
  const first = ctx.invoke();
  const second = ctx.invoke();
  resolve({ success: true, data: { id: 'persisted-checkin' } });
  await Promise.all([first, second]);
  assert.equal(state.checkins.length, 1);
  assert.equal(state.success, true);
  assert.equal(state.closed, true);
  assert.equal(ctx.wellbeingLoadRevisionRef.current, 1, 'Confirmed write invalidates in-flight list reads');
  assert.equal(ctx.moodSubmitInFlightRef.current, false);
}
console.log('adultMoodHistoryContextRace.regression.test.mjs: ok');
