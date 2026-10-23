import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = (p) => readFileSync(p, 'utf8');
const profileJs = ts.transpileModule(read('src/utils/patientProfileType.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const helpers = await import('data:text/javascript;base64,' + Buffer.from(profileJs).toString('base64'));
const server = read('server.ts');
const start = server.indexOf('function buildPatientProfileTypeFields(');
const end = server.indexOf('function normalizePatientInsuranceTypeForPersistence(', start);
assert.ok(start >= 0 && end > start, 'patient profile persistence function must exist exactly where expected');
assert.equal(server.indexOf('function buildPatientProfileTypeFields(', start + 1), -1, 'no duplicate persistence function');
const source = server.slice(start, end);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const resolve = runInNewContext(compiled + '\nbuildPatientProfileTypeFields', {
  normalizePatientProfileType: helpers.normalizePatientProfileType,
  mapPatientProfileTypeToLegacyPortalType: helpers.mapPatientProfileTypeToLegacyPortalType,
  sanitizeString: (v, limit = 80) => String(v ?? '').trim().slice(0, limit),
});
const result = (payload, partial) => JSON.parse(JSON.stringify(resolve(payload, partial)));
assert.deepEqual(result({ name: 'Only name changed' }, true), {}, 'name-only PATCH must not change patient role');
assert.deepEqual(result({ status: 'active', notes: 'updated' }, true), {}, 'non-profile PATCH must not default to ADULT');
assert.deepEqual(result({ group: 'adulto' }, true), {}, 'group-only partial PATCH must not silently reset an ABA/KIDS profile');
assert.equal(result({ patientProfileType: 'ABA' }, true).patient_profile_type, 'ABA');
assert.equal(result({ patient_group: 'infantil', patient_profile_type: 'ADULT' }, true).patient_profile_type, 'KIDS');
assert.equal(result({ grupo: 'adolescente' }, true).type, 'kids_tea');
assert.equal(result({}, false).patient_profile_type, 'ADULT', 'create defaults unchanged');
assert.equal(result({ patientProfileType: 'ABA' }, false).patient_profile_type, 'ABA');
assert.match(server, /function buildPatientIdentityPersistenceFields\(body: any, options: \{ partial\?: boolean \} = \{\}\)/);
assert.match(server, /buildPatientProfileTypeFields\(body, options\.partial === true\)/);
assert.match(server, /hasIdentityPersistencePatch \? buildPatientIdentityPersistenceFields\(patientIdentityPayload, \{ partial: true \}\)/);
assert.match(server, /const identityPersistenceFields = buildPatientIdentityPersistenceFields\(req\.body\)/, 'POST still uses creation mode');
console.log('p000PatientProfilePartialPatch: PASS');
