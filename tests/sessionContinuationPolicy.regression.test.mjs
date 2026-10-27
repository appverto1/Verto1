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
assert.equal(previewSessionContinuation({...base,baseDurationMinutes:30,choice:'full'}).additionalMinutes,30);
assert.throws(()=>previewSessionContinuation({...base,choice:'full',trustedUnitPriceCents:-1}));
assert.throws(()=>previewSessionContinuation({...base,choice:'30'}));

const other={id:'66666666-6666-4666-8666-666666666666',organization_id:org,clinic_id:clinic,
 therapist_id:professional,patient_id:b,status:'scheduled',
 scheduled_start_at:'2026-10-27T17:50:00.000Z',scheduled_end_at:'2026-10-27T18:40:00.000Z'};
const query={organizationId:org,clinicId:clinic,professionalId:professional,patientId:a,
 startAt:'2026-10-27T17:50:00.000Z',endAt:'2026-10-27T18:40:00.000Z',appointments:[other]};
assert.equal(previewContinuationConflicts(query).conflicting.length,1);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,clinic_id:'77777777-7777-4777-8777-777777777777'}]}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:null}).safe,false);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,status:'cancelled'}]}).conflicting.length,0);
assert.equal(previewContinuationConflicts({...query,appointments:[{...other,active_aba_session_id:'in_progress'}]}).safe,false);

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
console.log('sessionContinuationPolicy.regression.test.mjs: ok');
