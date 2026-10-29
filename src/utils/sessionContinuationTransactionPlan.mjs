// P0-504: fail-closed pure preflight. Does NOT charge or cancel anyone.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key=/^[A-Za-z0-9:._-]{12,120}$/;
const s=v=>String(v??'').trim();
const reject=reason=>Object.freeze({approved:false,reason});
export function planSessionContinuationTransaction(p){
 if(!p||['actorId','organizationId','clinicId','patientId','appointmentId'].some(k=>!UUID.test(s(p[k]))))return reject('INVALID_TRUSTED_SCOPE');
 // Organization and clinic are distinct identifiers. Verify both source records against clinic scope.
 if(p.appointmentClinicId!==p.clinicId||p.sessionClinicId!==p.clinicId||
   p.appointmentPatientId!==p.patientId||p.sessionPatientId!==p.patientId)
   return reject('CLINIC_OR_PATIENT_MISMATCH');
 if(!s(p.sessionId)||s(p.sessionId).length>180||!key.test(s(p.idempotencyKey)))return reject('INVALID_SESSION_OR_KEY');
 if(p.isSessionActive!==true)return reject('SESSION_NOT_ACTIVE');
 if(!Number.isInteger(p.baseDurationMinutes)||p.baseDurationMinutes<15||p.baseDurationMinutes>360)return reject('UNVERIFIED_BASE_DURATION');
 if(p.hasIncompleteClinicalWrites!==false||p.hasOpenSessionTimers!==false)return reject('CLINICAL_WRITE_PENDING');
 if(!['5','10','15','full'].includes(p.choice)||p.quote?.choice!==p.choice)return reject('INVALID_CHOICE');
 const q=p.quote, full=p.choice==='full';
 if(!Number.isInteger(q.additionalMinutes)||q.additionalMinutes!==(full?p.baseDurationMinutes:Number(p.choice))||
 !Number.isFinite(Date.parse(q.baselineEndAt))||!Number.isFinite(Date.parse(q.nextEndAt))||
 Date.parse(q.nextEndAt)-Date.parse(q.baselineEndAt)!==q.additionalMinutes*60000)
 return reject('INVALID_WINDOW');
 if(!Array.isArray(p.permissions)||['session.finish','calendar.appointment.create','finance.entries.manage']
 .some(cap=>!p.permissions.includes(cap)))return reject('MISSING_REQUIRED_CAPABILITY');
 if(p.conflicts?.safe!==true||!Array.isArray(p.conflicts.conflicting))return reject('UNVERIFIED_CONFLICTS');
 if(p.conflicts.conflicting.some(c=>c?.mustNeverAutoCancel!==false))return reject('UNSAFE_CANCELLATION');
 if(p.conflicts.conflicting.some(c=>c?.patientId===p.patientId))return reject('SAME_PATIENT_BOOKING_CONFLICT');
 const other=p.conflicts.conflicting.filter(c=>c?.patientId!==p.patientId);
 if(other.length&&!full)return reject('NEXT_PATIENT_REQUIRES_FULL_SESSION_DECISION');
 if(other.length&&!p.permissions.includes('calendar.appointment.cancel'))return reject('CANCELLATION_CAPABILITY_REQUIRED');
 if(other.some(c=>c.mustNeverAutoCancel!==false||c.cancellationNoChargeVerified!==true||
 c.hasCapturedPayment!==false||c.clinicId!==p.clinicId||!UUID.test(s(c.appointmentId))||!UUID.test(s(c.patientId))))return reject('UNSAFE_CANCELLATION');
 if(new Set(other.map(c=>c.appointmentId)).size!==other.length)return reject('DUPLICATE_CANCELLATION');
 if(full){
   if(!['AT_SESSION','MONTHLY_SESSION'].includes(p.financialEngine))return reject('UNVERIFIED_FINANCIAL_ENGINE');
   if(!Number.isSafeInteger(q.additionalChargeCents)||q.additionalChargeCents<0||q.additionalBillableUnits!==1||
   !Number.isSafeInteger(q.unitPriceCents)||q.unitPriceCents<0||
   !Number.isSafeInteger(q.existingBillableUnits)||q.existingBillableUnits<1||
   q.additionalChargeCents!==q.unitPriceCents||
   q.projectedBillableUnits!==q.existingBillableUnits+1||
   !Number.isSafeInteger(q.projectedTotalCents)||
   q.projectedTotalCents!==q.unitPriceCents*q.projectedBillableUnits)return reject('UNVERIFIED_PRICE');
 } else if(q.additionalChargeCents!==0||q.additionalBillableUnits!==0)return reject('SMALL_EXTENSION_CANNOT_CHARGE');
 return Object.freeze({approved:true,reason:null,sessionId:s(p.sessionId),idempotencyKey:s(p.idempotencyKey),
 endAt:q.nextEndAt,additionalMinutes:q.additionalMinutes,bookFullUnit:full,
 cancelAppointmentIds:Object.freeze(other.map(c=>c.appointmentId)),
 additionalChargeCents:full?q.additionalChargeCents:0,
 financialEngine:full?p.financialEngine:null,transactionRequired:true});
}
