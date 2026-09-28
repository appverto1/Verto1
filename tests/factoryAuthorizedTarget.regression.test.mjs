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
  issue:{number:267,contract_version:1,current_agent:'05',writer:'05',active_handoff:'A29',handoff_status:'CLAIMED',claimed_by:'run-1',claim_expires_at:EXP,branch:'factory/267-mandatory-preflight-adoption-v1',base_sha:B,head_sha:H,labels:['agent:05','status:claimed']},
  latest_handoff:{id:'A29',status:'CLAIMED',current_agent:'05'},
  winning_claim:{handoff_id:'A29',claimed_by:'run-1',claim_expires_at:EXP},
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

// 1. Normal staging operation remains consistent.
assert.equal(verifyFactoryConsistency(snap(),{now:NOW}).status,'CONSISTENT');

// 2. main target without structured authorization fails closed.
{
  const s=authorized();delete s.authorized_target;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.notEqual(r.status,'CONSISTENT');assert(r.problems.some(x=>x.code==='AUTHORIZED_TARGET_EVIDENCE_MISSING'));
}

// 3. Explicitly authorized main target with factual target base/freshness is consistent.
assert.equal(verifyFactoryConsistency(authorized(),{now:NOW}).status,'CONSISTENT');

// 4. Wrong target base is drift.
{
  const s=authorized();s.issue.target_base_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='TARGET_BASE_DRIFT'));
}

// 5. Stale staging freshness remains drift even for an exceptional target.
{
  const s=authorized();s.issue.staging_freshness_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='STAGING_FRESHNESS_DRIFT'));
}

// 6. Factual target branch divergence is drift.
{
  const s=authorized();s.refs.target_branch='release';
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='TARGET_BRANCH_DRIFT'));
}

// 7. Authorization without factual evidence reference fails closed.
{
  const s=authorized();delete s.authorized_target.evidence_ref;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='AUTHORIZED_TARGET_EVIDENCE_MISSING'));
}

// 8. Effective scope must be a subset of the explicitly authorized scope.
{
  const s=authorized();s.operation_scope.push('src/product.ts');
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='AUTHORIZED_SCOPE_EXCEEDED'));
}

// 9. Candidate must descend from the factual target base.
{
  const s=authorized();s.refs.target_ancestry.is_ancestor=false;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='TARGET_ANCESTRY_INVALID'));
}

// 10. Generic bypass flags are rejected rather than interpreted as authority.
{
  const s=authorized();s.skip_staging_check=true;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='GENERIC_BYPASS_REJECTED'));
}

// 11. Explicit staging semantics do not weaken the normal base==staging rule.
{
  const s=snap();s.issue.reference_branch='staging';s.issue.target_branch='staging';s.issue.staging_freshness_sha=B;
  assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
  s.issue.base_sha=O;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='BASE_STAGING_DRIFT'));
}

// 12. #266 / PR #276 shape is representable without false BASE_STAGING_DRIFT.
{
  const STAGING='bb7228d5ee969d39f5072cbcd4e4ae1b9774d02c';
  const MAIN='d7ca9012b5d66cacc56b0db3e2e047a7d8e68888';
  const CAND='a1b48bcc787f8394623ada10573baa0b5e1a7a20';
  const s=authorized();
  s.issue.number=266;s.issue.branch='factory/266-default-branch-writer-validation-bootstrap-v1';s.issue.base_sha=MAIN;s.issue.head_sha=CAND;s.issue.staging_freshness_sha=STAGING;s.issue.target_base_sha=MAIN;
  s.refs.branch=s.issue.branch;s.refs.branch_sha=CAND;s.refs.staging_sha=STAGING;s.refs.target_branch_sha=MAIN;s.refs.target_ancestry={base_sha:MAIN,candidate_sha:CAND,is_ancestor:true};
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'CONSISTENT');assert(!r.problems.some(x=>x.code==='BASE_STAGING_DRIFT'));
}

// Required exceptional-target fields must fail closed when absent.
for (const field of ['reference_branch','staging_freshness_sha','target_branch','target_base_sha']) {
  const s=authorized();delete s.issue[field];
  const r=verifyFactoryConsistency(s,{now:NOW});assert.notEqual(r.status,'CONSISTENT',`missing ${field} must fail closed`);
}
{
  const s=authorized();delete s.refs.target_ancestry;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='TARGET_ANCESTRY_MISSING'));
}
{
  const s=authorized();delete s.operation_scope;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='OPERATION_SCOPE_MISSING'));
}

console.log('factoryAuthorizedTarget.regression.test.mjs: PASS');
