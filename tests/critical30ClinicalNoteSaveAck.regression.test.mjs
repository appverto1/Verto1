import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const view = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/dataService.ts', import.meta.url), 'utf8');
const handler = view.match(/  const noteSaveContextRef = useRef\(''\);[\s\S]*?  const handleAddNoteWithSubject = async \(\) => \{[\s\S]*?\n  \};/);
assert.ok(handler, 'Manual note save handler and patient/mode context guard must exist');
assert.match(view, /noteSaveInFlightRef\.current = true/);
assert.match(view, /disabled=\{isSavingNote \|\| !newNote\.trim\(\)\}/);
assert.match(view, /role="alert"/);
assert.match(app, /const requireServerAck = options\?\.requireServerAck === true/);
assert.match(app, /if \(!requireServerAck\) \{\s*setTherapistNotes/);
assert.match(app, /if \(requireServerAck\) \{\s*if \(result\?\.success === true && result\?\.pending !== true && result\?\.offline !== true && result\?\.data\?\.id\)/);
assert.match(service, /if \(options\.requireServerAck === true\) \{[\s\S]*?result\?\.success === true && result\?\.data\?\.id/);
assert.match(service, /return await saveOfflineFirst\(id, data, 'note', '\/api\/notes'\)/, 'Legacy offline flow remains available to existing callers');

const compiled = ts.transpileModule(handler[0], {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(save, opts = {}) {
  const state = { text: 'Registro clínico sintético', subject: 'Evolução', mentions: ['member-1'], saving: false, error: '', calls: [] };
  const ctx = {
    useRef: (initial) => ({ current: initial }),
    crypto: { randomUUID: (() => { let i = 0; return () => 'synthetic-note-' + ++i; })() },
    patient: { id: 'patient-A' },
    noteMode: opts.mode || 'professional',
    newNote: state.text,
    newNoteSubject: state.subject,
    selectedMentionUserIds: state.mentions,
    setNewNote: (update) => { state.text = typeof update === 'function' ? update(state.text) : update; },
    setNewNoteSubject: (update) => { state.subject = typeof update === 'function' ? update(state.subject) : update; },
    setSelectedMentionUserIds: (update) => { state.mentions = typeof update === 'function' ? update(state.mentions) : update; },
    setIsSavingNote: (value) => { state.saving = value; },
    setNoteSaveError: (value) => { state.error = value; },
    onAddNote: (...args) => { state.calls.push(args); return save(...args); },
  };
  vm.createContext(ctx);
  vm.runInContext(compiled + '\nglobalThis.invoke = handleAddNoteWithSubject; globalThis.noteContext = noteSaveContextRef;', ctx);
  return { ctx, state };
}

for (const result of [
  undefined, null, {}, { success: false, error: 'Recusado' },
  { success: true, pending: true, data: { id: 'persisted' } },
  { success: true, offline: true, data: { id: 'persisted' } },
  { success: true },
]) {
  const { ctx, state } = harness(async () => result);
  await ctx.invoke();
  assert.equal(state.text, 'Registro clínico sintético', 'Unconfirmed save preserves draft');
  assert.equal(state.subject, 'Evolução', 'Unconfirmed save preserves subject');
  assert.equal(state.mentions.length, 1, 'Unconfirmed save preserves mentions');
  assert.ok(state.error, 'Unconfirmed save shows an error');
  assert.equal(state.saving, false);
  assert.equal(ctx.noteSaveInFlightRef.current, false);
}

{
  const { ctx, state } = harness(async () => { throw new Error('Rede indisponível'); });
  await ctx.invoke();
  assert.equal(state.text, 'Registro clínico sintético');
  assert.match(state.error, /Falha ao salvar/);
}

{
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  const { ctx, state } = harness(() => pending);
  const first = ctx.invoke();
  await ctx.invoke();
  assert.equal(state.calls.length, 1, 'Rapid double-click must send only one request');
  assert.equal(state.calls[0][0], 'patient-A');
  assert.equal(state.calls[0][2], 'professional');
  assert.equal(state.calls[0][4].requireServerAck, true);
  assert.equal(state.calls[0][4].mentionUserIds.length, 1);
  resolveSave({ success: true, data: { id: 'persisted' } });
  await first;
  assert.equal(state.text, '', 'Confirmed save clears only its draft');
  assert.equal(state.subject, '');
  assert.equal(state.mentions.length, 0);
  assert.equal(state.error, '');
  assert.equal(state.saving, false);
}

{
  const { ctx, state } = harness(async () => ({ success: false }));
  await ctx.invoke();
  const id1 = state.calls[0][4].clientNoteId;
  await ctx.invoke();
  assert.equal(state.calls[1][4].clientNoteId, id1, 'Retry of unchanged draft must reuse idempotent note ID');
  ctx.newNote = 'Novo texto';
  await ctx.invoke();
  assert.notEqual(state.calls[2][4].clientNoteId, id1, 'Changed draft gets a new identity');
}

{
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  const { ctx, state } = harness(() => pending);
  const first = ctx.invoke();
  ctx.noteContext.current = 'patient-B:professional';
  resolveSave({ success: true, data: { id: 'persisted' } });
  await first;
  assert.equal(state.text, 'Registro clínico sintético', 'Late response cannot clear another patient draft');
  assert.equal(state.subject, 'Evolução');
  assert.equal(state.error, '');
}

console.log('critical30ClinicalNoteSaveAck.regression.test.mjs: ok');
