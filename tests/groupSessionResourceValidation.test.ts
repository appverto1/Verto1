import assert from 'node:assert/strict';
import { validateGroupBookingResources } from '../services/groupSessions/groupSessionResourceValidation';

const clinic = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const otherClinic = 'd745a2f6-3e82-455c-b7bb-5853bf53e15b';
const specialist = '9128fd0a-9e77-42f9-98c9-d86403d6f7b0';
const assistant = 'a19473bd-9e4f-47b4-ae13-a49935e4db7e';
const room = 'a87b5cd6-4493-4f25-a5ea-48901fe0fe39';
const membership = (user_id: string, specialty: string, overrides: Record<string, unknown> = {}) =>
  ({ user_id, clinic_id: clinic, role:'therapist', status:'active', specialty, ...overrides });
const good = {
  clinicId:clinic, specialty:'Fonoaudiologia', professionalIds:[specialist,assistant],
  patientCount:3, roomId:room,
  membershipRows:[membership(specialist,'Fonoaudiólogo'),membership(assistant,'Fonoaudiologia')],
  roomRows:[{id:room,clinic_id:clinic,is_active:true,capacity:4}],
};
const valid = validateGroupBookingResources(good);
assert.deepEqual(valid,{ok:true,roomCapacity:4});
const rejected = [
  [{membershipRows:[membership(specialist,'Fonoaudiologia')]},'GROUP_PROFESSIONAL_MEMBERSHIP_INVALID'],
  [{membershipRows:[membership(specialist,'Fonoaudiologia'), membership(assistant,'Terapia Ocupacional')]},'GROUP_PROFESSIONAL_SPECIALTY_MISMATCH'],
  [{membershipRows:[membership(specialist,'Fonoaudiologia'), membership(assistant,'Fonoaudiologia',{role:'patient'})]},'GROUP_PROFESSIONAL_MEMBERSHIP_INVALID'],
  [{membershipRows:[membership(specialist,'Fonoaudiologia'), membership(assistant,'Fonoaudiologia',{status:'pending'})]},'GROUP_PROFESSIONAL_MEMBERSHIP_INVALID'],
  [{membershipRows:[membership(specialist,'Fonoaudiologia'), membership(assistant,'Fonoaudiologia',{clinic_id:otherClinic})]},'GROUP_PROFESSIONAL_MEMBERSHIP_INVALID'],
  [{membershipRows:[...good.membershipRows,membership(assistant,'Fonoaudiologia')]},'GROUP_PROFESSIONAL_MEMBERSHIP_INVALID'],
  [{roomRows:[{id:room,clinic_id:otherClinic,is_active:true,capacity:10}]},'GROUP_ROOM_UNAVAILABLE'],
  [{roomRows:[{id:room,clinic_id:clinic,is_active:false,capacity:10}]},'GROUP_ROOM_UNAVAILABLE'],
  [{roomRows:[{id:room,clinic_id:clinic,is_active:true,capacity:null}]},'GROUP_ROOM_CAPACITY_REQUIRED'],
  [{roomRows:[{id:room,clinic_id:clinic,is_active:true,capacity:2}]},'GROUP_ROOM_CAPACITY_EXCEEDED'],
  [{patientCount:31},'GROUP_RESOURCES_INVALID'],
  [{professionalIds:[specialist,specialist]},'GROUP_RESOURCES_INVALID'],
] as const;
for (const [changes,code] of rejected) {
  const decision=validateGroupBookingResources({...good,...changes});
  assert.deepEqual(decision,{ok:false,code},JSON.stringify(changes));
}
console.log('groupSessionResourceValidation.test.ts: ok');
