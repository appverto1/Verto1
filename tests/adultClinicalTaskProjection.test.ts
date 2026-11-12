import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAdultCompletedTasks,
  buildAdultScheduledTasks,
  getAssignedTaskData,
  getEffortEmoji,
  hasCanonicalAdultEffortSemantics,
  normalizeEffortPercent,
  resolveAssignedTaskNumber,
  resolveAssignedTaskProfessionalScore,
  resolveAssignedTaskPatientEffort,
  resolveAssignedTaskReviewNote,
} from '../src/utils/adultClinicalTaskProjection';

const timestamp = (day: string) => `2026-10-${day}T12:00:00.000Z`;

const assignedTasks = [
  {
    id: 'assigned-1', status: 'completed', task_type: 'intervention',
    completed_at: timestamp('03'), reviewed_at: timestamp('09'),
    pro_score: 3, patient_effort: 64.8, patient_comment: 'Fiz o exercício',
    task_data: { title: 'Exercício combinado', maxScore: 5, patientEffortSemantics: 'effort_min_0_max_100_v2' },
  },
  { id: 'pending-1', status: 'pending', scheduled_at: timestamp('11'), task_data: { title: 'Tarefa futura' } },
  { id: 'assigned-2', status: 'completed', completed_at: timestamp('08'), task_data: { title: 'Sem revisão', maxScore: 4 } },
];
const legacyTasks = [
  {
    id: 'legacy-1', is_completed: true, type: 'task', title: 'Registro legado',
    completed_at: timestamp('01'), pro_score: 0, patient_effort: 0, evalComment: 'Revisão legada',
  },
  {
    id: 'assigned-1', done: true, title: 'Cópia anterior',
    completed_at: timestamp('02'), pro_score: 2,
  },
];

const completed = buildAdultCompletedTasks(assignedTasks, legacyTasks);
assert.equal(completed.length, 3, 'completed tasks stay deduplicated across assigned and legacy records');
assert.deepEqual(completed.map((row) => row.id), ['assigned-1', 'assigned-2', 'legacy-1'],
  'clinical evolution remains sorted by review date where present');
const reviewed = completed[0];
assert.equal(reviewed.taskTitle, 'Exercício combinado');
assert.equal(reviewed.taskType, 'intervention');
assert.equal(reviewed.maxScore, 5);
assert.equal(reviewed.professionalScore, 3);
assert.equal(reviewed.patientEffort, 65);
assert.equal(reviewed.patientEffortSemantics, 'effort_min_0_max_100_v2');
assert.equal(reviewed.patientComment, 'Fiz o exercício');
assert.equal(reviewed.eventDate.toISOString(), timestamp('09'), 'review timestamp takes precedence after score');
assert.equal(reviewed.executionDate.toISOString(), timestamp('03'), 'original execution date remains intact');
assert.equal(completed[1].professionalScore, null, 'missing professional review must not fabricate a score');
assert.equal(completed[1].patientEffort, null, 'missing patient effort must remain absent, not 0%');
assert.equal(completed[1].eventDate.toISOString(), timestamp('08'));
assert.equal(completed[2].professionalScore, 0, 'explicit clinical score 0 is distinct from missing score');
assert.equal(completed[2].patientEffort, 0, 'explicit patient effort 0 is distinct from missing effort');
assert.equal(completed[2].evolutionNote, 'Revisão legada');

const scheduled = buildAdultScheduledTasks([
  { id: 'same', title: 'Local', scheduledAt: timestamp('10') },
  { id: 'legacy-pending', title: 'Pendente legado', scheduled_at: timestamp('12') },
], [
  { id: 'same', status: 'pending', scheduled_at: timestamp('13'), task_data: { title: 'Persistido' } },
  { id: 'complete', status: 'completed', scheduled_at: timestamp('14'), task_data: { title: 'Concluído' } },
], false);
assert.deepEqual(scheduled.map((row) => row.id), ['legacy-pending', 'same'],
  'adult schedule preserves date ordering, skips completed assigned tasks and deduplicates by id');
assert.equal(scheduled[1].source, 'server', 'server record overrides a matching local projection');
assert.equal(scheduled[1].title, 'Persistido');
assert.deepEqual(buildAdultScheduledTasks([], assignedTasks, true), [], 'pediatric portal keeps its existing separate schedule');

assert.deepEqual(getAssignedTaskData({ task_data: { title: 'DB' }, taskData: { title: 'Legacy' } }), { title: 'DB' });
assert.equal(resolveAssignedTaskNumber('', undefined, '0'), 0);
assert.equal(resolveAssignedTaskProfessionalScore({ task_data: { proScore: '2' } }), 2);
assert.equal(resolveAssignedTaskPatientEffort({ task_data: { patientEffort: 0 } }), 0);
assert.equal(resolveAssignedTaskReviewNote({ task_data: { reviewNote: 'Anotação preservada' } }), 'Anotação preservada');
assert.equal(hasCanonicalAdultEffortSemantics({ task_data: { patientEffortSemantics: 'effort_min_0_max_100_v2' } }), true);
assert.equal(hasCanonicalAdultEffortSemantics({ patient_effort: 40 }), false, 'old records remain marked as legacy');
assert.equal(normalizeEffortPercent(101), 100);
assert.equal(normalizeEffortPercent(-7), 0);
assert.equal(getEffortEmoji(80), '😫');

const source = readFileSync('src/utils/adultClinicalTaskProjection.ts', 'utf8');
const panel = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
assert.doesNotMatch(source, /dataService|supabase|fetch\(|axios|\.insert\(|\.update\(/,
  'projection module must not read or write the server or database');
assert.match(panel, /const normalizeReviewedAssignedTask =/,
  'clinical review merging remains in patient panel');
assert.match(panel, /const handleSchedule = async/,
  'explicit task scheduling persistence remains in patient panel');
assert.match(panel, /\(\) => buildAdultCompletedTasks\(assignedTasks, patientTasks\)/);
assert.match(panel, /\(\) => buildAdultScheduledTasks\(patientTasks, assignedTasks, isKidsProfile\)/);

console.log('adultClinicalTaskProjection.test.ts: PASS');
