import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const walk = (node, fn) => { fn(node); ts.forEachChild(node, child => walk(child, fn)); };

// Reconstruct source views for older source-contract tests from the *live*
// registrations and module implementations. No historical snapshot is used.
export function readModularServerSource() {
  let text = readFileSync('server.ts', 'utf8');
  const source = parse('server.ts', text);
  const imports = new Map();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const path = node.moduleSpecifier.text;
    if (!path.startsWith('./services/')) continue;
    const file = path.slice(2) + '.ts';
    if (!existsSync(file)) continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imports.set(element.name.text, file);
  }
  const modules = new Map();
  const moduleFor = name => {
    const file = imports.get(name);
    if (!file) return null;
    if (!modules.has(file)) {
      const code = readFileSync(file, 'utf8');
      modules.set(file, { code, source: parse(file, code) });
    }
    return modules.get(file);
  };
  const instances = new Map();
  walk(source, node => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isCallExpression(node.initializer) || !ts.isIdentifier(node.initializer.expression)) return;
    const name = node.initializer.expression.text;
    if (imports.has(name)) instances.set(node.name.text, name);
  });
  function factoryBody(name) {
    const mod = moduleFor(name);
    if (!mod) return null;
    const functionDecl = mod.source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    let body = functionDecl?.body;
    if (!body) {
      const statement = mod.source.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(mod.source) === name));
      const initializer = statement?.declarationList.declarations[0]?.initializer;
      if (initializer && ts.isArrowFunction(initializer) && ts.isBlock(initializer.body)) body = initializer.body;
    }
    return body ? { mod, body } : null;
  }
  function factoryExpression(name) {
    const factory = factoryBody(name);
    const value = factory?.body.statements.find(ts.isReturnStatement)?.expression;
    if (value) return { mod: factory.mod, value };
    const mod = moduleFor(name);
    const statement = mod?.source.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(mod.source) === name));
    const initializer = statement?.declarationList.declarations[0]?.initializer;
    if (!initializer || !ts.isArrowFunction(initializer)) return null;
    let expression = initializer.body;
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    return ts.isObjectLiteralExpression(expression) ? { mod, value: expression } : null;
  }
  const replacements = [];
  walk(source, node => {
    let name;
    if (ts.isVariableStatement(node)) {
      const init = node.declarationList.declarations[0]?.initializer;
      if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression)) name = init.expression.text;
    } else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      name = node.expression.expression.text;
    }
    if (!name || !imports.has(name)) return;
    // Only the commercial factories below move named declarations or whole route registrations.
    if (!/^(?:create(?:Sales|PaidDirector|StripeWebhookEventState|ModularCheckoutCore)|register(?:PublicSales|OwnerSales|LegacySales|StripeCanonical|PatientTimeReport|TissPayerProfilesList|TussMapping))/.test(name)) return;
    const factory = factoryBody(name);
    if (!factory) return;
    const moved = factory.body.statements.filter(statement => {
      if (ts.isReturnStatement(statement)) return false;
      if (ts.isVariableStatement(statement) && statement.getText(factory.mod.source).includes(' = deps')) return false;
      return ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement) || ts.isExpressionStatement(statement);
    }).map(statement => statement.getText(factory.mod.source)).join('\n');
    if (moved) replacements.push({ start: node.end, end: node.end, text: '\n' + moved + '\n' });
  });
  walk(source, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.expression.getText(source) !== 'app' || node.arguments.length < 2 || !ts.isStringLiteral(node.arguments[0])) return;
    const last = node.arguments.at(-1);
    let name, property;
    if (ts.isCallExpression(last) && ts.isIdentifier(last.expression)) name = last.expression.text;
    else if (ts.isPropertyAccessExpression(last) && ts.isIdentifier(last.expression)) { name = instances.get(last.expression.text); property = last.name.text; }
    else if (ts.isElementAccessExpression(last) && ts.isIdentifier(last.expression) && ts.isStringLiteral(last.argumentExpression)) { name = instances.get(last.expression.text); property = last.argumentExpression.text; }
    if (!name && ts.isIdentifier(last)) {
      const mod = moduleFor(last.text);
      const statement = mod?.source.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(mod.source) === last.text));
      const handler = statement?.declarationList.declarations[0]?.initializer;
      if (handler && ts.isArrowFunction(handler) && ts.isBlock(handler.body)) {
        const body = mod.code.slice(handler.body.getStart(mod.source) + 1, handler.body.end - 1);
        replacements.push({ start: last.getStart(source), end: last.end, text: `async (req: any, res) => {${body}}` });
      }
      return;
    }
    if (!name) return;
    const factory = factoryExpression(name);
    if (!factory) return;
    let handler = factory.value;
    if (property && ts.isObjectLiteralExpression(handler)) handler = handler.properties.find(p => p.name?.getText(factory.mod.source).replace(/^['"]|['"]$/g, '') === property)?.initializer;
    if (!handler || !ts.isArrowFunction(handler) || !ts.isBlock(handler.body)) return;
    const statements = handler.body.statements;
    const first = statements[0];
    const start = first && ts.isVariableStatement(first) && first.getText(factory.mod.source).includes('getDeps()') ? first.end : handler.body.getStart(factory.mod.source) + 1;
    const body = factory.mod.code.slice(start, handler.body.end - 1);
    replacements.push({ start: last.getStart(source), end: last.end, text: `async (req: any, res) => {${body}}` });
  });
  for (const item of replacements.sort((a, b) => b.start - a.start)) text = text.slice(0, item.start) + item.text + text.slice(item.end);
  return text;
}
