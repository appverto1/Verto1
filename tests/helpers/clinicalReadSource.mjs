import { readFileSync } from 'node:fs';
import ts from 'typescript';

export const clinicalReadManifest = JSON.parse(readFileSync('docs/backend-modularization/20261015-clinical-read-extraction.json', 'utf8'));

export function extractedClinicalArrow(route) {
  const file = `services/${route.module}.ts`;
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const factory = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === route.name);
  if (!factory) throw new Error(`Missing factory ${route.name}`);
  const returned = factory.body.statements.find(ts.isReturnStatement)?.expression;
  if (!returned || !ts.isArrowFunction(returned)) throw new Error(`Missing handler ${route.name}`);
  const injected = `\n    const { ${route.deps.join(', ')} } = getDeps();`;
  const arrow = returned.getText(ast);
  if (!arrow.includes(injected)) throw new Error(`Dependency contract changed: ${route.name}`);
  return arrow.replace(injected, '');
}

// Existing source-contract regressions inspect the live implementation at its new
// location, while retaining the actual route and middleware registration text.
export function readClinicalServerSource() {
  let source = readFileSync('server.ts', 'utf8');
  for (const route of clinicalReadManifest.routes) {
    if (source.split(route.replacement).length !== 2) throw new Error(`Missing/duplicate registration ${route.name}`);
    source = source.replace(route.replacement, extractedClinicalArrow(route));
  }
  return source.replace(clinicalReadManifest.imports, '');
}
