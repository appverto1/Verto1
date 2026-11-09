import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {loadCanonicalGroupScheduleSlots,canonicalSharedGroupSlot} from '../services/groupSessions/groupSessionScheduleConflicts';
import {normalizeDurationMinutes,addMinutesToTime,normalizeScheduleLocationType,roomPreventsOverlappingAppointments,appointmentTimesOverlap} from '../src/utils/scheduling';
const id=(n:number)=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),group=id(2),room=id(3),team=[id(4),id(5)];
const rows=[10,11].map((n,i)=>({id:id(n),patientId:id(20+i),patientName:`Fictício ${i}`,date:'2026-11-04',time:'10:00',durationMinutes:60,roomId:room,locationType:'clinica',professionalId:team[0],professionalIds:team,status:'scheduled',sessionModality:'GROUP',sessionGroupId:group}));
let persisted=rows.map(a=>({appointment_id:a.id,booking_id:group,patient_id:a.patientId,appointment:{clinic_id:clinic,patient_id:a.patientId,room_id:room,scheduled_start_at:'2026-11-04T13:00:00Z',scheduled_end_at:'2026-11-04T14:00:00Z',location_timezone:'America/Sao_Paulo',source_payload:a}}));
let reads=0;let scoped='';
const supabase={from(name:string){assert.equal(name,'group_session_participants');reads++;return{select(){return this;},eq(field:string,value:string){assert.equal(field,'organization_id');scoped=value;return this;},in(){return this;},limit:async()=>({data:persisted,error:null})};}};
const source=fs.readFileSync('server.ts','utf8');
const start=source.indexOf('function getClinicStateAppointmentStatusBlocksConflict('),end=source.indexOf('\nasync function upsertAppointmentMirrorRow',start);
const ctx:any={supabase,loadCanonicalGroupScheduleSlots,canonicalSharedGroupSlot,normalizeDurationMinutes,addMinutesToTime,normalizeScheduleLocationType,roomPreventsOverlappingAppointments,appointmentTimesOverlap,
  sanitizeString:(value:any,max=1000)=>String(value??'').trim().slice(0,max),sanitizeDate:(value:any)=>value||null};
vm.createContext(ctx);vm.runInContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const validate=(appointments:any[])=>ctx.validateClinicStateAppointmentsForScheduleConflicts({appointments,clinicId:clinic,rooms:[{id:room,name:'Fictícia',prevent_overlapping_appointments:true}]});
const individual={...rows[0],id:id(30),patientId:id(31),sessionModality:'INDIVIDUAL',sessionGroupId:undefined,date:'2026-11-06'};
assert.equal((await validate([...rows,individual])).ok,true,'existing GROUP must not block an unrelated individual day');assert.equal(scoped,clinic);
assert.equal((await validate([...rows,{...individual,date:'2026-11-04',roomId:id(32),professionalId:team[1],professionalIds:[team[1]]}])).ok,false,'secondary professional still blocks individual overlap');
assert.equal((await validate([...rows,{...individual,date:'2026-11-04',professionalIds:[id(33)],professionalId:id(33)}])).ok,false,'room still blocks individual overlap');
assert.equal((await validate([...rows,{...individual,date:'2026-11-04',patientId:rows[0].patientId}])).ok,false,'patient overlap is never waived');
for(const changes of [{id:id(99)},{sessionGroupId:id(99)},{time:'10:10'},{durationMinutes:50},{roomId:id(99)},{professionalIds:[team[0]]},{patientId:id(99)}]){
  assert.equal((await validate([rows[0],{...rows[1],...changes}])).ok,false,'unpersisted/mutated group cannot authorize shared resources');
}
persisted=[];assert.equal((await validate(rows)).ok,false,'frontend GROUP IDs alone do not authorize overlap');
const before=reads;assert.equal((await validate([individual])).ok,true);assert.equal(reads,before,'individual-only agendas add no database read');
assert.equal((await validate([{...individual,id:id(40)},{...individual,id:id(41),patientId:id(42)}])).ok,false,'individual equivalence');
console.log('groupSessionLegacySchedule: real server validator, unrelated individual save, canonical membership, cross-modality conflicts and forged/mutated GROUP rejection passed');
