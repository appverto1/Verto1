import { readFileSync } from 'node:fs';
import ts from 'typescript';

export const productionClinicalWrites = JSON.parse(readFileSync('tests/fixtures/productionClinicalExtraction.json', 'utf8'));
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
export function productionClinicalHandler(route) {
  const text = readFileSync(route.module, 'utf8');
  const source = parse(route.module, text);
  const factory = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === route.factory);
  if (!factory) throw new Error(`Missing clinical handler factory ${route.factory}`);
  const returned = factory.body.statements.find(ts.isReturnStatement)?.expression;
  const arrow = route.property ? returned?.properties?.find(node => node.name?.getText(source) === route.property)?.initializer : returned;
  if (!arrow || !ts.isArrowFunction(arrow) || !ts.isBlock(arrow.body)) throw new Error(`Missing clinical handler ${route.path}`);
  const deps = arrow.body.statements[0];
  if (!ts.isVariableStatement(deps) || !deps.getText(source).includes('getDeps()')) throw new Error(`Missing lazy dependencies ${route.path}`);
  return text.slice(deps.end, arrow.body.end - 1);
}
export function restoreProductionClinicalWrites(text) {
  const source = parse('server.ts', text);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'app' && ts.isStringLiteral(node.arguments[0])) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const replacements = productionClinicalWrites.map(route => {
    const matches = calls.filter(node => node.expression.name.text === route.method && node.arguments[0].text === route.path);
    if (matches.length !== 1) throw new Error(`Expected one registration: ${route.path}`);
    const handler = matches[0].arguments.at(-1);
    return { start: handler.getStart(source), end: handler.end, text: `${route.signature}{${productionClinicalHandler(route)}}` };
  });
  for (const replacement of replacements.sort ( (a, b) => b.start - a.start)) text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
  return text;
}
