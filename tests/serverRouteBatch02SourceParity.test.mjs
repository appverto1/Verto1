import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import ts from 'typescript';
const manifest=JSON.parse(readFileSync('docs/backend-modularization/20261011-server-route-batch02-manifest.json','utf8'));
const original=execFileSync('git',['cat-file','blob',manifest.oldGitBlob],{maxBuffer:10*1024*1024}).toString('utf8');
const originalAST=ts.createSourceFile('server.ts',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const current=readFileSync('server.ts','utf8');
const currentAST=ts.createSourceFile('server.ts',current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const modules=new Map();
for(const item of manifest.routes){
 if(!modules.has(item.module)){
 const text=readFileSync(item.module,'utf8');
 modules.set(item.module,ts.createSourceFile(item.module,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS));
 }
}
const normalize=(v)=>v.replace(/[ \t]+$/gm,'');
const route=(file,item)=>{
 const matches=[];
 function walk(n){
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)
   &&n.expression.expression.getText(file)==='app'
   &&n.expression.name.text===item.method&&ts.isStringLiteral(n.arguments[0])
   &&n.arguments[0].text===item.path)matches.push(n);
  ts.forEachChild(n,walk);
 }
 walk(file);
 assert.equal(matches.length,1,'unique route '+item.path);
 return matches[0];
};
for(const item of manifest.routes){
 const old=route(originalAST,item),current=route(currentAST,item);
 assert.equal(old.arguments.length,current.arguments.length,'middleware count '+item.path);
 for(let i=0;i<old.arguments.length-1;i++)
  assert.equal(old.arguments[i].getText(originalAST),current.arguments[i].getText(currentAST),'exact path/middleware '+item.path);
 const originalArrow=old.arguments[old.arguments.length-1];
 assert.ok(ts.isArrowFunction(originalArrow)&&ts.isBlock(originalArrow.body),'old arrow '+item.path);
 const raw=original.slice(originalArrow.body.getStart(originalAST)+1,originalArrow.body.end-1);
 assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),item.bodySHA256,'source SHA '+item.path);
 const module=modules.get(item.module);
 const func=module.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===item.factory);
 assert.ok(func&&func.body,'module factory '+item.factory);
 const returnStmt=func.body.statements.find(x=>ts.isReturnStatement(x));
 const moved=returnStmt?.expression;
 assert.ok(moved&&ts.isArrowFunction(moved)&&ts.isBlock(moved.body),'moved arrow '+item.factory);
 const dep=moved.body.statements[0];
 assert.ok(ts.isVariableStatement(dep)&&dep.getText(module).includes('getDeps()'),'lazy deps '+item.factory);
 const originalStatements=originalArrow.body.statements.map(x=>normalize(x.getText(originalAST)));
 const movedStatements=moved.body.statements.slice(1).map(x=>normalize(x.getText(module)));
 assert.deepEqual(movedStatements,originalStatements,'statement-by-statement exact parity '+item.path);
}
assert.equal(manifest.totalRoutes,12);
assert.equal(manifest.previousLines - manifest.newLines, manifest.removedLines, 'historical extraction size; later independent server edits may change current lines');
console.log('serverRouteBatch02SourceParity.test: PASS 12 original AST statement sequences and middleware');
