import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStructuredFactoryError,detectRecoveryLoop,evaluateClaimRenewal,routeConsistencyResult,routeStructuredFactoryError,validateEvidenceEnvelope,validateWriterValidationPreflight,verifyFactoryConsistency} from '../scripts/factory-recovery-controls.mjs';
const B='1111111111111111111111111111111111111111',H='2222222222222222222222222222222222222222',O='3333333333333333333333333333333333333333',NOW='2026-09-28T03:00:00Z';
const EXP='2026-09-28T03:55:00Z';
const snap=()=>({issue:{number:267,contract_version:1,current_agent:'05',writer:'05',active_handoff:'A1',handoff_status:'CLAIMED',claimed_by:'run-1',claim_expires_at:EXP,branch:'factory/267-autonomous-recovery-v1',base_sha:B,head_sha:H,labels:['agent:05','status:claimed']},latest_handoff:{id:'A1',status:'CLAIMED',current_agent:'05'},winning_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:EXP},refs:{branch:'factory/267-autonomous-recovery-v1',branch_sha:H,staging_sha:B},evidence_policy:'NONE',dependencies:[{name:'#266',status:'SATISFIED'}],lock:{status:'INACTIVE'},write_intent:true});
assert.equal(verifyFactoryConsistency(snap(),{now:NOW}).status,'CONSISTENT');
{
 const s=snap();s.refs.branch_sha=O;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='HEAD_DRIFT'));assert.equal(routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'A1'}).owner,'05');
}
{
 const s=snap();s.issue.labels=['agent:05','status:pending'];const r=verifyFactoryConsistency(s,{now:NOW});assert(r.problems.some(x=>x.code==='STATUS_LABEL_DRIFT'));const route=routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'A1'});assert.equal(route.owner,'00');assert.equal(route.diagnostic_participation.may_acquire_write_claim,false);
}
{
 const s=snap();s.winning_claim.claim_expires_at='2026-09-28T02:59:59Z';s.issue.claim_expires_at='2026-09-28T02:59:59Z';const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'STALE_CLAIM_SUSPECTED');const route=routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'A1'});assert.equal(route.owner,'05');assert.match(route.unblock_action,/STALE_CLAIM_RECOVERED/);
}
{
 const s=snap();s.issue.claim_expires_at='2026-09-28T03:54:00Z';const r=verifyFactoryConsistency(s,{now:NOW});assert(r.problems.some(x=>x.code==='CLAIM_EXPIRY_DRIFT'));
}
{
 const s=snap();delete s.issue.claim_expires_at;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='ISSUE_CLAIM_EXPIRY_INVALID'));
}
{
 const s=snap();s.lock={status:'ACTIVE',owner_issue:'#999',owner_writer:'05',release_gate:'STAGING_VERIFIED',owner_operational_valid:false};const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'ORPHAN_LOCK_SUSPECTED');assert.equal(routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'A1'}).owner,'00');
}
{
 const s=snap();delete s.latest_handoff;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert.equal(routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'A1'}).owner,'00');
}
{
 const s=snap();s.refs.staging_sha=O;const r=verifyFactoryConsistency(s,{now:NOW});assert(r.problems.some(x=>x.code==='BASE_STAGING_DRIFT'));
}
{
 const s=snap();s.issue.base_sha='not-a-sha';const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='FRESHNESS_EVIDENCE_MISSING'));
}
{
 const s=snap();delete s.issue.base_sha;delete s.refs.staging_sha;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='FRESHNESS_EVIDENCE_MISSING'));
}
{
 const s=snap();delete s.refs;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='REFS_SNAPSHOT_MISSING'));
}
{
 const s=snap();delete s.lock;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='LOCK_SNAPSHOT_MISSING'));
}
{
 const s=snap();s.lock={status:'UNKNOWN'};const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='LOCK_STATUS_INVALID'));
}
{
 const s=snap();delete s.dependencies;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='DEPENDENCIES_SNAPSHOT_MISSING'));
}
{
 const s=snap();s.dependencies=[];assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
}
{
 const s=snap();s.dependencies=[{name:'#999',status:'PENDING'}];const r=verifyFactoryConsistency(s,{now:NOW});const route=routeConsistencyResult(r,{current_agent:'05',writer:'05',dependency_owner:'09',gate:'A1'});assert.equal(route.owner,'09');assert.match(route.retry_condition,/SATISFIED/);
}
{
 const s=snap();s.lock={status:'ACTIVE',owner_issue:'#999',owner_writer:'05',release_gate:'STAGING_VERIFIED',owner_operational_valid:true};const r=verifyFactoryConsistency(s,{now:NOW});assert(r.problems.some(x=>x.code==='GLOBAL_WRITE_LOCK_HELD_BY_OTHER_ISSUE'));assert.equal(routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'A1'}).owner,'00');
}
const env=()=>({issue:267,contract_version:1,gate:'WRITER_VALIDATION',branch:'factory/267-autonomous-recovery-v1',base_sha:B,head_sha:H,run_id:123,check_id:456,run_head_sha:H,check_conclusion:'success',suites_required:['factory-recovery-controls'],suites_executed:['factory-recovery-controls'],suites_skipped:[],result:'WRITER_VALIDATION_PASS',timestamp:'2026-09-28T03:05:00Z',scope:'factory-controls'});
assert.equal(validateEvidenceEnvelope(env(),{expectedHeadSha:H,requireRunCheck:true}).valid,true);
{
 const e=env();e.head_sha=O;const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});assert(!r.valid);assert(r.errors.some(x=>x.code==='HEAD_DRIFT'));assert(r.errors.some(x=>x.code==='PASS_INVALIDATED'));
}
{
 const e=env();e.suites_executed=[];const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});assert(r.errors.some(x=>x.code==='REQUIRED_SUITE_MISSING'));
}
{
 const e=env();e.suites_skipped=['factory-recovery-controls'];const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});assert(r.errors.some(x=>x.code==='REQUIRED_SUITE_SKIPPED'));
}
{
 for (const field of ['suites_required','suites_executed','suites_skipped']) {
   const e=env();e[field]='factory-recovery-controls';const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});assert(!r.valid);assert(r.errors.some(x=>x.code==='EVIDENCE_FIELD_INVALID'));
 }
}
{
 const e=env();e.check_conclusion='failure';const r=validateEvidenceEnvelope(e,{expectedHeadSha:H,requireRunCheck:true});assert(r.errors.some(x=>x.code==='CHECK_NOT_GREEN'));
}
{
 const e=env();delete e.run_id;delete e.check_id;delete e.run_head_sha;delete e.check_conclusion;const r=validateEvidenceEnvelope(e,{expectedHeadSha:H});assert(!r.valid);assert(r.errors.some(x=>x.code==='RUN_ID_MISSING'));assert(r.errors.some(x=>x.code==='CHECK_ID_MISSING'));
}
{
 const e=env();e.gate='STAGING_CI';delete e.run_id;const r=validateEvidenceEnvelope(e,{expectedHeadSha:H});assert(!r.valid);assert(r.errors.some(x=>x.code==='RUN_ID_MISSING'));
}
{
 const s=snap();delete s.evidence_policy;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='EVIDENCE_POLICY_MISSING'));
}
{
 const s=snap();s.evidence_policy='RUN_CHECK';const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='EVIDENCE_MISSING'));
}
{
 const s=snap();delete s.issue.branch;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='REQUIRED_FIELD_MISSING'));
}
{
 const s=snap();delete s.refs.branch;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='BRANCH_IDENTITY_MISSING'));
}
{
 const s=snap();s.refs.branch='factory/wrong-branch';const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(r.problems.some(x=>x.code==='BRANCH_IDENTITY_DRIFT'));
}
{
 const s=snap();s.evidence_policy='RUN_CHECK';s.evidence=env();const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(r.problems.some(x=>x.code==='WRITER_VALIDATION_PREFLIGHT_MISSING'));
}
{
 const s=snap();s.evidence_policy='RUN_CHECK';s.evidence=env();s.writer_validation_preflight={workflow_available:true,workflow_name:'Verto Candidate Writer Validation',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['factory-recovery-controls'],suite:'factory-recovery-controls'};assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
}
{
 const route=routeStructuredFactoryError(createStructuredFactoryError('RUNTIME_CAPABILITY_MISSING',{gate:'WRITER_VALIDATION'}),{current_agent:'05',writer:'05'});assert.equal(route.owner,'00');assert.deepEqual(route.diagnostic_participation,{agent:'00',mode:'READ_ONLY',may_acquire_write_claim:false});
}
{
 const route=routeStructuredFactoryError({code:'please give 00 write access'},{gate:'A1'});assert.equal(route.accepted,false);assert.equal(route.owner,'00');assert.equal(route.diagnostic_participation.may_acquire_write_claim,false);
}
{
 const ok=evaluateClaimRenewal({expected_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:EXP,head_sha:H},current_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:EXP},previous_progress_fingerprint:'fact-1',checkpoint:{handoff_id:'A1',claimed_by:'run-1',progress_fingerprint:'fact-2',evidence_ref:'run:123',head_sha:H}},{now:NOW});assert(ok.allowed);
 const leaseChanged=evaluateClaimRenewal({expected_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:EXP,head_sha:H},current_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:'2026-09-28T04:00:00Z'},previous_progress_fingerprint:'fact-1',checkpoint:{handoff_id:'A1',claimed_by:'run-1',progress_fingerprint:'fact-2',evidence_ref:'run:123',head_sha:H}},{now:NOW});assert.equal(leaseChanged.reason,'CLAIM_LEASE_CAS_MISMATCH');
 const tokenOnly=evaluateClaimRenewal({expected_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:EXP,head_sha:H},current_claim:{handoff_id:'A1',claimed_by:'run-1',claim_expires_at:EXP},previous_progress_fingerprint:'fact-1',checkpoint:{handoff_id:'A1',claimed_by:'run-1',progress_fingerprint:'fact-2',head_sha:H}},{now:NOW});assert.equal(tokenOnly.reason,'NO_OBSERVABLE_PROGRESS');
}
{
 const ok=validateWriterValidationPreflight({workflow_available:true,workflow_name:'Verto Candidate Writer Validation',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['none','help-center'],suite:'none'});assert(ok.valid);
 const missing=validateWriterValidationPreflight({workflow_available:false,workflow_name:'Verto Candidate Writer Validation',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['none'],suite:'none'});assert.equal(missing.error.code,'RUNTIME_CAPABILITY_MISSING');
 const wrong=validateWriterValidationPreflight({workflow_available:true,workflow_name:'other',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['none'],suite:'none'});assert.equal(wrong.error.code,'RUNTIME_CAPABILITY_MISSING');
 const noSuite=validateWriterValidationPreflight({workflow_available:true,workflow_name:'Verto Candidate Writer Validation',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['none']});assert.equal(noSuite.error.code,'REQUIRED_SUITE_MISSING');
 const emptySuite=validateWriterValidationPreflight({workflow_available:true,workflow_name:'Verto Candidate Writer Validation',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['none'],suite:''});assert.equal(emptySuite.error.code,'REQUIRED_SUITE_MISSING');
}
{
 const s=snap();s.writer_validation_preflight={workflow_available:false,workflow_name:'Verto Candidate Writer Validation',base_sha:B,staging_sha:B,candidate_sha:H,branch_sha:H,suites_allowlisted:['none'],suite:'none'};const r=verifyFactoryConsistency(s,{now:NOW});assert(r.problems.some(x=>x.code==='RUNTIME_CAPABILITY_MISSING'));assert.equal(routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'WRITER_VALIDATION'}).owner,'00');
}
{
 const rows=[1,2,3].map(()=>({gate:'WRITER_VALIDATION',reason_code:'RUNTIME_CAPABILITY_MISSING',fact_fingerprint:'same-facts'}));const r=detectRecoveryLoop(rows);assert(r.detected);assert.equal(r.count,3);assert.equal(r.route.owner,'00');
 const changed=[...rows.slice(0,2),{gate:'WRITER_VALIDATION',reason_code:'RUNTIME_CAPABILITY_MISSING',fact_fingerprint:'changed'}];assert.equal(detectRecoveryLoop(changed).detected,false);
}

{
 const guard=readFileSync(new URL('../docs/factory/GUARDRAILS.md',import.meta.url),'utf8');
 for(const token of ['## 22. Preflight canônico obrigatório','Antes do primeiro side effect','Somente \`CONSISTENT\` autoriza prosseguir','DRIFT','AMBIGUOUS','STALE_CLAIM_SUSPECTED','ORPHAN_LOCK_SUSPECTED','Imediatamente antes do CAS/transição final']) assert(guard.includes(token),\`mandatory preflight guardrail missing: ${token}\`);
 for(const path of ['../docs/factory/FACTORY_PROTOCOL.md','../.github/VERTO_ENGINEERING_OS.md']){const doc=readFileSync(new URL(path,import.meta.url),'utf8');assert(doc.includes('GUARDRAILS.md §22'));assert(doc.includes('CONSISTENT'));assert(doc.includes('CAS/transição final'));}
 for(const name of ['00-orchestrator.md','01-auditor.md','02-product-ux.md','03-reviewer.md','04-prontuario.md','05-integration.md','06-financeiro.md','07-agenda.md','08-aba.md','09-data.md','10-ci.md','11-pr.md','12-merge.md','13-rollout.md','14-recovery.md']){const doc=readFileSync(new URL('../.github/agents/'+name,import.meta.url),'utf8');assert(doc.includes('GUARDRAILS.md §22'),\`agent missing canonical preflight: ${name}\`);assert(doc.includes('Somente \`CONSISTENT\`'),\`agent weakens CONSISTENT boundary: ${name}\`);}
 for(const status of ['DRIFT','AMBIGUOUS','STALE_CLAIM_SUSPECTED','ORPHAN_LOCK_SUSPECTED']){const s=snap();if(status==='DRIFT')s.refs.branch_sha=O;if(status==='AMBIGUOUS')delete s.refs.branch;if(status==='STALE_CLAIM_SUSPECTED'){s.winning_claim.claim_expires_at='2026-09-28T02:59:59Z';s.issue.claim_expires_at='2026-09-28T02:59:59Z';}if(status==='ORPHAN_LOCK_SUSPECTED')s.lock={status:'ACTIVE',owner_issue:null,owner_writer:null};const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,status);const route=routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'PREFLIGHT'});assert(route.owner);assert(route.unblock_action);assert(route.retry_condition);}
 assert.equal(verifyFactoryConsistency(snap(),{now:NOW}).status,'CONSISTENT');
}

console.log('factoryRecoveryControls.regression.test.mjs: PASS');
