import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readModularServerSource } from './helpers/modularServerSource.mjs';

const baseline = JSON.parse(readFileSync('tests/fixtures/productionExtractedRouteParity.json', 'utf8'));
const text = readModularServerSource();
const source = ts.createSourceFile('server.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const printer = ts.createPrinter({ removeComments: true });
const routes = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'app' && node.arguments.length > 1 && ts.isStringLiteral(node.arguments[0])) routes.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
for (const expected of baseline) {
  const matches = routes.filter(node => node.expression.name.text === expected.method && node.arguments[0].text === expected.path);
  assert.equal(matches.length, 1, `one registration: ${expected.method} ${expected.path}`);
  const route = matches[0];
  assert.deepEqual(route.arguments.slice(0, -1).map(node => node.getText(source)), expected.middleware, `middleware: ${expected.path}`);
  const handler = route.arguments.at(-1);
  assert.ok(ts.isArrowFunction(handler) && ts.isBlock(handler.body), `module handler: ${expected.path}`);
  const body = printer.printNode(ts.EmitHint.Unspecified, handler.body, source);
  const emitted = ts.transpileModule(`async function handler(req,res) ${body}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  assert.equal(createHash('sha256').update(emitted).digest('hex'), expected.sha256, `reviewed behavior: ${expected.path}`);
}
console.log(`Reviewed route baseline: ${baseline.length} extracted routes, middleware and emitted handler bodies match`);
