import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const dashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261007193000_assigned_task_completion_idempotency_p0.sql', 'utf8');

assert.match(dashboard, /const \[isTaskSaving, setIsTaskSaving\] = useState\(false\)/);
assert.match(dashboard, /if \(isReadOnlyMode \|\| !selectedTask \|\| isTaskSaving \|\| taskSubmitInFlightRef\.current\) return;/);
assert.match(dashboard, /taskSubmitInFlightRef = useRef\(false\)/);
assert.match(dashboard, /taskSubmitInFlightRef\.current = true;/);
assert.match(dashboard, /taskSubmitInFlightRef\.current = false;/);
assert.match(dashboard, /setIsTaskSaving\(true\)[\s\S]*finally \{[\s\S]*setIsTaskSaving\(false\)/);
assert.match(dashboard, /disabled=\{isTaskSaving \|\| showTaskSuccess/);
assert.match(dashboard, /isTaskSaving \?[\s\S]*Salvando\.\.\.|isTaskSaving \?[\s\S]*Enviando\.\.\./);

assert.match(app, /taskCompletionInFlightRef = useRef<Set<string>>\(new Set\(\)\)/);
assert.match(app, /taskCompletionInFlightRef\.current\.has\(taskCompletionLockKey\)/);
assert.match(app, /taskCompletionInFlightRef\.current\.add\(taskCompletionLockKey\)/);
assert.match(app, /finally \{[\s\S]*taskCompletionInFlightRef\.current\.delete\(taskCompletionLockKey\)/);

assert.match(dataService, /X-Idempotency-Key': `assigned-task-completion:\$\{String\(taskId\)\}`/);

assert.match(migration, /for update/);
assert.match(migration, /lower\(coalesce\(v_task\.status, 'pending'\)\) in \('completed', 'done'\)/);
assert.match(migration, /v_task\.last_history_event_id/);
assert.match(migration, /assigned_task_id = v_task\.id/);
assert.match(migration, /source = 'assigned_task_completion'/);
assert.match(migration, /'idempotent', true/);
assert.ok(
  migration.indexOf("lower(coalesce(v_task.status, 'pending')) in ('completed', 'done')") <
  migration.indexOf('update public.assigned_tasks'),
  'idempotent replay must return before mutating the completed task'
);

console.log('patientTaskCompletionIdempotency.regression.test.mjs: ok');


// Item 28: adult task completion requires an explicit, server-confirmed ACK.
// Exercise the actual TypeScript handler instead of only matching its source text.
const handlerStart = dashboard.indexOf('  const handleConfirmTask = async () => {');
const handlerEnd = dashboard.indexOf('\n  };', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'Adult task completion handler must exist');
assert.match(dashboard, /taskSaveError && <p role="alert"/, 'Failures must be visible inside the task modal');
const compiledTaskHandler = ts.transpileModule(dashboard.slice(handlerStart, handlerEnd + 5), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function taskHarness(onCompleteTask, options = {}) {
  const state = {
    selectedTask: { id: 'synthetic-task-A', type: 'task', title: 'Tarefa sintética' },
    note: 'Rascunho sintético', error: '', saving: false, success: false, timers: [],
  };
  const ctx = {
    isReadOnlyMode: options.readOnly || false,
    isTaskSaving: false,
    isKidsProfile: false,
    selectedTask: state.selectedTask,
    taskEnergy: 40,
    taskNote: state.note,
    interventionResponse: '',
    interventionImages: [],
    taskSubmitInFlightRef: { current: false },
    onCompleteTask,
    setTaskSaveError: (value) => { state.error = value; },
    setIsTaskSaving: (value) => { state.saving = value; },
    setShowTaskSuccess: (value) => { state.success = value; },
    setSelectedTask: (value) => { state.selectedTask = value; },
    setInterventionResponse: () => {},
    setInterventionImages: () => {},
    setTaskStep: () => {},
    window: { setTimeout: (callback) => { state.timers.push(callback); } },
  };
  vm.createContext(ctx);
  vm.runInContext(compiledTaskHandler + '\nglobalThis.invokeTask = handleConfirmTask;', ctx);
  return { ctx, state };
}

for (const response of [
  undefined, null, {}, { success: false, error: 'Negado' },
  { success: true, pending: true }, { success: true, queued: true },
  { success: true, offline: true }, { success: false, queued: true },
]) {
  const { ctx, state } = taskHarness(async () => response);
  await ctx.invokeTask();
  assert.equal(state.selectedTask.id, 'synthetic-task-A', 'No unconfirmed response may close the task');
  assert.equal(state.note, 'Rascunho sintético', 'Unconfirmed response must retain draft');
  assert.equal(state.success, false, 'Unconfirmed response must not show success');
  assert.equal(state.timers.length, 0, 'Unconfirmed response must not schedule success overlay');
  assert.ok(state.error, 'Unconfirmed response must explain failure');
  assert.equal(state.saving, false);
  assert.equal(ctx.taskSubmitInFlightRef.current, false);
}

{
  const { ctx, state } = taskHarness(async () => { throw new Error('Rede indisponível'); });
  await ctx.invokeTask();
  assert.match(state.error, /Rede indisponível/);
  assert.equal(state.selectedTask.id, 'synthetic-task-A');
  assert.equal(state.success, false);
  assert.equal(ctx.taskSubmitInFlightRef.current, false);
}

{
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const { ctx, state } = taskHarness(async () => { calls += 1; return pending; });
  const first = ctx.invokeTask();
  const duplicate = ctx.invokeTask();
  assert.equal(calls, 1, 'Double click must not trigger two task completions');
  finish({ success: true, data: { id: 'synthetic-task-A', status: 'completed' } });
  await Promise.all([first, duplicate]);
  assert.equal(state.selectedTask, null, 'Confirmed save closes task modal');
  assert.equal(state.success, true, 'Confirmed save shows success');
  assert.equal(state.timers.length, 1);
  assert.equal(ctx.taskSubmitInFlightRef.current, false);
}

{
  let calls = 0;
  const { ctx } = taskHarness(async () => { calls += 1; return { success: true }; }, { readOnly: true });
  await ctx.invokeTask();
  assert.equal(calls, 0, 'Read-only portal must not submit task completion');
}
