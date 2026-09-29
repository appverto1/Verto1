import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {
  validateEvidenceEnvelope,
  validateWriterValidationPreflight,
  verifyFactoryConsistency,
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

const byCode = new Map();
for (const entry of catalog.entries) {
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
  "WRITER_VALIDATION_RUNNER_UNAVAILABLE_IN_CURRENT_RUNTIME"
];
for (const code of mandatory) assert(byCode.has(code), `mandatory blocker missing from catalog: ${code}`);

// Deterministic anti-drift: these are the structured blocker/liveness literals the controls emit/use.
const patterns = [
  /\bp\('([A-Z][A-Z0-9_]+)'/g,
  /\{code:'([A-Z][A-Z0-9_]+)'/g,
  /\breturn fail\('([A-Z][A-Z0-9_]+)'/g,
  /createStructuredFactoryError\('([A-Z][A-Z0-9_]+)'/g,
  /\bcode='([A-Z][A-Z0-9_]+)'/g,
  /\breason:'([A-Z][A-Z0-9_]+)'/g,
];
const emitted = new Set();
for (const pattern of patterns) {
  for (const match of source.matchAll(pattern)) emitted.add(match[1]);
}
emitted.delete('OBSERVABLE_PROGRESS_AND_CAS_CONFIRMED');
for (const code of emitted) assert(byCode.has(code), `structured factory blocker missing from catalog: ${code}`);

// Coverage may never claim code/test protection that cannot be located materially.
for (const entry of catalog.entries) {
  if (entry.coverage_status === 'CODED_AND_TESTED' || entry.coverage_status === 'CODED_NOT_TESTED') {
    assert.equal(typeof entry.detection_source, 'string', `${entry.code}: coded coverage requires detection_source`);
    assert(entry.detection_source.length > 0, `${entry.code}: coded coverage requires detection_source`);
    const detectionUrl = new URL(`../${entry.detection_source}`, import.meta.url);
    assert(existsSync(detectionUrl), `${entry.code}: detection source does not exist: ${entry.detection_source}`);
    const detectionSource = readFileSync(detectionUrl, 'utf8');
    const detectionAssertion = entry.detection_assertion ?? entry.code;
    assert.equal(typeof detectionAssertion, 'string', `${entry.code}: coded coverage requires a detection assertion`);
    assert(detectionAssertion.length > 0, `${entry.code}: coded coverage requires a detection assertion`);
    assert(detectionSource.includes(detectionAssertion), `${entry.code}: catalog claims coded protection not found in source`);
  }
  if (entry.coverage_status === 'CODED_AND_TESTED') {
    assert.equal(typeof entry.regression_test, 'string', `${entry.code}: CODED_AND_TESTED requires regression_test`);
    assert(entry.regression_test.length > 0, `${entry.code}: CODED_AND_TESTED requires regression_test`);
    const testUrl = new URL(`../${entry.regression_test}`, import.meta.url);
    assert(existsSync(testUrl), `${entry.code}: regression test does not exist: ${entry.regression_test}`);
    const regression = readFileSync(testUrl, 'utf8');
    const regressionAssertion = entry.regression_assertion ?? entry.code;
    assert.equal(typeof regressionAssertion, 'string', `${entry.code}: CODED_AND_TESTED requires a regression assertion`);
    assert(regressionAssertion.length > 0, `${entry.code}: CODED_AND_TESTED requires a regression assertion`);
    assert(regression.includes(regressionAssertion), `${entry.code}: declared regression assertion not found`);
  }
}

const B='1111111111111111111111111111111111111111';
const H='2222222222222222222222222222222222222222';
const O='3333333333333333333333333333333333333333';
const NOW='2026-09-29T20:00:00Z';
const EXP='2026-09-29T20:55:00Z';

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
