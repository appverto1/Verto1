import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../src/components/ClinicalPlanAnalyticsShell.tsx', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/ClinicalOutcomesDashboard.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../src/components/ClinicalChartsWorkspace.tsx', import.meta.url), 'utf8');
const patient = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');

assert.match(shell, /sessionDateTimeLabel/);
assert.match(shell, /day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'/);
assert.doesNotMatch(shell, /`Sessão \${index \+ 1}`/);
assert.match(shell, /onOpenSessionReport/);
assert.match(shell, /clickableDot/);
assert.match(shell, /onClick=\{\(entry: any\) => openSessionReport/);
assert.match(shell, /bg-emerald-600 text-white/);
assert.match(dashboard, /onOpenSessionReport=\{onOpenSessionReport\}/);
assert.match(workspace, /onOpenSessionReport=\{onOpenSessionReport\}/);
assert.match(patient, /onOpenSessionReport=\{openCompletedSessionReport\}/);

console.log('clinical plan analytics session navigation regression: PASS');
