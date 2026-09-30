import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
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

// Bounded static resolution only: lexical const chains, emitter aliases and literal object members.
// No code execution, mutable-variable inference or general JavaScript interpreter.
function staticResolver(ast) {
  const scopes = new Map(), emitters = new Set(['p','fail','createStructuredFactoryError']);
  const scopeOf = (node) => {
    for (let n=node; n; n=n.parent) if (ts.isSourceFile(n) || ts.isBlock(n) || ts.isFunctionLike(n)) return n;
  };
  const bind = (scope, name, initializer, immutable) => {
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    scopes.get(scope).set(name, {initializer, immutable});
  };
  walk(ast, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bind(scopeOf(node.parent), node.name.text, node.initializer, Boolean(node.parent.flags & ts.NodeFlags.Const));
    if (ts.isFunctionDeclaration(node) && node.name) bind(scopeOf(node.parent), node.name.text, node, true);
    if (ts.isFunctionLike(node)) for (const parameter of node.parameters) if (ts.isIdentifier(parameter.name)) bind(node, parameter.name.text, undefined, false);
  });
  const binding = (node) => {
    for (let n=node; n; n=n.parent) if (scopes.get(n)?.has(node.text)) return scopes.get(n).get(node.text);
  };
  const unparen = (node) => { while (node && ts.isParenthesizedExpression(node)) node=node.expression; return node; };
  const propertyName = (node, seen=new Set()) => ts.isComputedPropertyName(node) ? resolve(node.expression, 'string', seen) : nameOf(node);
  const resolve = (input, kind='string', seen=new Set()) => {
    const node=unparen(input);
    if (!node || seen.has(node)) return undefined;
    const next=new Set(seen); next.add(node);
    if (kind==='string' && ts.isStringLiteralLike(node)) return node.text;
    if (kind==='object' && ts.isObjectLiteralExpression(node)) return node;
    if (ts.isIdentifier(node)) {
      const b=binding(node);
      if (kind==='emitter' && emitters.has(node.text) && (!b || (b.immutable && b.initializer && ts.isFunctionLike(b.initializer)))) return node.text;
      return b?.immutable ? resolve(b.initializer,kind,next) : undefined;
    }
    if (kind==='string' && ts.isBinaryExpression(node) && node.operatorToken.kind===ts.SyntaxKind.PlusToken) {
      const a=resolve(node.left,kind,next), b=resolve(node.right,kind,next);
      return typeof a==='string' && typeof b==='string' ? a+b : undefined;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object=resolve(node.expression,'object',next);
      const key=ts.isPropertyAccessExpression(node) ? node.name.text : resolve(node.argumentExpression,'string',next);
      if (object && typeof key==='string') {
        const property=object.properties.find(p=>p.name && propertyName(p.name,next)===key);
        if (property && ts.isPropertyAssignment(property)) return resolve(property.initializer,kind,next);
        if (property && ts.isShorthandPropertyAssignment(property)) return resolve(property.name,kind,next);
      }
    }
    return undefined;
  };
  const literalOnly = (input, seen=new Set()) => {
    const node=unparen(input);
    if (!node || seen.has(node)) return false;
    const next=new Set(seen); next.add(node);
    if (ts.isLiteralExpression(node) || [ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
    if (ts.isIdentifier(node)) { const b=binding(node); return Boolean(b?.immutable && literalOnly(b.initializer,next)); }
    if (typeof resolve(node)==='string') return true;
    if (ts.isArrayLiteralExpression(node)) return node.elements.every(n=>literalOnly(n,next));
    if (ts.isObjectLiteralExpression(node)) return node.properties.every(p=>ts.isPropertyAssignment(p) && literalOnly(p.initializer,next));
    return false;
  };
  return {value:node=>resolve(node), emitter:node=>resolve(node,'emitter'), object:node=>resolve(node,'object'), propertyName, literalOnly};
}

function structuredCodes(text) {
  const ast=parse(text), codes=new Set(), resolver=staticResolver(ast);
  const add = (node) => { const code=resolver.value(node); if (code && code!=='OBSERVABLE_PROGRESS_AND_CAS_CONFIRMED') codes.add(code); };
  walk(ast, (node) => {
    if (ts.isCallExpression(node)) {
      if (resolver.emitter(node.expression)) add(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text==='has' && nameOf(node.expression.expression)==='codes') add(node.arguments[0]);
    }
    if (ts.isPropertyAssignment(node) && ['code','reason'].includes(resolver.propertyName(node.name))) add(node.initializer);
    if (ts.isShorthandPropertyAssignment(node) && ['code','reason'].includes(nameOf(node.name))) add(node.name);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind===ts.SyntaxKind.EqualsToken) {
      const left=node.left;
      const key=ts.isPropertyAccessExpression(left) ? left.name.text : ts.isElementAccessExpression(left) ? resolver.value(left.argumentExpression) : nameOf(left);
      if (['code','reason'].includes(key)) add(node.right);
    }
    if (ts.isVariableDeclaration(node) && nameOf(node.name)==='ERRORS' && node.initializer) walk(node.initializer, child=> { if (ts.isStringLiteralLike(child) || ts.isIdentifier(child)) add(child); });
    if (ts.isVariableDeclaration(node) && nameOf(node.name)==='routes' && node.initializer) {
      const object=resolver.object(node.initializer);
      if (object) for (const property of object.properties) if (ts.isPropertyAssignment(property)) {
        const code=resolver.propertyName(property.name); if (code) codes.add(code);
      }
    }
  });
  return codes;
}

// Evidence comes from tested operands/predicates or exception matchers, never diagnostic messages.
function assertionTokens(text) {
  const ast=parse(text), tokens=new Set(), resolver=staticResolver(ast);
  const expected = (node) => { if (node) walk(node, child=> {
    const value=resolver.value(child); if (typeof value==='string') tokens.add(value);
    if (ts.isRegularExpressionLiteral(child)) tokens.add(child.text.slice(1,child.text.lastIndexOf('/')));
  }); };
  const pair = (a,b) => {
    if (!a || !b) return;
    if (!resolver.literalOnly(a)) expected(b);
    if (!resolver.literalOnly(b)) expected(a);
  };
  const predicate = (node) => { if (node) walk(node, child=> {
    if (ts.isBinaryExpression(child) && [ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(child.operatorToken.kind)) pair(child.left,child.right);
    if (ts.isCallExpression(child)) {
      if (ts.isPropertyAccessExpression(child.expression) && ['has','includes','test'].includes(child.expression.name.text)) pair(child.expression.expression,child.arguments[0]);
      if (nameOf(child.expression)==='has' && child.arguments.length===2) pair(child.arguments[0],child.arguments[1]);
    }
  }); };
  walk(ast, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee=node.expression;
    if (nameOf(callee)==='assert') { predicate(node.arguments[0]); return; }
    if (!ts.isPropertyAccessExpression(callee) || nameOf(callee.expression)!=='assert') return;
    const method=callee.name.text;
    if (method==='ok') predicate(node.arguments[0]);
    if (['equal','strictEqual','notEqual','notStrictEqual','deepEqual','deepStrictEqual','notDeepEqual','notDeepStrictEqual','match','doesNotMatch'].includes(method)) pair(node.arguments[0],node.arguments[1]);
    if (['throws','rejects'].includes(method)) {
      const matcher=node.arguments[1];
      // In Node assert.throws(fn, string), the second argument is also a message.
      if (matcher && ts.isRegularExpressionLiteral(matcher)) expected(matcher);
      else if (matcher && ts.isObjectLiteralExpression(matcher)) expected(matcher);
      else if (matcher && ts.isFunctionLike(matcher)) predicate(matcher);
    }
  });
  return tokens;
}

const readSource = (path) => {
  assert.equal(typeof path, 'string');
  assert(path.length > 0 && !path.includes('..') && !path.startsWith('/'), 'catalog paths must be repository-relative');
  const url = new URL(`../${path}`, import.meta.url);
  assert(existsSync(url), `catalog source does not exist: ${path}`);
  return readFileSync(url, 'utf8');
};

function validateCatalog(input, controls, read = readSource) {
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
const emitted = structuredCodes(controls);
for (const code of emitted) assert(byCode.has(code), `structured factory blocker missing from catalog: ${code}`);

// Coverage may never claim code/test protection that cannot be located materially.
for (const entry of input.entries) {
  if (entry.coverage_status === 'CODED_AND_TESTED' || entry.coverage_status === 'CODED_NOT_TESTED') {
    assert.equal(typeof entry.detection_source, 'string', `${entry.code}: coded coverage requires detection_source`);
    assert(entry.detection_source.length > 0, `${entry.code}: coded coverage requires detection_source`);
    if (entry.source_kind === 'REGRESSION_GUARD') {
      assert(assertionTokens(read(entry.detection_source)).has(entry.detection_assertion), `${entry.code}: catalog claims nonexistent regression guard`);
    } else {
    const detectionCodes = structuredCodes(read(entry.detection_source));
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
      assert(assertionTokens(regression).has(regressionAssertion), `${entry.code}: material regression assertion not found`);
  }
}
return emitted;
}

const emitted = validateCatalog(catalog, source);

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
assert.deepEqual([...structuredCodes('const A="OUTER_PROBE"; function probe(){const A="INNER_PROBE";const emit=p;emit(A,"detail");}')], ['INNER_PROBE']);
assert.equal(structuredCodes('const A=B;const B=A;p(A,"detail");').size, 0);
assert.equal(structuredCodes('const value={[value.key]:"cycle"};p(value.key,"detail");').size, 0);
assert.equal(structuredCodes('function probe(p){p("PARAMETER_PROBE","detail");}').size, 0);
assert(structuredCodes('const ERRORS = new Set(["ENUM_PROBE"]);').has('ENUM_PROBE'));
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
assert.doesNotThrow(() => fakeCoverage('assert.equal(result.code,"HEAD_DRIFT");'));
assert(assertionTokens('assert(result.errors.some(e=>e.code==="HEAD_DRIFT"));').has('HEAD_DRIFT'));
assert(assertionTokens('assert.throws(()=>validateCatalog(input,controls),/HEAD_DRIFT/);').has('HEAD_DRIFT'));
assert.throws(() => validateCatalog(catalog, source, path => path===tested.regression_test ? `// ${tested.regression_assertion ?? tested.code}\nconst fixture = "${tested.regression_assertion ?? tested.code}";` : readSource(path)), /material regression assertion not found/);
assert.throws(() => validateCatalog(catalog, source, path => path===tested.detection_source ? `// ${tested.code}` : readSource(path)), /coded protection not found/);
assert.throws(() => validateCatalog(mutate(c => { c.entries.find(e=>e.code===tested.code).regression_test='tests/nonexistent-catalog-regression.mjs'; }), source), /source does not exist/);

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
