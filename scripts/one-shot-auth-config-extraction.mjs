import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const branch = 'refactor/backend-auth-config-route-20261011';
const base = 'e78a05511dfd03b82d32d92d44f4231004d71a64';
const expectedBlob = 'b5460aa69d3cee3ff6ec96849f61537974007997';
const oldServer = readFileSync('server.ts', 'utf8');
assert.equal(execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim(),expectedBlob);
assert.equal(oldServer.split('\n').length,102066);
const prefix = "  app.get('/api/auth/config', ";
const next = "\n\n  app.post('/api/auth/resend-confirmation'";
const start = oldServer.indexOf(prefix), end = oldServer.indexOf(next,start);
assert.ok(start > 0 && end > start && oldServer.indexOf(prefix,start+prefix.length) === -1);
const oldRoute = oldServer.slice(start,end), callback = oldRoute.slice(prefix.length,-2);
assert.ok(oldRoute.endsWith(');') && callback.startsWith('(_req, res) => {') && callback.endsWith('}'));
const anchor = "import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const importLine = "import { createAuthConfigHandler } from './services/authConfigRouteHandler';\n";
const newRoute = "  app.get('/api/auth/config', createAuthConfigHandler({ getAuthRedirectUrl, getRecoveryRedirectUrl, sanitizeString }));";
assert.ok(oldServer.includes(anchor) && !oldServer.includes('createAuthConfigHandler'));
const newServer = oldServer.replace(anchor,anchor+importLine).replace(oldRoute,newRoute);
assert.equal(newServer.replace(anchor+importLine,anchor).replace(newRoute,oldRoute),oldServer);
assert.equal(newServer.split("app.get('/api/auth/config'").length-1,1);
const moduleText = [
  "import type { RequestHandler } from 'express';",
  '',
  'type Deps = {',
  '  getAuthRedirectUrl: () => string;',
  '  getRecoveryRedirectUrl: () => string;',
  '  sanitizeString: (value: any, maxLength?: number) => string;',
  '};',
  '',
  'export function createAuthConfigHandler(deps: Deps): RequestHandler {',
  '  const { getAuthRedirectUrl, getRecoveryRedirectUrl, sanitizeString } = deps;',
  '  return ' + callback + ';',
  '}',
  ''
].join('\n');
assert.ok(moduleText.includes('return '+callback+';\n}'));
const gate=readFileSync('scripts/pre-main-gate.mjs','utf8');
const gateMarker="  'tests/productionSessionPersistence.regression.test.mjs',";
assert.ok(gate.includes(gateMarker) && !gate.includes('authConfigRouteHandler.test.ts'));
const newGate=gate.replace(gateMarker,gateMarker+"\n  'tests/authConfigRouteHandler.test.ts',");
writeFileSync('server.ts',newServer);
writeFileSync('services/authConfigRouteHandler.ts',moduleText);
writeFileSync('scripts/pre-main-gate.mjs',newGate);

const testSource = "import assert from 'node:assert/strict';\nimport { once } from 'node:events';\nimport { readFileSync } from 'node:fs';\nimport express from 'express';\nimport { createAuthConfigHandler } from '../services/authConfigRouteHandler';\n\nconst serverText = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');\nconst route = \"app.get('/api/auth/config', createAuthConfigHandler({ getAuthRedirectUrl, getRecoveryRedirectUrl, sanitizeString }))\";\nassert.ok(serverText.includes(route));\nassert.equal(serverText.split(\"app.get('/api/auth/config'\").length - 1, 1);\nassert.ok(serverText.indexOf(\"app.post('/api/auth/signup-direct'\") < serverText.indexOf(route));\nassert.ok(serverText.indexOf(route) < serverText.indexOf(\"app.post('/api/auth/resend-confirmation'\"));\n\nconst originalBase = process.env.VERTO_APP_BASE_URL;\nconst originalFallback = process.env.APP_BASE_URL;\nlet authCalls = 0;\nlet recoveryCalls = 0;\nlet reject = false;\nconst app = express();\napp.get('/api/auth/config', createAuthConfigHandler({\n  getAuthRedirectUrl: () => { authCalls++; if (reject) throw new Error('TEST_AUTH_REDIRECT_ERROR'); return 'https://test.invalid/auth'; },\n  getRecoveryRedirectUrl: () => { recoveryCalls++; return 'https://test.invalid/recovery'; },\n  sanitizeString: (value: any, max?: number) => { assert.equal(max, 500); return String(value ?? '').trim().slice(0, max); },\n}));\nconst server = app.listen(0, '127.0.0.1');\nawait once(server, 'listening');\nconst address = server.address();\nassert.ok(address && typeof address !== 'string');\nconst url = 'http://127.0.0.1:' + address.port + '/api/auth/config';\ntry {\n  process.env.VERTO_APP_BASE_URL = 'https://app.example.invalid';\n  process.env.APP_BASE_URL = 'https://fallback.example.invalid';\n  let response = await fetch(url);\n  assert.equal(response.status, 200);\n  assert.deepEqual(await response.json(), { success: true, authRedirectUrl: 'https://test.invalid/auth', recoveryRedirectUrl: 'https://test.invalid/recovery', productionBaseUrl: 'https://app.example.invalid' });\n  assert.equal(authCalls, 1); assert.equal(recoveryCalls, 1);\n  delete process.env.VERTO_APP_BASE_URL;\n  response = await fetch(url);\n  assert.equal(response.status, 200);\n  assert.equal((await response.json()).productionBaseUrl, 'https://fallback.example.invalid');\n  reject = true;\n  response = await fetch(url);\n  assert.equal(response.status, 500);\n  assert.deepEqual(await response.json(), {success:false,error:'TEST_AUTH_REDIRECT_ERROR'});\n  assert.equal(authCalls, 3); assert.equal(recoveryCalls, 2);\n} finally {\n  if (originalBase === undefined) delete process.env.VERTO_APP_BASE_URL;\n  else process.env.VERTO_APP_BASE_URL = originalBase;\n  if (originalFallback === undefined) delete process.env.APP_BASE_URL;\n  else process.env.APP_BASE_URL = originalFallback;\n  server.close(); server.closeAllConnections();\n}\nconsole.log('authConfigRouteHandler.test.ts: PASS');\n";

writeFileSync('tests/authConfigRouteHandler.test.ts',testSource);
const newLines=newServer.split('\n').length;
assert.ok(newLines < 102066 && newLines > 102000);
const checkpoint=[
 '# Backend modularization — public auth configuration route',
 '',
 '- Date: 2026-10-11. Baseline staging '+base+', server blob '+expectedBlob+' (102,066 original lines).',
 '- Scope: GET /api/auth/config only, same registration position (after signup-direct and before resend-confirmation), same handler body, status 200/500, payload keys, error handling, redirect evaluation, environment precedence and sanitization.',
 '- Source parity: original server source reconstructed byte-for-byte by reversing import and handler replacement; single-route registration asserted.',
 '- Files: server.ts, services/authConfigRouteHandler.ts, tests/authConfigRouteHandler.test.ts, scripts/pre-main-gate.mjs, this checkpoint. No runtime dependency changes outside the route.',
 '- Test: new Node 20 TS test calls local mock Express endpoint for HTTP 200/500, failed callback short circuit, URL fallback, response fields and route ordering; automatically executed in pre-main gate.',
 '- Branch: '+branch+'. Implementation final commit and PR numbers are in GitHub branch/PR history. Final CI status is to be logged in the PR after verification.',
 '- Temporary one-shot workflow and script remove themselves before the commit/push. No changes to secrets, production, Stripe, Resend, Supabase, RLS, clinic/patient roles, clinical saves, HTTP middleware or request volume.',
 '- Other pending PRs #381/#383 change distinct sections of server.ts, and #383 changes a different portion of pre-main gate. Any eventual merge requires current-base conflict and regression checks.',
 '- Progress: one selected route out of one extracted (100% slice). Candidate direct reduction: '+String(102066-newLines)+'/102066 lines. Staging stays 0/102066 (0%) until authorized integration. Whole backend denominator unknown.',
 '- No merge/deploy/smoke of a live environment; no Fábrica Verto or Issues dependency.',
 ''
].join('\n');
mkdirSync('docs/backend-modularization', { recursive: true });
writeFileSync('docs/backend-modularization/20261011-auth-config-route.md',checkpoint);
const run=(cmd,args)=>{
  const result=spawnSync(cmd,args,{stdio:'inherit',timeout:300000,env:{...process.env,NODE_ENV:'test'}});
  assert.equal(result.status,0,cmd+' '+args.join(' ')+' failed: '+String(result.error||result.signal||result.status));
};
run('node',['--import','tsx','tests/authConfigRouteHandler.test.ts']);
run('npm',['run','build']);
run('git',['diff','--check']);
console.log('AUTH_CONFIG_ROUTE_PARITY_VERIFIED',JSON.stringify({oldLines:102066,newLines}));
rmSync('.github/workflows/one-shot-auth-config-extraction.yml');
rmSync('scripts/one-shot-auth-config-extraction.mjs');
run('git',['config','user.name','github-actions[bot]']);
run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
run('git',['add','server.ts','services/authConfigRouteHandler.ts','tests/authConfigRouteHandler.test.ts','scripts/pre-main-gate.mjs','docs/backend-modularization/20261011-auth-config-route.md','.github/workflows/one-shot-auth-config-extraction.yml','scripts/one-shot-auth-config-extraction.mjs']);
run('git',['commit','-m','refactor(backend): extract auth config route from server']);
run('git',['push','origin','HEAD:refs/heads/'+branch]);
