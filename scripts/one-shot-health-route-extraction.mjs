import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
const source=readFileSync('server.ts','utf8');
assert.equal(execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim(),'aa914fac455bbd82fab898843cdee795acccf33a');
const start="  app.get('/api/health', ", next="\n\n  app.get('/api/ready'";
const i=source.indexOf(start),j=source.indexOf(next,i);
assert.ok(i>0&&j>i&&source.indexOf(start,i+start.length)===-1);
const oldRoute=source.slice(i,j), callback=oldRoute.slice(start.length,-2);
assert.ok(oldRoute.endsWith(');')&&callback.startsWith('async (_req, res) => {')&&callback.endsWith('}'));
const importAnchor="import { registerHelpCenterRoutes } from './services/helpCenterRoutes';\n";
const importLine="import { createHealthRouteHandler } from './services/healthRouteHandler';\n";
assert.ok(source.includes(importAnchor)&&!source.includes('createHealthRouteHandler'));
const newRoute="  app.get('/api/health', createHealthRouteHandler({ deploymentReleaseId, cleanObject }));";
const changed=source.replace(importAnchor,importAnchor+importLine).replace(oldRoute,newRoute);
assert.equal(changed.replace(importAnchor+importLine,importAnchor).replace(newRoute,oldRoute),source);
assert.equal(changed.split("app.get('/api/health'").length-1,1);
writeFileSync('server.ts',changed);
writeFileSync('services/healthRouteHandler.ts',[
 "import type { RequestHandler } from 'express';",
 '',
 'type HealthRouteDeps = {',
 '  deploymentReleaseId: () => string;',
 '  cleanObject: (value: any) => any;',
 '};',
 '',
 'export function createHealthRouteHandler(deps: HealthRouteDeps): RequestHandler {',
 '  const { deploymentReleaseId, cleanObject } = deps;',
 '  return '+callback+';',
 '}',''
].join('\n'));
const gate=readFileSync('scripts/pre-main-gate.mjs','utf8');
const marker="  'tests/productionSessionPersistence.regression.test.mjs',";
assert.ok(gate.includes(marker)&&!gate.includes('healthRouteHandler.test.ts'));
writeFileSync('scripts/pre-main-gate.mjs',gate.replace(marker,marker+"\n  'tests/healthRouteHandler.test.ts',"));

const testContent = "import assert from 'node:assert/strict';\nimport {once} from 'node:events';\nimport {readFileSync} from 'node:fs';\nimport express from 'express';\nimport {createHealthRouteHandler} from '../services/healthRouteHandler';\nconst source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');\nassert.equal(source.split(\"app.get('/api/health'\").length-1,1);\nassert.ok(source.includes(\"app.get('/api/health', createHealthRouteHandler({ deploymentReleaseId, cleanObject }))\"));\nassert.ok(source.indexOf(\"app.get('/api/config'\")<source.indexOf(\"app.get('/api/health'\"));\nassert.ok(source.indexOf(\"app.get('/api/health'\")<source.indexOf(\"app.get('/api/ready'\"));\nlet calls=0;\nconst app=express();\napp.get('/api/health',createHealthRouteHandler({\n deploymentReleaseId:()=>{calls++;return 'release-test';},\n cleanObject:(value:any)=>{assert.deepEqual(value,{status:'ok',release:'release-test'});return {...value,cleaned:true};}\n}));\nconst server=app.listen(0,'127.0.0.1');\nawait once(server,'listening');\nconst address=server.address();\nassert.ok(address&&typeof address!=='string');\ntry {\n for(let i=1;i<=2;i++){\n const response=await fetch('http://127.0.0.1:'+address.port+'/api/health');\n assert.equal(response.status,200);\n assert.deepEqual(await response.json(),{status:'ok',release:'release-test',cleaned:true});\n assert.equal(calls,i,'release must resolve once per request');\n }\n} finally {server.close();server.closeAllConnections();}\nconsole.log('healthRouteHandler.test.ts: PASS');\n";

writeFileSync('tests/healthRouteHandler.test.ts',testContent);
mkdirSync('docs/backend-modularization',{recursive:true});
const before=source.split('\n').length,after=changed.split('\n').length;
assert.ok(before===101730&&after<before);
writeFileSync('docs/backend-modularization/20261011-health-route.md',[
 '# Backend modularization — GET /api/health',
 '',
 '- Date: 2026-10-11; base staging 5fc564ba5b11bef1f21b56e4f81fd6c43e587f60, server original blob aa914fac455bbd82fab898843cdee795acccf33a.',
 '- Extract exactly one public health handler into services/healthRouteHandler.ts. Preserve original callback source byte-for-byte, middleware order, release ID evaluation at request time, cleanObject and payload, and placement between /api/config and /api/ready.',
 '- Checked full server roundtrip and unique route registration. Add HTTP regression tests to existing pre-main runner for 200 payload, cleanObject, and once-per-request release lookup.',
 '- One-shot GitHub Action validates old SHA, performs source roundtrip, tests and build, removes its own workflow/script and commits only five expected source files.',
 '- Distinct from proposed PRs #381, #383, #387, #388, but each edits server.ts; merge requires updated comparison. No factory/Issues, schema, permissions, financial, Stripe, Supabase/Railway traffic or production changes.',
 '- Branch refactor/backend-health-route-20261011. Pull request and final validation results recorded in PR description after GitHub confirmation.',
 '- Server lines: '+before+' to '+after+' (candidate only). Staging remains unchanged until explicit merge; no reliable overall backend percent.',
 ''
].join('\n'));
const run=(cmd,args)=>{
 const r=spawnSync(cmd,args,{stdio:'inherit',timeout:300000,env:{...process.env,NODE_ENV:'test'}});
 assert.equal(r.status,0,cmd+' '+args.join(' ')+' failed: '+String(r.error||r.signal||r.status));
};
run('node',['--import','tsx','tests/healthRouteHandler.test.ts']);
run('npm',['run','build']);
run('git',['diff','--check']);
console.log('HEALTH_ROUTE_EXTRACTION_VERIFIED',JSON.stringify({before,after,removed:before-after}));
rmSync('.github/workflows/one-shot-health-route-extraction.yml');
rmSync('scripts/one-shot-health-route-extraction.mjs');
run('git',['config','user.name','github-actions[bot]']);
run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
run('git',['add','server.ts','services/healthRouteHandler.ts','tests/healthRouteHandler.test.ts','scripts/pre-main-gate.mjs','docs/backend-modularization/20261011-health-route.md','.github/workflows/one-shot-health-route-extraction.yml','scripts/one-shot-health-route-extraction.mjs']);
run('git',['commit','-m','refactor(backend): extract public health GET handler']);
run('git',['push','origin','HEAD:refs/heads/refactor/backend-health-route-20261011']);
