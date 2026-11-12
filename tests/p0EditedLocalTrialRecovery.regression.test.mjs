import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const session = readFileSync('src/components/SessionMode.tsx', 'utf8');
const start = session.indexOf('  const canRecoverUnconfirmedSessionTrial = (record: SessionRecord) => {');
const end = session.indexOf('\n  const retryUnconfirmedSessionTrial = async ', start);
assert.ok(start >= 0 && end > start, 'recovery predicate must exist');
const predicate = session.slice(start, end)
  .replace('(record: SessionRecord)', '(record)')
  .replace(/^  /gm, '');
const canRecover = new Function(predicate + '\nreturn canRecoverUnconfirmedSessionTrial;')();

const trial = {
  id: 'trial-old', kind: 'trial', targetId: 'target-real',
  syncStatus: 'local', editedAt: '2026-11-12T14:01:00Z',
  rawPayload: { source: 'session_mode_trial', clientTrialId: 'trial-old' }
};
assert.equal(canRecover(trial), true, 'pre-hotfix edited-local trial must allow explicit recovery');
assert.equal(canRecover({ ...trial, syncStatus: 'error', editedAt: undefined }), true, 'original failed trial remains recoverable');
assert.equal(canRecover({ ...trial, rawPayload: { ...trial.rawPayload, durableRecoveryQueued: true } }), false, 'one durable queue intent must suppress repeated retries');
assert.equal(canRecover({ ...trial, rawPayload: { ...trial.rawPayload, syncStatusBeforeEdit: 'synced' } }), false, 'a newly edited, previously synced record is not an offline failure');
assert.equal(canRecover({ ...trial, rawPayload: { ...trial.rawPayload, syncStatusBeforeEdit: 'local' } }), false, 'new local edits need their own persistence workflow');
assert.equal(canRecover({ ...trial, syncStatus: 'synced' }), false);
assert.equal(canRecover({ ...trial, measurementModelVersion: 'V3' }), false, 'ABA V3 revision uses separate append-only flow');
assert.equal(canRecover({ ...trial, kind: 'behavior' }), false);
assert.equal(canRecover({ ...trial, rawPayload: { source: 'untrusted' } }), false);
assert.equal(canRecover({ ...trial, targetId: '' }), false);

assert.match(session, /syncStatus: original\.kind === 'trial' && original\.syncStatus === 'error' \? 'error' : 'local'/,
  'edit must not turn a failed record into a false local save');
assert.match(session, /rawPayload: \{ \.\.\.original\.rawPayload, syncStatusBeforeEdit: original\.syncStatus \}/,
  'future edits must keep their original status for safe classification');
assert.match(session, /onClick=\{\(\) => void retryUnconfirmedSessionTrial\(record\)\}/,
  'recoverable edited record needs an explicit button');
assert.match(session, /const queued = result\?\.pending === true && result\?\.durable === true/,
  'only durable queued writes may be reported as local');
assert.match(session, /rawPayload: \{ \.\.\.record\.rawPayload, durableRecoveryQueued: queued \}/,
  'queued state must prevent repeated retry intents');
assert.match(session, /if \(!confirmed && !queued\) throw new Error/,
  'unconfirmed writes must never be marked synced');

console.log('p0EditedLocalTrialRecovery.regression.test.mjs: ok');
