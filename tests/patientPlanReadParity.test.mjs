import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { extractedClinicalArrow } from './helpers/clinicalReadSource.mjs';
import { patientPlanReadManifest as manifest, extractedPatientPlanArrow, restorePatientPlanReads } from './helpers/patientPlanReadSource.mjs';
const current = readFileSync('server.ts', 'utf8');
const original = execFileSync('git', ['cat-file', 'blob', manifest.originalBlob], { encoding: 'utf8', maxBuffer: 12_000_000 });
assert.equal(manifest.routes.length, 8);
assert.ok(current.includes(manifest.imports));
const emit = source => ts.transpileModule('module.exports = ' + source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
for (const route of manifest.routes) {
  const arrow = extractedPatientPlanArrow(route);
  assert.equal(createHash('sha256').update(arrow).digest('hex'), route.sha256, `${route.name}: exact source after removing recorded type-only annotations`);
  assert.equal(original.slice(route.start, route.end), arrow);
  if (route.name === 'createPatientSelfHistoryReadHandler') {
    // Intentional exception: only this history response now includes the
    // clinic-scoped, server-confirmed profile. The other seven remain byte-exact.
    const source = readFileSync('services/' + route.module + '.ts', 'utf8');
    assert.match(source, /resolveCanonicalPatientPortalScope\(req\.session\.user\)/);
    assert.match(source, /select\('patient_profile_type,panel_type,type,patient_group,age'\)/);
    assert.match(source, /\.eq\('id', portalScope\.patientId\)/);
    assert.match(source, /\.eq\('clinic_id', portalScope\.clinicId\)/);
    assert.match(source, /\.is\('deleted_at', null\)/);
    assert.match(source, /portalProfile: \{/);
    assert.doesNotMatch(source, /\.eq\('email',/);
  } else {
    assert.equal(emit(extractedClinicalArrow(route)), emit(arrow), 'type-only Map annotations erase to identical executable JavaScript');
  }
  assert.equal(current.split(route.header + route.replacement).length, 2, `${route.path}: exact original middleware and dependencies`);
}
for (const name of new Set(manifest.routes.map(r => r.module))) {
  const ast = ts.createSourceFile(name + '.ts', readFileSync(`services/${name}.ts`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.ok(ast.statements.every(ts.isFunctionDeclaration), 'no new initialization or runtime imports');
}
if (process.argv.includes('--full-roundtrip')) assert.equal(restorePatientPlanReads(current), original, 'whole server reverse reconstruction');
console.log('Patient/plan reads: 8 source, middleware and emitted-JavaScript parity contracts PASS');
