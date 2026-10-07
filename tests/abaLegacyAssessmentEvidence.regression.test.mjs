import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const workspace = fs.readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const legacy = fs.readFileSync('src/components/LegacyAssessmentChartsPanel.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');

const trialStart = app.indexOf('const handleRecordTrial = async');
const trialEnd = app.indexOf('const handle', trialStart + 50);
const trial = app.slice(trialStart, trialEnd > trialStart ? trialEnd : trialStart + 24000);
assert.match(trial, /matchedProtocol\?\.category === 'evaluation'/);
assert.match(trial, /evidence_kind: 'protocol_assessment'/);
for (const field of ['protocol_id','protocol_title','domain_id','domain_name','skill_id','skill_name','max_score']) {
  assert.match(trial, new RegExp(field));
}
assert.match(trial, /task_data: assessmentEvidence/);

assert.match(workspace, /LegacyAssessmentChartsPanel/);
assert.doesNotMatch(
  workspace.match(/view === 'aba'[\s\S]*?view === 'aba-v3'/)?.[0] || '',
  /AbaClinicalChartsPanel/,
  'ABA Legacy must not render the intervention/session snapshot panel'
);
assert.match(workspace, /legacyAssessmentProtocols/);

assert.match(legacy, /category \|\| protocol\?\.type/);
assert.match(legacy, /=== 'evaluation'/);
assert.match(legacy, /const explicitProtocol =/);
assert.match(legacy, /if \(!explicitProtocol\) return false/);
assert.match(legacy, /ref\.evidenceKind !== 'session_intervention'/);
assert.match(legacy, /Dados de intervenção do plano individual não entram no ABA Legacy/);
assert.match(legacy, /RadarDomainAssessmentChart/);

const historyStart = dataService.indexOf('async getHistory(patientId: string');
const historyEnd = dataService.indexOf('async getHistoryByEmail', historyStart);
const historyHelper = dataService.slice(historyStart, historyEnd);
assert.match(historyHelper, /fetchWithAuthRetry\(endpoint/);

console.log('abaLegacyAssessmentEvidence.regression.test.mjs: ok');
