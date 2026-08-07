import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('src/components/PayerRequirementsPanel.tsx', 'utf8');
const dataService = fs.readFileSync('src/services/dataService.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

assert.match(panel, /normalizePatientInsuranceEligibility/);
assert.match(panel, /setupPatientMatchesPayer\(patient, selectedPayerId, selectedPayer\?\.name\)/);
assert.match(panel, /dataService\.getTissPreGuideTestOptions\(/);
assert.doesNotMatch(panel, /dataService\.getCalendarEvents\(/);
assert.match(panel, /buildSetupPreGuidePendingReasons/);
assert.match(panel, /A Pré-guia pode ser testada mesmo com pendências/);
assert.match(dataService, /async getTissPreGuideTestOptions\(options: any = \{\}\)/);
assert.match(dataService, /\/api\/tiss\/pre-guides\/test-options/);
assert.match(server, /app\.get\('\/api\/tiss\/pre-guides\/test-options'/);
assert.match(server, /ascending: false/);
assert.match(server, /insurance_payer_id/);
assert.match(server, /preGuidePendingReasons/);
assert.match(server, /syncStatus: syncStatus \|\| null/);
assert.doesNotMatch(server.match(/app\.get\('\/api\/tiss\/pre-guides\/test-options'[\s\S]*?const normalizeTissXmlCompetenceMonth/)?.[0] || '', /sourcePayload: parseCalendarSourcePayload/);

console.log('tissPayerLinkedPatientRecognition: ok');
