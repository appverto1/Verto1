import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const sha='3b221575a18e3b01df24286168743e70bee8e06b',base='66c4188729196ff846ecd33e07b2c9d309c7528d';
const specs=[
['/api/owner/stats','ownerStats','loadOwnerSaasClients buildOwnerFinancialOverviewFromLedger sanitizeString'],
['/api/owner/clients','ownerClients','loadOwnerSaasClients sanitizeString'],
['/api/owner/financial-overview','ownerFinancialOverview','buildOwnerFinancialOverviewFromLedger sanitizeString'],
['/api/owner/financial-feature-surveys','ownerFinancialSurveys','supabase'],
['/api/admin/demo/sandboxes','adminDemoSandboxes','supabase extractMissingColumnName isMissingRelationError sanitizeString logRouteDbError'],
['/api/admin/stats','adminStats','supabase'],
['/api/admin/clients','adminClients','supabase USER_PROFILE_SELECT parseBoundedListLimit'],
['/api/admin/verto-protocols','adminVertoProtocols','supabase CANONICAL_PROTOCOL_SELECT sanitizeString sanitizeClinicalPayload'],
['/api/owner/leads/recovery','ownerRecoveryLeads','supabase sanitizeString sanitizeEmail'],
];
const original=fs.readFileSync('server.ts','utf8');
assert.equal(execFileSync('git',['hash-object','server.ts'],{encoding:'utf8'}).trim(),sha,'base file changed');
const source=ts.createSourceFile('server.ts',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let patches=[],parts=[],manifest=[];
for(const [path,name,rawDeps] of specs) {
 let matches=[];
 function walk(node) {
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
   &&node.expression.expression.getText(source)==='app'
   &&node.expression.name.text==='get'&&ts.isStringLiteral(node.arguments[0])
   &&node.arguments[0].text===path)matches.push(node);
  ts.forEachChild(node,walk);
 }
 walk(source);assert.equal(matches.length,1,'unique GET route '+path);
 const call=matches[0],handler=call.arguments.at(-1);
 assert.ok(ts.isArrowFunction(handler)&&ts.isBlock(handler.body),'inline arrow '+path);
 const old=original.slice(handler.getStart(source),handler.end);
 assert.ok(/^async \((?:_req: any|req|_req: any, res|req: any, res)/.test(old),'original async arrow '+path);
 const deps=rawDeps.split(' ');
 const factory='create'+name[0].toUpperCase()+name.slice(1)+'Handler';
 const inner=original.slice(handler.body.getStart(source)+1,handler.body.end-1);
 const replacement=factory+'(() => ({ '+deps.join(', ')+' }))';
 patches.push({start:handler.getStart(source),end:handler.end,old,replacement});
 parts.push('// GET '+path+'\nexport function '+factory+'(getDeps: () => any) {\n  return async (req: any, res: any) => {\n    const { '+deps.join(', ')+' } = getDeps();'+inner+'\n  };\n}\n');
 manifest.push({method:'get',path,factory,dependencies:deps,sourceLines:original.slice(call.getStart(source),call.end).split('\n').length});
}
let next=original;for(const p of patches.sort((a,b)=>b.start-a.start))next=next.slice(0,p.start)+p.replacement+next.slice(p.end);
const imports="import { "+manifest.map(x=>x.factory).join(', ')+" } from './services/ownerAdminReadHandlers';\n";
assert.ok(!original.includes('ownerAdminReadHandlers'),'not already extracted');
next=imports+next;let reconstructed=next.slice(imports.length);for(const p of patches){
 assert.equal(reconstructed.split(p.replacement).length,2,'unique replacement');reconstructed=reconstructed.replace(p.replacement,p.old);
}
assert.equal(reconstructed,original,'exact reversible extraction');
const expectedLines=next.split('\n').length;
const document={originalGitBlob:sha,baseCommit:base,originalLines:original.split('\n').length,expectedServerLines:expectedLines,module:'services/ownerAdminReadHandlers.ts',routes:manifest};
fs.writeFileSync('server.ts',next);
fs.writeFileSync(document.module,parts.join('\n').replace(/[ \t]+$/gm,'').trimEnd()+'\n');
fs.writeFileSync('docs/backend-modularization/20261012-owner-admin-read-batch.json',JSON.stringify(document,null,2)+'\n');
fs.writeFileSync('docs/backend-modularization/20261012-owner-admin-read-batch.md',[
'# Owner/Admin GET route extraction (2026-10-12)',
'',
'- Original staging '+base+'; server blob '+sha+'.',
'- Nine read-only registrations extracted to services/ownerAdminReadHandlers.ts.',
'- Original app.get registration locations, all guards and middlewares are preserved unchanged.',
'- Byte-exact reconstructed original server.ts before publishing; AST body statement parity is part of the regression runner.',
'- '+document.originalLines+' to '+expectedLines+' entrypoint lines (−'+(document.originalLines-expectedLines)+').',
'- No DB migration, write endpoint, Stripe, authentication or billing change, new query, logging, cron or polling.',
'- Existing checkOwner and checkPlatformAdmin wrappers are untouched, including the exact order.',
'- Only mocked/structural regressions are claimed; live role smoke test pending.',
'',
...manifest.map(x=>'- GET '+x.path+' ('+x.sourceLines+' original lines)')
].join('\n')+'\n');
const runner='scripts/backend-modularization-batch01-regressions.mjs';
const runnerText=fs.readFileSync(runner,'utf8');
const anchor="  'tests/clinicFinancialReadHandlers.test.ts',";
assert.equal(runnerText.split(anchor).length,2,'runner anchor missing');
fs.writeFileSync(runner,runnerText.replace(anchor,anchor+"\n  'tests/ownerAdminReadHandlersSourceParity.test.mjs',\n  'tests/ownerAdminReadHandlers.test.ts',"));
console.log(JSON.stringify({routes:manifest.length,oldLines:document.originalLines,newLines:expectedLines,byteRoundtrip:true}));
