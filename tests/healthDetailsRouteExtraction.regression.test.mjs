import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const original = execFileSync('git', ['show', 'e78a05511dfd03b82d32d92d44f4231004d71a64:server.ts'], {
  encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
const server = readFileSync('server.ts', 'utf8');
const module = readFileSync('services/healthDetailsRouteHandler.ts', 'utf8');
const origImport = "import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const addedImport = "import { createHealthDetailsHandler } from './services/healthDetailsRouteHandler';\n";
const start = "  app.get('/api/health/details', async (_req, res) => {\n";
const end = "  });\n\n  app.get('/api/internal/schema-status'";
const i = original.indexOf(start);
const j = original.indexOf(end, i);
assert.ok(i >= 0 && j > i, 'original handler unique boundaries');
const originalBlock = original.slice(i, j + 5);
const originalBody = originalBlock.slice(start.length, -'  });'.length).replace(/\n$/, '');
assert.ok(module.includes(originalBody), 'handler body preserved exactly');
const replacement = "  app.get('/api/health/details', createHealthDetailsHandler({\n    isProd, deploymentReleaseId, supabase, getStripe,\n  }));";
assert.ok(server.includes(replacement));
assert.equal((server.match(/app\.get\('\/api\/health\/details'/g) || []).length, 1);
// Guard the moved handler and registration, not the entirety of server.ts: other independent PRs may extract unrelated routes.
assert.ok(server.includes(origImport + addedImport), 'entrypoint retains the imported handler after its original import');
assert.ok(!server.includes(start), 'previous inline handler no longer exists');
assert.ok(server.indexOf("app.get('/api/ready'") < server.indexOf(replacement));
assert.ok(server.indexOf(replacement) < server.indexOf("app.get('/api/internal/schema-status'"));
assert.match(module, /if \(isProd\) \{\s+return res\.status\(404\)\.json\(\{ error: 'Not found' \}\);/);
console.log('healthDetailsRouteExtraction.regression: PASS');
