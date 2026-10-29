// P0-504: pure projection updater for clinic_state.appointments.
// Caller MUST lock clinic_state FOR UPDATE and perform a compare-and-set on
// section_versions.appointments/revision inside the SAME PostgreSQL transaction.
// Never send this patch directly to the generic public save-clinic-state route.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str=x=>String(x??'').trim();
export class SessionAgendaProjectionConflict extends Error{
  constructor(code){super(code);this.name='SessionAgendaProjectionConflict';this.code=code;}
}
const deny=code=>{throw new SessionAgendaProjectionConflict(code)};
const appId=x=>str(x?.id);
const cancellable=new Set(['scheduled','pending','confirmed']);
/** Only call with canonically verified, locked appointment rows and a revision. */
export function createSessionContinuationAgendaProjection({
  appointments,originalAppointmentId,cancelAppointmentIds=[],
  continuationAppointment=null,clinicId,actorId,sectionVersion,at
}){
  if(!Array.isArray(appointments)||!UUID.test(str(clinicId))||
     !UUID.test(str(actorId))||!Number.isSafeInteger(sectionVersion)||
     sectionVersion<0||!Number.isFinite(Date.parse(at)))deny('UNVERIFIED_AGENDA_REVISION');
  if(!UUID.test(str(originalAppointmentId))||
     !Array.isArray(cancelAppointmentIds)||cancelAppointmentIds.some(id=>!UUID.test(str(id)))||
     new Set(cancelAppointmentIds).size!==cancelAppointmentIds.length)
    deny('INVALID_APPOINTMENT_IDS');
  const original=appointments.filter(x=>appId(x)===originalAppointmentId);
  if(original.length!==1)deny('SOURCE_APPOINTMENT_NOT_UNIQUE');
  if(str(original[0]?.clinicId??original[0]?.clinic_id)!==str(clinicId))
    deny('SOURCE_CLINIC_MISMATCH');
  const seen=new Set();
  for(const item of appointments){
    if(!item||typeof item!=='object'||Array.isArray(item)||!UUID.test(appId(item)))deny('UNKNOWN_APPOINTMENT_ID');
    if(seen.has(appId(item)))deny('DUPLICATED_AGENDA_IDS');
    seen.add(appId(item));
  }
  const targets=new Set(cancelAppointmentIds);
  if(targets.has(originalAppointmentId))deny('CANNOT_CANCEL_SOURCE');
  for(const id of targets){
    const row=appointments.find(x=>appId(x)===id);
    if(!row)deny('CONFLICT_APPOINTMENT_NOT_IN_AGENDA');
    if(str(row.clinicId??row.clinic_id)!==str(clinicId))deny('CROSS_CLINIC_CONFLICT');
    if(!cancellable.has(str(row.status).toLowerCase())||
       row.active_aba_session_id||row.activeAbaSessionId||
       row.actual_start_at||row.actualStartAt)deny('CONFLICT_APPOINTMENT_ALREADY_STARTED');
  }
  if(continuationAppointment!==null){
    const next=continuationAppointment;
    if(!UUID.test(appId(next))||seen.has(appId(next))||
       str(next.clinicId??next.clinic_id)!==str(clinicId)||
       str(next.source_payload?.continuationOfAppointmentId)!==str(originalAppointmentId)||
       !UUID.test(str(next.patientId??next.patient_id))||
       !UUID.test(str(next.therapistId??next.therapist_id))||
       !Number.isFinite(Date.parse(str(next.scheduled_start_at??next.scheduledStartAt)))||
       !Number.isFinite(Date.parse(str(next.scheduled_end_at??next.scheduledEndAt))))
      deny('UNVERIFIED_CONTINUATION_APPOINTMENT');
  }
  const updated=appointments.map(row=>{
    if(!targets.has(appId(row)))return row;
    return {
      ...row,status:'cancelled_by_clinic',is_active:false,
      cancellationSource:'clinic',cancellation_source:'clinic',
      cancellationReason:'CONFLITO_CONTINUIDADE_SESSAO',
      cancellation_reason:'CONFLITO_CONTINUIDADE_SESSAO',
      statusUpdatedBy:actorId,statusUpdatedAt:at,updated_at:at
    };
  });
  if(continuationAppointment)updated.push({...continuationAppointment});
  return Object.freeze({
    sectionVersionBefore:sectionVersion,
    sectionVersionAfter:sectionVersion+1,
    appointments:Object.freeze(updated),
    cancellationCount:targets.size,
    continuationAdded:continuationAppointment!==null
  });
}
