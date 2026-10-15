import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { protocolImportManifest as manifest, extractedProtocolArrow, readProtocolImportServerSource } from './helpers/protocolImportSource.mjs';

const current = readFileSync('server.ts', 'utf8');
const original = execFileSync('git', ['cat-file', 'blob', manifest.originalBlob], { encoding: 'utf8', maxBuffer: 12_000_000 });
assert.equal(manifest.routes.length, 9);
assert.ok(current.includes(manifest.imports));
for (const route of manifest.routes) {
  const arrow = extractedProtocolArrow(route);
  assert.equal(createHash('sha256').update(arrow).digest('hex'), route.sha256, `${route.name}: literal original source`);
  assert.equal(original.slice(route.start, route.end), arrow);
  assert.equal(current.split(route.header + route.replacement).length, 2, `${route.path}: original middleware and exact dependency capture`);
  assert.equal(current.split(`app.${route.method}('${route.path}',`).length, 2, `${route.method} ${route.path}: once`);
}
for (const name of new Set(manifest.routes.map(r => r.module))) {
  const ast = ts.createSourceFile(name + '.ts', readFileSync(`services/${name}.ts`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.ok(ast.statements.every(node => ts.isFunctionDeclaration(node)), 'no module initialization or circular imports');
}
if (process.argv.includes('--full-roundtrip')) assert.equal(readProtocolImportServerSource(), original, 'whole server source reconstructs byte-for-byte');
console.log('Protocol import extraction: 9 historical handlers and unchanged registrations PASS');
