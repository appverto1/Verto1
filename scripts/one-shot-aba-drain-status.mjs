import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
const branch='refactor/backend-aba-drain-status-20261011';
const source=readFileSync('server.ts','utf8');
assert.equal(execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim(),'aa914fac455bbd82fab898843cdee795acccf33a');
const start="  app.get(\n    '/api/aba/v3/admin/drain-status',";
const end="\n\n  app.get(\n    '/api/aba/v3/admin/cohort-catalog',";
const i=source.indexOf(start),j=source.indexOf(end,i);
assert.ok(i>0&&j>i&&source.indexOf(start,i+start.length)===-1);
const original=source.slice(i,j);
const begin=original.indexOf('    async (req: any, res) => {');
const callback=original.slice(begin,original.lastIndexOf('\n  );'));
assert.ok(callback.endsWith('    }')&&callback.includes("get_aba_v3_rollout_drain_status"));
const marker="import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const importLine="import { createAbaV3DrainStatusHandler } from './services/abaV3DrainStatusHandler';\n";
const modifiedRoute=original.replace(callback,'    createAbaV3DrainStatusHandler({ sanitizeString, isUuid, supabase, handleAbaV3RolloutRpcError })');
const modified=source.replace(marker,marker+importLine).replace(original,modifiedRoute);
assert.equal(modified.replace(marker+importLine,marker).replace(modifiedRoute,original),source,'exact source roundtrip');
assert.ok(modifiedRoute.includes('requireAbaV3PreflightFeature,\n    checkAuth,\n    checkPlatformAdmin,'));
assert.equal(modified.split("' /api/aba/v3/admin/drain-status'").length,1);
const helper=[
"type Deps = {",
"  sanitizeString: (value: any, maxLength?: number) => string;",
"  isUuid: (value: any) => boolean;",
"  supabase: any;",
"  handleAbaV3RolloutRpcError: (res: any, error: any) => any;",
"};",
"",
"export function createAbaV3DrainStatusHandler(deps: Deps) {",
"  const { sanitizeString, isUuid, supabase, handleAbaV3RolloutRpcError } = deps;",
"  return "+callback.trimStart()+";",
"}",
""
].join('\n');
writeFileSync('server.ts',modified);
writeFileSync('services/abaV3DrainStatusHandler.ts',helper);
const gate=readFileSync('scripts/pre-main-gate.mjs','utf8');
const insertion="  'tests/productionSessionPersistence.regression.test.mjs',";
assert.ok(gate.includes(insertion)&&!gate.includes('abaV3DrainStatusHandler.test.ts'));
writeFileSync('scripts/pre-main-gate.mjs',gate.replace(insertion,insertion+"\n  'tests/abaV3DrainStatusHandler.test.ts',"));
mkdirSync('docs/backend-modularization',{recursive:true});
const reduction=source.split('\n').length-modified.split('\n').length;
assert.ok(reduction>=15&&reduction<=40);
writeFileSync('docs/backend-modularization/20261011-aba-drain-status.md',[
'# Backend modularization — ABA V3 drain status route',
'',
'- Baseline staging: 5fc564ba5b11bef1f21b56e4f81fd6c43e587f60; server blob aa914fac455bbd82fab898843cdee795acccf33a.',
'- Scope: extract only GET /api/aba/v3/admin/drain-status handler, leaving requireAbaV3PreflightFeature, checkAuth and checkPlatformAdmin at the same route registration and in the same order.',
'- Exact handler body preserved through dependency injection; same scope checks, RPC, cache-control private no-store, HTTP 400/422/500 and return objects. No business logic change.',
'- Verified source roundtrip byte-for-byte, handler uniqueness, API middleware order. Tested directed mock handler + build. CI pre-main runs the new directed test.',
'- Candidate server reduction: '+reduction+' lines, staging only after approved merge. Whole-backend completion unknown.',
'- Files: server.ts, services/abaV3DrainStatusHandler.ts, tests/abaV3DrainStatusHandler.test.ts, scripts/pre-main-gate.mjs, this checkpoint.',
'- One-shot workflow and script are deleted from feature branch prior to commit. No merge/deploy/production and no Factory/Issues.',
'- Other open server PRs #381, #383, #387, #388, #392 target distinct route handlers; integrate against fresh current base and re-run tests to avoid lost changes.',
''].join('\n'));
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit',timeout:300000,env:{...process.env,NODE_ENV:'test'}});assert.equal(r.status,0,cmd+' '+args.join(' ')+' failed '+String(r.error||r.signal||r.status));};
run('node',['--import','tsx','tests/abaV3DrainStatusHandler.test.ts']);
run('npm',['run','build']);
run('git',['diff','--check']);
console.log('ABA_DRAIN_STATUS_EXTRACTION_OK',JSON.stringify({oldLines:source.split('\n').length,newLines:modified.split('\n').length,reduction}));
rmSync('.github/workflows/one-shot-aba-drain-status.yml');rmSync('scripts/one-shot-aba-drain-status.mjs');
run('git',['config','user.name','github-actions[bot]']);run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
run('git',['add','server.ts','services/abaV3DrainStatusHandler.ts','tests/abaV3DrainStatusHandler.test.ts','scripts/pre-main-gate.mjs','docs/backend-modularization/20261011-aba-drain-status.md','.github/workflows/one-shot-aba-drain-status.yml','scripts/one-shot-aba-drain-status.mjs']);
run('git',['commit','-m','refactor(backend): extract protected ABA V3 drain status handler']);
run('git',['push','origin','HEAD:refs/heads/'+branch]);
