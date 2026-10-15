import assert from 'node:assert/strict';
import { checkLocalScheduleConflicts } from '../src/utils/scheduling';

const id = 'db7f211c-6d4f-4781-930e-9cf0146782a1';
const first = {
  id:'appointment-a', clinic_id:'clinic-a', patient_id:'patient-a',
  session_modality:'GROUP', session_group_id:id, date:'2026-10-16',
  time:'21:45', duration_minutes:50, location_type:'clinica',
  room_id:'room-a', service_type:'Fonoaudiologia', status:'scheduled',
  professional_ids:['professional-a','professional-b']
};
const second = {
  appointments:[first], clinic_id:'clinic-a', patient_id:'patient-b',
  professional_ids:['professional-a','professional-b'], session_modality:'GROUP',
  session_group_id:id, group_booking_authorized:true, date:'2026-10-16', start_time:'21:45',
  duration_minutes:50, location_type:'clinica', room_id:'room-a',
  service_type:'Fonoaudiologia',
  rooms:[{id:'room-a',name:'Sala A',prevent_overlapping_appointments:true}],
};
const unverified = checkLocalScheduleConflicts({ ...second, group_booking_authorized: false });
assert.equal(unverified.blocking, true, 'ID de grupo sem validação server-side não libera agenda');
const shared = checkLocalScheduleConflicts(second);
assert.equal(shared.blocking,false,'mesma sessão coletiva pode compartilhar sala e equipe');
const asIndividual = checkLocalScheduleConflicts({...second,session_modality:'INDIVIDUAL'});
assert.equal(asIndividual.blocking,true,'sessão individual mantém o bloqueio');
const otherClinic = checkLocalScheduleConflicts({...second,clinic_id:'clinic-b'});
assert.equal(otherClinic.blocking,true,'id de grupo não contorna escopo da clínica');
const separateGroup = checkLocalScheduleConflicts({...second,session_group_id:'d7c724bb-3e09-4f65-9b15-c1234f6f785a'});
assert.equal(separateGroup.blocking,true,'dois grupos não compartilham equipe/sala bloqueada');
const samePatient = checkLocalScheduleConflicts({...second,patient_id:'patient-a'});
assert.equal(samePatient.blocking,true,'paciente não participa duas vezes');
const differentTime = checkLocalScheduleConflicts({...second,start_time:'22:00'});
assert.equal(differentTime.blocking,true,'sessão em horário diferente não integra o mesmo grupo');
const room = checkLocalScheduleConflicts({...second,room_id:'room-b',rooms:[{id:'room-b',prevent_overlapping_appointments:false}]});
assert.equal(room.blocking,true,'profissional fica indisponível em sala distinta');
console.log('groupScheduleConflict.test.ts: ok');
