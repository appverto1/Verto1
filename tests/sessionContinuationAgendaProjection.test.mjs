import assert from 'node:assert/strict';
import {createSessionContinuationAgendaProjection as patch} from '../services/sessionContinuationAgendaProjection.mjs';

const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const clinicId=id(1),actorId=id(2),originId=id(3),conflictId=id(4),newId=id(5);
const existing=[
 {id:originId,clinicId,patientId:id(6),therapistId:id(7),status:'in_progress',notes:'Do not touch clinical notes'},
 {id:conflictId,clinicId,patientId:id(8),therapistId:id(7),status:'confirmed',notes:'Preserve notes for B'},
 {id:id(9),clinicId,patientId:id(10),therapistId:id(11),status:'scheduled',roomId:'other-room'}
];
const extra={
 id:newId,clinicId,patientId:id(6),therapistId:id(7),status:'scheduled',
 source_payload:{continuationOfAppointmentId:originId},
 scheduled_start_at:'2026-10-27T17:50:00Z',scheduled_end_at:'2026-10-27T18:40:00Z'
};
const payload={appointments:existing,originalAppointmentId:originId,
 cancelAppointmentIds:[conflictId],continuationAppointment:extra,
 clinicId,actorId,sectionVersion:23,at:'2026-10-27T17:45:00Z'};
const result=patch(payload);
assert.equal(result.sectionVersionBefore,23);
assert.equal(result.sectionVersionAfter,24);
assert.equal(result.cancellationCount,1);
assert.equal(result.continuationAdded,true);
assert.equal(result.appointments.length,4);
assert.equal(result.appointments[1].status,'cancelled_by_clinic');
assert.equal(result.appointments[1].notes,'Preserve notes for B');
assert.equal(result.appointments[1].cancellationReason,'CONFLITO_CONTINUIDADE_SESSAO');
assert.deepEqual(result.appointments[0],existing[0],'origin appointment remains untouched');
assert.deepEqual(result.appointments[2],existing[2],'unrelated other therapist remains untouched');
assert.equal(existing[1].status,'confirmed','function does not mutate original');
const deny=(change,code)=>{
  assert.throws(()=>patch({...payload,...change}),e=>e.code===code);
};
deny({sectionVersion:null},'UNVERIFIED_AGENDA_REVISION');
deny({appointments:[existing[0],existing[0],existing[1]]},'DUPLICATED_AGENDA_IDS');
deny({appointments:existing.slice(0,2).filter(x=>x.id!==conflictId)},'CONFLICT_APPOINTMENT_NOT_IN_AGENDA');
deny({cancelAppointmentIds:[originId]},'CANNOT_CANCEL_SOURCE');
deny({cancelAppointmentIds:[conflictId,conflictId]},'INVALID_APPOINTMENT_IDS');
deny({appointments:[existing[0],{...existing[1],status:'in_progress'},existing[2]]},'CONFLICT_APPOINTMENT_ALREADY_STARTED');
deny({appointments:[existing[0],{...existing[1],actual_start_at:'2026-10-27T17:40:00Z'},existing[2]]},'CONFLICT_APPOINTMENT_ALREADY_STARTED');
deny({appointments:[existing[0],{...existing[1],clinicId:id(12)},existing[2]]},'CROSS_CLINIC_CONFLICT');
deny({continuationAppointment:{...extra,id:originId}},'UNVERIFIED_CONTINUATION_APPOINTMENT');
deny({continuationAppointment:{...extra,source_payload:{continuationOfAppointmentId:id(99)}}},'UNVERIFIED_CONTINUATION_APPOINTMENT');
const small=patch({...payload,cancelAppointmentIds:[],continuationAppointment:null});
assert.equal(small.appointments.length,3);
assert.equal(small.cancellationCount,0);
assert.equal(small.continuationAdded,false);
console.log('sessionContinuationAgendaProjection.test.mjs: ok');
