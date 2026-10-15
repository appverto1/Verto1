import assert from 'node:assert/strict';
import { prepareNewGroupBooking } from '../services/groupSessions/groupSessionBookingPlan';

const clinic = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const outside = 'd745a2f6-3e82-455c-b7bb-5853bf53e15b';
const patientA = '5502e3c5-f4c1-4a18-ae65-714180e38b92';
const patientB = '46b81ab1-d910-4b87-90d3-30d0f0d5886f';
const professional = '9128fd0a-9e77-42f9-98c9-d86403d6f7b0';
const roomId = 'a87b5cd6-4493-4f25-a5ea-48901fe0fe39';
const input = {
  authenticatedClinicId: clinic, specialty: 'Fonoaudiólogo',
  date: '2026-10-16', startTime: '21:45', durationMinutes: 50,
  roomId, patientIds: [patientA, patientB], professionalIds: [professional],
  idempotencyKey: 'group-create:abc12345',
  clinicPatientRows: [
    { id: patientA, clinic_id: clinic }, { id: patientB, clinic_id: clinic }
  ],
  clinicProfessionalRows: [
    { user_id: professional, clinic_id: clinic, role: 'therapist', status: 'active', specialty: 'Fonoaudiólogo' }
  ],
  clinicRoomRows: [{ id:roomId, clinic_id:clinic, is_active:true, capacity:10 }],
  activeFinancialPlanRows: [
    { id:'98100c4d-23f4-4a5c-87ad-2778df202d9d', organization_id:clinic, patient_id:patientA,
      status:'ACTIVE', billing_mode:'PRIVATE', service_type:'SPEECH_THERAPY', group_amount_cents:8000 },
    { id:'ab64e1e1-9aba-4287-822a-038539d9fb95', organization_id:clinic, patient_id:patientB,
      status:'ACTIVE', billing_mode:'PRIVATE', service_type:'SPEECH_THERAPY', group_amount_cents:7000 }
  ],
};
const valid = prepareNewGroupBooking(input);
assert.equal(valid.ok, true);
if (valid.ok) {
  assert.deepEqual(valid.plan.patients.map(row=>row.priceCents), [8000,7000]);
  assert.equal(valid.plan.idempotencyKey,input.idempotencyKey);
  assert.equal(valid.plan.groupId.length,36);
  assert.equal(valid.plan.modality,'GROUP');
  assert.deepEqual(valid.plan.professionalIds,[professional]);
}
if (valid.ok) {
  assert.match(valid.plan.idempotencyFingerprint, /^[0-9a-f]{64}$/);
  const retry = prepareNewGroupBooking({...input,patientIds:[patientB,patientA]});
  assert.equal(retry.ok,true);
  if (retry.ok) {
    assert.notEqual(retry.plan.groupId,valid.plan.groupId,
      'preview group IDs are not binding reservation identities');
    assert.equal(retry.plan.idempotencyFingerprint,valid.plan.idempotencyFingerprint,
      'same clinic, slot, patients, professional and canonical prices hash identically');
  }
  const changedPrice = prepareNewGroupBooking({...input,
    activeFinancialPlanRows: input.activeFinancialPlanRows.map((row,i) =>
      i === 0 ? {...row, group_amount_cents:8001} : row),
  });
  assert.equal(changedPrice.ok,true);
  if (changedPrice.ok) assert.notEqual(changedPrice.plan.idempotencyFingerprint,valid.plan.idempotencyFingerprint,
    'same idempotency key with different canonical charge must conflict at write');
  const changedRoom = prepareNewGroupBooking({...input,
    roomId:'48385e86-4f18-4fa7-b977-00a182e768c3',
    clinicRoomRows:[{id:'48385e86-4f18-4fa7-b977-00a182e768c3',clinic_id:clinic,is_active:true,capacity:10}],
  });
  assert.equal(changedRoom.ok,true);
  if (changedRoom.ok) assert.notEqual(changedRoom.plan.idempotencyFingerprint,valid.plan.idempotencyFingerprint);
  const changedTime = prepareNewGroupBooking({...input,startTime:'22:00'});
  assert.equal(changedTime.ok,true);
  if (changedTime.ok) assert.notEqual(changedTime.plan.idempotencyFingerprint,valid.plan.idempotencyFingerprint);
}
// Multiple clinicians are part of the SAME group identity. Their input
// ordering cannot create duplicate bookings; changing the team changes it.
const secondProfessional = '758cad98-40d5-4d8d-a796-4840289752d2';
const multiProfessional = {
  ...input,
  professionalIds: [professional, secondProfessional],
  clinicProfessionalRows: [
    ...input.clinicProfessionalRows,
    {user_id:secondProfessional,clinic_id:clinic,role:'therapist',status:'active',specialty:'Fonoaudiólogo'},
  ],
};
const multiA = prepareNewGroupBooking(multiProfessional);
const multiB = prepareNewGroupBooking({
  ...multiProfessional,professionalIds:[secondProfessional,professional],
  patientIds:[patientB,patientA],
});
assert.equal(multiA.ok,true,'two authorized clinicians may share a group');
assert.equal(multiB.ok,true,'order of group roster is immaterial');
if (multiA.ok && multiB.ok && valid.ok) {
  assert.equal(multiA.plan.idempotencyFingerprint,multiB.plan.idempotencyFingerprint);
  assert.notEqual(multiA.plan.idempotencyFingerprint,valid.plan.idempotencyFingerprint,
    'adding a clinician is a material occupancy change');
}
const invalid = [
  { patientIds:[patientA] },
  { patientIds:[patientA,patientA] },
  { patientIds:[patientA,patientB,outside] },
  { professionalIds:[professional, professional] },
  { professionalIds:[] },
  { date:'2026-02-30' },
  { date:'2026-1-02' },
  { startTime:'25:00' },
  { durationMinutes:0 },
  { durationMinutes:361 },
  { roomId: outside },
  { idempotencyKey:'' },
  { idempotencyKey:'<script>alert(1)</script>' },
  { clinicPatientRows:[{ id:patientA,clinic_id:outside },input.clinicPatientRows[1]] },
  { clinicProfessionalRows:[{user_id:professional,clinic_id:clinic,role:'therapist',status:'inactive',specialty:'Fonoaudiólogo'}] },
  { clinicProfessionalRows:[{user_id:professional,clinic_id:clinic,role:'patient',status:'active',specialty:'Fonoaudiólogo'}] },
  { clinicProfessionalRows:[{user_id:professional,clinic_id:clinic,role:'therapist',status:'active',specialty:'Psicólogo'}] },
  { clinicRoomRows:[{id:roomId,clinic_id:outside,is_active:true,capacity:10}] },
  { clinicRoomRows:[{id:roomId,clinic_id:clinic,is_active:true,capacity:1}] },
  { clinicRoomRows:[{id:roomId,clinic_id:clinic,is_active:true,capacity:null}] },
  { activeFinancialPlanRows:input.activeFinancialPlanRows.slice(0,1) },
  { activeFinancialPlanRows:input.activeFinancialPlanRows.map(r=>({...r,group_amount_cents:0})) },
  { activeFinancialPlanRows:input.activeFinancialPlanRows.map(r=>({...r,billing_mode:'INSURANCE'})) },
];
for (const entry of invalid) {
  const response = prepareNewGroupBooking({...input,...entry});
  assert.equal(response.ok, false, JSON.stringify(entry));
}
console.log('groupSessionBookingPlan.test.ts: ok');
