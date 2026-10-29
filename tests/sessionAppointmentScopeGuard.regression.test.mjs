import assert from 'node:assert/strict';
import {assessScheduledSessionReuse as check} from '../src/utils/sessionAppointmentScopeGuard.mjs';
const session={status:'active',appointment_id:'appointment-A',patient_id:'patient-A',clinic_id:'clinic-A',professional_id:'professional-A',therapeutic_plan_id:'plan-A'};
const appointment={id:'appointment-A',patient_id:'patient-A',clinic_id:'clinic-A',professional_id:'professional-A',therapeutic_plan_id:'plan-A'};
const base={session,appointment,patientId:'patient-A',clinicId:'clinic-A',professionalId:'professional-A',planId:'plan-A',sessionSpecialtyKey:'fono',appointmentSpecialtyKey:'fono',serverVerified:true};
assert.equal(check(base).safe,true);
for (const [patch,reason] of [
 [{serverVerified:false},'SERVER_PREFLIGHT_REQUIRED'],
 [{session:{...session,appointment_id:null}},'APPOINTMENT_UNVERIFIED'],
 [{session:{...session,appointment_id:'appointment-B'}},'APPOINTMENT_MISMATCH'],
 [{session:{...session,patient_id:'patient-B'}},'PATIENT_MISMATCH'],
 [{appointment:{...appointment,clinic_id:'clinic-B'}},'CLINIC_MISMATCH'],
 [{professionalId:'professional-B'},'PROFESSIONAL_MISMATCH'],
 [{session:{...session,therapeutic_plan_id:'plan-TO'}},'PLAN_MISMATCH'],
 [{appointmentSpecialtyKey:'to'},'SPECIALTY_MISMATCH'],
 [{appointmentSpecialtyKey:null},'SPECIALTY_UNVERIFIED'],
 [{session:{...session,status:'completed'}},'SESSION_NOT_ACTIVE']
])assert.equal(check({...base,...patch}).reason,reason);
console.log('sessionAppointmentScopeGuard.regression.test.mjs: ok');