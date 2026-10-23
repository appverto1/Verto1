import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const repoBranch = 'refactor/staging-schema-status-current-20261023';
const baseline = 'a850b45a54dc64ccbe3962976d10ba87c2c376e0';
const originalServerBlob = '89d3a895797eb61503c777c0ea68f9a1c61f93a0';
const vettedPrHead = '5dc6499c5490cf50e0131b2e709b1a5a8c532ab7';
const workFile = '.github/workflows/one-shot-reapply-schema-status.yml';
const workScript = 'scripts/one-shot-reapply-schema-status.mjs';
const cmd = (name,args) => execFileSync(name,args,{encoding:'utf8',stdio:['ignore','pipe','inherit'],timeout:120000}).trim();
const run = (name,args,timeout=300000) => {
  const result = spawnSync(name,args,{stdio:'inherit',timeout});
  assert.equal(result.status,0,name+' '+args.join(' ')+' failed: '+String(result.error||result.signal||result.status));
};
assert.equal(cmd('git',['hash-object','server.ts']),originalServerBlob,'server.ts source must equal staging baseline');
assert.equal(cmd('git',['merge-base',baseline,'HEAD']),baseline,'branch must descend from exact staging baseline');

run('git',['fetch','--no-tags','--depth=1','origin','refs/heads/refactor/backend-internal-schema-status-route-20261011']);
assert.equal(cmd('git',['rev-parse','FETCH_HEAD']),vettedPrHead,'legacy branch changed');
const oldFile = path => execFileSync('git',['show',vettedPrHead+':'+path],{encoding:'utf8'});

const before=readFileSync('server.ts','utf8');
const routePrefix="  app.get('/api/internal/schema-status', checkAuth, checkPlatformAdmin, async (req: any, res) => {\n";
const marker="\n\n  // --- API ROUTES ---";
const start=before.indexOf(routePrefix);
const end=before.indexOf(marker,start);
assert.ok(start>=0&&end>start&&before.indexOf(routePrefix,start+1)===-1,'unique protected route');
const originalRoute=before.slice(start,end);
assert.ok(originalRoute.endsWith("\n  });"),'original route shape');
const originalBody=originalRoute.slice(routePrefix.length,-"\n  });".length);
const handler=oldFile('services/internalSchemaStatusRouteHandler.ts');
const extractedBody=handler.match(/  return async \(req: any, res\) => \{\n([\s\S]*?)\n  \};/)?.[1];
assert.equal(originalBody,extractedBody,'exact route callback parity');
const from="import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const imported="import { createInternalSchemaStatusHandler } from './services/internalSchemaStatusRouteHandler';\n";
assert.equal(before.split(from).length-1,1,'unique import insertion point');
assert.ok(!before.includes(imported),'not previously extracted');
const newRoute="  app.get('/api/internal/schema-status', checkAuth, checkPlatformAdmin, createInternalSchemaStatusHandler({ refreshAppointmentActionResolutionSchema, APPOINTMENT_ACTION_RESOLUTION_SCHEMA_VERSION }));";
const after=(before.slice(0,start)+newRoute+before.slice(end)).replace(from,from+imported);
assert.equal(after.replace(imported,'').replace(newRoute,originalRoute),before,'server byte-for-byte inverse');
assert.equal(after.split("app.get('/api/internal/schema-status'").length-1,1,'single registered route');
assert.ok(after.indexOf("app.get('/api/health/details'")<after.indexOf(newRoute));
assert.ok(after.indexOf(newRoute)<after.indexOf("app.post('/api/auth/2fa/setup'"));

const gate=readFileSync('scripts/pre-main-gate.mjs','utf8');
const gateAnchor="  'tests/healthRouteHandler.test.ts',\n";
assert.equal(gate.split(gateAnchor).length-1,1,'unique ratchet insertion point');
assert.ok(!gate.includes('internalSchemaStatusRouteHandler.test.ts'),'test not already registered');
const updatedGate=gate.replace(gateAnchor,gateAnchor+"  'tests/internalSchemaStatusRouteHandler.test.ts',\n");
const oldTest=oldFile('tests/internalSchemaStatusRouteHandler.test.ts');
assert.ok(oldTest.includes('no schema diagnostics for unauthorized users'));
writeFileSync('server.ts',after);
writeFileSync('services/internalSchemaStatusRouteHandler.ts',handler);
writeFileSync('tests/internalSchemaStatusRouteHandler.test.ts',oldTest);
writeFileSync('scripts/pre-main-gate.mjs',updatedGate);
mkdirSync('docs/backend-modularization',{recursive:true});
writeFileSync('docs/backend-modularization/20261023-internal-schema-status-route.md',[
  '# Backend modularization — protected internal schema-status',
  '',
  '- Date: 2026-10-23; base staging '+baseline+'; source server blob '+originalServerBlob+'.',
  '- Supersedes [PR #388](https://github.com/appverto1/Verto1/pull/388), whose old branch diverged by 404 commits.',
  '- Only GET /api/internal/schema-status is extracted. The handler body matches the old route byte-for-byte.',
  '- Route remains in the same location with checkAuth then checkPlatformAdmin, including session, platform admin identity and MFA checks.',
  '- Response contract, Boolean(req.query?.refresh), checkedAt, TTL and nextCheckAt remain identical.',
  '- Exact server reverse-transformation parity verified, 19 net lines removed. One request remains one authorized schema status lookup.',
  '- HTTP regression inherited from #388 tests 401, 403, zero probes for denied requests, full success contract, refresh behavior and null timestamps.',
  '- New test added to pre-main ratchet. No SQL, RLS, Supabase migrations, Stripe, billing, clinical saves, notifications or Production changes.',
  '- GitHub CI, Railway deployment and human smoke are separate validation gates, never inferred as passed.',
  ''
].join('\n'));

run('node',['--import','tsx','tests/internalSchemaStatusRouteHandler.test.ts']);
run('npm',['run','build'],300000);
run('git',['diff','--check']);
assert.equal(before.split('\n').length-after.split('\n').length,19,'server line reduction');
rmSync(workFile);
rmSync(workScript);
run('git',['add','-A']);
const expected=[
  workFile,'docs/backend-modularization/20261023-internal-schema-status-route.md',
  'scripts/pre-main-gate.mjs',workScript,'server.ts',
  'services/internalSchemaStatusRouteHandler.ts','tests/internalSchemaStatusRouteHandler.test.ts'
].sort();
assert.deepEqual(cmd('git',['diff','--cached','--name-only']).split('\n').sort(),expected,'no unrelated files changed');
run('git',['config','user.name','github-actions[bot]']);
run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
run('git',['commit','-m','refactor(staging): extract protected schema-status route on current base']);
run('git',['push','origin','HEAD:refs/heads/'+repoBranch],120000);
console.log('SCHEMA_STATUS_EXTRACTED: PASS, 19 server lines removed; baseline unchanged outside scoped route and import');
