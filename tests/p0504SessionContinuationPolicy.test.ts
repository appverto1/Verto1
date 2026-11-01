import assert from 'node:assert/strict';
import { canAutoCloseClinicalSession, financialContinuationPreview,
  previewSessionContinuation, resolveCanonicalSessionEnd } from '../src/utils/sessionContinuationPolicy';

const fixed = {scheduledEndAt:'2026-11-02T18:50:00.000Z',
  actualStartedAt:'2026-11-02T18:00:00.000Z',scheduledBaseDurationMinutes:50};
assert.equal(resolveCanonicalSessionEnd(fixed),'2026-11-02T18:50:00.000Z');
assert.equal(resolveCanonicalSessionEnd({...fixed,actualStartedAt:'2026-11-02T18:10:00.000Z'}),'2026-11-02T19:00:00.000Z');
assert.equal(resolveCanonicalSessionEnd({...fixed,persistedEffectiveEndAt:'2026-11-02T19:15:00.000Z'}),'2026-11-02T19:15:00.000Z');
assert.equal(resolveCanonicalSessionEnd({...fixed,scheduledBaseDurationMinutes:0}),null);
assert.equal(resolveCanonicalSessionEnd({...fixed,actualStartedAt:'invalid'}),null);
for (const duration of [30,45,50,60,90]) {
  const a={...fixed,scheduledBaseDurationMinutes:duration};
  const answer=previewSessionContinuation(a,'FULL');
  assert.equal(answer?.additionalMinutes,duration);
  assert.equal(answer?.additionalBillableSessions,1);
  assert.equal(answer?.requiresBackendConflictAndAuthorizationCheck,true);
}
const full=previewSessionContinuation(fixed,'FULL');
assert.equal(full?.proposedEndAt,'2026-11-02T19:40:00.000Z');
for(const [choice,end] of [[5,'2026-11-02T18:55:00.000Z'],
  [10,'2026-11-02T19:00:00.000Z'],[15,'2026-11-02T19:05:00.000Z']] as const) {
  const preview=previewSessionContinuation(fixed,choice);
  assert.equal(preview?.proposedEndAt,end);
  assert.equal(preview?.additionalBillableSessions,0,'short extension cannot automatically bill a full unit');
}
assert.deepEqual(financialContinuationPreview(18000,'FULL',1),{
  originalUnitPriceCents:18000,alreadyCommittedCents:18000,
  additionalCents:18000,quotedTotalCents:36000,additionalBillableUnits:1,actualChargeCreated:false
});
assert.equal(financialContinuationPreview(18000,'FULL',2)?.quotedTotalCents,54000);
assert.equal(financialContinuationPreview(10000,5,1)?.additionalCents,0);
assert.equal(financialContinuationPreview(-1,'FULL',1),null);
assert.equal(financialContinuationPreview('18000','FULL',1),null);
assert.equal(financialContinuationPreview(18000,'FULL',0),null);

const proof = {
  status:'active',effectiveEndAt:'2026-11-02T18:50:00.000Z',
  continuationQuestionAt:'2026-11-02T18:50:00.000Z',
  now:'2026-11-02T18:55:00.000Z',
  lastDurableClinicalWriteAt:'2026-11-02T18:49:00.000Z',
  serverObservedClinicalCursor:true,
  pendingClinicalWrites:false,pendingOfflineSync:false,
  openClinicalTimers:false,extensionInProgress:false,pendingCollectionReview:false,
  appointmentId:'synthetic-appointment',
};
assert.equal(canAutoCloseClinicalSession(proof),true);
for (const unsafe of [
  {now:'2026-11-02T18:54:59.000Z'},
  {lastDurableClinicalWriteAt:'2026-11-02T18:53:00.000Z'},
  {lastDurableClinicalWriteAt:'garbled'},
  {serverObservedClinicalCursor:false},
  {pendingClinicalWrites:true},{pendingOfflineSync:true},
  {openClinicalTimers:true},{extensionInProgress:true},
  {pendingCollectionReview:true},{appointmentId:null},
  {status:'completed'}, {effectiveEndAt:'invalid'},
  {continuationQuestionAt:'2026-11-02T18:40:00.000Z'},
  {now:'invalid'},
]) assert.equal(canAutoCloseClinicalSession({...proof,...unsafe}),false,JSON.stringify(unsafe));
console.log('P0-504 session continuation policy: PASS (pure, no database mutations).');
