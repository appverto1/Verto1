import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const m=JSON.parse(fs.readFileSync('docs/backend-modularization/20261012-owner-admin-read-batch.json','utf8'));
const original=execFileSync('git',['cat-file','blob',m.originalGitBlob],{maxBuffer:12*1024*1024,encoding:'utf8'});
const current=fs.readFileSync('server.ts','utf8');
const mod=fs.readFileSync(m.module,'utf8');
const old=ts.createSourceFile('old.ts',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),now=ts.createSourceFile('server.ts',current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),file=ts.createSourceFile(m.module,mod,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const clean=s=>s.replace(/[ \t]+$/gm,'');
function route(source,item) {
 const hits=[];
 function visit(node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(source)==='app'&&node.expression.name.text===item.method&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===item.path)hits.push(node);ts.forEachChild(node,visit)}
 visit(source);assert.equal(hits.length,1,'unique route '+item.path);return hits[0];
}
for(const item of m.routes){
 const before=route(old,item),after=route(now,item);
 assert.equal(before.arguments.length,after.arguments.length,'preserve guard count '+item.path);
 for(let j=0;j<before.arguments.length-1;j++)assert.equal(before.arguments[j].getText(old),after.arguments[j].getText(now),'identical route middleware '+item.path);
 const originalHandler=before.arguments.at(-1),newHandler=after.arguments.at(-1);
 assert.ok(ts.isArrowFunction(originalHandler)&&ts.isBlock(originalHandler.body));
 assert.ok(ts.isCallExpression(newHandler)&&ts.isIdentifier(newHandler.expression)&&newHandler.expression.text===item.factory);
 const getter=newHandler.arguments[0],props=ts.isParenthesizedExpression(getter.body)?getter.body.expression:getter.body;
 assert.ok(ts.isArrowFunction(getter)&&ts.isObjectLiteralExpression(props));
 assert.deepEqual(props.properties.map(x=>x.name.getText(now)),item.dependencies,'original dependency names '+item.path);
 const fn=file.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===item.factory);
 assert.ok(fn,'factory '+item.path);
 const returned=fn.body.statements.find(ts.isReturnStatement)?.expression;
 assert.ok(ts.isArrowFunction(returned)&&ts.isBlock(returned.body));
 assert.ok(returned.body.statements[0].getText(file).includes('getDeps()'));
 assert.deepEqual(returned.body.statements.slice(1).map(x=>clean(x.getText(file))),originalHandler.body.statements.map(x=>clean(x.getText(old))),'original exact statements '+item.path);
}
assert.equal(m.routes.length,9);
assert.equal(m.originalLines - m.expectedServerLines, 281, 'historical owner/admin extraction delta must remain documented');
console.log('PASS: nine owner/admin read handlers AST and middleware parity');
