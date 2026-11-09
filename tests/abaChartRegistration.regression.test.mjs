import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync('server.ts', 'utf8');
const route = "app.get('/api/aba/patients/:patientId/charts/session-changes', requireAbaV2Feature, checkAuth, requireClinicCapability('aba.analytics.view'), checkPatientAccess, abaChartReadHandlers['session-changes']);";
assert.equal(server.split(route).length, 2, 'session-changes must register once with its original access guards and valid handler');
assert.ok(!server.includes('abaChartReadHandlers.session-changes'), 'hyphenated handler name requires bracket access');
console.log('ABA chart session-changes registration: PASS');
