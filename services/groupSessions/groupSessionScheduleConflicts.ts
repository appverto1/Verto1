import {groupCalendarMetadata} from './groupSessionCalendar';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sorted=(ids:string[])=>[...ids].sort().join(',');
type Slot={groupId:string;patientId:string;date:string;startTime:string;durationMinutes:number;roomId:string;professionalIds:string[]};

/** Only persisted participant/appointment links authorize sharing a slot. */
export async function loadCanonicalGroupScheduleSlots(supabase:any,clinicId:string,appointments:any[]):Promise<Map<string,Slot>>{
  const ids=[...new Set(appointments.filter(a=>groupCalendarMetadata(a).sessionGroupId&&UUID.test(String(a.id||''))).map(a=>String(a.id)))];
  const result=new Map<string,Slot>();
  if(!ids.length||!UUID.test(clinicId))return result;
  // Batch by IDs, not patients, and stay below PostgREST's row/URL limits.
  for(let start=0;start<ids.length;start+=200){
    const batch=ids.slice(start,start+200);
    const {data,error}=await supabase.from('group_session_participants')
      .select('appointment_id,booking_id,patient_id,appointment:appointments!inner(clinic_id,patient_id,source_payload,room_id,scheduled_at,scheduled_start_at,scheduled_end_at,location_timezone)')
      .eq('organization_id',clinicId).in('appointment_id',batch).limit(batch.length);
    if(error)throw error;
    for(const link of data||[]){
      const a=link.appointment;const metadata=groupCalendarMetadata(a);
      if(a?.clinic_id!==clinicId||a.patient_id!==link.patient_id||metadata.sessionGroupId!==link.booking_id)continue;
      const instant=new Date(a.scheduled_start_at||a.scheduled_at);
      const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:a.location_timezone||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);
      result.set(link.appointment_id,{groupId:link.booking_id,patientId:link.patient_id,date:parts.slice(0,10),startTime:parts.slice(11,16),
        durationMinutes:(Date.parse(a.scheduled_end_at)-instant.getTime())/60000,roomId:a.room_id,professionalIds:metadata.professionalIds!});
    }
  }
  return result;
}

export function canonicalSharedGroupSlot(appointment:any,normalized:any,slots:Map<string,Slot>):string|null{
  const slot=slots.get(String(appointment.id||''));
  if(!slot||groupCalendarMetadata(appointment).sessionGroupId!==slot.groupId||normalized.patientId!==slot.patientId||
    normalized.date!==slot.date||normalized.startTime!==slot.startTime||normalized.durationMinutes!==slot.durationMinutes||
    normalized.locationType!=='clinica'||normalized.roomId!==slot.roomId||sorted(normalized.professionalIds)!==sorted(slot.professionalIds))return null;
  return slot.groupId;
}
