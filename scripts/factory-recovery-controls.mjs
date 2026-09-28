import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const EXPECTED_WRITER_VALIDATION_WORKFLOW = 'Verto Candidate Writer Validation';
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
const issueRef = (v) => String(v ?? '').replace(/^#/,'');
const p = (code, detail, severity='DRIFT') => ({code,detail,severity});
const statusOf = (ps) => ps.some(x=>x.severity==='AMBIGUOUS') ? 'AMBIGUOUS'
  : ps.some(x=>x.severity==='ORPHAN_LOCK_SUSPECTED') ? 'ORPHAN_LOCK_SUSPECTED'
  : ps.some(x=>x.severity==='STALE_CLAIM_SUSPECTED') ? 'STALE_CLAIM_SUSPECTED'
  : ps.length ? 'DRIFT' : 'CONSISTENT';

export function validateEvidenceEnvelope(e, {expectedHeadSha, requireRunCheck=false}={}) {
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
  const req=new Set(arr(e.suites_required)), ran=new Set(arr(e.suites_executed)), skipped=new Set(arr(e.suites_skipped));
  for (const s of req) {
    if (skipped.has(s)) errors.push({code:'REQUIRED_SUITE_SKIPPED',detail:`required suite skipped: ${s}`});
    else if (!ran.has(s)) errors.push({code:'REQUIRED_SUITE_MISSING',detail:`required suite not executed: ${s}`});
  }
  if (Number.isNaN(new Date(e.timestamp).getTime())) errors.push({code:'EVIDENCE_TIMESTAMP_INVALID',detail:'invalid timestamp'});
  const automatedGate = ['WRITER_VALIDATION','STAGING_CI'].includes(String(e.gate));
  if (requireRunCheck || automatedGate) {
    if (!e.run_id) errors.push({code:'RUN_ID_MISSING',detail:'run_id required'});
    if (!e.check_id) errors.push({code:'CHECK_ID_MISSING',detail:'check_id required'});
    if (e.run_head_sha!==e.head_sha) errors.push({code:'HEAD_DRIFT',detail:'run head differs from evidence head'});
    if (e.check_conclusion!=='success') errors.push({code:'CHECK_NOT_GREEN',detail:'required check is not green'});
  }
  if (String(e.result).endsWith('_PASS') && errors.length) errors.push({code:'PASS_INVALIDATED',detail:'PASS cannot survive mismatched/incomplete evidence'});
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
  if (nonempty(i.current_agent) && !labels.has(`agent:${i.current_agent}`)) ps.push(p('AGENT_LABEL_DRIFT',`missing agent:${i.current_agent}`));
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
  if (!SHA.test(String(i.base_sha??'')) || !SHA.test(String(refs.staging_sha??''))) ps.push(p('FRESHNESS_EVIDENCE_MISSING','full base/staging SHAs required','AMBIGUOUS'));
  else if (i.base_sha!==refs.staging_sha) ps.push(p('BASE_STAGING_DRIFT','base differs from current staging'));

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
  if (evidencePolicy==='ENVELOPE' || evidencePolicy==='RUN_CHECK') {
    if (!s.evidence) ps.push(p('EVIDENCE_MISSING','evidence required by evidence_policy','AMBIGUOUS'));
    else for (const e of validateEvidenceEnvelope(s.evidence,{expectedHeadSha:i.head_sha||undefined,requireRunCheck:evidencePolicy==='RUN_CHECK'}).errors) ps.push(p(e.code,e.detail));
  } else if (s.evidence) {
    for (const e of validateEvidenceEnvelope(s.evidence,{expectedHeadSha:i.head_sha||undefined}).errors) ps.push(p(e.code,e.detail));
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
    HEAD_DRIFT:[agent,'Refresh exact staging/base/head refs and rebuild evidence.','Fresh base/head/ref equality is restored and SHA-bound gates rerun.'],
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
  else if (codes.has('HEAD_DRIFT')||codes.has('BASE_STAGING_DRIFT')) code='HEAD_DRIFT';
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

const readInput=(path)=>JSON.parse(path?readFileSync(path,'utf8'):readFileSync(0,'utf8'));
async function main([command,path]){const input=readInput(path);let out;if(command==='consistency')out=verifyFactoryConsistency(input);else if(command==='evidence')out=validateEvidenceEnvelope(input.envelope??input,input.options??{});else if(command==='preflight')out=validateWriterValidationPreflight(input.preflight??input);else if(command==='route')out=routeStructuredFactoryError(input.error,input.context??{});else if(command==='loop')out=detectRecoveryLoop(input.attempts??input,input.threshold??3);else throw new Error('usage: factory-recovery-controls.mjs <consistency|evidence|preflight|route|loop> [json-file]');process.stdout.write(`${JSON.stringify(out,null,2)}\n`);if((out.status&&out.status!=='CONSISTENT')||out.valid===false||out.accepted===false)process.exitCode=2;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=2;});
