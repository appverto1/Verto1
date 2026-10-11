import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const expectedBlob = 'b5460aa69d3cee3ff6ec96849f61537974007997';
const sourcePath = 'server.ts';
const servicePath = 'services/healthDetailsRouteHandler.ts';
const sha = execFileSync('git', ['hash-object', sourcePath], { encoding: 'utf8' }).trim();
assert.equal(sha, expectedBlob, 'original server baseline must match exactly');
assert.equal(existsSync(servicePath), false, 'service must not already exist');
const source = readFileSync(sourcePath, 'utf8');
assert.equal(source.split('\n').length, 102066, 'baseline line count');
const routeStart = "  app.get('/api/health/details', async (_req, res) => {";
const nextRoute = "  });\n\n  app.get('/api/internal/schema-status'";
const i = source.indexOf(routeStart);
const j = source.indexOf(nextRoute, i);
assert.ok(i >= 0 && j > i && source.indexOf(routeStart, i + 1) === -1, 'one exact route block');
const block = source.slice(i, j + 5);
const prefix = routeStart + '\n';
assert.ok(block.startsWith(prefix) && block.endsWith('  });'), 'route bracket position');
const body = block.slice(prefix.length, -'  });'.length).replace(/\n$/, '');
const originalImport = "import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const addedImport = "import { createHealthDetailsHandler } from './services/healthDetailsRouteHandler';\n";
assert.ok(source.includes(originalImport) && !source.includes(addedImport));
const replacement = "  app.get('/api/health/details', createHealthDetailsHandler({\n    isProd, deploymentReleaseId, supabase, getStripe,\n  }));";
const edited = source.replace(originalImport, originalImport + addedImport).replace(block, replacement);
assert.equal(edited.replace(originalImport + addedImport, originalImport).replace(replacement, block), source, 'reversible patch byte parity');
assert.equal(source.split('\n').length - edited.split('\n').length, 31, 'expected line shrink');
const module = `// Only the original non-production diagnostics handler was moved here.
export function createHealthDetailsHandler(deps: {
  isProd: boolean;
  deploymentReleaseId: () => string | undefined;
  supabase: any;
  getStripe: () => unknown;
}) {
  return async (_req: any, res: any) => {
    const { isProd, deploymentReleaseId, supabase, getStripe } = deps;
${body}
  };
}
`;
assert.ok(module.includes(body), 'unchanged handler body');
assert.ok(edited.indexOf("app.get('/api/ready'") < edited.indexOf("app.get('/api/health/details'"));
assert.ok(edited.indexOf("app.get('/api/health/details'") < edited.indexOf("app.get('/api/internal/schema-status'"));
writeFileSync(sourcePath, edited, 'utf8');
writeFileSync(servicePath, module, 'utf8');
console.log('HEALTH_DETAILS_EXTRACTED', JSON.stringify({ originalLines: 102066, newLines: 102035, serviceLines: module.split('\n').length, routeBodyBytes: Buffer.byteLength(body) }));
