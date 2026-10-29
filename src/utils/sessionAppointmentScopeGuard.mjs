// Read-only P0 #504 gate: backend-provided records only. Never relink a legacy session.
const norm=x=>String(x??'').trim();
const field=(o,...names)=>names.map(n=>norm(o?.[n])).find(Boolean)||'';
const deny=reason=>Object.freeze({safe:false,reason});
export function assessScheduledSessionReuse({session,appointment,patientId,clinicId,professionalId,planId,sessionSpecialtyKey,appointmentSpecialtyKey,serverVerified}){
 if(serverVerified!==true||!session||!appointment)return deny('SERVER_PREFLIGHT_REQUIRED');
 if(!['active','in_progress'].includes(norm(session.status).toLowerCase()))return deny('SESSION_NOT_ACTIVE');
 const checks=[
  ['APPOINTMENT',field(session,'appointment_id','appointmentId'),field(appointment,'id','appointment_id','appointmentId')],
  ['PATIENT',field(session,'patient_id','patientId'),field(appointment,'patient_id','patientId'),patientId],
  ['CLINIC',field(session,'clinic_id','clinicId'),field(appointment,'clinic_id','clinicId'),clinicId],
  ['PROFESSIONAL',field(session,'professional_id','professionalId','therapist_id','therapistId'),field(appointment,'professional_id','professionalId','therapist_id','therapistId'),professionalId],
  ['PLAN',field(session,'therapeutic_plan_id','therapeuticPlanId'),field(appointment,'therapeutic_plan_id','therapeuticPlanId'),planId],
 ];
 for(const [label,s,a,want] of checks){
   if(!s||!a||(want!==undefined&&!norm(want)))return deny(label+'_UNVERIFIED');
   if(s!==a||(want!==undefined&&s!==norm(want)))return deny(label+'_MISMATCH');
 }
 if(!norm(sessionSpecialtyKey)||!norm(appointmentSpecialtyKey))return deny('SPECIALTY_UNVERIFIED');
 if(norm(sessionSpecialtyKey)!==norm(appointmentSpecialtyKey))return deny('SPECIALTY_MISMATCH');
 return Object.freeze({safe:true,reason:null});
}