import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const manifest=JSON.parse(readFileSync('docs/backend-modularization/20261012-tiss-payer-read-batch-manifest.json','utf8'));
const original=execFileSync('git',['cat-file','blob',manifest.originalGitBlob],{maxBuffer:14*1024*1024}).toString('utf8');
const current=readFileSync('server.ts','utf8');
const moduleText=readFileSync(manifest.module,'utf8');
const oldFile=ts.createSourceFile('old.ts',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const nowFile=ts.createSourceFile('server.ts',current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const service=ts.createSourceFile(manifest.module,moduleText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const normalize=s=>s.replace(/[ \t]+$/gm,'');
function route(file,item){
 const matches=[];
 const visit=n=>{
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)
    &&n.expression.expression.getText(file)==='app'&&n.expression.name.text===item.method
    &&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===item.path)matches.push(n);
  ts.forEachChild(n,visit);
 };
 visit(file);
 assert.equal(matches.length,1,'unique route '+item.path);
 return matches[0];
}
for(const item of manifest.routes) {
 const previous=route(oldFile,item),newCall=route(nowFile,item);
 assert.equal(previous.arguments.length,newCall.arguments.length,'middleware count '+item.path);
 for(let i=0;i<previous.arguments.length-1;i++)
  assert.equal(previous.arguments[i].getText(oldFile),newCall.arguments[i].getText(nowFile),'exact path + original guards '+item.path);
 const oldHandler=previous.arguments.at(-1),newHandler=newCall.arguments.at(-1);
 assert.ok(ts.isArrowFunction(oldHandler)&&ts.isBlock(oldHandler.body),'original callback '+item.path);
 assert.ok(ts.isCallExpression(newHandler)&&ts.isIdentifier(newHandler.expression)&&newHandler.expression.text===item.factory,'factory only replacement '+item.path);
 const getter=newHandler.arguments[0];
 assert.ok(ts.isArrowFunction(getter),'lazy dependency callback '+item.path);
 const obj=ts.isParenthesizedExpression(getter.body)?getter.body.expression:getter.body;
 assert.ok(ts.isObjectLiteralExpression(obj),'dependency object '+item.path);
 assert.deepEqual(obj.properties.map(x=>x.name.getText(nowFile)),item.dependencies,'exact frozen dependencies '+item.path);
 const fn=service.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===item.factory);
 assert.ok(fn?.body,'handler factory present '+item.path);
 const ret=fn.body.statements.find(ts.isReturnStatement);
 assert.ok(ret&&ts.isArrowFunction(ret.expression)&&ts.isBlock(ret.expression.body),'return original callback '+item.path);
 const moved=ret.expression.body.statements;
 assert.ok(ts.isVariableStatement(moved[0])&&moved[0].getText(service).includes('getDeps()'),'per-request resolution '+item.path);
 assert.deepEqual(moved.slice(1).map(x=>normalize(x.getText(service))),
                  oldHandler.body.statements.map(x=>normalize(x.getText(oldFile))),
                  'source AST statements unchanged '+item.path);
}
assert.equal(manifest.routes.length,20,'20-source contract');
assert.equal(original.split('\n').length,manifest.originalLines);
assert.equal(current.split('\n').length,manifest.expectedServerLines);
for(const r of manifest.routes)assert.ok(!r.path.includes('download'),'no download/file side-effect route moved');
console.log('PASS: 20 original TISS/payer GET handler AST bodies and exact route middleware parity.');
