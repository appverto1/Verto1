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

/**
 * UI-only rejection of clearly unsafe session reuse.
 * NEVER treats localStorage/browser data as authorization for a backend write.
 * An unlinked legacy session requires server-mediated recovery, not implicit rebinding.
 */
export function detectUnsafeLocalSessionReuse(session,appointment,patientId) {
  if(!session||!appointment||!norm(patientId))return deny('MISSING_CONTEXT');
  const oldAppointment=field(session,'appointment_id','appointmentId');
  const requestedAppointment=field(appointment,'appointment_id','appointmentId','id');
  if(!oldAppointment||!requestedAppointment)return deny('APPOINTMENT_UNVERIFIED');
  if(oldAppointment!==requestedAppointment)return deny('APPOINTMENT_MISMATCH');
  const oldPatient=field(session,'patient_id','patientId');
  if(!oldPatient||oldPatient!==norm(patientId))return deny('PATIENT_MISMATCH');
  const scheduledPatient=field(appointment,'patient_id','patientId');
  if(scheduledPatient&&scheduledPatient!==oldPatient)return deny('PATIENT_MISMATCH');
  const pairs=[
    ['CLINIC',field(session,'clinic_id','clinicId'),field(appointment,'clinic_id','clinicId')],
    ['PROFESSIONAL',field(session,'professional_id_snapshot','professional_id','professionalId','therapist_id','therapistId'),
      field(appointment,'professional_id','professionalId','therapist_id','therapistId')],
  ];
  for(const [key,oldValue,newValue] of pairs){
    // Fail closed on unknown scope; a client cache is not a valid source of identity.
    if(!oldValue||!newValue)return deny(key+'_UNVERIFIED');
    if(oldValue!==newValue)return deny(key+'_MISMATCH');
  }
  // Appointments do not have a top-level therapeutic_plan_id column.
  // Reject a known mismatch, but do not invent an appointment plan link.
  const planOnSession=field(session,'therapeutic_plan_id','therapeuticPlanId');
  const planOnAppointment=field(appointment,'therapeutic_plan_id','therapeuticPlanId');
  if(planOnSession&&planOnAppointment&&planOnSession!==planOnAppointment)
    return deny('PLAN_MISMATCH');
  return Object.freeze({safe:true,reason:null,requiresServerAuthorization:true});
}
