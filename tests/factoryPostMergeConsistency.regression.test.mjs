import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {routeConsistencyResult,verifyFactoryConsistency} from '../scripts/factory-recovery-controls.mjs';

const B='1111111111111111111111111111111111111111';
const H='2222222222222222222222222222222222222222';
const M='3333333333333333333333333333333333333333';
const O='4444444444444444444444444444444444444444';
const T='5555555555555555555555555555555555555555';
const NOW='2026-09-28T20:30:00Z';
const EXP='2026-09-28T21:20:00Z';
const BRANCH='factory/267-post-merge-consistency-semantics-v1';
const has=(r,code)=>r.problems.some(x=>x.code===code);

const normal=()=>({
  issue:{number:267,contract_version:1,current_agent:'05',writer:'05',active_handoff:'A41',handoff_status:'CLAIMED',claimed_by:'run-1',claim_expires_at:EXP,reference_branch:'staging',branch:BRANCH,base_sha:B,staging_freshness_sha:B,head_sha:H,labels:['agent:05','status:claimed']},
  latest_handoff:{id:'A41',status:'CLAIMED',current_agent:'05'},
  winning_claim:{handoff_id:'A41',claimed_by:'run-1',claim_expires_at:EXP},
  refs:{branch:BRANCH,branch_sha:H,staging_sha:B},
  evidence_policy:'NONE',dependencies:[],lock:{status:'INACTIVE'},write_intent:true,
});
const gateEvidence=(gate,result,{automated=false,base=B,head=H}={})=>{
  const e={issue:267,contract_version:1,gate,branch:'factory/267-mandatory-preflight-adoption-v1',base_sha:base,head_sha:head,suites_required:automated?['required-gate']:[],suites_executed:automated?['required-gate']:[],suites_skipped:[],result,timestamp:'2026-09-28T19:30:00Z',scope:'post-merge-proof'};
  if(automated)Object.assign(e,{run_id:123,check_id:456,run_head_sha:head,check_conclusion:'success'});
  return e;
};
const postMerge=()=>{
  const s=normal();
  s.issue.base_sha=B;
  s.issue.staging_freshness_sha=M;
  s.issue.post_merge_subject_pr=277;
  s.issue.post_merge_subject_base_sha=B;
  s.issue.post_merge_subject_head_sha=H;
  s.issue.post_merge_subject_merge_sha=M;
  s.refs.staging_sha=M;
  s.refs.post_merge_proof={schema_version:'FACTORY_POST_MERGE_PROOF_V1',pr_number:277,merged:true,merge_sha:M,parents:[B,H],base_ancestry:{ancestor_sha:B,descendant_sha:M,is_ancestor:true},candidate_ancestry:{ancestor_sha:H,descendant_sha:M,is_ancestor:true}};
  s.post_merge_evidence={
    writer_validation:gateEvidence('WRITER_VALIDATION','WRITER_VALIDATION_PASS',{automated:true}),
    staging_ci:gateEvidence('STAGING_CI','CI_PASS',{automated:true}),
    review:gateEvidence('REVIEW','REVIEW_PASS'),
    audit:gateEvidence('AUDIT','AUDIT_PASS_POS'),
  };
  return s;
};

// 1. Normal/pré-merge continua exigindo base == staging.
assert.equal(verifyFactoryConsistency(normal(),{now:NOW}).status,'CONSISTENT');

// 2. Staging muda sem merge factual: DRIFT.
{
  const s=normal();s.refs.staging_sha=O;s.issue.staging_freshness_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'BASE_STAGING_DRIFT'));
}

// 3/4. Merge factual completo permite base histórica != staging atual somente com prova estrutural.
{
  const s=postMerge();const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'CONSISTENT');assert(!has(r,'BASE_STAGING_DRIFT'));
  delete s.refs.post_merge_proof;const noProof=verifyFactoryConsistency(s,{now:NOW});assert.notEqual(noProof.status,'CONSISTENT');assert(has(noProof,'POST_MERGE_PROOF_MISSING'));assert(has(noProof,'BASE_STAGING_DRIFT'));
}

// 5. staging != merge_sha provado falha.
{
  const s=postMerge();s.refs.staging_sha=O;s.issue.staging_freshness_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.notEqual(r.status,'CONSISTENT');assert(has(r,'POST_MERGE_STAGING_DRIFT'));
}

// 6. O merge precisa conter o exact candidate e provar ancestry.
{
  const s=postMerge();s.refs.post_merge_proof.parents=[B,O];
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'POST_MERGE_CANDIDATE_ANCESTRY_INVALID'));
}
{
  const s=postMerge();delete s.refs.post_merge_proof.candidate_ancestry;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'POST_MERGE_ANCESTRY_MISSING'));
}

// 7. Base histórica adulterada/incompatível falha.
{
  const s=postMerge();s.issue.post_merge_subject_base_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.notEqual(r.status,'CONSISTENT');assert(has(r,'POST_MERGE_BASE_ANCESTRY_INVALID')||has(r,'POST_MERGE_ANCESTRY_DRIFT'));
}

// 8. merge_sha fabricado ou divergente entre fontes falha.
{
  const s=postMerge();s.refs.post_merge_proof.merge_sha=O;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'POST_MERGE_MERGE_SHA_DRIFT'));assert(has(r,'POST_MERGE_STAGING_DRIFT'));
}

// 9. Flag caller-controlled de pós-merge nunca é autoridade/bypass.
for(const key of ['post_merge','post_merge_mode','is_post_merge','allow_post_merge','post_merge_override']){
  const s=postMerge();s[key]=true;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'GENERIC_BYPASS_REJECTED'),`${key} must fail closed`);
}

// 10. PR divergente ou merge não factual falham.
{
  const s=postMerge();s.refs.post_merge_proof.pr_number=276;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'POST_MERGE_PR_DRIFT'));
}
{
  const s=postMerge();s.refs.post_merge_proof.merged=false;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'POST_MERGE_NOT_FACTUAL'));
}

// 11. Evidence Envelope deve pertencer ao exact candidate/base e aos gates aprovados.
{
  const s=postMerge();s.post_merge_evidence.review.head_sha=O;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'DRIFT');assert(has(r,'POST_MERGE_EVIDENCE_STALE'));
}
{
  const s=postMerge();delete s.post_merge_evidence.audit;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'POST_MERGE_EVIDENCE_MISSING'));
}
{
  const s=postMerge();delete s.issue.post_merge_subject_merge_sha;const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'AMBIGUOUS');assert(has(r,'POST_MERGE_FIELD_MISSING'));
}

// 12. Authorized-target semantics permanecem intactas, inclusive fixture factual #266/PR #276.
{
  const s=normal();s.issue.reference_branch='staging';s.issue.target_branch='main';s.issue.staging_freshness_sha=B;s.issue.target_base_sha=T;s.issue.base_sha=T;
  s.refs.target_branch='main';s.refs.target_branch_sha=T;s.refs.target_ancestry={base_sha:T,candidate_sha:H,is_ancestor:true};
  s.authorized_target={schema_version:'FACTORY_AUTHORIZED_TARGET_V1',authority:'FOUNDER_EXPLICIT',evidence_ref:'issue:266#founder-authorization',target_branch:'main',allowed_scope:['.github/workflows/candidate-writer-validation.yml']};
  s.operation_scope=['.github/workflows/candidate-writer-validation.yml'];
  assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
  s.refs.target_branch_sha=O;const drift=verifyFactoryConsistency(s,{now:NOW});assert.equal(drift.status,'DRIFT');assert(has(drift,'TARGET_BASE_DRIFT'));
}
{
  const STAGING='bb7228d5ee969d39f5072cbcd4e4ae1b9774d02c',MAIN='d7ca9012b5d66cacc56b0db3e2e047a7d8e68888',CAND='a1b48bcc787f8394623ada10573baa0b5e1a7a20';
  const s=normal();s.issue.number=266;s.issue.branch='factory/266-default-branch-writer-validation-bootstrap-v1';s.issue.reference_branch='staging';s.issue.target_branch='main';s.issue.base_sha=MAIN;s.issue.head_sha=CAND;s.issue.staging_freshness_sha=STAGING;s.issue.target_base_sha=MAIN;
  s.refs.branch=s.issue.branch;s.refs.branch_sha=CAND;s.refs.staging_sha=STAGING;s.refs.target_branch='main';s.refs.target_branch_sha=MAIN;s.refs.target_ancestry={base_sha:MAIN,candidate_sha:CAND,is_ancestor:true};
  s.authorized_target={schema_version:'FACTORY_AUTHORIZED_TARGET_V1',authority:'FOUNDER_EXPLICIT',evidence_ref:'issue:266#founder-authorization',target_branch:'main',allowed_scope:['.github/workflows/candidate-writer-validation.yml']};s.operation_scope=['.github/workflows/candidate-writer-validation.yml'];
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'CONSISTENT');assert(!has(r,'BASE_STAGING_DRIFT'));assert(!has(r,'TARGET_BASE_DRIFT'));
}

// 13. Mandatory preflight 00–14 continua obrigatório por anti-removal regression.
{
  const guard=readFileSync(new URL('../docs/factory/GUARDRAILS.md',import.meta.url),'utf8');
  for(const token of ['## 22. Preflight canônico obrigatório','Antes do primeiro side effect','Somente `CONSISTENT` autoriza prosseguir','DRIFT','AMBIGUOUS','STALE_CLAIM_SUSPECTED','ORPHAN_LOCK_SUSPECTED','Imediatamente antes do CAS/transição final'])assert(guard.includes(token),`mandatory preflight guardrail missing: ${token}`);
  for(const name of ['00-orchestrator.md','01-auditor.md','02-product-ux.md','03-reviewer.md','04-prontuario.md','05-integration.md','06-financeiro.md','07-agenda.md','08-aba.md','09-data.md','10-ci.md','11-pr.md','12-merge.md','13-rollout.md','14-recovery.md']){const doc=readFileSync(new URL('../.github/agents/'+name,import.meta.url),'utf8');assert(doc.includes('GUARDRAILS.md §22'));assert(doc.includes('Somente `CONSISTENT`'));}
}

// 14. DRIFT/AMBIGUOUS/stale claim/orphan lock/recovery routing continuam intactos.
{
  const drift=normal();drift.refs.branch_sha=O;const dr=verifyFactoryConsistency(drift,{now:NOW});assert.equal(dr.status,'DRIFT');assert.equal(routeConsistencyResult(dr,{current_agent:'05',writer:'05',gate:'A41'}).owner,'05');
  const ambiguous=normal();delete ambiguous.refs.branch;assert.equal(verifyFactoryConsistency(ambiguous,{now:NOW}).status,'AMBIGUOUS');
  const stale=normal();stale.issue.claim_expires_at='2026-09-28T20:29:00Z';stale.winning_claim.claim_expires_at='2026-09-28T20:29:00Z';assert.equal(verifyFactoryConsistency(stale,{now:NOW}).status,'STALE_CLAIM_SUSPECTED');
  const orphan=normal();orphan.lock={status:'ACTIVE',owner_issue:null,owner_writer:null};assert.equal(verifyFactoryConsistency(orphan,{now:NOW}).status,'ORPHAN_LOCK_SUSPECTED');
}

// 15. Novo ciclo: base factual atual == merge anterior; provenance histórica separada não força modo pós-merge.
{
  const s=normal();s.issue.base_sha=M;s.issue.staging_freshness_sha=M;s.refs.staging_sha=M;
  s.issue.post_merge_subject_pr=277;s.issue.post_merge_subject_base_sha=B;s.issue.post_merge_subject_head_sha=H;s.issue.post_merge_subject_merge_sha=M;
  delete s.refs.post_merge_proof;delete s.post_merge_evidence;
  const r=verifyFactoryConsistency(s,{now:NOW});assert.equal(r.status,'CONSISTENT');assert(!has(r,'POST_MERGE_PROOF_MISSING'));
}


// 16. Terminal current_agent:none representa ausência de agente operacional; labels agent:* continuam fail-closed.
{
  const terminal=postMerge();
  Object.assign(terminal.issue,{state:'DONE',current_agent:'none',active_handoff:'none',handoff_status:'DONE',claimed_by:'none',claim_expires_at:'none',labels:['status:done']});
  terminal.latest_handoff={id:'none',status:'DONE',current_agent:'none'};
  terminal.winning_claim=null;
  assert.equal(verifyFactoryConsistency(terminal,{now:NOW}).status,'CONSISTENT');

  const staleAgent=structuredClone(terminal);staleAgent.issue.labels=['status:done','agent:00'];
  const staleResult=verifyFactoryConsistency(staleAgent,{now:NOW});assert.equal(staleResult.status,'DRIFT');assert(has(staleResult,'AGENT_LABEL_DRIFT'));

  const syntheticNone=structuredClone(terminal);syntheticNone.issue.labels=['status:done','agent:none'];
  const syntheticResult=verifyFactoryConsistency(syntheticNone,{now:NOW});assert.equal(syntheticResult.status,'DRIFT');assert(has(syntheticResult,'AGENT_LABEL_DRIFT'));

  const nonTerminal=structuredClone(terminal);nonTerminal.issue.state='IMPLEMENTATION';
  const nonTerminalResult=verifyFactoryConsistency(nonTerminal,{now:NOW});assert.equal(nonTerminalResult.status,'DRIFT');assert(has(nonTerminalResult,'AGENT_LABEL_DRIFT'));
}
{
  const missingAgent=normal();missingAgent.issue.labels=['status:claimed'];
  const missingResult=verifyFactoryConsistency(missingAgent,{now:NOW});assert.equal(missingResult.status,'DRIFT');assert(has(missingResult,'AGENT_LABEL_DRIFT'));

  const wrongAgent=normal();wrongAgent.issue.labels=['status:claimed','agent:13'];
  const wrongResult=verifyFactoryConsistency(wrongAgent,{now:NOW});assert.equal(wrongResult.status,'DRIFT');assert(has(wrongResult,'AGENT_LABEL_DRIFT'));
}

// Contract v3 evidence is bound to the factual candidate tree and paths as well as SHA.
{
 const s=normal();s.issue.contract_version=3;
 const manifest={schema_version:'FACTORY_CANDIDATE_MANIFEST_V1',issue:267,contract_version:3,branch:BRANCH,base_sha:B,head_sha:H,tree_sha:T,paths:[{path:'scripts/factory-recovery-controls.mjs',status:'modified',mode:'100644',blob_sha:H}]};
 s.authorized_paths=['scripts/factory-recovery-controls.mjs'];s.candidate_manifest=structuredClone(manifest);s.refs.candidate_manifest=structuredClone(manifest);
 assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
 s.candidate_manifest.paths.push({path:'__noop__',status:'added',mode:'100644',blob_sha:'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'});
 const pathResult=verifyFactoryConsistency(s,{now:NOW});assert(has(pathResult,'CANDIDATE_PATH_UNAUTHORIZED'));assert(has(pathResult,'CANDIDATE_MANIFEST_DRIFT'));
 s.candidate_manifest=structuredClone(manifest);s.refs.candidate_manifest.tree_sha=O;
 const treeResult=verifyFactoryConsistency(s,{now:NOW});assert(has(treeResult,'CANDIDATE_MANIFEST_DRIFT'));
}
// A70 keeps v3 post-merge proofs usable while enforcing every historical gate's identity/manifest.
{
 const s=postMerge();s.issue.contract_version=3;
 const manifest={schema_version:'FACTORY_CANDIDATE_MANIFEST_V1',issue:267,contract_version:3,branch:BRANCH,base_sha:B,head_sha:H,tree_sha:T,paths:[{path:'scripts/factory-recovery-controls.mjs',status:'modified',mode:'100644',blob_sha:H}]};
 s.candidate_manifest=structuredClone(manifest);s.refs.candidate_manifest=structuredClone(manifest);s.authorized_paths=manifest.paths.map(p=>p.path);
 for(const e of Object.values(s.post_merge_evidence))Object.assign(e,{contract_version:3,branch:BRANCH,candidate_manifest:structuredClone(manifest)});
 assert.equal(verifyFactoryConsistency(s,{now:NOW}).status,'CONSISTENT');
 s.post_merge_evidence.review.contract_version=2;delete s.post_merge_evidence.review.candidate_manifest;
 const rejected=verifyFactoryConsistency(s,{now:NOW});assert.notEqual(rejected.status,'CONSISTENT');assert(has(rejected,'POST_MERGE_EVIDENCE_STALE'));
}
console.log('factoryPostMergeConsistency.regression.test.mjs: PASS');
