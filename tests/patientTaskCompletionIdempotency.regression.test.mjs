import assert from 'node:assert/strict';
import fs from 'node:fs';

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
