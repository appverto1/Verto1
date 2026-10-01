import assert from 'node:assert/strict';
import {existsSync, readFileSync, realpathSync, mkdtempSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, relative, isAbsolute, join} from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
import {
  validateEvidenceEnvelope,
  validateWriterValidationPreflight,
  verifyFactoryConsistency,
  detectRecoveryLoop,
} from '../scripts/factory-recovery-controls.mjs';

const CATALOG_URL = new URL('../docs/factory/BLOCKER_CATALOG_V1.json', import.meta.url);
const SOURCE_URL = new URL('../scripts/factory-recovery-controls.mjs', import.meta.url);
const catalog = JSON.parse(readFileSync(CATALOG_URL, 'utf8'));
const source = readFileSync(SOURCE_URL, 'utf8');

assert.equal(catalog.schema_version, 'BLOCKER_CATALOG_V1');
assert(Array.isArray(catalog.entries), 'catalog entries must be an array');

const allowedCoverage = new Set(['CODED_AND_TESTED', 'CODED_NOT_TESTED', 'DOCUMENTED_ONLY', 'GAP']);
const requiredFields = [
  'code','symptom','detection','detection_source','owner','unblock_action','retry_condition',
  'fail_closed_behavior','claim_effect','lock_effect','exact_sha_requirement','evidence_required',
  'regression_test','coverage_status','first_observed','notes',
];
const requiredActions = ['owner','unblock_action','retry_condition','fail_closed_behavior'];

const parse = (text) => {
  const ast = ts.createSourceFile('factory.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, 'Factory source must parse before catalog validation');
  return ast;
};
const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
const nameOf = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null;

// Lexical binding uses the TypeScript checker; resolution stays bounded and never executes source.
function staticResolver(ast) {
  const host={
    getSourceFile:name=>name===ast.fileName?ast:undefined,
    getDefaultLibFileName:()=>'',writeFile:()=>{},getCurrentDirectory:()=>'',getDirectories:()=>[],
    fileExists:name=>name===ast.fileName,readFile:name=>name===ast.fileName?ast.text:undefined,
    getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n',
  };
  const checker=ts.createProgram([ast.fileName],{allowJs:true,noLib:true,noResolve:true},host).getTypeChecker();
  const symbol=node=>node?.parent&&ts.isShorthandPropertyAssignment(node.parent)&&node.parent.name===node?checker.getShorthandAssignmentValueSymbol(node.parent):checker.getSymbolAtLocation(node);
  const declaration=node=>symbol(node)?.valueDeclaration??symbol(node)?.declarations?.[0];
  const imported=node=>{const d=declaration(node);let parent=d;while(parent&&!ts.isImportDeclaration(parent))parent=parent.parent;return parent?{module:parent.moduleSpecifier.text,name:ts.isImportSpecifier(d)?(d.propertyName??d.name).text:ts.isImportClause(d)?'default':'*'}:null;};
  const unparen=input=>{let node=input;while(node&&ts.isParenthesizedExpression(node))node=node.expression;return node;};
  const immutable=d=>d&&ts.isVariableDeclaration(d)&&Boolean(d.parent.flags&ts.NodeFlags.Const);
  const assigned=new Set();
  const aliases=[];
  const rootSymbol=input=>{let node=unparen(input);while(node&&(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)))node=unparen(node.expression);return node&&ts.isIdentifier(node)?symbol(node):undefined;};
  walk(ast,node=>{
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const root=rootSymbol(node.initializer);if(root)aliases.push([symbol(node.name),root]);}
    if(ts.isVariableDeclaration(node)&&node.initializer){
      const roots=[];const direct=rootSymbol(node.initializer);if(direct)roots.push(direct);
      if(ts.isObjectLiteralExpression(node.initializer)||ts.isArrayLiteralExpression(node.initializer))walk(node.initializer,n=>{if(ts.isIdentifier(n)&&!ts.isPropertyAccessExpression(n.parent)&&!(ts.isPropertyAssignment(n.parent)&&n.parent.name===n)){const root=rootSymbol(n);if(root)roots.push(root);}});
      const bindings=[];const collect=name=>{if(ts.isIdentifier(name))bindings.push(symbol(name));else if(ts.isBindingPattern(name))for(const e of name.elements)if(ts.isBindingElement(e))collect(e.name);};collect(node.name);
      for(const binding of bindings)for(const root of roots)if(binding&&root)aliases.push([binding,root]);
    }
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment){
      let target=node.left;while(ts.isPropertyAccessExpression(target)||ts.isElementAccessExpression(target))target=target.expression;
      if(ts.isIdentifier(target))assigned.add(symbol(target));
      if(node.operatorToken.kind===ts.SyntaxKind.EqualsToken){const right=rootSymbol(node.right),left=rootSymbol(node.left);if(right&&left)aliases.push([left,right]);}
    }
    if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)&&ts.isIdentifier(node.operand))assigned.add(symbol(node.operand));
  });
  const propertyName=(node,seen=new Set())=>ts.isComputedPropertyName(node)?resolve(node.expression,'string',seen):nameOf(node);
  const mutableContainer=node=>{
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      let root=node.expression;
      while(ts.isPropertyAccessExpression(root)||ts.isElementAccessExpression(root))root=root.expression;
      return ts.isIdentifier(root)&&assigned.has(symbol(root));
    }
    let owner=node.parent;
    while(owner&&(ts.isObjectLiteralExpression(owner)||ts.isPropertyAssignment(owner)||ts.isArrayLiteralExpression(owner)||ts.isParenthesizedExpression(owner)))owner=owner.parent;
    return Boolean(owner&&ts.isVariableDeclaration(owner)&&ts.isIdentifier(owner.name)&&assigned.has(symbol(owner.name)));
  };
  // A named function is an emitter only if its returned structured code is the first parameter.
  const emitterFunction=(fn,seen)=>{
    if(!fn||!ts.isFunctionLike(fn)||!fn.body||!fn.parameters[0]||!ts.isIdentifier(fn.parameters[0].name))return false;
    const parameter=symbol(fn.parameters[0].name);
    const returns=[];
    if(ts.isArrowFunction(fn)&&!ts.isBlock(fn.body))returns.push(fn.body);
    else {const visit=n=>{if(n!==fn.body&&ts.isFunctionLike(n))return;if(ts.isReturnStatement(n)&&n.expression)returns.push(n.expression);ts.forEachChild(n,visit);};visit(fn.body);}
    const structured=input=>{
      const node=unparen(input);
      if(!node)return false;
      if(ts.isObjectLiteralExpression(node))return node.properties.some(member=>{
        if(ts.isShorthandPropertyAssignment(member))return member.name.text==='code'&&symbol(member.name)===parameter;
        if(!ts.isPropertyAssignment(member))return false;
        if(propertyName(member.name)==='code'&&ts.isIdentifier(member.initializer)&&symbol(member.initializer)===parameter)return true;
        return structured(member.initializer);
      });
      if(ts.isCallExpression(node)){
        if(ts.isPropertyAccessExpression(node.expression)&&nameOf(node.expression.expression)==='Object'&&!declaration(node.expression.expression)&&node.expression.name.text==='freeze')return structured(node.arguments[0]);
        return resolve(node.expression,'emitter',seen)&&Boolean(node.arguments[0])&&ts.isIdentifier(node.arguments[0])&&symbol(node.arguments[0])===parameter;
      }
      return false;
    };
    return returns.some(structured);
  };
  const resolve=(input,kind='string',seen=new Set())=>{
    const node=unparen(input);
    if(!node||seen.has(node)||seen.size>=64)return undefined;
    const next=new Set(seen);next.add(node);
    if(kind==='string'&&ts.isStringLiteralLike(node))return node.text;
    if(kind==='object'&&ts.isObjectLiteralExpression(node)&&!mutableContainer(node)&&!node.properties.some(ts.isSpreadAssignment))return node;
    if(ts.isIdentifier(node)){
      const d=declaration(node);
      if(!d||assigned.has(symbol(node)))return undefined;
      if(kind==='emitter'&&ts.isFunctionDeclaration(d))return emitterFunction(d,next)?d:undefined;
      if(immutable(d)){
        if(kind==='emitter'&&d.initializer&&ts.isFunctionLike(d.initializer))return emitterFunction(d.initializer,next)?d:undefined;
        return resolve(d.initializer,kind,next);
      }
      return undefined;
    }
    if(kind==='string'&&ts.isTemplateExpression(node)){
      let value=node.head.text;
      for(const span of node.templateSpans){const part=resolve(span.expression,'string',next);if(typeof part!=='string')return undefined;value+=part+span.literal.text;}
      return value;
    }
    if(kind==='string'&&ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){
      const a=resolve(node.left,kind,next),b=resolve(node.right,kind,next);
      return typeof a==='string'&&typeof b==='string'?a+b:undefined;
    }
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const object=resolve(node.expression,'object',next);
      const key=ts.isPropertyAccessExpression(node)?node.name.text:resolve(node.argumentExpression,'string',next);
      if(object&&typeof key==='string'){
        const members=object.properties.filter(p=>p.name&&propertyName(p.name,next)===key);
        if(members.length!==1)return undefined;
        const member=members[0];
        if(ts.isPropertyAssignment(member))return resolve(member.initializer,kind,next);
        if(ts.isShorthandPropertyAssignment(member))return resolve(member.name,kind,next);
      }
    }
    return undefined;
  };
  const literalOnly=(input,seen=new Set())=>{
    const node=unparen(input);if(!node||seen.has(node)||seen.size>=64)return false;
    const next=new Set(seen);next.add(node);
    if(ts.isLiteralExpression(node)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.kind))return true;
    if(ts.isIdentifier(node)){const d=declaration(node);return Boolean(immutable(d)&&!assigned.has(symbol(node))&&literalOnly(d.initializer,next));}
    if(typeof resolve(node)==='string')return true;
    if(ts.isArrayLiteralExpression(node))return node.elements.every(n=>literalOnly(n,next));
    if(ts.isObjectLiteralExpression(node))return node.properties.every(p=>ts.isPropertyAssignment(p)&&literalOnly(p.initializer,next));
    return false;
  };
  // Mutation/escape of any shared alias invalidates the entire object proof.
  walk(ast,node=>{
    if(ts.isDeleteExpression(node))assigned.add(rootSymbol(node.expression));
    if(ts.isCallExpression(node)){
      const callee=node.expression,imp=ts.isPropertyAccessExpression(callee)?imported(callee.expression):imported(callee);
      const readonly=imp&&['node:assert','node:assert/strict','node:fs','../scripts/factory-recovery-controls.mjs'].includes(imp.module)||
        ts.isPropertyAccessExpression(callee)&&nameOf(callee.expression)==='Object'&&!declaration(callee.expression)&&['freeze','keys','values','entries','hasOwn'].includes(callee.name.text);
      if(!readonly)for(const arg of node.arguments)if(resolve(arg,'object'))assigned.add(rootSymbol(arg));
      if(ts.isPropertyAccessExpression(callee)&&['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin','set','add','delete','clear'].includes(callee.name.text))assigned.add(rootSymbol(callee.expression));
    }
    if(ts.isReturnStatement(node)&&node.expression&&ts.isIdentifier(node.expression)&&resolve(node.expression,'object'))assigned.add(rootSymbol(node.expression));
  });
  for(let changed=true;changed;){changed=false;for(const [a,b] of aliases)if(assigned.has(a)||assigned.has(b)){if(!assigned.has(a)||!assigned.has(b))changed=true;assigned.add(a);assigned.add(b);}}
  assigned.delete(undefined);
  const tainted=node=>{let bad=false;if(node)walk(node,n=>{const binding=ts.isIdentifier(n)&&symbol(n);if(binding&&assigned.has(binding))bad=true;});return bad;};
  const guardedEmitter=node=>{
    const d=resolve(node,'emitter'),fn=d&&ts.isFunctionDeclaration(d)?d:d?.initializer;
    if(!fn?.body||!ts.isBlock(fn.body)||!fn.parameters[0])return false;
    return fn.body.statements.some(statement=>{
      const condition=ts.isIfStatement(statement)&&statement.expression,call=condition&&ts.isPrefixUnaryExpression(condition)&&condition.operator===ts.SyntaxKind.ExclamationToken&&condition.operand;
      const base=call&&ts.isCallExpression(call)&&ts.isPropertyAccessExpression(call.expression)&&call.expression.name.text==='has'&&declaration(call.expression.expression);
      return base&&immutable(base)&&nameOf(base.name)==='ERRORS'&&ts.isNewExpression(base.initializer)&&nameOf(base.initializer.expression)==='Set'&&!declaration(base.initializer.expression)&&symbol(call.arguments[0])===symbol(fn.parameters[0].name)&&ts.isThrowStatement(statement.thenStatement);
    });
  };
  return {value:node=>resolve(node),emitter:node=>resolve(node,'emitter'),guardedEmitter,object:node=>resolve(node,'object'),propertyName,literalOnly,mutableContainer,symbol,declaration,imported,unparen,immutable,tainted};
}

function structuredCodes(text) {
  const ast=parse(text), codes=new Set(), resolver=staticResolver(ast);
  codes.unresolved=[];
  const add = (node) => { const code=resolver.value(node); if (code && code!=='OBSERVABLE_PROGRESS_AND_CAS_CONFIRMED') codes.add(code); };
  walk(ast, (node) => {
    if (ts.isCallExpression(node)) {
      if (resolver.emitter(node.expression)) {add(node.arguments[0]);if(resolver.tainted(node.arguments[0])&&!resolver.guardedEmitter(node.expression))codes.unresolved.push(node.arguments[0].getText(ast));}
    }
    if (ts.isPropertyAssignment(node) && !resolver.mutableContainer(node) && ['code','reason'].includes(resolver.propertyName(node.name))) add(node.initializer);
    if (ts.isShorthandPropertyAssignment(node) && !resolver.mutableContainer(node) && ['code','reason'].includes(nameOf(node.name))) add(node.name);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind===ts.SyntaxKind.EqualsToken) {
      const left=node.left;
      const key=ts.isPropertyAccessExpression(left) ? left.name.text : ts.isElementAccessExpression(left) ? resolver.value(left.argumentExpression) : nameOf(left);
      if (['code','reason'].includes(key) && !resolver.mutableContainer(left)) add(node.right);
    }
    if (ts.isVariableDeclaration(node) && nameOf(node.name)==='ERRORS' && node.initializer && node.parent?.parent?.parent===ast) walk(node.initializer, child=> { if (ts.isStringLiteralLike(child) || ts.isIdentifier(child)) add(child); });
    if (ts.isVariableDeclaration(node) && nameOf(node.name)==='routes' && node.initializer) {
      const object=resolver.object(node.initializer);
      if (object) for (const property of object.properties) if (ts.isPropertyAssignment(property)) {
        const code=resolver.propertyName(property.name); if (code) codes.add(code);
      }
    }
  });
  return codes;
}

// Only lexically bound Node assertions over control-derived operands prove coverage.
function assertionTokens(text) {
  const ast=parse(text), tokens=new Set(), resolver=staticResolver(ast);
  const controls=new Set(['validateEvidenceEnvelope','validateWriterValidationPreflight','verifyFactoryConsistency','detectRecoveryLoop','evaluateRecoveryMetadata','evaluateCapabilityProbe','validateCandidateManifest','createStructuredFactoryError','routeStructuredFactoryError','routeConsistencyResult','evaluateClaimRenewal']);
  const returns=fn=>{
    if(!fn?.body)return [];
    if(ts.isArrowFunction(fn)&&!ts.isBlock(fn.body))return [fn.body];
    const values=[];const visit=n=>{if(n!==fn.body&&ts.isFunctionLike(n))return;if(ts.isReturnStatement(n)&&n.expression)values.push(n.expression);ts.forEachChild(n,visit);};visit(fn.body);return values;
  };
  const functionOf=node=>{const d=resolver.declaration(node);return d&&ts.isFunctionDeclaration(d)?d:d&&ts.isVariableDeclaration(d)&&d.initializer&&ts.isFunctionLike(d.initializer)?d.initializer:undefined;};
  const assertion=(input,seen=new Set())=>{
    const node=resolver.unparen(input);if(!node||seen.has(node)||seen.size>=64||resolver.tainted(node))return undefined;
    const next=new Set(seen);next.add(node);
    if(ts.isPropertyAccessExpression(node)){const base=assertion(node.expression,next);return base==='assert'?node.name.text:undefined;}
    if(ts.isIdentifier(node)){
      const imp=resolver.imported(node);
      if(imp&&['node:assert','node:assert/strict'].includes(imp.module))return ['default','*'].includes(imp.name)?'assert':imp.name;
      const d=resolver.declaration(node);if(resolver.immutable(d))return assertion(d.initializer,next);
    }
    return undefined;
  };
  const bind=(fn,args,context)=>{const bound=new Map(context);fn.parameters.forEach((p,index)=>{if(ts.isIdentifier(p.name))bound.set(resolver.symbol(p.name),{expression:args[index],context});});return bound;};
  // The in-file catalog/path analyzers are controls only at their real lexical
  // declarations with imported parser/fs or material Node assertions in their body.
  const localControl=fn=>{
    const owner=ts.isFunctionDeclaration(fn)?fn:fn.parent;
    if(!owner||owner.parent!==ast&&!ts.isVariableDeclaration(owner))return false;
    const name=ts.isFunctionDeclaration(fn)?nameOf(fn.name):ts.isVariableDeclaration(owner)?nameOf(owner.name):null;
    if(!['validateCatalog','structuredCodes','assertionTokens','confinedPath','readSource'].includes(name))return false;
    let guarded=false;walk(fn.body,node=>{
      if(ts.isCallExpression(node)){
        const imp=resolver.imported(ts.isPropertyAccessExpression(node.expression)?node.expression.expression:node.expression);
        if(imp&&['typescript','node:fs'].includes(imp.module)||assertion(node.expression)&&node.arguments.some(arg=>!resolver.literalOnly(arg)))guarded=true;
      }
    });return guarded;
  };
  const origin=(input,context=new Map(),seen=new Set())=>{
    const node=resolver.unparen(input);if(!node||seen.has(node)||seen.size>=64||resolver.literalOnly(node))return false;
    const next=new Set(seen);next.add(node);
    if(ts.isIdentifier(node)){
      if(resolver.tainted(node))return false;
      const bound=context.get(resolver.symbol(node));if(bound)return bound.trusted===true||origin(bound.expression,bound.context,next);
      const d=resolver.declaration(node);return resolver.immutable(d)&&origin(d.initializer,context,next);
    }
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const object=resolver.object(node.expression),key=ts.isPropertyAccessExpression(node)?node.name.text:resolver.value(node.argumentExpression);
      if(object){const member=object.properties.find(p=>p.name&&resolver.propertyName(p.name)===key);return member&&ts.isPropertyAssignment(member)?origin(member.initializer,context,next):false;}
      return origin(node.expression,context,next);
    }
    if(ts.isCallExpression(node)){
      const callee=node.expression,imp=resolver.imported(ts.isPropertyAccessExpression(callee)?callee.expression:callee);
      if(resolver.tainted(callee))return false;
      if(imp?.module==='../scripts/factory-recovery-controls.mjs'&&controls.has(imp.name))return true;
      if(imp?.module==='node:fs'&&['readFileSync','realpathSync'].includes(imp.name))return true;
      if(imp?.module==='typescript')return true;
      if(ts.isPropertyAccessExpression(callee)&&['some','every','find','filter','map','has','includes','test'].includes(callee.name.text))return origin(callee.expression,context,next);
      const fn=functionOf(callee);
      if(fn){if(localControl(fn))return true;const values=returns(fn),bound=bind(fn,node.arguments,context);return values.length>0&&values.every(value=>origin(value,bound,next));}
      if(ts.isPropertyAccessExpression(callee)&&nameOf(callee.expression)==='JSON'&&!resolver.declaration(callee.expression)&&callee.name.text==='parse')return origin(node.arguments[0],context,next);
    }
    if(ts.isBinaryExpression(node))return [ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)?origin(node.left,context,next)&&origin(node.right,context,next):origin(node.left,context,next)||origin(node.right,context,next);
    return false;
  };
  const expected=(node,context=new Map(),seen=new Set())=>{
    if(!node||seen.has(node)||seen.size>=64)return;const next=new Set(seen);next.add(node);
    if(ts.isIdentifier(node)){const bound=context.get(resolver.symbol(node));if(bound?.expression){expected(bound.expression,bound.context,next);return;}}
    const value=resolver.value(node);
    if(typeof value==='string'){tokens.add(value);return;}
    if(ts.isRegularExpressionLiteral(node)){tokens.add(node.text.slice(1,node.text.lastIndexOf('/')));return;}
    if(ts.isObjectLiteralExpression(node))for(const member of node.properties)if(ts.isPropertyAssignment(member))expected(member.initializer,context,next);
    if(ts.isArrayLiteralExpression(node))for(const member of node.elements)expected(member,context,next);
  };
  const pair=(a,b,context)=>{if(origin(a,context))expected(b,context);if(origin(b,context))expected(a,context);};
  const predicate=(input,context=new Map(),seen=new Set())=>{
    const node=resolver.unparen(input);if(!node||seen.has(node)||seen.size>=64)return;
    const next=new Set(seen);next.add(node);
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken){predicate(node.operand,context,next);return;}
    if(ts.isBinaryExpression(node)){
      if([ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)){
        // Both branches must be control-derived. Constant/fixture short-circuits
        // and unknown predicates cannot establish a material assertion.
        if(origin(node.left,context)&&origin(node.right,context)){predicate(node.left,context,next);predicate(node.right,context,next);}return;
      }
      if([ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind))pair(node.left,node.right,context);
      return;
    }
    if(ts.isCallExpression(node)){
      const callee=node.expression;
      if(ts.isPropertyAccessExpression(callee)&&['some','every','find'].includes(callee.name.text)&&origin(callee.expression,context)){
        const fn=node.arguments[0];if(fn&&ts.isFunctionLike(fn)){const bound=new Map(context);for(const p of fn.parameters)if(ts.isIdentifier(p.name))bound.set(resolver.symbol(p.name),{trusted:true});for(const value of returns(fn))predicate(value,bound,next);}return;
      }
      if(ts.isPropertyAccessExpression(callee)&&['has','includes','test'].includes(callee.name.text)){pair(callee.expression,node.arguments[0],context);return;}
      const fn=functionOf(callee);if(fn){const bound=bind(fn,node.arguments,context);for(const value of returns(fn))predicate(value,bound,next);}
    }
  };
  walk(ast,node=>{
    if(!ts.isCallExpression(node))return;const method=assertion(node.expression);if(!method)return;
    if(['assert','ok'].includes(method))predicate(node.arguments[0]);
    if(['equal','strictEqual','notEqual','notStrictEqual','deepEqual','deepStrictEqual','notDeepEqual','notDeepStrictEqual','match','doesNotMatch'].includes(method))pair(node.arguments[0],node.arguments[1],new Map());
    if(['throws','rejects'].includes(method)){
      const target=node.arguments[0];if(!target||!ts.isFunctionLike(target))return;
      let tested=false;walk(target.body,n=>{if(ts.isCallExpression(n)&&origin(n))tested=true;});if(!tested)return;
      const matcher=node.arguments[1];
      if(matcher&&(ts.isRegularExpressionLiteral(matcher)||ts.isObjectLiteralExpression(matcher)))expected(matcher);
      else if(matcher&&ts.isFunctionLike(matcher)){const bound=new Map();for(const p of matcher.parameters)if(ts.isIdentifier(p.name))bound.set(resolver.symbol(p.name),{trusted:true});for(const value of returns(matcher))predicate(value,bound);}
    }
  });
  return tokens;
}

const REPO_ROOT=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const confinedPath=(path,root=REPO_ROOT)=>{
  assert.equal(typeof path,'string');
  assert(path.length>0&&!isAbsolute(path)&&!path.includes('\\')&&!path.includes('%')&&!path.includes(':')&&!/[\x00-\x1f]/.test(path),'catalog paths must be repository-relative');
  assert(path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'catalog paths must be repository-relative');
  const candidate=resolve(root,path);
  assert(existsSync(candidate),`catalog source does not exist: ${path}`);
  const real=realpathSync(candidate),inside=relative(realpathSync(root),real);
  assert(inside&&!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith('../'),'catalog path escapes real repository root');
  return real;
};
const readSource=path=>readFileSync(confinedPath(path),'utf8');

function validateCatalog(input, controls, read = readSource) {
const codeCache=new Map(),tokenCache=new Map();
const codesOf=text=>{if(!codeCache.has(text))codeCache.set(text,structuredCodes(text));return codeCache.get(text);};
const tokensOf=text=>{if(!tokenCache.has(text))tokenCache.set(text,assertionTokens(text));return tokenCache.get(text);};
assert.equal(input.schema_version, 'BLOCKER_CATALOG_V1');
assert(Array.isArray(input.entries), 'catalog entries must be an array');
const byCode = new Map();
for (const entry of input.entries) {
  assert(entry && typeof entry === 'object' && !Array.isArray(entry), 'every catalog entry must be an object');
  for (const field of requiredFields) assert(Object.hasOwn(entry, field), `${entry.code ?? '<missing>'}: missing field ${field}`);
  assert.equal(typeof entry.code, 'string');
  assert(entry.code.length > 0, 'entry code must be non-empty');
  assert(!byCode.has(entry.code), `duplicate blocker code: ${entry.code}`);
  byCode.set(entry.code, entry);
  assert(allowedCoverage.has(entry.coverage_status), `${entry.code}: invalid coverage_status ${entry.coverage_status}`);
  for (const field of requiredActions) {
    assert.equal(typeof entry[field], 'string', `${entry.code}: ${field} must be a string`);
    assert(entry[field].trim().length > 0, `${entry.code}: ${field} must be non-empty`);
  }
}

const mandatory = [
  "HEAD_DRIFT",
  "BRANCH_IDENTITY_DRIFT",
  "BASE_STAGING_DRIFT",
  "STAGING_FRESHNESS_DRIFT",
  "CHECK_NOT_GREEN",
  "REQUIRED_SUITE_MISSING",
  "REQUIRED_SUITE_SKIPPED",
  "EVIDENCE_MISSING",
  "EVIDENCE_FIELD_MISSING",
  "EVIDENCE_FIELD_INVALID",
  "EVIDENCE_SHA_INVALID",
  "PASS_INVALIDATED",
  "RUN_ID_MISSING",
  "CHECK_ID_MISSING",
  "STALE_CLAIM",
  "CLAIM_IDENTITY_DRIFT",
  "CLAIM_LEASE_CAS_MISMATCH",
  "NO_OBSERVABLE_PROGRESS",
  "STATUS_LABEL_DRIFT",
  "AGENT_LABEL_DRIFT",
  "TERMINAL_CURRENT_AGENT_NONE",
  "STATE_AMBIGUOUS",
  "REFS_SNAPSHOT_MISSING",
  "LOCK_SNAPSHOT_MISSING",
  "DEPENDENCIES_SNAPSHOT_MISSING",
  "DEPENDENCY_UNSATISFIED",
  "GLOBAL_WRITE_LOCK_HELD_BY_OTHER_ISSUE",
  "ORPHAN_LOCK_SUSPECTED",
  "LOCK_INCONSISTENT",
  "RUNTIME_CAPABILITY_MISSING",
  "RECOVERY_LOOP",
  "WRITER_VALIDATION_WORKFLOW_UNAVAILABLE_OR_INCORRECT",
  "CANDIDATE_BRANCH_MISMATCH",
  "SUITE_ALLOWLIST_INVALID",
  "POST_MERGE_PROOF_MISSING",
  "POST_MERGE_MERGE_SHA_DRIFT",
  "POST_MERGE_ANCESTRY_MISSING_OR_INVALID",
  "POST_MERGE_EVIDENCE_STALE",
  "BODY_COMMENT_LABEL_REF_DIVERGENCE",
  "DEAD_RUNTIME_WITH_CLAIM",
  "PRIVATE_GITHUB_TRANSPORT_UNAVAILABLE",
  "RUNTIME_NOMINAL_BUT_MATERIALLY_UNUSABLE",
  "WRITER_VALIDATION_RUNNER_UNAVAILABLE_IN_CURRENT_RUNTIME",
  "BLOCKER_CATALOG_DRIFT",
  "BLOCKER_CATALOG_ANTI_DRIFT_ALIAS_AND_INTERMEDIATE_BYPASS",
  "BLOCKER_CATALOG_FALSE_MATERIAL_ASSERTION_COVERAGE"
];
for (const code of mandatory) assert(byCode.has(code), `mandatory blocker missing from catalog: ${code}`);
const emitted = codesOf(controls);
assert.equal(emitted.unresolved.length,0,'structured factory blocker has mutable or escaped code');
for (const code of emitted) assert(byCode.has(code), `structured factory blocker missing from catalog: ${code}`);

// Coverage may never claim code/test protection that cannot be located materially.
for (const entry of input.entries) {
  if (entry.coverage_status === 'CODED_AND_TESTED' || entry.coverage_status === 'CODED_NOT_TESTED') {
    assert.equal(typeof entry.detection_source, 'string', `${entry.code}: coded coverage requires detection_source`);
    assert(entry.detection_source.length > 0, `${entry.code}: coded coverage requires detection_source`);
    if (entry.source_kind === 'REGRESSION_GUARD') {
      assert(tokensOf(read(entry.detection_source)).has(entry.detection_assertion), `${entry.code}: catalog claims nonexistent regression guard`);
    } else {
    const detectionCodes = codesOf(read(entry.detection_source));
    assert.equal(detectionCodes.unresolved.length,0,'structured factory blocker has mutable or escaped code');
    const mappedCodes = entry.maps_to ?? [entry.code];
    assert(Array.isArray(mappedCodes) && mappedCodes.length > 0, `${entry.code}: invalid detection mapping`);
    for (const code of mappedCodes) {
      assert(byCode.has(code), `${entry.code}: mapped blocker absent from catalog: ${code}`);
      assert(detectionCodes.has(code), `${entry.code}: catalog claims coded protection not found in source: ${code}`);
    }
    }
  }
  if (entry.coverage_status === 'CODED_AND_TESTED') {
    assert.equal(typeof entry.regression_test, 'string', `${entry.code}: CODED_AND_TESTED requires regression_test`);
    assert(entry.regression_test.length > 0, `${entry.code}: CODED_AND_TESTED requires regression_test`);
    const regression = read(entry.regression_test);
    const regressionAssertion = entry.regression_assertion ?? entry.code;
    assert.equal(typeof regressionAssertion, 'string', `${entry.code}: CODED_AND_TESTED requires a regression assertion`);
    assert(regressionAssertion.length > 0, `${entry.code}: CODED_AND_TESTED requires a regression assertion`);
      assert(tokensOf(regression).has(regressionAssertion), `${entry.code}: material regression assertion not found`);
  }
}
return emitted;
}

const emitted = validateCatalog(catalog, source);
if(catalog.contract_manifest){
  const counts=Object.fromEntries([...allowedCoverage].map(status=>[status,catalog.entries.filter(e=>e.coverage_status===status).length]));
  assert.deepEqual(catalog.counts,{entries:catalog.entries.length,structured_codes:emitted.size,...counts});
}

// Mutation regressions prove the validator itself fails closed; never mutate repository files.
const mutate = (change) => { const input = structuredClone(catalog); change(input); return input; };
assert.throws(() => validateCatalog({...catalog, schema_version:'wrong'}, source), /BLOCKER_CATALOG_V1/);
assert.throws(() => validateCatalog({...catalog, entries:{}}, source), /entries must be an array/, 'catalog entries type drift is rejected');
assert.throws(() => validateCatalog(mutate(c => c.entries.push({...c.entries[0]})), source), /duplicate blocker code/);
assert.throws(() => validateCatalog(mutate(c => { c.entries[0].coverage_status='ASPIRATIONAL'; }), source), /invalid coverage_status/);
for (const field of requiredActions) assert.throws(() => validateCatalog(mutate(c => { c.entries[0][field]=''; }), source), /must be non-empty/);
assert.throws(() => validateCatalog(mutate(c => { delete c.entries[0].notes; }), source), /missing field notes/);
assert.throws(() => validateCatalog(mutate(c => { c.entries=c.entries.filter(e => e.code!=='HEAD_DRIFT'); }), source), /missing from catalog/);
for (const addition of [
  'export function probe() { return p( "UNCATALOGED_PROBE", "new blocker" ); }',
  'export function probe() { return { code : `UNCATALOGED_PROBE`, detail: "new blocker" }; }',
  'export function probe() { return { reason : "UNCATALOGED_PROBE" }; }',
  'const NEW_CODE = "UNCATALOGED_PROBE"; export function probe() { return p(NEW_CODE, "new blocker"); }',
  'const A="UNCATALOGED_PROBE"; const B=A; export function probe(){return p(B,"detail");}',
  'const emitter=p; const intermediate=emitter; export function probe(){return intermediate("UNCATALOGED_PROBE","detail");}',
  'const KEY="code"; export function probe(){return {[KEY]:"UNCATALOGED_PROBE"};}',
  'const values={primary:"UNCATALOGED_PROBE"}; const intermediate=values; export function probe(){return p(intermediate.primary,"detail");}',
  'const emitters={emit:p}; const KEY="emit"; export function probe(){return emitters[KEY]("UNCATALOGED_PROBE","detail");}',
  'const KEY="UNCATALOGED_PROBE"; const routes={[KEY]:[]};',
]) assert.throws(() => validateCatalog(catalog, `${source}\n${addition}`), /structured factory blocker missing from catalog: UNCATALOGED_PROBE/);
assert.throws(() => validateCatalog(catalog, `${source}\nconst emit=p; export function probe(){return emit("UNCATALOGED_ALIAS","detail");}`), /structured factory blocker missing from catalog: UNCATALOGED_ALIAS/);
assert.throws(() => validateCatalog(catalog, `${source}\nexport function probe(){return {["code"]:"UNCATALOGED_COMPUTED"};}`), /structured factory blocker missing from catalog: UNCATALOGED_COMPUTED/);
assert.deepEqual([...structuredCodes('const p=(code,detail)=>({code,detail});const A="OUTER_PROBE"; function probe(){const A="INNER_PROBE";const emit=p;emit(A,"detail");}')], ['INNER_PROBE']);
assert.equal(structuredCodes('const A=B;const B=A;p(A,"detail");').size, 0);
assert.equal(structuredCodes('const value={[value.key]:"cycle"};p(value.key,"detail");').size, 0);
assert.equal(structuredCodes('const p=(code,detail)=>({code,detail});function probe(p){p("PARAMETER_PROBE","detail");}').size, 0);
assert.equal(structuredCodes('const p=()=>{};p("SHADOWED_NOOP","detail");').size,0);
assert.equal(structuredCodes('function noop(){};noop();').size,0);
assert.equal(structuredCodes('const p=code=>Object.freeze();p("MISSING_OBJECT","detail");').size,0);
assert.equal(structuredCodes('const p=code=>({code});const wrapper=code=>p();wrapper("MISSING_ARGUMENT","detail");').size,0);
assert(!structuredCodes('const p=()=>{};p("SHADOWED_NOOP","detail");').has('SHADOWED_NOOP'));
assert.equal(structuredCodes('const p=(code,detail)=>({code,detail});function f(){const p=()=>{};p("SHADOWED_NOOP","detail");}').size,0);
assert.equal(structuredCodes('const p=(code,detail)=>({code,detail});function f({p}){p("SHADOWED_DESTRUCTURED","detail");}').size,0);
assert.equal(structuredCodes('const p=(code,detail)=>({code,detail});let code="MUTABLE";p(code,"detail");').size,0);
assert.equal(structuredCodes('const p=(code,detail)=>({code,detail});const values={code:"MUTATED"};values.code="NEW";p(values.code,"detail");').size,0);
assert.equal(structuredCodes('const p=(code,detail)=>({code,detail});const values={code:"MUTATED"};values["code"]="NEW";p(values.code,"detail");').size,0);
assert(structuredCodes('const p=(code,detail)=>({code,detail});const values={code:"STATIC_OBJECT"};p(values.code,"detail");').has('STATIC_OBJECT'));
assert.throws(()=>validateCatalog(catalog,source+'\nconst prefix="UNCATALOGED";p(`${prefix}_TEMPLATE`,"detail");'),/structured factory blocker missing from catalog: UNCATALOGED_TEMPLATE/);
assert(structuredCodes('const ERRORS = new Set(["ENUM_PROBE"]);').has('ENUM_PROBE'));
assert.equal(structuredCodes('function fixture(){const ERRORS=new Set(["FIXTURE_ONLY"]);return 1;}').size,0);
assert.throws(() => validateCatalog(catalog, `${source}\nconst routes = { UNCATALOGED_ROUTE_PROBE: [] };`), /structured factory blocker missing from catalog: UNCATALOGED_ROUTE_PROBE/);
assert(!assertionTokens('assert.throws(() => { const fixture="COMMENT_ONLY"; });').has('COMMENT_ONLY'));
assert(!structuredCodes('// p("COMMENT_ONLY", "not protection")').has('COMMENT_ONLY'));
const tested = catalog.entries.find(e => e.coverage_status==='CODED_AND_TESTED');
const headCoverageCatalog=mutate(c=> { for (const e of c.entries) if (e.coverage_status==='CODED_AND_TESTED' && e.code!=='HEAD_DRIFT') e.coverage_status='CODED_NOT_TESTED'; });
const headTest=headCoverageCatalog.entries.find(e=>e.code==='HEAD_DRIFT').regression_test;
const fakeCoverage = text => validateCatalog(headCoverageCatalog, source, path=>path===headTest ? text : readSource(path));
assert.throws(() => fakeCoverage('assert.equal(1,1,"HEAD_DRIFT");'), /HEAD_DRIFT: material regression assertion not found/);
for (const snippet of [
  'assert(1,"HEAD_DRIFT");',
  'assert.ok(true,"HEAD_DRIFT");',
  'assert.equal("HEAD_DRIFT","HEAD_DRIFT");',
  'const message="HEAD_DRIFT";assert.strictEqual(1,1,message);',
  'assert.throws(()=>{const fixture="HEAD_DRIFT";},"HEAD_DRIFT");',
  'assert.throws(()=>{const fixture="HEAD_DRIFT";},/unrelated/,"HEAD_DRIFT");',
  'const fixture="HEAD_DRIFT";',
  '// HEAD_DRIFT',
  'assert.equal(1,1);',
]) assert.throws(() => fakeCoverage(snippet), /HEAD_DRIFT: material regression assertion not found/);
assert.throws(()=>fakeCoverage('function ignore(){return 0;}assert.equal(result.code,ignore("HEAD_DRIFT"));'),/HEAD_DRIFT: material regression assertion not found/);
const controlImports='import assert from "node:assert/strict";import {verifyFactoryConsistency,validateEvidenceEnvelope} from "../scripts/factory-recovery-controls.mjs";';
assert.doesNotThrow(() => fakeCoverage(controlImports+'const result=verifyFactoryConsistency(s);assert(result.problems.some(p=>p.code==="HEAD_DRIFT"));'));
assert(assertionTokens(controlImports+'const result=validateEvidenceEnvelope(e);assert(result.errors.some(e=>e.code==="HEAD_DRIFT"));').has('HEAD_DRIFT'));
assert(!assertionTokens('import assert from "node:assert/strict";assert.throws(()=>unknown(input),/HEAD_DRIFT/);').has('HEAD_DRIFT'));
// A69-F3 full-validator negatives: syntax that never tests the guarded value is insufficient.
for(const snippet of [
 'const assert={equal(){}};const result={code:"WRONG"};assert.equal(result.code,"HEAD_DRIFT");',
 controlImports+'function f(assert){const result=verifyFactoryConsistency(s);assert.equal(result.code,"HEAD_DRIFT");}',
 controlImports+'function fixture(){return {code:"HEAD_DRIFT"}}const result=fixture();assert.equal(result.code,"HEAD_DRIFT");',
 controlImports+'function has(){return true;}const result=verifyFactoryConsistency(s);assert(has(result,"HEAD_DRIFT"));',
 controlImports+'const result=verifyFactoryConsistency(s);assert(true || result.code==="HEAD_DRIFT");',
 controlImports+'const result=verifyFactoryConsistency(s);assert(false && result.code==="HEAD_DRIFT");',
 controlImports+'const result=verifyFactoryConsistency(s);assert(unknown() || result.code==="HEAD_DRIFT");',
 controlImports+'const result={code:"HEAD_DRIFT",real:verifyFactoryConsistency(s)};assert.equal(result.code,"HEAD_DRIFT");',
 controlImports+'const result=verifyFactoryConsistency(s);result.code="HEAD_DRIFT";assert.equal(result.code,"HEAD_DRIFT");',
 controlImports+'const alias=assert;alias.equal=()=>{};const result=verifyFactoryConsistency(s);assert.equal(result.code,"HEAD_DRIFT");',
])assert.throws(()=>fakeCoverage(snippet),/HEAD_DRIFT: material regression assertion not found/);
assert.doesNotThrow(()=>fakeCoverage(controlImports+'const check=assert;const result=verifyFactoryConsistency(s);check(result.problems.some(p=>p.code==="HEAD_DRIFT"));'));
for(const snippet of [
 'const valueAliasFixture={code:"HEAD_DRIFT"};const sharedAlias=valueAliasFixture;sharedAlias.code="UNCATALOGED_ALIAS_MUTATION";p(valueAliasFixture.code,"detail");',
 'const valueAliasFixture={code:"HEAD_DRIFT"};const sharedAlias=valueAliasFixture;const second=sharedAlias;second["code"]="UNCATALOGED_ALIAS_MUTATION";p(valueAliasFixture.code,"detail");',
 'const valueAliasFixture={code:"HEAD_DRIFT"};mutate(valueAliasFixture);p(valueAliasFixture.code,"detail");',
 'const valueAliasFixture={code:"HEAD_DRIFT"};delete valueAliasFixture.code;p(valueAliasFixture.code,"detail");',
 'const valueAliasFixture={nested:{code:"HEAD_DRIFT"}};const {nested}=valueAliasFixture;nested.code="UNCATALOGED_ALIAS_MUTATION";p(valueAliasFixture.nested.code,"detail");',
 'const valueAliasFixture={code:"HEAD_DRIFT"};const holder={value:valueAliasFixture};holder.value.code="UNCATALOGED_ALIAS_MUTATION";p(valueAliasFixture.code,"detail");',
]){
 assert.equal(structuredCodes('const p=code=>({code});'+snippet).size,0);
 assert.throws(()=>validateCatalog(catalog,source+'\n'+snippet),/structured factory blocker has mutable or escaped code/);
}
assert.doesNotThrow(()=>validateCatalog(catalog,source+'\nconst values={primary:"HEAD_DRIFT"};const immutableAlias=values;p(immutableAlias.primary,"detail");'));
assert.throws(() => validateCatalog(catalog, source, path => path===tested.regression_test ? `// ${tested.regression_assertion ?? tested.code}\nconst fixture = "${tested.regression_assertion ?? tested.code}";` : readSource(path)), /material regression assertion not found/);
assert.throws(() => validateCatalog(catalog, source, path => path===tested.detection_source ? `// ${tested.code}` : readSource(path)), /coded protection not found/);
assert.throws(() => validateCatalog(mutate(c => { c.entries.find(e=>e.code===tested.code).regression_test='tests/nonexistent-catalog-regression.mjs'; }), source), /source does not exist/);

for(const path of ['%2e%2e/outside','/tmp/outside','https://example.com/file','file:///tmp/outside','../outside','C:/outside','tests/../scripts/factory-recovery-controls.mjs']){
  assert.throws(()=>readSource(path),/catalog paths must be repository-relative/);
}
{
  const outer=mkdtempSync(join(tmpdir(),'factory-confinement-'));
  try{
    const root=join(outer,'repo');const {mkdirSync}=await import('node:fs');mkdirSync(root);
    writeFileSync(join(root,'inside'),'material');writeFileSync(join(outer,'outside'),'external');
    symlinkSync(join(outer,'outside'),join(root,'escape'));
    assert.equal(readFileSync(confinedPath('inside',root),'utf8'),'material');
    assert.throws(()=>confinedPath('escape',root),/catalog path escapes real repository root/);
  }finally{rmSync(outer,{recursive:true,force:true});}
}

const B='1111111111111111111111111111111111111111';
const H='2222222222222222222222222222222222222222';
const O='3333333333333333333333333333333333333333';
const NOW='2026-09-29T20:00:00Z';
const EXP='2026-09-29T20:55:00Z';

{
  const attempts = [1,2,3].map(() => ({gate:'WRITER_VALIDATION',reason_code:'RUNTIME_CAPABILITY_MISSING',fact_fingerprint:'unchanged'}));
  const result = detectRecoveryLoop(attempts);
  assert.equal(result.detected, true);
  assert.equal(result.route.code, 'RECOVERY_LOOP');
  assert.equal(result.route.owner, '00');
}

const env=()=>({
  issue:267,contract_version:2,gate:'WRITER_VALIDATION',branch:'factory/267-post-merge-consistency-semantics-v1',
  base_sha:B,head_sha:H,run_id:123,check_id:456,run_head_sha:H,check_conclusion:'success',
  suites_required:[],suites_executed:[],suites_skipped:[],result:'WRITER_VALIDATION_PASS',
  timestamp:'2026-09-29T20:05:00Z',scope:'blocker-catalog-v1',
});
{
  const e=env(); delete e.issue;
  const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});
  assert(r.errors.some(x=>x.code==='EVIDENCE_FIELD_MISSING'));
  // catalog-probe: EVIDENCE_FIELD_MISSING
}
{
  const e=env(); e.base_sha='not-a-sha';
  const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});
  assert(r.errors.some(x=>x.code==='EVIDENCE_SHA_INVALID'));
  // catalog-probe: EVIDENCE_SHA_INVALID
}
{
  const e=env(); e.timestamp='not-a-date';
  const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});
  assert(r.errors.some(x=>x.code==='EVIDENCE_TIMESTAMP_INVALID'));
  // catalog-probe: EVIDENCE_TIMESTAMP_INVALID
}

const snap=()=>({
  issue:{
    number:267,contract_version:2,state:'IMPLEMENTATION',current_agent:'05',writer:'05',
    active_handoff:'A55',handoff_status:'CLAIMED',claimed_by:'run-1',claim_expires_at:EXP,
    reference_branch:'staging',staging_freshness_sha:B,branch:'factory/267-post-merge-consistency-semantics-v1',
    base_sha:B,head_sha:H,labels:['agent:05','status:claimed'],
  },
  latest_handoff:{id:'A55',status:'CLAIMED',current_agent:'05'},
  winning_claim:{handoff_id:'A55',claimed_by:'run-1',claim_expires_at:EXP},
  refs:{branch:'factory/267-post-merge-consistency-semantics-v1',branch_sha:H,staging_sha:B},
  evidence_policy:'NONE',dependencies:[],lock:{status:'INACTIVE'},write_intent:true,
});
{
  const s=snap(); s.issue.staging_freshness_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});
  assert(r.problems.some(x=>x.code==='STAGING_FRESHNESS_DRIFT'));
  // catalog-probe: STAGING_FRESHNESS_DRIFT
}
{
  const r=validateWriterValidationPreflight({
    workflow_available:true,workflow_name:'Verto Candidate Writer Validation',
    base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:O,
    suites_allowlisted:['none','help-center'],suite:'none',
  });
  assert.equal(r.valid,false);
  assert.equal(r.error.code,'HEAD_DRIFT');
  // catalog-probe: CANDIDATE_BRANCH_MISMATCH
}
{
  const r=validateWriterValidationPreflight({
    workflow_available:true,workflow_name:'Verto Candidate Writer Validation',
    base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,
    suites_allowlisted:['none','help-center'],suite:'factory-blocker-catalog',
  });
  assert.equal(r.valid,false);
  assert.equal(r.error.code,'REQUIRED_SUITE_MISSING');
  // catalog-probe: SUITE_ALLOWLIST_INVALID
}

console.log(`factoryBlockerCatalog.regression.test.mjs: PASS (${catalog.entries.length} entries, ${emitted.size} structured codes)`);
