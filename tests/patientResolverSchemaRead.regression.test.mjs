import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('server.ts','utf8');
const start = source.indexOf('async function resolvePatientIdForRequest(');
const end = source.indexOf('function normalizeAppointmentStatusForTable(',start);
assert.ok(start >= 0 && end > start,'patient resolver must remain in server.ts');
const resolver = source.slice(start,end);
const uuidBranch = resolver.slice(resolver.indexOf('if (isUuid(safeRaw)) {'),resolver.indexOf('const guessedName ='));

test('patient UUID lookup selects only existing canonical id and never missing created_by', () => {
  assert.match(uuidBranch,/\.from\('patients'\)\s*\/\/[^\n]*\n\s*\.select\('id'\)/);
  assert.doesNotMatch(uuidBranch,/\.select\('[^']*(?:created_by|created_at)[^']*'\)/);
  assert.equal((uuidBranch.match(/\.from\('patients'\)/g)||[]).length,1);
  assert.equal((uuidBranch.match(/\.select\('id'\)/g)||[]).length,1);
});

test('patient resolver preserves UUID, active, non-deleted and tenant scope before resolving', () => {
  assert.match(uuidBranch,/\.eq\('id', safeRaw\)/);
  assert.match(uuidBranch,/\.eq\('is_active', true\)/);
  assert.match(uuidBranch,/\.is\('deleted_at', null\)/);
  assert.match(uuidBranch,/\.limit\(1\)/);
  assert.match(uuidBranch,/if \(isUuid\(sanitizeString\(clinicId, 120\)\)\)\s*\{\s*byIdQuery = byIdQuery\.eq\('clinic_id', sanitizeString\(clinicId, 120\)\)/);
  assert.match(uuidBranch,/await byIdQuery\.maybeSingle\(\)/);
});

test('patient portal keeps canonical bound identity and UUID branch never creates patients', () => {
  assert.match(resolver,/if \(role === 'patient'\)\s*\{\s*const portalScope = await resolveCanonicalPatientPortalScope\(user\)/);
  assert.match(resolver,/return portalScope\.patientId/);
  assert.doesNotMatch(uuidBranch,/\.insert\(|\.upsert\(|\.update\(/);
  assert.match(resolver,/Clinical write routes must never create a patient as a side effect/);
});
