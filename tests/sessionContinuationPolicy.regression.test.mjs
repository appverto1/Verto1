import assert from 'node:assert/strict';
import { canonicalSessionEnd, previewSessionContinuation, previewContinuationConflicts, automaticClosureEligibility } from '../src/utils/sessionContinuationPolicy.mjs';

const clinic = '11111111-1111-4111-8111-111111111111';
const org = '22222222-2222-4222-8222-222222222222';
const professional = '33333333-3333-4333-8333-333333333333';
const a = '44444444-4444-4444-8444-444444444444';
const b = '55555555-5555-4555-8555-555555555555';

const base = {scheduledEndAt:'2026-10-27T17:50:00.000Z', actualStartAt:'2026-10-27T17:00:00.000Z',baseDurationMinutes:50,trustedUnitPriceCents:18000};
assert.equal(canonicalSessionEnd(base),'2026-10-27T17:50:00.000Z');
assert.equal(canonicalSessionEnd({...base,actualStartAt:'2026-10-27T17:10:00.000Z'}),'2026-10-27T18:00:00.000Z');
for (const [choice,minutes] of [['5',5],['10',10],['15',15],['full',50]]) {
  const result=previewSessionContinuation({...base,choice});
  assert.equal(result.additionalMinutes,minutes);
  assert.equal(result.additionalChargeCents,choice==='full'?18000:0);
}
const full=previewSessionContinuation({...base,choice:'full'});
assert.equal(full.nextEndAt,'2026-10-27T18:40:00.000Z');
assert.equal(full.twoUnitTotalCents,36000);
const third=previewSessionContinuation({...base,choice:'full',existingBillableUnits:2});
assert.equal(third.additionalChargeCents,18000);
assert.equal(third.projectedTotalCents,54000);
assert.equal(third.twoUnitTotalCents,null);
assert.throws(()=>previewSessionContinuation({...base,choice:'full',existingBillableUnits:0}));
assert.equal(previewSessionContinuation({...base,baseDurationMinutes:30,choice:'full'}).additionalMinutes,30);
assert.throws(()=>previewSessionContinuation({...base,choice:'full',trustedUnitPriceCents:-1}));
assert.throws(()=>previewSessionContinuation({...base,choice:'30'}));

const other={id:'66666666-6666-4666-8666-666666666666',organization_id:org,clinic_id:clinic,
 therapist_id:professional,patient_id:b,status:'scheduled',cancellation_without_charge_verified:true,has_captured_payment:false,
 scheduled_start_at:'2026-10-27T17:50:00.000Z',scheduled_end_at:'2026-10-27T18:40:00.000Z'};
const query={organizationId:org,clinicId:clinic,professionalId:professional,patientId:a,
 startAt:'2026-10-27T17:50:00.000Z',endAt:'2026-10-27T18:40:00.000Z',appointments:[other],
 workingPeriods:[{startAt:'2026-10-27T16:00:00.000Z',endAt:'2026-10-27T19:00:00.000Z'}],blockedPeriods:[]};
assert.equal(previewContinuationConflicts(query).conflicting.length,1);
assert.equal(previewContinuationConflicts(query).conflicting[0].cancellationNoChargeVerified,true);
assert.equal(previewContinuationConflicts(query).conflicting[0].hasCapturedPayment,false);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,clinic_id:'77777777-7777-4777-8777-777777777777'}]}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:null}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,status:'cancelled'}]}).conflicting.length,0);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,active_aba_session_id:'in_progress'}]}).safe,false);


assert.equal(previewContinuationConflicts({...query, workingPeriods:undefined}).safe,false);
assert.equal(previewContinuationConflicts({...query, sessionBufferMinutes:121}).reason,'UNVERIFIED_SESSION_BUFFER');
assert.equal(previewContinuationConflicts({...query, workingPeriods:[{startAt:'2026-10-27T16:00:00.000Z',endAt:'2026-10-27T18:39:00.000Z'}]}).reason,'OUTSIDE_WORK_SCHEDULE_OR_BUFFER');
assert.equal(previewContinuationConflicts({...query, blockedPeriods:[{startAt:'2026-10-27T18:00:00.000Z',endAt:'2026-10-27T18:10:00.000Z'}]}).reason,'BREAK_OR_PAUSE_CONFLICT');
assert.equal(previewContinuationConflicts({...query, appointments:[{...other, therapist_id:'99999999-9999-4999-8999-999999999999',patient_id:a}]}).safe,false);
assert.equal(previewContinuationConflicts({...query, roomId:'room-5', appointments:[{...other, therapist_id:'99999999-9999-4999-8999-999999999999',room_id:'room-5'}]}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,actual_start_at:'2026-10-27T17:52:00.000Z'}]}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,cancellation_without_charge_verified:false}]}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,has_captured_payment:true}]}).safe,false);

const closing={...base,status:'active',organizationId:org,clinicId:clinic,patientId:a,professionalId:professional,
 appointmentId:'88888888-8888-4888-8888-888888888888',
 lastConfirmedClinicalActivityAt:'2026-10-27T17:48:00.000Z',
 hasUnflushedClinicalWrites:false,hasOpenTimers:false,hasPendingSync:false,
 serverVerifiedSyncComplete:true,collectionStateKnown:true,syncAttestedAt:'2026-10-27T17:56:00.000Z',
 now:'2026-10-27T17:56:00.000Z'};
assert.equal(automaticClosureEligibility(closing).eligible,true);
assert.equal(automaticClosureEligibility({...closing,now:'2026-10-27T17:54:00.000Z'}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,lastConfirmedClinicalActivityAt:'2026-10-27T17:53:00.000Z'}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,hasPendingSync:true}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,syncAttestedAt:'2026-10-27T17:53:00.000Z'}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,serverVerifiedSyncComplete:false}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,collectionStateKnown:false}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,lastConfirmedClinicalActivityAt:null}).eligible,false);
assert.equal(automaticClosureEligibility({...closing,syncAttestedAt:null}).eligible,false);
assert.throws(()=>previewContinuationConflicts({...query,appointments:[{...other,scheduled_end_at:null}]}));
console.log('sessionContinuationPolicy.regression.test.mjs: ok');
