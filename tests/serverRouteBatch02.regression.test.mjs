import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const manifest=JSON.parse(fs.readFileSync('docs/backend-modularization/20261011-server-route-batch02-manifest.json','utf8'));
const source=fs.readFileSync('server.ts','utf8');
const ast=ts.createSourceFile('server.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),matches=new Map();
function walk(n){
 if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(ast)==='app'
 &&ts.isStringLiteral(n.arguments[0])){
  const key=n.expression.name.text+' '+n.arguments[0].text;
  if(manifest.routes.some(r=>r.method+' '+r.path===key)){
   if(matches.has(key))throw Error('DUPLICATE_ROUTE '+key);
   matches.set(key,n);
  }
 }
 ts.forEachChild(n,walk);
}
walk(ast);
assert.equal(manifest.totalRoutes,12);
assert.ok(manifest.removedLines>=850);
assert.equal(matches.size,12);
for(const row of manifest.routes){
 const node=matches.get(row.method+' '+row.path);
 assert.ok(node,row.path);
 assert.equal(node.arguments.length,row.arguments,'arg count '+row.path);
 assert.deepEqual(node.arguments.slice(1,-1).map(x=>x.getText(ast)),row.middleware,'middleware '+row.path);
 assert.ok(node.arguments[node.arguments.length-1].getText(ast).startsWith(row.factory+'('),row.factory);
 const svc=fs.readFileSync(row.module,'utf8');
 assert.ok(svc.includes('export function '+row.factory+'('),'factory not found '+row.factory);
 assert.ok(svc.includes('getDeps()'),'dependency accessor not found');
}
assert.equal(source.split('\n').length,manifest.newLines);
assert.ok(source.includes("app.get('/api/ready'"));
console.log('serverRouteBatch02.regression.test: PASS 12 routes, middleware signatures and extraction placement');
