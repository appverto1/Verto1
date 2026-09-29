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

// Parse actual JS syntax: comments, quote style and whitespace cannot hide a new class.
function structuredCodes(text) {
  const ast = parse(text), codes = new Set(), constants = new Map();
  walk(ast, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteralLike(node.initializer)) constants.set(node.name.text, node.initializer.text);
  });
  const value = (node) => node && ts.isStringLiteralLike(node) ? node.text : ts.isIdentifier(node) ? constants.get(node.text) : undefined;
  const add = (node) => { const code = value(node); if (code && code !== 'OBSERVABLE_PROGRESS_AND_CAS_CONFIRMED') codes.add(code); };
  walk(ast, (node) => {
    if (ts.isCallExpression(node)) {
      if (['p','fail','createStructuredFactoryError'].includes(nameOf(node.expression))) add(node.arguments[0]);
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'has' && nameOf(node.expression.expression) === 'codes') add(node.arguments[0]);
    }
    if (ts.isPropertyAssignment(node) && ['code','reason'].includes(nameOf(node.name))) add(node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && nameOf(node.left) === 'code') add(node.right);
    if (ts.isVariableDeclaration(node) && nameOf(node.name) === 'ERRORS') walk(node.initializer, (child) => { if (ts.isStringLiteralLike(child)) add(child); });
    if (ts.isVariableDeclaration(node) && nameOf(node.name) === 'routes' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property)) codes.add(nameOf(property.name));
    }
  });
  return codes;
}

// A token in a comment/fixture is not a material assertion. Only assertion arguments count.
function assertionTokens(text, guardAssertions = false) {
  const ast = parse(text), tokens = new Set();
  walk(ast, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const isAssert = nameOf(callee) === 'assert' || (ts.isPropertyAccessExpression(callee) && nameOf(callee.expression) === 'assert' && !['throws','doesNotThrow'].includes(callee.name.text));
    if (isAssert) for (const arg of node.arguments) walk(arg, (child) => { if (ts.isStringLiteralLike(child)) tokens.add(child.text); });
    // The guard's own negative regressions may cite a direct assertion message, never callback fixture text.
    if (guardAssertions && ts.isPropertyAccessExpression(callee) && nameOf(callee.expression)==='assert' && callee.name.text==='throws') {
      for (const arg of node.arguments) if (ts.isStringLiteralLike(arg)) tokens.add(arg.text);
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
  "BLOCKER_CATALOG_DRIFT"
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
    assert(assertionTokens(regression, entry.source_kind === 'REGRESSION_GUARD').has(regressionAssertion), `${entry.code}: material regression assertion not found`);
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
]) assert.throws(() => validateCatalog(catalog, `${source}\n${addition}`), /structured factory blocker missing from catalog: UNCATALOGED_PROBE/);
assert(structuredCodes('const ERRORS = new Set(["ENUM_PROBE"]);').has('ENUM_PROBE'));
assert.throws(() => validateCatalog(catalog, `${source}\nconst routes = { UNCATALOGED_ROUTE_PROBE: [] };`), /structured factory blocker missing from catalog: UNCATALOGED_ROUTE_PROBE/);
assert(!assertionTokens('assert.throws(() => { const fixture="COMMENT_ONLY"; });').has('COMMENT_ONLY'));
assert(!structuredCodes('// p("COMMENT_ONLY", "not protection")').has('COMMENT_ONLY'));
const tested = catalog.entries.find(e => e.coverage_status==='CODED_AND_TESTED');
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
