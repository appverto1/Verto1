import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync('src/components/ClinicalChartsWorkspace.tsx', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');

assert.match(workspace, /data-testid="aba-legacy-protocol-applications"/);
assert.match(workspace, /Aplicações de protocolos/);
assert.match(workspace, /Intervenções do plano individual não entram nesta leitura/);
assert.match(workspace, /protocol\?\.category === 'evaluation' \|\| !protocol\?\.category/);
assert.match(workspace, /type === 'intervention' \|\| type === 'reinforcement'/);
assert.match(workspace, /category === 'intervention' \|\| category === 'reinforcement'/);
assert.match(workspace, /legacyProtocolSkillKeys\.has\(titleKey\)/);
assert.match(workspace, /<RadarDomainAssessmentChart[\s\S]*history=\{legacyProtocolHistory\}/);
assert.match(workspace, /<CumulativeGrowthChart[\s\S]*history=\{legacyProtocolHistory\}/);
assert.doesNotMatch(
  workspace.slice(workspace.indexOf("view === 'aba'"), workspace.indexOf("view === 'aba-v3'")),
  /AbaClinicalChartsPanel/,
  'ABA Legacy must not render intervention/session ABA V2 analytics anymore'
);
assert.match(patientDetail, /<ClinicalChartsWorkspace[\s\S]*protocols=\{planProtocolCatalog\}[\s\S]*history=\{history\}/);

console.log('abaLegacyProtocolApplicationsP0.regression.test.mjs: ok');
