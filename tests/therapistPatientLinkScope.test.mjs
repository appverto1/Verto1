import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../src/utils/patientClinicalAccess.ts', import.meta.url), 'utf8');

const start = server.indexOf('async function resolvePatientListScopedPatientIds');
const end = server.indexOf('async function resolveLegacyClinicalEmailReadScope', start);
const scoped = server.slice(start, end);

assert.match(scoped, /mode === 'assigned_patients'/);
assert.match(scoped, /from\('patient_professional_links'\)[\s\S]*?select\('patient_id'\)[\s\S]*?eq\('professional_id', context\.userId\)[\s\S]*?eq\('status', 'active'\)/);
assert.doesNotMatch(scoped, /\.eq\('therapist_id'/, 'therapist_id legado não pode ampliar a lista de pacientes');
assert.doesNotMatch(scoped, /\.in\('therapist_id'/, 'supervisão também deve usar vínculos canônicos');
assert.match(access, /patient_professional_links is the canonical case-team relation/);
assert.match(access, /if \(!link\) \{[\s\S]*?return false;/);

console.log('therapistPatientLinkScope.test.mjs: ok');
