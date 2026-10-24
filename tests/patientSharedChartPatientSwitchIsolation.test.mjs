import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workspace = readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const control = readFileSync('src/components/ProfessionalSharedChartControl.tsx', 'utf8');
const panel = readFileSync('src/components/PatientSharedChartDelegationPanel.tsx', 'utf8');
const routes = readFileSync('services/patientSharedChartRoutes.ts', 'utf8');

assert.match(workspace, /<ProfessionalSharedChartControl key=\{patientId\} patientId=\{patientId\}/,
  'changing patients must unmount previous chart/share state');
assert.match(control, /const requestId = \+\+lastRequest\.current/);
assert.match(control, /if \(lastRequest\.current !== requestId\) return/,
  'old chart responses cannot override new patient authority');
assert.match(control, /setConfirmed\(null\)/);
assert.match(control, /setGovernance\(\{ canPublish: false, canDelegate: false \}\)/);
assert.match(control, /<PatientSharedChartDelegationPanel key=\{patientId\} patientId=\{patientId\}/);
assert.match(panel, /setPeople\(\[\]\);[\s\S]*setDraft\(\{\}\);/,
  'a new patient or failed fetch cannot display old professional grants');
assert.match(panel, /if \(!active \|\| currentPatientRef\.current !== requestedPatientId\) return/);
assert.match(panel, /if \(currentPatientRef\.current !== requestedPatientId\) return/,
  'an earlier Save result cannot update a different patient');
assert.match(routes, /const actorId = sanitizeString\(req\.session\.user\?\.id \|\| req\.session\.user\?\.user_id, 120\)/,
  'both authenticated session ID variants must be supported');
assert.match(routes, /checkSharedChartProfessionalPatientScope/);
assert.match(routes, /set_patient_shared_chart_case_delegation_v2/);
console.log('patientSharedChartPatientSwitchIsolation.test.mjs: PASS');
