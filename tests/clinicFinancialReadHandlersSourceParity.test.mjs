import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const manifest = JSON.parse(readFileSync('docs/backend-modularization/20261012-clinic-financial-read-batch-manifest.json','utf8'));
const original = execFileSync('git',['cat-file','blob',manifest.originalGitBlob],{maxBuffer:12*1024*1024}).toString('utf8');
const current = readFileSync('server.ts','utf8');
const moved = readFileSync(manifest.module,'utf8');
const oldFile = ts.createSourceFile('old.ts',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const nowFile = ts.createSourceFile('server.ts',current,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const moduleFile = ts.createSourceFile(manifest.module,moved,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const normalize = (s) => s.replace(/[ \t]+$/gm,'');
function find(file,item) {
  const matches=[];
  function visit(node) {
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)
       &&node.expression.expression.getText(file)==='app'
       &&node.expression.name.text===item.method
       &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===item.path)matches.push(node);
    ts.forEachChild(node,visit);
  }
  visit(file);
  assert.equal(matches.length,1,'unique registered GET '+item.path);
  return matches[0];
}
for(const item of manifest.routes) {
  const old=find(oldFile,item),now=find(nowFile,item);
  assert.equal(now.arguments.length,old.arguments.length,'same middleware count '+item.path);
  for(let i=0;i<old.arguments.length-1;i++) {
    assert.equal(now.arguments[i].getText(nowFile),old.arguments[i].getText(oldFile),'original middleware '+item.path);
  }
  const originalArrow=old.arguments.at(-1);
  const replacement=now.arguments.at(-1);
  assert.ok(ts.isArrowFunction(originalArrow)&&ts.isBlock(originalArrow.body),'original handler '+item.path);
  assert.ok(ts.isCallExpression(replacement)&&ts.isIdentifier(replacement.expression)&&replacement.expression.text===item.factory,'factory '+item.path);
  const depGetter=replacement.arguments[0];
  assert.ok(ts.isArrowFunction(depGetter),'per-request getter '+item.path);
  const supply=ts.isParenthesizedExpression(depGetter.body)?depGetter.body.expression:depGetter.body;
  assert.ok(ts.isObjectLiteralExpression(supply),'dependency snapshot '+item.path);
  assert.deepEqual(supply.properties.map(x=>x.name.getText(nowFile)),item.dependencies,'exact lexical dependency names '+item.path);
  const fn=moduleFile.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===item.factory);
  assert.ok(fn&&fn.body,'extracted factory exists '+item.path);
  const ret=fn.body.statements.find(ts.isReturnStatement);
  assert.ok(ret&&ts.isArrowFunction(ret.expression)&&ts.isBlock(ret.expression.body),'factory returns the handler '+item.path);
  const statements=ret.expression.body.statements;
  assert.ok(ts.isVariableStatement(statements[0])&&statements[0].getText(moduleFile).includes('getDeps()'),'lazy dependency resolution '+item.path);
  assert.deepEqual(statements.slice(1).map(x=>normalize(x.getText(moduleFile))),
     originalArrow.body.statements.map(x=>normalize(x.getText(oldFile))),'byte-faithful original statements '+item.path);
}
assert.equal(manifest.routes.length,10);
assert.equal(original.split('\n').length,manifest.originalLines);
assert.ok(current.split('\n').length<=manifest.expectedServerLines,'entrypoint may shrink further after later independent extractions');
console.log('PASS: 10 financial GET handlers, original AST statement parity, 10 route guards and tenant dependencies.');
