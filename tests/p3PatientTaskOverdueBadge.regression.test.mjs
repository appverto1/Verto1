import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const patientDashboard = readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const start = patientDashboard.indexOf('const portalTasksPanel = (');
const end = patientDashboard.indexOf('const portalAnamnesisPanel =', start);
assert.ok(start >= 0 && end > start, 'o painel de tarefas do portal deve existir');
const panel = patientDashboard.slice(start, end);

assert.match(panel, /visiblePatientTasks\.map\(/, 'as tarefas disponíveis continuam listadas');
assert.match(panel, /openTaskModal\(task\)/, 'tarefa disponível continua abrindo o fluxo existente');
assert.match(panel, /parseScheduledTaskDate\(/, 'a data agendada permanece disponível');
assert.match(panel, /scheduledAt\.toLocaleString\('pt-BR'/, 'a data continua legível no card');
assert.doesNotMatch(panel, /\boverdue\b|>Atrasada<|Selo de atraso/i,
  'tarefa ainda disponível não recebe rótulo punitivo de atraso');
assert.match(panel, /disabled=\{isReadOnlyMode\}/, 'bloqueio somente-leitura do portal permanece');
assert.match(panel, /Nenhuma tarefa pendente no momento/, 'estado vazio permanece intacto');

console.log('p3PatientTaskOverdueBadge.regression.test.mjs: OK');
