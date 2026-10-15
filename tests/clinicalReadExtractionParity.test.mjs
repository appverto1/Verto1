import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { clinicalReadManifest as manifest, extractedClinicalArrow, readClinicalServerSource } from './helpers/clinicalReadSource.mjs';

const current = readFileSync('server.ts', 'utf8');
const original = execFileSync('git', ['cat-file', 'blob', manifest.originalBlob], { encoding: 'utf8', maxBuffer: 12_000_000 });
assert.equal(manifest.routes.length, 19);
assert.ok(current.includes(manifest.imports), 'factory imports must retain their explicit domain paths');
for (const route of manifest.routes) {
  const arrow = extractedClinicalArrow(route);
  assert.equal(createHash('sha256').update(arrow).digest('hex'), route.sha256, `${route.name}: exact original handler bytes`);
  assert.equal(original.slice(route.start, route.end), arrow, `${route.name}: independently pinned Git blob`);
  assert.equal(current.split(route.header + route.replacement).length, 2, `${route.path}: original middleware expressions/order and exact dependency wiring`);
  assert.equal(current.split(`app.get('${route.path}',`).length, 2, `${route.path}: registered once`);
}
for (const module of new Set(manifest.routes.map(route => route.module))) {
  const source = readFileSync(`services/${module}.ts`, 'utf8');
  const ast = ts.createSourceFile(module + '.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length, 0, module + ': valid TypeScript');
  assert.ok(ast.statements.every(node => ts.isFunctionDeclaration(node)), module + ': no new module-level effects, imports or singleton state');
}
if (process.argv.includes('--full-roundtrip')) {
  assert.equal(readClinicalServerSource(), original, 'whole server source reconstructs byte-for-byte before publication');
}
console.log('Clinical read extraction: 19 historical handler hashes, middleware and dependency contracts PASS');
