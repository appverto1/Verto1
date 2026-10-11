import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import ts from 'typescript';

const targetBranch = 'refs/heads/refactor/backend-tuss-mappings-route-batch-20261011';
assert.equal(process.env.GITHUB_REF, targetBranch, 'isolation branch mismatch');
const original = fs.readFileSync('server.ts', 'utf8');
const originalSha = crypto.createHash('sha1')
  .update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(original) + '\0'), Buffer.from(original)]))
  .digest('hex');
assert.equal(originalSha, '4c1457f35514b2bb05c7a528073515288a3801f6', 'staging baseline changed; refusing rewrite');
const start = "  app.get('/api/admin/tuss/mappings',";
const next = "  app.get('/api/admin/tuss/prices',";
const a = original.indexOf(start);
const b = original.indexOf(next, a);
assert.ok(a > 0 && b > a && original.indexOf(start, a + 1) < 0, 'unexpected route anchor');
const extracted = original.slice(a, b);
assert.equal(extracted.split('\n').length, 341, 'unexpected TUSS mappings slice');
const routes = [...extracted.matchAll(/app\.(get|post|patch)\('([^']+)'/g)].map((m) => m[1] + ' ' + m[2]);
assert.deepEqual(routes, [
  'get /api/admin/tuss/mappings',
  'post /api/admin/tuss/mappings',
  'patch /api/admin/tuss/mappings/:mappingId',
]);
assert.ok(extracted.includes("if (!persistedData?.id || persistedData.payer_id !== payerId"), 'persistence confirmation must stay');
assert.ok(extracted.includes("if (!data?.id || data.id !== mappingId"), 'update persistence confirmation must stay');
assert.ok(extracted.includes("runTissPipelineForAppointments"), 'TISS pipeline must stay');
assert.ok(extracted.includes("requireClinicModule('insurance_tiss')"), 'module authorization must stay');
assert.ok(extracted.includes("requireClinicCapability('billing.mapping.manage')"), 'role capability must stay');

const dependencyNames = ["checkAuth","requireClinicModule","requireClinicCapability","portalActionLimiter","sanitizeString","currentClinicId","isUuid","payerSafeError","parseBoundedListLimit","supabase","PAYER_TUSS_MAPPING_SELECT","hasMissingFinancialSchema","TUSS_SERVICE_CATALOG_SELECT","TUSS_CODE_SELECT","serializePayerTussMapping","enforcePayloadLimit","normalizeTissCivilDate","guideTypes040300","tussValidityRangeIsValid","fetchPayerForAdmin","fetchTussServiceCatalogById","fetchTussCodeById","fetchPayerTussMappingById","tussConfigurationScopeIsConsistent","cleanObject","crypto","sanitizeTextField","normalizeTussBillingUnit","normalizeTussQuantityRule","mergePayerTussMappingCodeMetadata","isTussUniqueConflict","markTissPreGuidesStale","collectTissPipelineAffectedFutureAppointmentIds","runTissPipelineForAppointments","revalidateAppointmentBillingForAppointment"];
assert.equal(new Set(dependencyNames).size, dependencyNames.length);
for (const name of dependencyNames) assert.ok(new RegExp('\\b' + name + '\\b').test(extracted), 'dependency absent ' + name);

const importStatement = "import { registerTussMappingRoutes } from './services/tussMappingRoutes';\n";
const importAnchor = "import express from 'express';\n";
assert.ok(original.startsWith(importAnchor));
assert.ok(!original.includes('registerTussMappingRoutes'), 'already extracted');
const dependencyObject = dependencyNames.map((name) => '    ' + name + ',').join('\n');
const registration = '  registerTussMappingRoutes(app, {\n' + dependencyObject + '\n  });\n\n';
const replacement = original.replace(extracted, registration);
const updated = replacement.replace(importAnchor, importAnchor + importStatement);
assert.notEqual(updated, original);
assert.equal(updated.replace(importStatement, '').replace(registration, extracted), original, 'exact round-trip failed');
assert.equal(updated.split(next).length, 2, 'adjacent route missing/duplicated');

const typeDecl = 'type TussMappingRouteDeps = {\n' + dependencyNames.map((n) => '  ' + n + ': any;').join('\n') + '\n};\n';
const moduleSource = [
  "import type { Express } from 'express';",
  '',
  typeDecl.trimEnd(),
  '',
  'export function registerTussMappingRoutes(app: Express, deps: TussMappingRouteDeps) {',
  '  const {',
  dependencyNames.map((name) => '    ' + name + ',').join('\n'),
  '  } = deps;',
  '',
  extracted.trimEnd(),
  '}',
  '',
].join('\n').replace(/^[ \t]+$/gm, '');

const ast = ts.createSourceFile('tussMappingRoutes.ts', moduleSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
assert.equal(ast.parseDiagnostics.length, 0, ast.parseDiagnostics.map((d) => d.messageText).join('; '));
const newRoutes = [...moduleSource.matchAll(/app\.(get|post|patch)\('([^']+)'/g)].map((m) => m[1] + ' ' + m[2]);
assert.deepEqual(newRoutes, routes);
assert.ok(!fs.existsSync('services/tussMappingRoutes.ts'), 'module already exists');
fs.writeFileSync('services/tussMappingRoutes.ts', moduleSource);
fs.writeFileSync('server.ts', updated);
fs.mkdirSync('docs/backend-modularization', { recursive: true });
fs.writeFileSync('docs/backend-modularization/20261011-tuss-mappings-route-batch.md', [
  '# TUSS mapping routes — isolated domain extraction',
  '',
  '- Baseline: staging `c19f70319be521e4b580ab9f4773276911d52e6e`, server.ts blob `4c1457f35514b2bb05c7a528073515288a3801f6`.',
  '- Single cohesive slice: GET, POST, PATCH of `/api/admin/tuss/mappings` in original order, ' + extracted.split('\n').length + ' lines moved to `services/tussMappingRoutes.ts`.',
  '- Every handler statement/branch and middleware call moved unchanged; only blank-line whitespace is normalized. All route registrations now occur at the exact prior point via `registerTussMappingRoutes(app, deps)`.',
  '- Explicit injected closure dependencies: ' + dependencyNames.join(', ') + '. No module-global new clients, no new DB queries, no changed RLS, idempotency, persistence checks, Stripe or TISS pipeline.',
  '- Rewriter validates the exact original Git blob SHA, three unique route bindings, protected authorization/persistence/pipeline anchors, TypeScript parse and exact source round-trip. Fails closed if baseline changes.',
  '- Server.ts lines: ' + original.split('\n').length + ' → ' + updated.split('\n').length + ' (' + (original.split('\n').length - updated.split('\n').length) + ' lines removed).',
  '- Run Node 20 focused authorization and API tests, standalone `tsc`, Vite build and full staging CI; do not merge before all required gates succeed.',
  '- The one-use branch-only writer and workflow are removed before PR; no privileged workflow is merged into staging.',
  '- Branch: `refactor/backend-tuss-mappings-route-batch-20261011`; PR, merge, deploy unconfirmed at initial checkpoint. Verify the real current state and append after PR.',
  '',
].join('\n'));
console.log('TUSS_MAPPING_EXTRACTION', {oldLines: original.split('\n').length, newLines: updated.split('\n').length, removed: original.split('\n').length - updated.split('\n').length, routes, sha: originalSha});
