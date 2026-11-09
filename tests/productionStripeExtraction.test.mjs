import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const declarations = JSON.parse(readFileSync('tests/fixtures/productionStripeExtraction.json', 'utf8'));
for (const entry of declarations) {
  const text = readFileSync(entry.module, 'utf8');
  const source = ts.createSourceFile(entry.module, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === entry.name) matches.push(node);
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1 && node.declarationList.declarations[0].name.getText(source) === entry.name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `${entry.module}: ${entry.name}`);
  assert.equal(createHash('sha256').update(matches[0].getText(source)).digest('hex'), entry.sha256, `production declaration ${entry.name}`);
}
console.log(`Production Stripe extraction: ${declarations.length} declarations match production`);
