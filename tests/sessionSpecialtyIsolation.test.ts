import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scheduledAbaSessionScopeMismatch } from '../src/utils/sessionAutoFinalization';
import {
  clinicalSpecialtiesMatch,
  clinicalSpecialtyScopeKey,
} from '../src/utils/clinicalSpecialties';
import {
  appointmentClinicalSpecialtyKey,
  sessionPlanMatchesAppointmentSpecialty,
  sessionSpecialtyPlanCandidates,
} from '../src/utils/sessionSpecialtyIsolation';

assert.equal(clinicalSpecialtyScopeKey('Fonoaudiologia'), 'speech_therapy');
assert.equal(clinicalSpecialtyScopeKey('Fonoaudiólogo'), 'speech_therapy');
assert.equal(clinicalSpecialtyScopeKey('TO'), 'occupational_therapy');
assert.equal(clinicalSpecialtyScopeKey('Terapia Ocupacional'), 'occupational_therapy');
assert.equal(clinicalSpecialtyScopeKey('ABA'), null, 'ABA é abordagem, não especialidade');
assert.equal(clinicalSpecialtiesMatch('Fonoaudiologia', 'Fonoaudiólogo'), true);
assert.equal(clinicalSpecialtiesMatch('Fonoaudiologia', 'Terapia Ocupacional'), false);

const fonoAppointment = { service_type: 'Fonoaudiologia' };
const toAppointment = { service_type: 'Terapia Ocupacional' };
assert.equal(appointmentClinicalSpecialtyKey(fonoAppointment), 'speech_therapy');
assert.equal(appointmentClinicalSpecialtyKey(toAppointment), 'occupational_therapy');

const plans = [
  { id: 'fono-active', specialty: 'Fonoaudiólogo', status: 'active', mode: 'specialty' },
  { id: 'fono-paused', specialty: 'Fonoaudiólogo', status: 'paused', mode: 'specialty' },
  { id: 'to-active', specialty: 'Terapeuta Ocupacional', status: 'active', mode: 'specialty' },
  { id: 'pts', specialty: null, status: 'active', mode: 'interdisciplinary' },
  { id: 'legacy-fono', specialty: 'Fonoaudiólogo', status: 'active', mode: 'legacy' },
];
assert.deepEqual(
  sessionSpecialtyPlanCandidates(plans, fonoAppointment).map((plan) => plan.id),
  ['fono-active'],
  'sessão de Fono deve considerar somente o plano ativo de Fono',
);
assert.deepEqual(
  sessionSpecialtyPlanCandidates(plans, toAppointment).map((plan) => plan.id),
  ['to-active'],
  'sessão de TO deve considerar somente o plano ativo de TO',
);
assert.deepEqual(
  sessionSpecialtyPlanCandidates(
    [{ id: 'fono-paused-only', specialty: 'Fonoaudiólogo', status: 'paused', mode: 'specialty' }],
    fonoAppointment,
  ),
  [],
  'plano pausado não pode ser reativado implicitamente pela sessão',
);
assert.equal(sessionPlanMatchesAppointmentSpecialty(plans[0], fonoAppointment), true);
assert.equal(sessionPlanMatchesAppointmentSpecialty(plans[2], fonoAppointment), false);

const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const sessionMode = fs.readFileSync('src/components/SessionMode.tsx', 'utf8');
const cmv3PlanRoutes = fs.readFileSync('services/clinicalMeasurementV3PlanRoutes.ts', 'utf8');
const migrationV1 = fs.readFileSync('supabase/migrations/20261007003500_session_specialty_isolation_v1.sql', 'utf8');
const migrationV2 = fs.readFileSync('supabase/migrations/20261007004500_session_specialty_isolation_v2.sql', 'utf8');
const migrationV3 = fs.readFileSync('supabase/migrations/20261007005500_session_specialty_isolation_v3.sql', 'utf8');
const migrationV4 = fs.readFileSync('supabase/migrations/20261007006500_session_specialty_isolation_v4.sql', 'utf8');
const migrationV5 = fs.readFileSync('supabase/migrations/20261007007500_session_specialty_isolation_v5.sql', 'utf8');

assert.match(
  patientDetail,
  /sessionSpecialtyPlanCandidates\(scopes, scheduledSessionForPatient\)[\s\S]*?candidates\.length > 1/,
  'início pela Agenda deve bloquear somente ambiguidade e nunca escolher entre múltiplos planos ativos',
);
assert.match(
  sessionMode,
  /if \(!activeTherapeuticPlanId\) \{[\s\S]*?setTherapeuticPrograms\(\[\]\)[\s\S]*?setTherapeuticPlanLoading\(false\)/,
  'sessão sem plano congelado não pode carregar programas de todas as especialidades',
);
assert.match(
  sessionMode,
  /sessionId,[\s\S]*?therapeuticPlanId: activeTherapeuticPlanId \|\| null/,
  'medidas clínicas V3 devem transportar a identidade da sessão e do plano congelado',
);
assert.match(
  cmv3PlanRoutes,
  /sessionPlanId[\s\S]*?CMV3_SESSION_SPECIALTY_SCOPE_MISMATCH/,
  'writer V3 deve rejeitar escrita cuja origem não pertence ao plano da sessão',
);
assert.match(
  migrationV1,
  /ABA_TRIAL_SPECIALTY_PLAN_MISMATCH/,
  'Legacy deve falhar fechado quando alvo\/programa pertence a outro plano',
);
assert.match(
  migrationV1,
  /trg_guard_aba_trial_specialty_isolation_v1/,
  'guard de banco deve proteger inserções e alterações Legacy',
);
assert.match(
  migrationV2,
  /tg_op = 'INSERT'[\s\S]*?new\.therapeutic_plan_id is null/,
  'auto-resolução do plano deve ocorrer somente na criação da sessão',
);
assert.doesNotMatch(
  migrationV2,
  /tg_op = 'UPDATE'[\s\S]*?new\.therapeutic_plan_id :=/,
  'UPDATE nunca pode reinterpretar a especialidade congelada da sessão',
);
assert.doesNotMatch(
  migrationV3,
  /new\.therapeutic_plan_id\s*:=/,
  'o banco não deve inventar vínculo de plano em nome do usuário',
);
assert.match(
  migrationV5,
  /public\.clinic_state[\s\S]*?jsonb_array_elements/,
  'fallback de agendamento legado também deve participar da validação de especialidade',
);
assert.match(
  migrationV5,
  /if new\.therapeutic_plan_id is null or v_appointment_key is null then[\s\S]*?return new/,
  'sessão PEI-only deve permanecer válida sem importar plano pausado ou de outra especialidade',
);
assert.match(
  migrationV5,
  /tg_op = 'INSERT' and v_plan_status <> 'active'/,
  'um novo binding explícito só pode apontar para plano ativo',
);
assert.match(
  migrationV5,
  /ABA_SESSION_SPECIALTY_PLAN_MISMATCH/,
  'plano explicitamente vinculado deve corresponder à especialidade do atendimento',
);
assert.doesNotMatch(
  migrationV5,
  /new\.therapeutic_plan_id\s*:=/,
  'nem o caminho canônico nem o legado podem inventar vínculo de plano em nome do usuário',
);

assert.match(
  patientDetail,
  /if \(requestedPlanId\) \{[\s\S]*?chosen\.status[\s\S]*?chosen\.canEdit[\s\S]*?sessionPlanMatchesAppointmentSpecialty/,
  'sessão iniciada pelo painel do plano também deve revalidar estado ativo, permissão e especialidade no servidor',
);
assert.match(
  patientDetail,
  /getPatientTherapeuticPlan\(String\(patient\?\.id \|\| ''\), \{ force: true \}\)/,
  'início de sessão deve validar estado atualizado do plano e não confiar em cache pausado',
);


// P0-504: no cached/legacy session may become another scheduled encounter.
const scheduledFono = {
  id: 'appointment-fono', patientId: 'patient-1', clinicId: 'clinic-a',
  professionalId: 'professional-1', serviceType: 'Fonoaudiologia',
};
const scopedFonoSession = {
  id: 'session-fono', patientId: 'patient-1', clinicId: 'clinic-a',
  appointmentId: 'appointment-fono', professionalId: 'professional-1',
  serviceType: 'Fonoaudiologia', therapeuticPlanSpecialty: 'Fonoaudiologia',
  status: 'active',
};
const owner = { patientId: 'patient-1', clinicId: 'clinic-a' };
assert.equal(scheduledAbaSessionScopeMismatch(scopedFonoSession,scheduledFono,owner),null);
const deny = (session:any, appointment:any, reason:string) =>
  assert.equal(scheduledAbaSessionScopeMismatch(session,appointment,owner),reason);
deny(scopedFonoSession,{...scheduledFono,id:'appointment-to',serviceType:'Terapia Ocupacional'},'SESSION_APPOINTMENT_MISMATCH');
deny({...scopedFonoSession,appointmentId:null},scheduledFono,'SESSION_LEGACY_LINK_REVIEW_REQUIRED');
deny({...scopedFonoSession,clinicId:'clinic-b'},scheduledFono,'SESSION_PATIENT_CLINIC_MISMATCH');
deny(scopedFonoSession,{...scheduledFono,clinicId:'clinic-b'},'SESSION_PATIENT_CLINIC_MISMATCH');
deny({...scopedFonoSession,patientId:'patient-2'},scheduledFono,'SESSION_PATIENT_CLINIC_MISMATCH');
deny({...scopedFonoSession,professionalId:'professional-2'},scheduledFono,'SESSION_PROFESSIONAL_MISMATCH');
deny({...scopedFonoSession,professionalId:null},scheduledFono,'SESSION_PROFESSIONAL_UNVERIFIED');
deny({...scopedFonoSession,serviceType:'Terapia Ocupacional'},scheduledFono,'SESSION_SPECIALTY_MISMATCH');
deny({...scopedFonoSession,therapeuticPlanSpecialty:'Terapia Ocupacional'},scheduledFono,'SESSION_SPECIALTY_MISMATCH');
deny({...scopedFonoSession,serviceType:null,therapeuticPlanSpecialty:null},scheduledFono,'SESSION_SPECIALTY_UNVERIFIED');
deny({...scopedFonoSession,status:'completed'},scheduledFono,'SESSION_NOT_ACTIVE');
deny({...scopedFonoSession,therapeuticPlanId:'to-plan'},
  {...scheduledFono,therapeuticPlanId:'fono-plan'},'SESSION_THERAPEUTIC_PLAN_MISMATCH');
assert.match(patientDetail,/if \(activeSession\) \{[\s\S]{0,500}scheduledAbaSessionScopeMismatch\(/,
  'manual session reopening also guards explicit Agenda scope');
const guardedEffect = patientDetail.split('const sessionAppointmentId = sessionToOpen?.appointment_id')[1];
assert.ok(guardedEffect,'Agenda recovery branch must be present');
assert.ok(guardedEffect.indexOf('scheduledAbaSessionScopeMismatch(')>=0);
assert.ok(guardedEffect.indexOf('scheduledAbaSessionScopeMismatch(') <
  guardedEffect.indexOf('if (scheduledAppointmentId && !sessionAppointmentId)'),
  'refuse unsafe reuse and legacy relinking before any optimistic session mutation');

console.log('sessionSpecialtyIsolation.test.ts: ok');
