import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const EXPECTED_WRITER_VALIDATION_WORKFLOW = 'Verto Candidate Writer Validation';
const AUTHORIZED_TARGET_SCHEMA = 'FACTORY_AUTHORIZED_TARGET_V1';
const AUTHORIZED_TARGET_AUTHORITIES = new Set(['FOUNDER_EXPLICIT']);
const POST_MERGE_PROOF_SCHEMA = 'FACTORY_POST_MERGE_PROOF_V1';
const POST_MERGE_EVIDENCE = Object.freeze({
  writer_validation:{gate:'WRITER_VALIDATION',results:new Set(['WRITER_VALIDATION_PASS']),requireRunCheck:true},
  staging_ci:{gate:'STAGING_CI',results:new Set(['CI_PASS','CI_ALTERNATIVE_PASS']),requireRunCheck:false},
  review:{gate:'REVIEW',results:new Set(['REVIEW_PASS']),requireRunCheck:false},
  audit:{gate:'AUDIT',results:new Set(['AUDIT_PASS','AUDIT_PASS_POS']),requireRunCheck:false},
});
const ERRORS = new Set([
  'HEAD_DRIFT','CHECK_NOT_GREEN','REQUIRED_SUITE_MISSING','REQUIRED_SUITE_SKIPPED','STALE_CLAIM',
  'RUNTIME_CAPABILITY_MISSING','RECOVERY_LOOP','LOCK_INCONSISTENT','STATE_AMBIGUOUS','DEPENDENCY_UNSATISFIED',
]);
const STATUS_LABEL = {
  PENDING:'status:pending', CLAIMED:'status:claimed', DONE:'status:done', FAILED:'status:failed',
  SCHEDULED:'status:scheduled', NEEDS_FOUNDER:'status:needs-founder',
};
const arr = (v) => Array.isArray(v) ? v : [];
const nonempty = (v) => typeof v === 'string' && v.trim() !== '';
const stringArray = (v) => Array.isArray(v) && v.every(nonempty);
const nonemptyStringArray = (v) => stringArray(v) && v.length > 0;
const issueRef = (v) => String(v ?? '').replace(/^#/,'');
const p = (code, detail, severity='DRIFT') => ({code,detail,severity});
const statusOf = (ps) => ps.some(x=>x.severity==='AMBIGUOUS') ? 'AMBIGUOUS'
  : ps.some(x=>x.severity==='ORPHAN_LOCK_SUSPECTED') ? 'ORPHAN_LOCK_SUSPECTED'
  : ps.some(x=>x.severity==='STALE_CLAIM_SUSPECTED') ? 'STALE_CLAIM_SUSPECTED'
  : ps.length ? 'DRIFT' : 'CONSISTENT';
const FACTUAL_GATES = new Set(['WRITER_VALIDATION','STAGING_CI','REVIEW','AUDIT','MERGE','STAGING_VERIFY']);
const GATE_RESULTS = {WRITER_VALIDATION:['WRITER_VALIDATION_PASS','WRITER_VALIDATION_FAIL'],STAGING_CI:['CI_PASS','CI_ALTERNATIVE_PASS','CI_FAIL','CI_UNAVAILABLE'],REVIEW:['REVIEW_PASS','REVIEW_FAIL'],AUDIT:['AUDIT_PASS','AUDIT_PASS_POS','AUDIT_FAIL'],MERGE:['MERGE_PASS','MERGE_FAIL'],STAGING_VERIFY:['STAGING_VERIFIED','STAGING_VERIFY_PASS','STAGING_VERIFY_FAIL']};
const gateForAgent = agent => ({'10':'STAGING_CI','03':'REVIEW','01':'AUDIT','12':'MERGE','13':'STAGING_VERIFY'})[agent];
const canonicalIdentity = (i,gate) => ({issue:i.number,contract_version:i.contract_version,branch:i.branch,base_sha:i.base_sha,head_sha:i.head_sha,...(gate?{gate}:{})});
const identityMatches = (actual,expected) => ['issue','contract_version','branch','base_sha','head_sha',...(expected.gate?['gate']:[])].every(key=>
  key==='issue'?issueRef(actual?.[key])===issueRef(expected[key]):key==='contract_version'?String(actual?.[key])===String(expected[key]):actual?.[key]===expected[key]);

export function validateEvidenceEnvelope(e, {expectedHeadSha, requireRunCheck=false, manifestFacts, allowedPaths, expectedIdentity}={}) {
  const errors=[];
  if (!e || typeof e !== 'object') return {schema_version:'FACTORY_EVIDENCE_V1',valid:false,errors:[{code:'EVIDENCE_MISSING',detail:'evidence envelope is required'}]};
  for (const f of ['issue','contract_version','gate','branch','base_sha','head_sha','result','timestamp','scope','suites_required','suites_executed','suites_skipped']) {
    if (e[f]===null || e[f]===undefined || e[f]==='') errors.push({code:'EVIDENCE_FIELD_MISSING',detail:`${f} is required`});
  }
  for (const f of ['suites_required','suites_executed','suites_skipped']) {
    if (e[f]!==undefined && !stringArray(e[f])) errors.push({code:'EVIDENCE_FIELD_INVALID',detail:`${f} must be an array of non-empty strings`});
  }
  for (const f of ['base_sha','head_sha']) if (e[f]!==undefined && !SHA.test(String(e[f]))) errors.push({code:'EVIDENCE_SHA_INVALID',detail:`${f} must be a full SHA`});
  if (expectedHeadSha && e.head_sha!==expectedHeadSha) errors.push({code:'HEAD_DRIFT',detail:'evidence head differs from expected head'});
  if (expectedIdentity && !identityMatches(e,expectedIdentity)) errors.push({code:'EVIDENCE_IDENTITY_DRIFT',detail:'evidence Issue/contract/branch/base/head/gate differs from canonical authority'});
  if(expectedIdentity&&GATE_RESULTS[e.gate]&&!GATE_RESULTS[e.gate].includes(e.result))errors.push({code:'EVIDENCE_IDENTITY_DRIFT',detail:'result does not belong to the protected gate'});
  const req=new Set(arr(e.suites_required)), ran=new Set(arr(e.suites_executed)), skipped=new Set(arr(e.suites_skipped));
  for (const s of req) {
    if (skipped.has(s)) errors.push({code:'REQUIRED_SUITE_SKIPPED',detail:`required suite skipped: ${s}`});
    else if (!ran.has(s)) errors.push({code:'REQUIRED_SUITE_MISSING',detail:`required suite not executed: ${s}`});
  }
  if (Number.isNaN(new Date(e.timestamp).getTime())) errors.push({code:'EVIDENCE_TIMESTAMP_INVALID',detail:'invalid timestamp'});
  const alternative = e.gate==='STAGING_CI' && e.result==='CI_ALTERNATIVE_PASS';
  const automatedGate = e.gate==='WRITER_VALIDATION' || (e.gate==='STAGING_CI' && !alternative);
  if (alternative) {
    const proof=e.alternative_proof;
    const validProof=proof && typeof proof==='object' && !Array.isArray(proof) &&
      ['LOCAL_ISOLATED','CLOUD_ISOLATED'].includes(proof.executor_kind) &&
      nonempty(proof.executor_id) && nonempty(proof.reviewer_id) &&
      proof.executor_id!==proof.reviewer_id &&
      proof.base_checkout_sha===e.base_sha && proof.head_checkout_sha===e.head_sha &&
      /^[0-9a-f]{64}$/i.test(String(proof.log_sha256??'')) &&
      /^https:\/\//.test(String(proof.evidence_url??'')) &&
      Number.isFinite(Date.parse(String(proof.completed_at??''))) &&
      nonemptyStringArray(proof.test_commands) &&
      proof.result==='PASS' && proof.new_regressions===0 &&
      nonemptyStringArray(e.suites_required) &&
      e.suites_skipped?.length===0;
    if (!validProof) errors.push({code:'ALTERNATIVE_CI_PROOF_INVALID',detail:'independent runner, exact base/head, verified logs and reviewer are mandatory'});
  }
  if (requireRunCheck || automatedGate) {
    if (!e.run_id) errors.push({code:'RUN_ID_MISSING',detail:'run_id required'});
    if (!e.check_id) errors.push({code:'CHECK_ID_MISSING',detail:'check_id required'});
    if (e.run_head_sha!==e.head_sha) errors.push({code:'HEAD_DRIFT',detail:'run head differs from evidence head'});
    if (e.check_conclusion!=='success') errors.push({code:'CHECK_NOT_GREEN',detail:'required check is not green'});
  }
  const contractVersion=Number(expectedIdentity?.contract_version??manifestFacts?.contract_version??e.contract_version);
  if(contractVersion>=3&&(FACTUAL_GATES.has(expectedIdentity?.gate)||FACTUAL_GATES.has(e.gate))){
    for(const problem of validateCandidateManifest(e.candidate_manifest,manifestFacts,allowedPaths).problems)errors.push({code:problem.code,detail:problem.detail});
    if (!identityMatches(e,e.candidate_manifest??{})) errors.push({code:'EVIDENCE_IDENTITY_DRIFT',detail:'evidence identity differs from its factual candidate manifest'});
    if(expectedIdentity && !identityMatches(manifestFacts,{...expectedIdentity,gate:undefined})) errors.push({code:'CANDIDATE_MANIFEST_DRIFT',detail:'factual manifest identity differs from canonical Issue'});
  }
  if ((/_PASS(?:_POS)?$/.test(String(e.result))||e.result==='STAGING_VERIFIED') && errors.length) errors.push({code:'PASS_INVALIDATED',detail:'PASS cannot survive mismatched/incomplete evidence'});
  return {schema_version:'FACTORY_EVIDENCE_V1',valid:errors.length===0,errors};
}

export function validateWriterValidationPreflight(input={}) {
  const fail = (code, detail) => ({
    schema_version:'FACTORY_WRITER_VALIDATION_PREFLIGHT_V1',
    valid:false,
    error:createStructuredFactoryError(code,{gate:'WRITER_VALIDATION',head_sha:input.candidate_sha??null,evidence_ref:input.evidence_ref??null}),
    detail,
  });
  if (!input || typeof input!=='object') return fail('STATE_AMBIGUOUS','preflight primitives are required');
  if (input.workflow_available!==true) return fail('RUNTIME_CAPABILITY_MISSING','writer validation workflow is unavailable');
  if (input.workflow_name!==EXPECTED_WRITER_VALIDATION_WORKFLOW) return fail('RUNTIME_CAPABILITY_MISSING','writer validation workflow identity mismatch');
  for (const field of ['base_sha','staging_sha','candidate_sha','branch_sha']) {
    if (!SHA.test(String(input[field]??''))) return fail('STATE_AMBIGUOUS',`${field} must be a full SHA`);
  }
  if (input.base_sha!==input.staging_sha) return fail('HEAD_DRIFT','authorized base differs from current staging');
  if (input.candidate_sha!==input.branch_sha) return fail('HEAD_DRIFT','candidate differs from branch ref');
  if (!stringArray(input.suites_allowlisted)) return fail('STATE_AMBIGUOUS','suites_allowlisted must be an array of non-empty strings');
  if (!nonempty(input.suite)) return fail('REQUIRED_SUITE_MISSING','selected suite is required; use an explicit allowlisted value such as none when no focused suite applies');
  if (!input.suites_allowlisted.includes(input.suite)) return fail('REQUIRED_SUITE_MISSING','selected suite is not allowlisted');
  return {schema_version:'FACTORY_WRITER_VALIDATION_PREFLIGHT_V1',valid:true,error:null,detail:'preflight consistent'};
}

function validatePostMergeStagingSemantics(s,i,refs) {
  const problems=[];
  const subjectFields=['post_merge_subject_pr','post_merge_subject_base_sha','post_merge_subject_head_sha','post_merge_subject_merge_sha'];
  const hasSubject=subjectFields.some(f=>i[f]!==null&&i[f]!==undefined&&i[f]!=='');
  const proof=refs?.post_merge_proof;
  if (!hasSubject && !proof) return {claimed:false,valid:false,problems};
  for (const f of subjectFields) if (i[f]===null||i[f]===undefined||i[f]==='') problems.push(p('POST_MERGE_FIELD_MISSING',`issue.${f} is required for post-merge proof`,'AMBIGUOUS'));
  const subjectBase=i.post_merge_subject_base_sha, subjectHead=i.post_merge_subject_head_sha, subjectMerge=i.post_merge_subject_merge_sha;
  for (const [f,v] of [['post_merge_subject_base_sha',subjectBase],['post_merge_subject_head_sha',subjectHead],['post_merge_subject_merge_sha',subjectMerge]]) {
    if (v!==undefined && v!==null && v!=='' && !SHA.test(String(v))) problems.push(p('POST_MERGE_FIELD_INVALID',`issue.${f} must be a full SHA`,'AMBIGUOUS'));
  }
  if (!proof || typeof proof!=='object' || Array.isArray(proof)) {
    problems.push(p('POST_MERGE_PROOF_MISSING','trusted factual post-merge proof is required','AMBIGUOUS'));
    return {claimed:true,valid:false,problems};
  }
  if (proof.schema_version!==POST_MERGE_PROOF_SCHEMA) problems.push(p('POST_MERGE_PROOF_SCHEMA_INVALID','post-merge proof schema is invalid','AMBIGUOUS'));
  if (proof.merged!==true) problems.push(p('POST_MERGE_NOT_FACTUAL','pull request is not factually merged'));
  if (String(proof.pr_number)!==String(i.post_merge_subject_pr)) problems.push(p('POST_MERGE_PR_DRIFT','merge proof belongs to a different pull request'));
  if (!SHA.test(String(proof.merge_sha??''))) problems.push(p('POST_MERGE_FIELD_MISSING','proof.merge_sha must be a full SHA','AMBIGUOUS'));
  else {
    if (proof.merge_sha!==subjectMerge) problems.push(p('POST_MERGE_MERGE_SHA_DRIFT','merge proof SHA differs from canonical post-merge subject'));
    if (proof.merge_sha!==refs.staging_sha) problems.push(p('POST_MERGE_STAGING_DRIFT','current staging is not the proved merge SHA'));
  }
  if (!stringArray(proof.parents) || proof.parents.length<2) problems.push(p('POST_MERGE_ANCESTRY_MISSING','merge parent evidence is required','AMBIGUOUS'));
  else {
    if (!proof.parents.includes(subjectBase)) problems.push(p('POST_MERGE_BASE_ANCESTRY_INVALID','merge does not derive from the recorded historical base'));
    if (!proof.parents.includes(subjectHead)) problems.push(p('POST_MERGE_CANDIDATE_ANCESTRY_INVALID','merge does not include the exact approved candidate'));
  }
  for (const [name,expectedAncestor] of [['base_ancestry',subjectBase],['candidate_ancestry',subjectHead]]) {
    const ancestry=proof[name];
    if (!ancestry || typeof ancestry!=='object' || Array.isArray(ancestry)) {
      problems.push(p('POST_MERGE_ANCESTRY_MISSING',`${name} proof is required`,'AMBIGUOUS'));
      continue;
    }
    if (ancestry.ancestor_sha!==expectedAncestor || ancestry.descendant_sha!==subjectMerge) problems.push(p('POST_MERGE_ANCESTRY_DRIFT',`${name} does not bind the canonical subject to the merge SHA`));
    if (ancestry.is_ancestor!==true) problems.push(p('POST_MERGE_ANCESTRY_INVALID',`${name} does not prove ancestry`));
  }
  const evidence=s?.post_merge_evidence;
  if (!evidence || typeof evidence!=='object' || Array.isArray(evidence)) problems.push(p('POST_MERGE_EVIDENCE_MISSING','exact-candidate historical gate evidence is required','AMBIGUOUS'));
  else for (const [name,policy] of Object.entries(POST_MERGE_EVIDENCE)) {
    const envelope=evidence[name];
    if (!envelope || typeof envelope!=='object' || Array.isArray(envelope)) {
      problems.push(p('POST_MERGE_EVIDENCE_MISSING',`${name} evidence is required`,'AMBIGUOUS'));
      continue;
    }
    const expectedIdentity=Number(i.contract_version)>=3?{...canonicalIdentity(i,policy.gate),base_sha:subjectBase,head_sha:subjectHead}:undefined;
    for (const error of validateEvidenceEnvelope(envelope,{expectedHeadSha:subjectHead,requireRunCheck:policy.requireRunCheck,expectedIdentity,manifestFacts:refs.candidate_manifest,allowedPaths:s.authorized_paths}).errors) problems.push(p('POST_MERGE_EVIDENCE_STALE',`${name}: ${error.code} ${error.detail}`));
    if (issueRef(envelope.issue)!==issueRef(i.number)) problems.push(p('POST_MERGE_EVIDENCE_DRIFT',`${name} evidence belongs to another Issue`));
    if (String(envelope.contract_version)!==String(i.contract_version)) problems.push(p('POST_MERGE_EVIDENCE_DRIFT',`${name} evidence contract_version differs`));
    if (envelope.gate!==policy.gate) problems.push(p('POST_MERGE_EVIDENCE_DRIFT',`${name} evidence gate differs`));
    if (!policy.results.has(envelope.result)) problems.push(p('POST_MERGE_EVIDENCE_DRIFT',`${name} evidence is not an accepted PASS result`));
    if (envelope.base_sha!==subjectBase) problems.push(p('POST_MERGE_EVIDENCE_DRIFT',`${name} evidence base differs from the historical subject base`));
    if (envelope.head_sha!==subjectHead) problems.push(p('POST_MERGE_EVIDENCE_STALE',`${name} evidence head differs from the exact approved candidate`));
  }
  return {claimed:true,valid:problems.length===0,problems};
}

function validateReferenceAndTargetSemantics(s,i,refs,ps) {
  const referenceBranch=nonempty(i.reference_branch)?i.reference_branch:'staging';
  const targetBranch=nonempty(i.target_branch)?i.target_branch:referenceBranch;
  const exceptionalTarget=targetBranch!==referenceBranch;
  const explicitBypassKeys=new Set(['skip_staging_check','bypass_staging_check','allow_arbitrary_target','post_merge','post_merge_mode','is_post_merge','allow_post_merge','post_merge_override']);
  const bypassLike=/^(?:skip|bypass|ignore|override|allow).*(?:staging|target|base|ancestry|scope)/i;
  const bypassKeys=new Set([...Object.keys(s??{}),...Object.keys(i??{})].filter(key=>explicitBypassKeys.has(key)||bypassLike.test(key)));
  for (const key of bypassKeys) ps.push(p('GENERIC_BYPASS_REJECTED',`${key} is not an authorized target mechanism`,'AMBIGUOUS'));
  if (referenceBranch!=='staging') ps.push(p('REFERENCE_BRANCH_DRIFT','reference_branch must remain staging'));
  const freshnessSha=exceptionalTarget?i.staging_freshness_sha:(i.staging_freshness_sha??i.base_sha);
  if (!SHA.test(String(freshnessSha??'')) || !SHA.test(String(refs.staging_sha??''))) ps.push(p('FRESHNESS_EVIDENCE_MISSING','full staging freshness/ref SHAs required','AMBIGUOUS'));
  else if (freshnessSha!==refs.staging_sha) ps.push(p('STAGING_FRESHNESS_DRIFT','staging freshness differs from current staging'));
  if (!exceptionalTarget) {
    if (!SHA.test(String(i.base_sha??''))) ps.push(p('FRESHNESS_EVIDENCE_MISSING','full base/staging SHAs required','AMBIGUOUS'));
    else if (i.base_sha!==refs.staging_sha) {
      const postMerge=validatePostMergeStagingSemantics(s,i,refs);
      ps.push(...postMerge.problems);
      if (!postMerge.valid) ps.push(p('BASE_STAGING_DRIFT','base differs from current staging without complete factual merge proof'));
    }
    if (s?.authorized_target) ps.push(p('UNEXPECTED_TARGET_AUTHORIZATION','authorized_target is only valid for an exceptional target','AMBIGUOUS'));
    return;
  }
  const requiredIssueFields=['reference_branch','staging_freshness_sha','target_branch','base_sha','target_base_sha'];
  for (const f of requiredIssueFields) if (!nonempty(i[f])) ps.push(p('AUTHORIZED_TARGET_FIELD_MISSING',`issue.${f} required for exceptional target`,'AMBIGUOUS'));
  if (!SHA.test(String(i.base_sha??''))) ps.push(p('AUTHORIZED_TARGET_FIELD_MISSING','issue.base_sha must be a full SHA for exceptional target','AMBIGUOUS'));
  if (!SHA.test(String(i.target_base_sha??''))) ps.push(p('AUTHORIZED_TARGET_FIELD_MISSING','issue.target_base_sha must be a full SHA','AMBIGUOUS'));
  else if (SHA.test(String(i.base_sha??'')) && i.base_sha!==i.target_base_sha) ps.push(p('TARGET_BASE_DRIFT','canonical issue.base_sha differs from issue.target_base_sha'));
  if (!nonempty(refs.target_branch)) ps.push(p('AUTHORIZED_TARGET_REF_MISSING','refs.target_branch required','AMBIGUOUS'));
  else if (refs.target_branch!==targetBranch) ps.push(p('TARGET_BRANCH_DRIFT','target branch differs from factual target ref'));
  if (!SHA.test(String(refs.target_branch_sha??''))) ps.push(p('AUTHORIZED_TARGET_REF_MISSING','refs.target_branch_sha must be a full SHA','AMBIGUOUS'));
  else if (SHA.test(String(i.target_base_sha??'')) && refs.target_branch_sha!==i.target_base_sha) ps.push(p('TARGET_BASE_DRIFT','target base differs from factual target branch SHA'));
  const ancestry=refs.target_ancestry;
  if (!ancestry || typeof ancestry!=='object' || Array.isArray(ancestry)) ps.push(p('TARGET_ANCESTRY_MISSING','trusted target ancestry proof is required','AMBIGUOUS'));
  else {
    if (ancestry.base_sha!==i.target_base_sha || ancestry.candidate_sha!==i.head_sha) ps.push(p('TARGET_ANCESTRY_DRIFT','ancestry proof does not match target base/current candidate'));
    if (ancestry.is_ancestor!==true) ps.push(p('TARGET_ANCESTRY_INVALID','candidate is not a descendant of target base'));
  }
  const auth=s?.authorized_target;
  if (!auth || typeof auth!=='object' || Array.isArray(auth)) ps.push(p('AUTHORIZED_TARGET_EVIDENCE_MISSING','structured exceptional target authorization is required','AMBIGUOUS'));
  else {
    if (auth.schema_version!==AUTHORIZED_TARGET_SCHEMA) ps.push(p('AUTHORIZED_TARGET_SCHEMA_INVALID','authorized target schema is invalid','AMBIGUOUS'));
    if (!AUTHORIZED_TARGET_AUTHORITIES.has(auth.authority)) ps.push(p('AUTHORIZED_TARGET_AUTHORITY_INVALID','exceptional target authority is not allowlisted','AMBIGUOUS'));
    if (!nonempty(auth.evidence_ref)) ps.push(p('AUTHORIZED_TARGET_EVIDENCE_MISSING','authorization evidence_ref is required','AMBIGUOUS'));
    if (!nonempty(auth.target_branch)) ps.push(p('AUTHORIZED_TARGET_FIELD_MISSING','authorization target_branch is required','AMBIGUOUS'));
    else if (auth.target_branch!==targetBranch) ps.push(p('AUTHORIZED_TARGET_BRANCH_MISMATCH','authorization does not cover requested target branch'));
    if (!nonemptyStringArray(auth.allowed_scope)) ps.push(p('AUTHORIZED_TARGET_SCOPE_INVALID','authorization allowed_scope must be a non-empty explicit string array','AMBIGUOUS'));
  }
  if (!nonemptyStringArray(s?.operation_scope)) ps.push(p('OPERATION_SCOPE_MISSING','operation_scope must be a non-empty explicit string array','AMBIGUOUS'));
  else if (auth && nonemptyStringArray(auth.allowed_scope)) {
    const allowed=new Set(auth.allowed_scope);
    for (const item of s.operation_scope) if (!allowed.has(item)) ps.push(p('AUTHORIZED_SCOPE_EXCEEDED',`operation scope exceeds authorization: ${item}`));
  }
}

export function verifyFactoryConsistency(s, {now=Date.now()}={}) {
  const at=new Date(now); if (Number.isNaN(at.getTime())) throw new TypeError('invalid now');
  const ps=[], i=s?.issue;
  if (!i || typeof i!=='object') return {schema_version:'FACTORY_CONSISTENCY_V1',status:'AMBIGUOUS',problems:[p('ISSUE_SNAPSHOT_MISSING','canonical Issue snapshot required','AMBIGUOUS')]};
  for (const f of ['number','contract_version','current_agent','writer','active_handoff','handoff_status','branch']) if (i[f]===null || i[f]===undefined || i[f]==='') ps.push(p('REQUIRED_FIELD_MISSING',`issue.${f} required`,'AMBIGUOUS'));
  const h=s.latest_handoff;
  if (!h || typeof h!=='object') ps.push(p('LATEST_HANDOFF_MISSING','latest canonical handoff required','AMBIGUOUS'));
  else {
    if (h.id!==i.active_handoff) ps.push(p('ACTIVE_HANDOFF_DRIFT','Issue active_handoff differs from latest handoff'));
    if (h.current_agent && h.current_agent!==i.current_agent) ps.push(p('CURRENT_AGENT_DRIFT','current_agent differs from latest handoff'));
    if (h.status && h.status!==i.handoff_status) ps.push(p('HANDOFF_STATUS_DRIFT','handoff_status differs from latest handoff'));
  }
  const labels=new Set(arr(i.labels));
  const agentLabels=[...labels].filter(label=>typeof label==='string' && label.startsWith('agent:'));
  const terminalWithoutAgent=i.state==='DONE' && i.current_agent==='none' && i.active_handoff==='none' && i.handoff_status==='DONE';
  if (i.current_agent==='none') {
    if (!terminalWithoutAgent) ps.push(p('AGENT_LABEL_DRIFT','current_agent:none is only valid for terminal DONE state without an active handoff'));
    if (agentLabels.length>0) ps.push(p('AGENT_LABEL_DRIFT','current_agent:none requires no agent:* label'));
  } else if (nonempty(i.current_agent)) {
    const expectedAgentLabel=`agent:${i.current_agent}`;
    if (!labels.has(expectedAgentLabel) || agentLabels.some(label=>label!==expectedAgentLabel)) ps.push(p('AGENT_LABEL_DRIFT',`agent labels must match ${expectedAgentLabel}`));
  }
  if (STATUS_LABEL[i.handoff_status] && !labels.has(STATUS_LABEL[i.handoff_status])) ps.push(p('STATUS_LABEL_DRIFT',`missing ${STATUS_LABEL[i.handoff_status]}`));
  const c=s.winning_claim;
  if (i.handoff_status==='CLAIMED') {
    if (!nonempty(i.claimed_by)) ps.push(p('ISSUE_CLAIM_OWNER_MISSING','issue.claimed_by required while CLAIMED','AMBIGUOUS'));
    const issueExp=new Date(i.claim_expires_at);
    const issueExpiryValid=nonempty(i.claim_expires_at) && !Number.isNaN(issueExp.getTime());
    if (!issueExpiryValid) ps.push(p('ISSUE_CLAIM_EXPIRY_INVALID','issue.claim_expires_at required and valid while CLAIMED','AMBIGUOUS'));
    if (!c || typeof c!=='object') ps.push(p('WINNING_CLAIM_MISSING','CLAIMED handoff lacks winning claim','AMBIGUOUS'));
    else {
      if (c.handoff_id!==i.active_handoff || c.claimed_by!==i.claimed_by) ps.push(p('CLAIM_IDENTITY_DRIFT','winning claim differs from Issue CAS'));
      const exp=new Date(c.claim_expires_at);
      const winningExpiryValid=nonempty(c.claim_expires_at) && !Number.isNaN(exp.getTime());
      if (!winningExpiryValid) ps.push(p('CLAIM_EXPIRY_INVALID','claim expiry missing/invalid','AMBIGUOUS'));
      else {
        if (issueExpiryValid && exp.getTime()!==issueExp.getTime()) ps.push(p('CLAIM_EXPIRY_DRIFT','winning claim lease differs from Issue CAS'));
        if (exp<=at) ps.push(p('STALE_CLAIM','winning claim expired','STALE_CLAIM_SUSPECTED'));
      }
    }
  } else if (c && c.handoff_id===i.active_handoff && c.active!==false) ps.push(p('UNEXPECTED_ACTIVE_CLAIM','non-CLAIMED handoff has active claim'));

  const refsProvided=Boolean(s?.refs && typeof s.refs==='object' && !Array.isArray(s.refs));
  const refs=refsProvided?s.refs:{};
  if (!refsProvided) ps.push(p('REFS_SNAPSHOT_MISSING','refs snapshot is required','AMBIGUOUS'));
  if (!nonempty(refs.branch)) ps.push(p('BRANCH_IDENTITY_MISSING','refs.branch required','AMBIGUOUS'));
  else if (nonempty(i.branch) && refs.branch!==i.branch) ps.push(p('BRANCH_IDENTITY_DRIFT','refs.branch differs from issue.branch'));
  if (nonempty(i.head_sha)) {
    if (!SHA.test(i.head_sha)) ps.push(p('HEAD_SHA_INVALID','head_sha must be full SHA','AMBIGUOUS'));
    else if (!nonempty(refs.branch_sha)) ps.push(p('BRANCH_REF_MISSING','branch ref required','AMBIGUOUS'));
    else if (refs.branch_sha!==i.head_sha) ps.push(p('HEAD_DRIFT','branch ref differs from issue.head_sha'));
  }
  validateReferenceAndTargetSemantics(s,i,refs,ps);

  if (!Array.isArray(s.dependencies)) ps.push(p('DEPENDENCIES_SNAPSHOT_MISSING','dependencies must be an explicit array, including [] when none exist','AMBIGUOUS'));
  else for (const d of s.dependencies) if (d?.required!==false && d?.status!=='SATISFIED') ps.push(p('DEPENDENCY_UNSATISFIED',`dependency ${d?.name??'unknown'} is not SATISFIED`));

  const l=s.lock;
  if (!l || typeof l!=='object' || Array.isArray(l)) ps.push(p('LOCK_SNAPSHOT_MISSING','lock snapshot with explicit status is required','AMBIGUOUS'));
  else if (!['ACTIVE','INACTIVE'].includes(l.status)) ps.push(p('LOCK_STATUS_INVALID','lock.status must be ACTIVE or INACTIVE','AMBIGUOUS'));
  else if (l.status==='ACTIVE') {
    if (!l.owner_issue || !l.owner_writer || !l.release_gate) ps.push(p('LOCK_METADATA_INCOMPLETE','active lock lacks owner/writer/release gate','ORPHAN_LOCK_SUSPECTED'));
    if (l.owner_operational_valid===false) ps.push(p('ORPHAN_LOCK_SUSPECTED','lock owner is not operationally valid','ORPHAN_LOCK_SUSPECTED'));
    if (s.write_intent===true && issueRef(l.owner_issue)!==issueRef(i.number)) ps.push(p('GLOBAL_WRITE_LOCK_HELD_BY_OTHER_ISSUE','write conflicts with another Issue lock'));
  }
  const evidencePolicy=s.evidence_policy;
  if (!['NONE','ENVELOPE','RUN_CHECK'].includes(evidencePolicy)) ps.push(p('EVIDENCE_POLICY_MISSING','evidence_policy must be NONE, ENVELOPE or RUN_CHECK','AMBIGUOUS'));
  const v3=Number(i.contract_version)>=3;
  const protectedGate=gateForAgent(i.current_agent)??(/WRITER_VALIDATION/.test(String(i.next_gate))||/^0[4-9]$/.test(String(i.current_agent))&&FACTUAL_GATES.has(s.evidence?.gate)?'WRITER_VALIDATION':undefined);
  // A claim may consume the preceding completed gate's evidence. A gate result may
  // never relabel that evidence as its own PASS or select an unrelated gate.
  const previousAgent=String(i.previous_handoff??'').match(/-H(\d{2})-/)?.[1];
  const previousGate=i.previous_handoff_status==='DONE'?gateForAgent(previousAgent):undefined;
  const claimOperation=/(?:^|_)(?:PRECLAIM|CLAIM|ENTRY)(?:_|$)/.test(String(s.operation??s.protected_operation??''));
  const gate=v3&&claimOperation&&s.evidence?.gate===previousGate?previousGate:protectedGate;
  const expectedIdentity=v3?canonicalIdentity(i,gate):undefined;
  if (v3&&protectedGate || evidencePolicy==='ENVELOPE' || evidencePolicy==='RUN_CHECK') {
    if (!s.evidence) ps.push(p('EVIDENCE_MISSING','evidence required by evidence_policy','AMBIGUOUS'));
    else for (const e of validateEvidenceEnvelope(s.evidence,{expectedHeadSha:i.head_sha||undefined,requireRunCheck:evidencePolicy==='RUN_CHECK' && !(s.evidence?.gate==='STAGING_CI' && s.evidence?.result==='CI_ALTERNATIVE_PASS'),manifestFacts:refs.candidate_manifest,allowedPaths:s.authorized_paths,expectedIdentity}).errors) ps.push(p(e.code,e.detail));
  } else if (s.evidence) {
    for (const e of validateEvidenceEnvelope(s.evidence,{expectedHeadSha:i.head_sha||undefined,manifestFacts:refs.candidate_manifest,allowedPaths:s.authorized_paths,expectedIdentity}).errors) ps.push(p(e.code,e.detail));
  }
  if(v3&&nonempty(i.head_sha)){
    for(const problem of validateCandidateManifest(s.candidate_manifest,refs.candidate_manifest,s.authorized_paths).problems)ps.push(problem);
    if(s.candidate_manifest&&!identityMatches(s.candidate_manifest,canonicalIdentity(i)))ps.push(p('CANDIDATE_MANIFEST_DRIFT','candidate manifest identity differs from canonical Issue'));
    if(refs.candidate_manifest&&(refs.candidate_manifest.head_sha!==refs.branch_sha||nonempty(i.head_tree_sha)&&refs.candidate_manifest.tree_sha!==i.head_tree_sha))ps.push(p('CANDIDATE_MANIFEST_DRIFT','manifest facts differ from the factual ref/tree'));
  }
  const currentGate=String(s.evidence?.gate??'');
  if (currentGate==='WRITER_VALIDATION') {
    if (!s.writer_validation_preflight) ps.push(p('WRITER_VALIDATION_PREFLIGHT_MISSING','writer_validation_preflight required for WRITER_VALIDATION','AMBIGUOUS'));
    else {
      const pre=validateWriterValidationPreflight(s.writer_validation_preflight);
      if (!pre.valid) ps.push(p(pre.error.code,pre.detail));
    }
  } else if (s.writer_validation_preflight) {
    const pre=validateWriterValidationPreflight(s.writer_validation_preflight);
    if (!pre.valid) ps.push(p(pre.error.code,pre.detail));
  }
  return {schema_version:'FACTORY_CONSISTENCY_V1',status:statusOf(ps),problems:ps};
}

export function createStructuredFactoryError(code, context={}) {
  if (!ERRORS.has(code)) throw new TypeError(`unsupported factory error code: ${code}`);
  return Object.freeze({schema_version:'FACTORY_ERROR_V1',code,gate:context.gate??null,head_sha:context.head_sha??null,fact_fingerprint:context.fact_fingerprint??null,evidence_ref:context.evidence_ref??null});
}

export function routeStructuredFactoryError(error, context={}) {
  if (!error || error.schema_version!=='FACTORY_ERROR_V1' || !ERRORS.has(error.code)) return {accepted:false,code:'STATE_AMBIGUOUS',owner:'00',unblock_action:'Reconcile canonical state and structured evidence before retry.',retry_condition:'A canonical allowlisted FACTORY_ERROR_V1 exists with unambiguous evidence.',return_gate:context.gate??null,diagnostic_participation:{agent:'00',mode:'READ_ONLY',may_acquire_write_claim:false}};
  const agent=context.current_agent??null, writer=context.writer??agent, ret=context.return_agent??writer, dep=context.dependency_owner??'00';
  const routes={
    HEAD_DRIFT:[Array.isArray(context.material_capabilities)?(context.material_capabilities.find(c=>c.role==='14'&&c.can_recover_feature_ref===true&&nonempty(c.evidence_ref))?.role??context.material_capabilities.find(c=>c.role===writer&&c.can_recover_feature_ref===true&&nonempty(c.evidence_ref))?.role??'00'):(['04','05','06','07','08','09'].includes(agent)&&agent===writer?writer:'00'),'Recover factual ref/metadata through a capable authorized owner; never mutate refs for discovery.','Fresh base/head/ref/manifest equality is restored, stale evidence invalidated, and SHA-bound gates rerun.'],
    CHECK_NOT_GREEN:[agent,'Inspect the exact-SHA failing check and correct the smallest owning surface.','The required check is green on exact current head_sha.'],
    REQUIRED_SUITE_MISSING:[ret,'Restore the required allowlisted suite or deterministic selection.','The required suite exists and executes on exact candidate head.'],
    REQUIRED_SUITE_SKIPPED:[ret,'Make the required allowlisted suite execute instead of skip.','The required suite is recorded executed and not skipped.'],
    STALE_CLAIM:[agent,'Record STALE_CLAIM_RECOVERED, return same handoff to PENDING, then claim canonically.','Expired lease recovery is recorded and a new winning claim exists.'],
    RUNTIME_CAPABILITY_MISSING:['00','Broker an authorized capable executor without changing writer ownership.','A complete authorized execution path exists for exact required head/evidence.'],
    RECOVERY_LOOP:['00','Choose a materially different recovery strategy while preserving valid work.','A factual change or distinct strategy breaks the repeated loop.'],
    LOCK_INCONSISTENT:['00','Revalidate lock owner, scope, base SHA and release gate; never auto-release.','Lock metadata is canonically reconciled by 00.'],
    STATE_AMBIGUOUS:['00','Reconcile Issue, handoff, claim, refs, labels and evidence before side effect.','Canonical state is unambiguous.'],
    DEPENDENCY_UNSATISFIED:[dep,'Satisfy the named canonical dependency without changing unrelated authority.','Dependency is canonically SATISFIED and freshness revalidated.'],
  };
  const r=routes[error.code]; if (!r?.[0]) return routeStructuredFactoryError(createStructuredFactoryError('STATE_AMBIGUOUS',error),context);
  const diag=new Set(['RUNTIME_CAPABILITY_MISSING','RECOVERY_LOOP','LOCK_INCONSISTENT','STATE_AMBIGUOUS']);
  return {accepted:true,code:error.code,owner:String(r[0]),unblock_action:r[1],retry_condition:r[2],return_gate:error.gate??context.gate??null,diagnostic_participation:diag.has(error.code)?{agent:'00',mode:'READ_ONLY',may_acquire_write_claim:false}:null};
}

export function routeConsistencyResult(result, context={}) {
  if (!result || result.schema_version!=='FACTORY_CONSISTENCY_V1') return routeStructuredFactoryError(createStructuredFactoryError('STATE_AMBIGUOUS',{gate:context.gate}),context);
  if (result.status==='CONSISTENT') return null;
  const codes=new Set(arr(result.problems).map(x=>x?.code).filter(Boolean));
  let code='STATE_AMBIGUOUS';
  if (result.status==='STALE_CLAIM_SUSPECTED'||codes.has('STALE_CLAIM')) code='STALE_CLAIM';
  else if (result.status==='ORPHAN_LOCK_SUSPECTED'||codes.has('GLOBAL_WRITE_LOCK_HELD_BY_OTHER_ISSUE')) code='LOCK_INCONSISTENT';
  else if (['HEAD_DRIFT','BASE_STAGING_DRIFT','STAGING_FRESHNESS_DRIFT','TARGET_BRANCH_DRIFT','TARGET_BASE_DRIFT','TARGET_ANCESTRY_DRIFT','TARGET_ANCESTRY_INVALID','POST_MERGE_STAGING_DRIFT','POST_MERGE_MERGE_SHA_DRIFT','POST_MERGE_PR_DRIFT','POST_MERGE_NOT_FACTUAL','POST_MERGE_BASE_ANCESTRY_INVALID','POST_MERGE_CANDIDATE_ANCESTRY_INVALID','POST_MERGE_ANCESTRY_DRIFT','POST_MERGE_ANCESTRY_INVALID','POST_MERGE_EVIDENCE_STALE','POST_MERGE_EVIDENCE_DRIFT'].some(x=>codes.has(x))) code='HEAD_DRIFT';
  else if (codes.has('CHECK_NOT_GREEN')) code='CHECK_NOT_GREEN';
  else if (codes.has('REQUIRED_SUITE_MISSING')) code='REQUIRED_SUITE_MISSING';
  else if (codes.has('REQUIRED_SUITE_SKIPPED')) code='REQUIRED_SUITE_SKIPPED';
  else if (codes.has('DEPENDENCY_UNSATISFIED')) code='DEPENDENCY_UNSATISFIED';
  else if (codes.has('RUNTIME_CAPABILITY_MISSING')) code='RUNTIME_CAPABILITY_MISSING';
  return routeStructuredFactoryError(createStructuredFactoryError(code,{gate:context.gate,head_sha:context.head_sha,fact_fingerprint:context.fact_fingerprint}),context);
}

export function evaluateClaimRenewal(input,{now=Date.now()}={}) {
  const c=input?.current_claim,e=input?.expected_claim,k=input?.checkpoint; if(!c||!e||!k)return{allowed:false,reason:'MISSING_RENEWAL_EVIDENCE'};
  if(c.handoff_id!==e.handoff_id||c.claimed_by!==e.claimed_by)return{allowed:false,reason:'CLAIM_CAS_MISMATCH'};
  if(!nonempty(e.claim_expires_at)||c.claim_expires_at!==e.claim_expires_at)return{allowed:false,reason:'CLAIM_LEASE_CAS_MISMATCH'};
  const exp=new Date(c.claim_expires_at),at=new Date(now); if(Number.isNaN(exp.getTime())||exp<=at)return{allowed:false,reason:'STALE_CLAIM_REQUIRES_RECOVERY'};
  if(k.handoff_id!==c.handoff_id||k.claimed_by!==c.claimed_by)return{allowed:false,reason:'CHECKPOINT_CAS_MISMATCH'};
  if(!nonempty(k.progress_fingerprint)||k.progress_fingerprint===input.previous_progress_fingerprint||!nonempty(k.evidence_ref))return{allowed:false,reason:'NO_OBSERVABLE_PROGRESS'};
  if(nonempty(e.head_sha)){
    if(!SHA.test(e.head_sha)||k.head_sha!==e.head_sha)return{allowed:false,reason:'CHECKPOINT_HEAD_MISMATCH'};
  }
  return{allowed:true,reason:'OBSERVABLE_PROGRESS_AND_CAS_CONFIRMED'};
}

export function detectRecoveryLoop(attempts,threshold=3) {
  if(!Number.isInteger(threshold)||threshold<2)throw new TypeError('threshold must be integer >=2');
  const rows=arr(attempts),last=rows.at(-1); if(rows.length<threshold||!last?.gate||!last?.reason_code||!last?.fact_fingerprint)return{detected:false,count:0,route:null};
  let count=0; for(let n=rows.length-1;n>=0;n--){const r=rows[n];if(r.gate!==last.gate||r.reason_code!==last.reason_code||r.fact_fingerprint!==last.fact_fingerprint)break;count++;}
  if(count<threshold)return{detected:false,count,route:null};
  const error=createStructuredFactoryError('RECOVERY_LOOP',{gate:last.gate,fact_fingerprint:last.fact_fingerprint});
  return{detected:true,count,route:routeStructuredFactoryError(error,{gate:last.gate})};
}

const sameFact=(a,b)=>{
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
};
const MANIFEST_SCHEMA='FACTORY_CANDIDATE_MANIFEST_V1';
export function validateCandidateManifest(manifest,facts,allowedPaths){
  const problems=[];
  if(!manifest||!facts){problems.push(p('CANDIDATE_MANIFEST_MISSING','manifest and factual Git snapshot are required','AMBIGUOUS'));return {valid:false,problems};}
  const identity=['issue','contract_version','branch','base_sha','head_sha','tree_sha'];
  if(manifest.schema_version!==MANIFEST_SCHEMA||!Array.isArray(manifest.paths)||!nonemptyStringArray(allowedPaths)||new Set(allowedPaths).size!==allowedPaths.length||!['base_sha','head_sha','tree_sha'].every(key=>SHA.test(String(manifest[key]??'')))){
    problems.push(p('CANDIDATE_MANIFEST_INVALID','explicit schema, SHA/tree/path manifest and authorized paths required','AMBIGUOUS'));
  }else{
    if(identity.some(key=>!sameFact(manifest[key],facts[key]))||!sameFact(manifest.paths,facts.paths))problems.push(p('CANDIDATE_MANIFEST_DRIFT','manifest differs from factual SHA/tree/paths'));
    const seen=new Set();
    for(const entry of manifest.paths){
      if(!entry||!nonempty(entry.path)||seen.has(entry.path)||!['added','modified','removed'].includes(entry.status)||!((entry.status==='removed'&&entry.blob_sha===null&&entry.mode===null)||(SHA.test(String(entry.blob_sha??''))&&['100644','100755','120000'].includes(entry.mode)))){
        problems.push(p('CANDIDATE_MANIFEST_INVALID','invalid or duplicate factual tree entry','AMBIGUOUS'));continue;
      }
      seen.add(entry.path);
      if(!allowedPaths.includes(entry.path))problems.push(p('CANDIDATE_PATH_UNAUTHORIZED',`undeclared path: ${entry.path}`));
    }
  }
  return {valid:problems.length===0,problems};
}

// Read-only discovery or orphan Git objects only. No probe may consume a canonical identity.
export function evaluateCapabilityProbe(operation={}){
  const allowed=operation.kind==='READ_ONLY'&&operation.mutates===false||
    operation.kind==='ORPHAN_GIT_OBJECT'&&operation.necessary===true&&operation.ref===null&&operation.canonical_side_effect===false;
  return allowed?{allowed:true,error:null}:{allowed:false,error:p('CAPABILITY_PROBE_CANONICAL_MUTATION','probe would mutate a canonical ref/Issue/claim/PR/deploy')};
}

const RECOVERY_FIELDS=Object.freeze(['recovery_error','recovery_invalidated_evidence','recovery_owner','recovery_unblock_action','recovery_retry_condition','recovery_evidence']);
export function evaluateRecoveryMetadata(input={}, {now=Date.now()}={}){
  const deny=detail=>({allowed:false,error:p('RECOVERY_METADATA_REJECTED',detail),consistency:verifyFactoryConsistency(input.current??{},{now})});
  const {current,expected,after,provenance,executor}=input;
  if(!current?.issue||!expected?.issue||!after?.issue||!sameFact(current,expected))return deny('exact snapshot CAS mismatch');
  if(!Number.isInteger(Number(current.issue?.contract_version))||Number(current.issue.contract_version)<3||current.issue?.production!=='prohibited')return deny('contract v3 authority and production prohibition required');
  if(!provenance||!nonempty(provenance.evidence_ref)||!nonempty(provenance.snapshot_ref)||!nonempty(provenance.issue_revision)||provenance.issue_revision!==current.provenance?.issue_revision||!nonempty(provenance.verifier_blob_sha)||!SHA.test(provenance.verifier_blob_sha)||!Number.isFinite(Date.parse(provenance.timestamp))||Date.parse(provenance.timestamp)>new Date(now).getTime()||new Date(now).getTime()-Date.parse(provenance.timestamp)>60_000)return deny('missing or stale factual provenance');
  const validRole=role=>typeof role==='string'&&/^(?:0[0-9]|1[0-4])$/.test(role);
  if(!validRole(current.issue.current_agent)||!validRole(executor?.role)||executor.role!==current.issue.current_agent||!nonempty(executor.run_id))return deny('executor identity mismatch');
  const handoff=current.latest_handoff,claim=current.winning_claim;
  if(!handoff||!nonempty(current.issue.active_handoff)||current.issue.active_handoff==='none'||handoff.id!==current.issue.active_handoff||handoff.current_agent!==current.issue.current_agent||handoff.status!==current.issue.handoff_status||!['PENDING','CLAIMED','SCHEDULED'].includes(handoff.status)||!nonempty(current.issue.next_gate)||!/^0[4-9]$/.test(String(current.issue.writer)))return deny('explicit canonical handoff authority required');
  if(current.issue.handoff_status==='CLAIMED'){
    if(current.issue.claimed_by!==executor.run_id||claim?.claimed_by!==executor.run_id||claim.handoff_id!==current.issue.active_handoff||!nonempty(current.issue.claim_expires_at)||!Number.isFinite(Date.parse(current.issue.claim_expires_at))||claim.claim_expires_at!==current.issue.claim_expires_at)return deny('competing or ambiguous claim preserved');
  }else if(current.issue.claimed_by!=='none'||current.issue.claim_expires_at!=='none'||claim&&claim.active!==false)return deny('ambiguous unclaimed handoff');
  if(!current.refs||!SHA.test(String(current.refs.branch_sha??''))||!SHA.test(String(current.refs.staging_sha??''))||current.refs.branch!==current.issue.branch||!current.lock||!['ACTIVE','INACTIVE'].includes(current.lock.status)||!nonempty(current.issue.active_handoff)||!nonempty(current.issue.writer)||!SHA.test(String(current.issue.base_sha??''))||!Array.isArray(current.dependencies))return deny('complete Issue/handoff/refs/lock/freshness identity required');
  const result=verifyFactoryConsistency(current,{now});
  if(!['DRIFT','AMBIGUOUS','STALE_CLAIM_SUSPECTED','ORPHAN_LOCK_SUSPECTED'].includes(result.status))return deny('exception applies only to factual non-CONSISTENT results');
  const stripped=structuredClone(after);
  for(const field of RECOVERY_FIELDS){
    if(Object.hasOwn(current.issue,field))stripped.issue[field]=current.issue[field];else delete stripped.issue[field];
  }
  if(!sameFact(stripped,current))return deny('mutation exceeds recovery field allowlist');
  const context={current_agent:current.issue.current_agent,writer:current.issue.writer,gate:current.issue.next_gate,head_sha:current.refs.branch_sha,material_capabilities:input.material_capabilities};
  const route=routeConsistencyResult(result,context),record=after.issue.recovery_error,evidence=after.issue.recovery_evidence;
  if(!route?.accepted||!record||record.schema_version!=='FACTORY_ERROR_V1'||record.code!==route.code||record.head_sha!==current.refs.branch_sha||record.evidence_ref!==provenance.evidence_ref||record.fact_fingerprint!==provenance.snapshot_ref)return deny('structured error must bind factual result and snapshot');
  if(after.issue.recovery_owner!==route.owner||after.issue.recovery_unblock_action!==route.unblock_action||after.issue.recovery_retry_condition!==route.retry_condition)return deny('owner/action/retry must match deterministic canonical route');
  if(!evidence||evidence.gate!=='RECOVERY_METADATA'||evidence.result!==result.status||evidence.issue!==current.issue.number||evidence.contract_version!==current.issue.contract_version||evidence.branch!==current.refs.branch||evidence.base_sha!==current.issue.base_sha||evidence.head_sha!==current.refs.branch_sha||evidence.timestamp!==provenance.timestamp||!sameFact(evidence.suites_required,[])||!sameFact(evidence.suites_executed,[])||!sameFact(evidence.suites_skipped,[])||!validateEvidenceEnvelope(evidence,{expectedHeadSha:current.refs.branch_sha}).valid)return deny('factual non-PASS Evidence Envelope required');
  const stale=current.evidence&&current.evidence.head_sha!==current.refs.branch_sha?[current.evidence.head_sha]:[];
  if(!sameFact(after.issue.recovery_invalidated_evidence,stale))return deny('invalidate only the proven stale evidence identity');
  const afterResult=verifyFactoryConsistency(after,{now});
  if(!sameFact(afterResult,result))return deny('recovery metadata must preserve factual non-CONSISTENT result');
  return {allowed:true,error:null,consistency:result,route,allowed_fields:[...RECOVERY_FIELDS]};
}

const readInput=(path)=>JSON.parse(path?readFileSync(path,'utf8'):readFileSync(0,'utf8'));
async function main([command,path]){const input=readInput(path);let out;if(command==='consistency')out=verifyFactoryConsistency(input);else if(command==='evidence')out=validateEvidenceEnvelope(input.envelope??input,input.options??{});else if(command==='preflight')out=validateWriterValidationPreflight(input.preflight??input);else if(command==='route')out=routeStructuredFactoryError(input.error,input.context??{});else if(command==='recovery-metadata')out=evaluateRecoveryMetadata(input);else if(command==='probe')out=evaluateCapabilityProbe(input);else if(command==='manifest')out=validateCandidateManifest(input.manifest,input.facts,input.allowed_paths);else if(command==='loop')out=detectRecoveryLoop(input.attempts??input,input.threshold??3);else throw new Error('usage: factory-recovery-controls.mjs <consistency|evidence|preflight|route|loop> [json-file]');process.stdout.write(`${JSON.stringify(out,null,2)}\n`);if((out.status&&out.status!=='CONSISTENT')||out.valid===false||out.accepted===false||out.allowed===false)process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=2;});
