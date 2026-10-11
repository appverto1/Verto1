import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const branch = 'refactor/backend-internal-schema-status-route-20261011';
const base = 'e78a05511dfd03b82d32d92d44f4231004d71a64';
const expectedBlob = 'b5460aa69d3cee3ff6ec96849f61537974007997';
const source = readFileSync('server.ts', 'utf8');
assert.equal(execFileSync('git', ['hash-object', 'server.ts'], {encoding:'utf8'}).trim(), expectedBlob);
assert.equal(source.split('\n').length, 102066);
const prefix = "  app.get('/api/internal/schema-status', checkAuth, checkPlatformAdmin, ";
const suffix = "\n\n  // --- API ROUTES ---";
const start = source.indexOf(prefix), end = source.indexOf(suffix, start);
assert.ok(start > 0 && end > start && source.indexOf(prefix, start + prefix.length) === -1, 'unique protected route');
const oldRoute = source.slice(start, end), callback = oldRoute.slice(prefix.length, -2);
assert.ok(oldRoute.endsWith(');') && callback.startsWith('async (req: any, res) => {') && callback.endsWith('}'));
assert.ok(callback.includes('refreshAppointmentActionResolutionSchema(Boolean(req.query?.refresh))'));
const anchor = "import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const importLine = "import { createInternalSchemaStatusHandler } from './services/internalSchemaStatusRouteHandler';\n";
const replacement = "  app.get('/api/internal/schema-status', checkAuth, checkPlatformAdmin, createInternalSchemaStatusHandler({ refreshAppointmentActionResolutionSchema, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION }));";
assert.ok(source.includes(anchor) && !source.includes('createInternalSchemaStatusHandler'));
const modified = source.replace(anchor, anchor + importLine).replace(oldRoute, replacement);
assert.equal(modified.replace(anchor + importLine, anchor).replace(replacement, oldRoute), source, 'byte-for-byte server source roundtrip');
assert.equal(modified.split("app.get('/api/internal/schema-status'").length - 1, 1);
assert.ok(modified.indexOf("app.get('/api/health/details'") < modified.indexOf(replacement));
assert.ok(modified.indexOf(replacement) < modified.indexOf("app.post('/api/auth/2fa/setup'"));
const helper = [
  "import type { RequestHandler } from 'express';",
  '',
  'type InternalSchemaStatusDeps = {',
  '  refreshAppointmentActionResolutionSchema: (refresh: boolean) => Promise<any>;',
  '  APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION: string | number;',
  '};',
  '',
  'export function createInternalSchemaStatusHandler(deps: InternalSchemaStatusDeps): RequestHandler {',
  '  const { refreshAppointmentActionResolutionSchema, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION } = deps;',
  '  return ' + callback + ';',
  '}',
  ''
].join('\n');
assert.ok(helper.includes('return ' + callback + ';\n}'));
const gate=readFileSync('scripts/pre-main-gate.mjs','utf8');
const gateMarker="  'tests/productionSessionPersistence.regression.test.mjs',";
assert.ok(gate.includes(gateMarker)&&!gate.includes('internalSchemaStatusRouteHandler.test.ts'));
const updatedGate=gate.replace(gateMarker,gateMarker+"\n  'tests/internalSchemaStatusRouteHandler.test.ts',");
writeFileSync('server.ts', modified);
writeFileSync('services/internalSchemaStatusRouteHandler.ts', helper);
writeFileSync('scripts/pre-main-gate.mjs', updatedGate);

const testSource = "import assert from 'node:assert/strict';\nimport { once } from 'node:events';\nimport { readFileSync } from 'node:fs';\nimport express from 'express';\nimport { createInternalSchemaStatusHandler } from '../services/internalSchemaStatusRouteHandler';\n\nconst serverText = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');\nconst registration = \"app.get('/api/internal/schema-status', checkAuth, checkPlatformAdmin, createInternalSchemaStatusHandler({ refreshAppointmentActionResolutionSchema, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION }))\";\nassert.ok(serverText.includes(registration), 'protected registration must retain its middleware order');\nassert.equal(serverText.split(\"app.get('/api/internal/schema-status'\").length - 1, 1);\nassert.ok(serverText.indexOf(\"app.get('/api/health/details'\") < serverText.indexOf(registration));\nassert.ok(serverText.indexOf(registration) < serverText.indexOf(\"app.post('/api/auth/2fa/setup'\"));\n\nlet probeCalls = 0;\nconst forceValues: boolean[] = [];\nlet checkedAt: number | null = Date.parse('2026-10-11T17:00:00.000Z');\nconst app = express();\napp.get('/api/internal/schema-status',\n  (req, res, next) => {\n    if (req.headers['x-test-auth'] !== 'yes') { res.status(401).json({ error: 'SESSION_REQUIRED' }); return; }\n    next();\n  },\n  (req, res, next) => {\n    if (req.headers['x-test-platform-admin'] !== 'yes') { res.status(403).json({ error: 'PLATFORM_ADMIN_REQUIRED' }); return; }\n    next();\n  },\n  createInternalSchemaStatusHandler({\n    refreshAppointmentActionResolutionSchema: async (force: boolean) => {\n      probeCalls += 1;\n      forceValues.push(force);\n      return {\n        approvalReady: true,\n        availabilityReady: false,\n        schemaVersion: 'runtime.v2',\n        reason: 'MIGRATION_PENDING',\n        approvalReason: 'MISSING_FUNCTION',\n        stage: 'schema-check',\n        retryable: false,\n        checkedAt,\n        ttlMs: 60_000,\n      };\n    },\n    APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION: 'expected.v3',\n  }),\n);\nconst server = app.listen(0, '127.0.0.1');\nawait once(server, 'listening');\nconst address = server.address();\nassert.ok(address && typeof address !== 'string');\nconst url = 'http://127.0.0.1:' + address.port + '/api/internal/schema-status';\ntry {\n  let response = await fetch(url);\n  assert.equal(response.status, 401);\n  assert.deepEqual(await response.json(), { error: 'SESSION_REQUIRED' });\n  response = await fetch(url, { headers: { 'x-test-auth': 'yes' } });\n  assert.equal(response.status, 403);\n  assert.deepEqual(await response.json(), { error: 'PLATFORM_ADMIN_REQUIRED' });\n  assert.equal(probeCalls, 0, 'no schema diagnostics for unauthorized users');\n  const authorizedHeaders = { 'x-test-auth': 'yes', 'x-test-platform-admin': 'yes' };\n  response = await fetch(url, { headers: authorizedHeaders });\n  assert.equal(response.status, 200);\n  assert.deepEqual(await response.json(), {\n    success: true,\n    data: {\n      reschedule: {\n        ready: true,\n        availabilityReady: false,\n        approvalReady: true,\n        expectedVersion: 'expected.v3',\n        actualVersion: 'runtime.v2',\n        reason: 'MIGRATION_PENDING',\n        approvalReason: 'MISSING_FUNCTION',\n        stage: 'schema-check',\n        retryable: false,\n        checkedAt: '2026-10-11T17:00:00.000Z',\n        nextCheckAt: '2026-10-11T17:01:00.000Z',\n      },\n    },\n  });\n  response = await fetch(url + '?refresh=false', { headers: authorizedHeaders });\n  assert.equal(response.status, 200);\n  assert.equal((await response.json()).success, true);\n  assert.deepEqual(forceValues, [false, true], 'Boolean(req.query?.refresh) semantics must remain unchanged');\n  checkedAt = null;\n  response = await fetch(url + '?refresh=1', { headers: authorizedHeaders });\n  const body = await response.json();\n  assert.equal(body.data.reschedule.checkedAt, null);\n  assert.equal(body.data.reschedule.nextCheckAt, null);\n  assert.equal(probeCalls, 3);\n} finally {\n  server.close();\n  server.closeAllConnections();\n}\nconsole.log('internalSchemaStatusRouteHandler.test.ts: PASS');\n";

writeFileSync('tests/internalSchemaStatusRouteHandler.test.ts', testSource);
const oldLines = source.split('\n').length, newLines = modified.split('\n').length;
assert.ok(newLines < oldLines && newLines > 102000);
mkdirSync('docs/backend-modularization', { recursive: true });
const checkpoint = [
  '# Backend modularization — internal schema status route',
  '',
  '- Date: 2026-10-11. Baseline staging '+base+', original server.ts Git blob '+expectedBlob+' ('+oldLines+' lines).',
  '- Scope: extract exactly one GET /api/internal/schema-status handler into services/internalSchemaStatusRouteHandler.ts; keep the original callback source byte-for-byte, checkAuth + checkPlatformAdmin middleware positions, request-time Boolean(refresh), reschedule shape, timestamp/TTL computation, and version.',
  '- Files: server.ts, services/internalSchemaStatusRouteHandler.ts, tests/internalSchemaStatusRouteHandler.test.ts, scripts/pre-main-gate.mjs, this checkpoint.',
  '- Evidence: full-server reverse transformation restores the baseline byte-for-byte; registered route unique and located between health details and MFA setup; direct HTTP regression covers 401 unauthenticated, 403 without platform-admin, zero unauthorized schema queries, 200 body, refresh truthiness, TTL/null times.',
  '- A temporary one-shot GitHub workflow/patch script validates the original Git SHA, runs test and production build, cleans up itself and pushes only the result. It is NOT retained in the PR. GitHub staging CI checks the final branch HEAD and the new test is part of the existing pre-main ratchet.',
  '- Implementation HEAD commit and PR URL are stored in GitHub; final CI evidence is appended to PR metadata. No merge, smoke or deploy.',
  '- Collision scan: PR #381 changes distinct clinic routes in server.ts; #383 handles /api/health/details; #387 handles /api/auth/config. The extraction is between the health and auth routes and does not modify their handlers. Revalidation is mandatory before concurrent merges.',
  '- No behavior, security, permission, session, SQL, Supabase, Stripe/webhook, Resend, billing, clinical saves, environment or production configuration changes.',
  '- Progress: this 1/1 selected route is implemented (100%). Proposed server.ts line delta: '+String(oldLines-newLines)+'/'+oldLines+'. Staging is still 0/'+oldLines+' (0%) until authorized merge. Global backend completion not auditable without bounded scope.',
  '- Independent and idempotent; no Fábrica Verto, Issues or factory checkpoints involved.',
  ''
].join('\n');
writeFileSync('docs/backend-modularization/20261011-internal-schema-status-route.md', checkpoint);
const run = (cmd,args) => {
  const result = spawnSync(cmd,args,{stdio:'inherit',timeout:300000,env:{...process.env,NODE_ENV:'test'}});
  assert.equal(result.status,0,cmd+' '+args.join(' ')+' failed: '+String(result.error||result.signal||result.status));
};
run('node',['--import','tsx','tests/internalSchemaStatusRouteHandler.test.ts']);
run('npm',['run','build']);
run('git',['diff','--check']);
console.log('INTERNAL_SCHEMA_STATUS_ROUTE_PARITY_VERIFIED',JSON.stringify({oldLines,newLines,reduction:oldLines-newLines}));
rmSync('.github/workflows/one-shot-internal-schema-status.yml');
rmSync('scripts/one-shot-internal-schema-status.mjs');
run('git',['config','user.name','github-actions[bot]']);
run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
run('git',['add','server.ts','services/internalSchemaStatusRouteHandler.ts','tests/internalSchemaStatusRouteHandler.test.ts','scripts/pre-main-gate.mjs','docs/backend-modularization/20261011-internal-schema-status-route.md','.github/workflows/one-shot-internal-schema-status.yml','scripts/one-shot-internal-schema-status.mjs']);
run('git',['commit','-m','refactor(backend): extract protected schema status route']);
run('git',['push','origin','HEAD:refs/heads/'+branch]);
