import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { productionClinicalHandler, productionClinicalWrites } from './helpers/productionClinicalWriteSource.mjs';

const server = readFileSync('server.ts', 'utf8');
const source = ts.createSourceFile('server.ts', server, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const calls = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'app' && ts.isStringLiteral(node.arguments[0])) calls.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
for (const route of productionClinicalWrites) {
  const found = calls.filter(node => node.expression.name.text === route.method && node.arguments[0].text === route.path);
  assert.equal(found.length, 1, `registration: ${route.path}`);
  assert.deepEqual(found[0].arguments.slice(0, -1).map(node => node.getText(source)), route.middleware, `middleware: ${route.path}`);
  const body = productionClinicalHandler(route);
  assert.equal(createHash('sha256').update(body).digest('hex'), route.bodySha256, `reviewed body: ${route.path}`);
  const handler = found[0].arguments.at(-1).getText(source);
  assert.ok(route.property ? handler.endsWith(`.${route.property}`) : handler.startsWith(`${route.factory}(`), `handler wiring: ${route.path}`);
}
console.log(`Reviewed clinical extraction: ${productionClinicalWrites.length} bodies, middleware and registrations match`);
