import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateRecoveryMetadata,evaluateCapabilityProbe,validateCandidateManifest,createStructuredFactoryError,detectRecoveryLoop,evaluateClaimRenewal,routeConsistencyResult,routeStructuredFactoryError,validateEvidenceEnvelope,validateWriterValidationPreflight,verifyFactoryConsistency} from '../scripts/factory-recovery-controls.mjs';
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
 for(const token of ['## 22. Preflight canônico obrigatório','Antes do primeiro side effect','Somente \`CONSISTENT\` autoriza prosseguir','DRIFT','AMBIGUOUS','STALE_CLAIM_SUSPECTED','ORPHAN_LOCK_SUSPECTED','Imediatamente antes do CAS/transição final']) assert(guard.includes(token),`mandatory preflight guardrail missing: ${token}`);
 for(const path of ['../docs/factory/FACTORY_PROTOCOL.md','../.github/VERTO_ENGINEERING_OS.md']){const doc=readFileSync(new URL(path,import.meta.url),'utf8');assert(doc.includes('GUARDRAILS.md §22'));assert(doc.includes('CONSISTENT'));assert(doc.includes('CAS/transição final'));}
 for(const name of ['00-orchestrator.md','01-auditor.md','02-product-ux.md','03-reviewer.md','04-prontuario.md','05-integration.md','06-financeiro.md','07-agenda.md','08-aba.md','09-data.md','10-ci.md','11-pr.md','12-merge.md','13-rollout.md','14-recovery.md']){const doc=readFileSync(new URL('../.github/agents/'+name,import.meta.url),'utf8');assert(doc.includes('GUARDRAILS.md §22'),`agent missing canonical preflight: ${name}`);assert(doc.includes('Somente \`CONSISTENT\`'),`agent weakens CONSISTENT boundary: ${name}`);}
 for(const status of ['DRIFT','AMBIGUOUS','STALE_CLAIM_SUSPECTED','ORPHAN_LOCK_SUSPECTED']){const s=snap();if(status==='DRIFT')s.refs.branch_sha=O;if(status==='AMBIGUOUS')delete s.refs.branch;if(status==='STALE_CLAIM_SUSPECTED'){s.winning_claim.claim_expires_at='2026-09-28T02:59:59Z';s.issue.claim_expires_at='2026-09-28T02:59:59Z';}if(status==='ORPHAN_LOCK_SUSPECTED')s.lock={status:'ACTIVE',owner_issue:null,owner_writer:null};const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,status);const route=routeConsistencyResult(r,{current_agent:'05',writer:'05',gate:'PREFLIGHT'});assert(route.owner);assert(route.unblock_action);assert(route.retry_condition);}
 assert.equal(verifyFactoryConsistency(snap(),{now:NOW}).status,'CONSISTENT');
}


const manifest=()=>({schema_version:'FACTORY_CANDIDATE_MANIFEST_V1',issue:267,contract_version:3,branch:'factory/267-autonomous-recovery-v1',base_sha:B,head_sha:H,tree_sha:O,paths:[{path:'scripts/factory-recovery-controls.mjs',status:'modified',mode:'100644',blob_sha:H}]});
const authorized=['scripts/factory-recovery-controls.mjs'];
{
 const facts=manifest();assert.equal(validateCandidateManifest(facts,facts,authorized).valid,true);
 for(const field of ['head_sha','tree_sha','base_sha']){const changed=structuredClone(facts);changed[field]=facts[field]===B?O:B;const r=validateCandidateManifest(changed,facts,authorized);assert(r.problems.some(x=>x.code==='CANDIDATE_MANIFEST_DRIFT'));}
 const empty=manifest();empty.paths.push({path:'__noop__',status:'added',mode:'100644',blob_sha:'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'});
 assert(validateCandidateManifest(empty,empty,authorized).problems.some(x=>x.code==='CANDIDATE_PATH_UNAUTHORIZED'));
 assert(validateCandidateManifest(undefined,facts,authorized).problems.some(x=>x.code==='CANDIDATE_MANIFEST_MISSING'));
 const bad=manifest();bad.paths.push({...bad.paths[0]});assert(validateCandidateManifest(bad,bad,authorized).problems.some(x=>x.code==='CANDIDATE_MANIFEST_INVALID'));
 const e={...env(),contract_version:3,candidate_manifest:facts};
 assert.equal(validateEvidenceEnvelope(e,{expectedHeadSha:H,manifestFacts:facts,allowedPaths:authorized}).valid,true);
 assert(validateEvidenceEnvelope(e,{expectedHeadSha:H}).errors.some(x=>x.code==='CANDIDATE_MANIFEST_MISSING'));
 const wrong=structuredClone(facts);wrong.tree_sha=B;assert(validateEvidenceEnvelope(e,{expectedHeadSha:H,manifestFacts:wrong,allowedPaths:authorized}).errors.some(x=>x.code==='CANDIDATE_MANIFEST_DRIFT'));
}
{
 assert.equal(evaluateCapabilityProbe({kind:'READ_ONLY',mutates:false}).allowed,true);
 assert.equal(evaluateCapabilityProbe({kind:'ORPHAN_GIT_OBJECT',necessary:true,ref:null,canonical_side_effect:false}).allowed,true);
 for(const kind of ['CANONICAL_REF','ISSUE','CLAIM','LABEL','PR','MERGE','DEPLOY'])assert.equal(evaluateCapabilityProbe({kind,mutates:true}).error.code,'CAPABILITY_PROBE_CANONICAL_MUTATION');
 assert.equal(evaluateCapabilityProbe({kind:'ORPHAN_GIT_OBJECT',necessary:true,ref:'refs/heads/factory/267',canonical_side_effect:true}).allowed,false);
}
{
 const r=routeStructuredFactoryError(createStructuredFactoryError('HEAD_DRIFT',{gate:'REVIEW'}),{current_agent:'03',writer:'05'});
 assert.equal(r.owner,'00');
 const capable=routeStructuredFactoryError(createStructuredFactoryError('HEAD_DRIFT',{gate:'REVIEW'}),{current_agent:'03',writer:'05',material_capabilities:[{role:'14',can_recover_feature_ref:true,evidence_ref:'git-object-transport-proof'}]});
 assert.equal(capable.owner,'14');
 const unknown=routeStructuredFactoryError(createStructuredFactoryError('HEAD_DRIFT'),{current_agent:'03',writer:'05',material_capabilities:[{role:'03',can_recover_feature_ref:true,evidence_ref:'name-only'}]});
 assert.equal(unknown.owner,'00');
}
const recoveryInput=()=>{
 const current=snap();Object.assign(current.issue,{contract_version:3,production:'prohibited',next_gate:'REVIEW'});
 current.refs.branch_sha=O;current.provenance={issue_revision:'rev-1'};
 current.evidence={...env(),gate:'REVIEW',head_sha:H};
 const provenance={timestamp:NOW,evidence_ref:'snapshot:rev-1',snapshot_ref:'snapshot:rev-1',issue_revision:'rev-1',verifier_blob_sha:B};
 const material_capabilities=[{role:'14',can_recover_feature_ref:true,evidence_ref:'transport:git-object-proof'}];
 const context={current_agent:current.issue.current_agent,writer:current.issue.writer,gate:current.issue.next_gate,head_sha:O,material_capabilities};
 const result=verifyFactoryConsistency(current,{now:NOW}),route=routeConsistencyResult(result,context);
 const after=structuredClone(current);
 Object.assign(after.issue,{
   recovery_error:createStructuredFactoryError(route.code,{gate:'REVIEW',head_sha:O,evidence_ref:provenance.evidence_ref,fact_fingerprint:provenance.snapshot_ref}),
   recovery_invalidated_evidence:[H],recovery_owner:route.owner,recovery_unblock_action:route.unblock_action,recovery_retry_condition:route.retry_condition,
   recovery_evidence:{issue:267,contract_version:3,gate:'RECOVERY_METADATA',branch:current.refs.branch,base_sha:B,head_sha:O,result:result.status,timestamp:NOW,scope:'allowlisted recovery metadata only',suites_required:[],suites_executed:[],suites_skipped:[]},
 });
 return {current,expected:structuredClone(current),after,provenance,executor:{role:'05',run_id:'run-1'},material_capabilities};
};
{
 const input=recoveryInput(),r=evaluateRecoveryMetadata(input,{now:NOW});
 assert.equal(r.allowed,true);assert.equal(r.consistency.status,'DRIFT');assert.equal(r.route.owner,'14');
 assert.deepEqual(r.consistency,verifyFactoryConsistency(input.after,{now:NOW}));
 for(const change of [
   i=>{i.after.issue.head_sha=O;},
   i=>{i.after.issue.contract_version=4;},
   i=>{i.after.issue.handoff_status='PENDING';},
   i=>{i.after.issue.claimed_by='other-run';},
   i=>{i.after.issue.claim_expires_at='2026-09-28T04:00:00Z';},
   i=>{i.after.issue.active_handoff='NEW';},
   i=>{i.after.issue.labels=['agent:14','status:pending'];},
   i=>{i.after.issue.production='allowed';},
   i=>{i.after.refs.branch_sha=H;},
   i=>{i.after.lock={status:'INACTIVE',release_gate:'none'};},
   i=>{i.after.code_write=true;},
   i=>{i.after.merge=true;},
   i=>{i.after.deploy=true;},
   i=>{i.after.issue.recovery_evidence.result='RECOVERY_PASS';},
   i=>{i.after.issue.recovery_invalidated_evidence=[O];},
   i=>{i.after.issue.recovery_owner='03';},
   i=>{i.expected.refs.staging_sha=O;},
   i=>{i.executor.run_id='competing-run';},
   i=>{i.provenance.issue_revision='stale';},
   i=>{i.provenance.timestamp='2026-09-28T02:58:00Z';},
   i=>{delete i.provenance.evidence_ref;},
   i=>{delete i.current.refs; i.expected=structuredClone(i.current);},
 ]){
   const bad=recoveryInput();change(bad);const rejected=evaluateRecoveryMetadata(bad,{now:NOW});assert.equal(rejected.allowed,false);assert.equal(rejected.error.code,'RECOVERY_METADATA_REJECTED');
 }
 const active=recoveryInput();active.current.lock={status:'ACTIVE',owner_issue:267,owner_writer:'05',release_gate:'STAGING_VERIFIED',owner_operational_valid:true};active.expected=structuredClone(active.current);active.after.lock=structuredClone(active.current.lock);assert.equal(evaluateRecoveryMetadata(active,{now:NOW}).allowed,true);
 const release=structuredClone(active);release.after.lock.status='INACTIVE';assert.equal(evaluateRecoveryMetadata(release,{now:NOW}).allowed,false);
}

console.log('factoryRecoveryControls.regression.test.mjs: PASS');
