import assert from 'node:assert/strict';
import { verifyFactoryConsistency } from '../scripts/factory-recovery-controls.mjs';

const B='1111111111111111111111111111111111111111';
const H='2222222222222222222222222222222222222222';
const O='3333333333333333333333333333333333333333';
const T='4444444444444444444444444444444444444444';
const NOW='2026-09-28T03:00:00Z';
const EXP='2026-09-28T03:55:00Z';
const FLOW_SCOPE=['.github/workflows/candidate-writer-validation.yml'];

const snap=()=>({
  issue:{number:267,contract_version:1,current_agent:'05',writer:'05',active_handoff:'A34',handoff_status:'CLAIMED',claimed_by:'run-1',claim_expires_at:EXP,branch:'factory/267-mandatory-preflight-adoption-v1',base_sha:B,head_sha:H,labels:['agent:05','status:claimed']},
  latest_handoff:{id:'A34',status:'CLAIMED',current_agent:'05'},
  winning_claim:{handoff_id:'A34',claimed_by:'run-1',claim_expires_at:EXP},
  refs:{branch:'factory/267-mandatory-preflight-adoption-v1',branch_sha:H,staging_sha:B},
  evidence_policy:'NONE',dependencies:[],lock:{status:'INACTIVE'},write_intent:true,
});

const authorized=()=>{
  const s=snap();
  s.issue.reference_branch='staging';
  s.issue.staging_freshness_sha=B;
  s.issue.target_branch='main';
  s.issue.target_base_sha=T;
  s.issue.base_sha=T;
  s.refs.target_branch='main';
  s.refs.target_branch_sha=T;
  s.refs.target_ancestry={base_sha:T,candidate_sha:H,is_ancestor:true};
  s.authorized_target={schema_version:'FACTORY_AUTHORIZED_TARGET_V1',authority:'FOUNDER_EXPLICIT',evidence_ref:'issue:266#founder-authorization',target_branch:'main',allowed_scope:[...FLOW_SCOPE]};
  s.operation_scope=[...FLOW_SCOPE];
  return s;
};
const result=(mutate)=>{const s=authorized();mutate?.(s);return verifyFactoryConsistency(s,{now:NOW});};
const has=(r,code)=>r.problems.some(x=>x.code===code);

// 1. Exceptional flow binds canonical base_sha to target_base_sha and remains consistent when equal.
assert.equal(result().status,'CONSISTENT');

// 2. Canonical base_sha divergence from target_base_sha fails closed.
{
  const r=result(s=>{s.issue.base_sha=O;});
  assert.equal(r.status,'DRIFT');assert(has(r,'TARGET_BASE_DRIFT'));
}

// 3. Invalid authorization schema fails closed.
{
  const r=result(s=>{s.authorized_target.schema_version='FACTORY_AUTHORIZED_TARGET_V0';});
  assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_SCHEMA_INVALID'));
}

// 4. Unknown/non-allowlisted authority fails closed.
{
  const r=result(s=>{s.authorized_target.authority='ISSUE_TEXT';});
  assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_AUTHORITY_INVALID'));
}

// 5. Authorization target must match the requested target_branch.
{
  const r=result(s=>{s.authorized_target.target_branch='release';});
  assert.equal(r.status,'DRIFT');assert(has(r,'AUTHORIZED_TARGET_BRANCH_MISMATCH'));
}

// 6. Malformed allowed_scope fails closed.
{
  const r=result(s=>{s.authorized_target.allowed_scope='workflow';});
  assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_SCOPE_INVALID'));
}

// 7. Empty or absent allowed_scope fails closed.
for (const mode of ['empty','missing']) {
  const r=result(s=>{if(mode==='empty')s.authorized_target.allowed_scope=[];else delete s.authorized_target.allowed_scope;});
  assert.notEqual(r.status,'CONSISTENT',`${mode} allowed_scope must fail closed`);assert(has(r,'AUTHORIZED_TARGET_SCOPE_INVALID'));
}

// 8. Factual operation scope cannot exceed the authorized scope.
{
  const r=result(s=>{s.operation_scope.push('src/product.ts');});
  assert.equal(r.status,'DRIFT');assert(has(r,'AUTHORIZED_SCOPE_EXCEEDED'));
}

// 9. target_base_sha must match the factual target ref SHA.
{
  const r=result(s=>{s.refs.target_branch_sha=O;});
  assert.equal(r.status,'DRIFT');assert(has(r,'TARGET_BASE_DRIFT'));
}

// 10. Candidate must descend from target_base_sha.
{
  const r=result(s=>{s.refs.target_ancestry.is_ancestor=false;});
  assert.equal(r.status,'DRIFT');assert(has(r,'TARGET_ANCESTRY_INVALID'));
}

// 11. Ancestry proof must bind both base and candidate exactly.
for (const mismatch of ['base','candidate']) {
  const r=result(s=>{if(mismatch==='base')s.refs.target_ancestry.base_sha=O;else s.refs.target_ancestry.candidate_sha=O;});
  assert.equal(r.status,'DRIFT');assert(has(r,'TARGET_ANCESTRY_DRIFT'));
}

// 12. Required exceptional-target fields fail closed when absent.
for (const field of ['reference_branch','staging_freshness_sha','target_branch','base_sha','target_base_sha']) {
  const r=result(s=>{delete s.issue[field];});
  assert.notEqual(r.status,'CONSISTENT',`missing ${field} must fail closed`);
}
{
  const r=result(s=>{delete s.refs.target_branch;});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_REF_MISSING'));
}
{
  const r=result(s=>{delete s.refs.target_branch_sha;});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_REF_MISSING'));
}
{
  const r=result(s=>{delete s.refs.target_ancestry;});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'TARGET_ANCESTRY_MISSING'));
}
{
  const r=result(s=>{delete s.operation_scope;});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'OPERATION_SCOPE_MISSING'));
}

// 13. Known and bypass-like unknown caller flags are rejected.
for (const key of ['skip_staging_check','bypass_staging_check','allow_arbitrary_target','skip_target_base_binding']) {
  const r=result(s=>{s[key]=true;});
  assert.equal(r.status,'AMBIGUOUS');assert(has(r,'GENERIC_BYPASS_REJECTED'),`${key} must be rejected`);
}

// 14. Factual #266 / PR #276 fixture: canonical base == target base, freshness stays on staging.
{
  const STAGING='bb7228d5ee969d39f5072cbcd4e4ae1b9774d02c';
  const MAIN='d7ca9012b5d66cacc56b0db3e2e047a7d8e68888';
  const CAND='a1b48bcc787f8394623ada10573baa0b5e1a7a20';
  const s=authorized();
  s.issue.number=266;s.issue.branch='factory/266-default-branch-writer-validation-bootstrap-v1';s.issue.base_sha=MAIN;s.issue.head_sha=CAND;s.issue.staging_freshness_sha=STAGING;s.issue.target_base_sha=MAIN;
  s.refs.branch=s.issue.branch;s.refs.branch_sha=CAND;s.refs.staging_sha=STAGING;s.refs.target_branch_sha=MAIN;s.refs.target_ancestry={base_sha:MAIN,candidate_sha:CAND,is_ancestor:true};
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'CONSISTENT');assert(!has(r,'BASE_STAGING_DRIFT'));assert(!has(r,'TARGET_BASE_DRIFT'));
}

// 15. Normal staging path remains unchanged and still requires base == staging.
{
  const s=snap();s.issue.reference_branch='staging';s.issue.target_branch='staging';s.issue.staging_freshness_sha=B;
  assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
  s.issue.base_sha=O;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'BASE_STAGING_DRIFT'));
}

// Preserve prior A29 regressions and A33 edge coverage.
{
  const r=result(s=>{delete s.authorized_target;});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_EVIDENCE_MISSING'));
}
{
  const r=result(s=>{delete s.authorized_target.evidence_ref;});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_EVIDENCE_MISSING'));
}
{
  const r=result(s=>{s.issue.staging_freshness_sha=O;});assert.equal(r.status,'DRIFT');assert(has(r,'STAGING_FRESHNESS_DRIFT'));
}
{
  const r=result(s=>{s.issue.target_base_sha=O;});assert.equal(r.status,'DRIFT');assert(has(r,'TARGET_BASE_DRIFT'));
}
{
  const r=result(s=>{s.refs.target_branch='release';});assert.equal(r.status,'DRIFT');assert(has(r,'TARGET_BRANCH_DRIFT'));
}
{
  const r=result(s=>{s.refs.target_branch_sha='not-a-sha';});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'AUTHORIZED_TARGET_REF_MISSING'));
}
{
  const r=result(s=>{s.operation_scope=[];});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'OPERATION_SCOPE_MISSING'));
}

console.log('factoryAuthorizedTarget.regression.test.mjs: PASS');
