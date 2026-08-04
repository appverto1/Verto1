import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

assert.match(server, /role === 'therapist' && scopedClinicId/);
assert.match(server, /from\('patient_professional_links'\)[\s\S]*?select\('patient_id'\)[\s\S]*?eq\('professional_id', professionalId\)[\s\S]*?eq\('status', 'active'\)/);
assert.match(server, /linkedPatientIdsResult\.data/);
assert.match(server, /from\('patients'\)[\s\S]*?\.in\('id', patientIdBatch\)/);
assert.match(server, /const mergedPatients = new Map<string, any>\(\)/);
assert.match(server, /patients = Array\.from\(mergedPatients\.values\(\)\)/);

console.log('therapistPatientLinkScope.test.mjs: ok');
