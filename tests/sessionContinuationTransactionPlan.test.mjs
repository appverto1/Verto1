import assert from 'node:assert/strict';
import {planSessionContinuationTransaction as plan} from '../src/utils/sessionContinuationTransactionPlan.mjs';
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const next={appointmentId:id(9),patientId:id(8),clinicId:id(2),mustNeverAutoCancel:false,cancellationNoChargeVerified:true,hasCapturedPayment:false};
const q={choice:'full',additionalMinutes:50,baselineEndAt:'2026-10-27T17:50:00Z',nextEndAt:'2026-10-27T18:40:00Z',additionalChargeCents:18000,twoUnitTotalCents:36000,additionalBillableUnits:1,unitPriceCents:18000,existingBillableUnits:1,projectedBillableUnits:2,projectedTotalCents:36000};
const data={actorId:id(3),organizationId:id(1),clinicId:id(2),appointmentClinicId:id(2),sessionClinicId:id(2),patientId:id(4),appointmentPatientId:id(4),sessionPatientId:id(4),appointmentId:id(5),sessionId:'session-A',idempotencyKey:'session:unique-12345',isSessionActive:true,hasIncompleteClinicalWrites:false,hasOpenSessionTimers:false,baseDurationMinutes:50,choice:'full',quote:q,conflicts:{safe:true,conflicting:[next]},permissions:['session.finish','calendar.appointment.create','finance.entries.manage','calendar.appointment.cancel'],financialEngine:'AT_SESSION'};
assert.equal(plan(data).approved,true);assert.equal(plan(data).additionalChargeCents,18000);assert.deepEqual(plan(data).cancelAppointmentIds,[id(9)]);
for(const [patch,reason] of [
[{actorId:'bad'},'INVALID_TRUSTED_SCOPE'],[{clinicId:id(1)},'CLINIC_OR_PATIENT_MISMATCH'],[{sessionPatientId:id(9)},'CLINIC_OR_PATIENT_MISMATCH'],[{baseDurationMinutes:45},'INVALID_WINDOW'],
[{idempotencyKey:'tiny'},'INVALID_SESSION_OR_KEY'],[{isSessionActive:false},'SESSION_NOT_ACTIVE'],
[{hasIncompleteClinicalWrites:true},'CLINICAL_WRITE_PENDING'],[{choice:'10'},'INVALID_CHOICE'],
[{quote:{...q,nextEndAt:q.baselineEndAt}},'INVALID_WINDOW'],[{permissions:['session.finish']},'MISSING_REQUIRED_CAPABILITY'],
[{conflicts:{safe:false,conflicting:[]}},'UNVERIFIED_CONFLICTS'],
[{permissions:data.permissions.filter(x=>x!=='calendar.appointment.cancel')},'CANCELLATION_CAPABILITY_REQUIRED'],
[{conflicts:{safe:true,conflicting:[{...next,mustNeverAutoCancel:true}]}},'UNSAFE_CANCELLATION'],
[{conflicts:{safe:true,conflicting:[next,next]}},'DUPLICATE_CANCELLATION'],
[{financialEngine:'NONE'},'UNVERIFIED_FINANCIAL_ENGINE'],
[{conflicts:{safe:true,conflicting:[{...next,cancellationNoChargeVerified:false}]}},'UNSAFE_CANCELLATION'],
[{conflicts:{safe:true,conflicting:[{...next,hasCapturedPayment:true}]}},'UNSAFE_CANCELLATION'],
[{quote:{...q,projectedTotalCents:54000}},'UNVERIFIED_PRICE']
])assert.equal(plan({...data,...patch}).reason,reason);
const small={...q,choice:'10',additionalMinutes:10,nextEndAt:'2026-10-27T18:00:00Z',additionalBillableUnits:0,additionalChargeCents:0};
assert.equal(plan({...data,choice:'10',quote:small}).reason,'NEXT_PATIENT_REQUIRES_FULL_SESSION_DECISION');
assert.equal(plan({...data,choice:'10',quote:small,conflicts:{safe:true,conflicting:[]}}).approved,true);
assert.equal(plan({...data,choice:'10',quote:{...small,additionalChargeCents:18000},conflicts:{safe:true,conflicting:[]}}).reason,'SMALL_EXTENSION_CANNOT_CHARGE');
console.log('sessionContinuationTransactionPlan.test.mjs: ok');

const triple={...q,existingBillableUnits:2,projectedBillableUnits:3,projectedTotalCents:54000,twoUnitTotalCents:null};
assert.equal(plan({...data,quote:triple}).approved,true);
assert.equal(plan({...data,quote:{...triple,projectedTotalCents:72000}}).reason,'UNVERIFIED_PRICE');
assert.equal(plan({...data,conflicts:{safe:true,conflicting:[{...next,patientId:data.patientId}]}}).reason,'SAME_PATIENT_BOOKING_CONFLICT');
