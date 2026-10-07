import assert from 'node:assert/strict';
import fs from 'node:fs';
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
assert.equal(sessionPlanMatchesAppointmentSpecialty(plans[0], fonoAppointment), true);
assert.equal(sessionPlanMatchesAppointmentSpecialty(plans[2], fonoAppointment), false);

const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const sessionMode = fs.readFileSync('src/components/SessionMode.tsx', 'utf8');
const cmv3PlanRoutes = fs.readFileSync('services/clinicalMeasurementV3PlanRoutes.ts', 'utf8');
const migrationV1 = fs.readFileSync('supabase/migrations/20261007003500_session_specialty_isolation_v1.sql', 'utf8');
const migrationV2 = fs.readFileSync('supabase/migrations/20261007004500_session_specialty_isolation_v2.sql', 'utf8');
const migrationV3 = fs.readFileSync('supabase/migrations/20261007005500_session_specialty_isolation_v3.sql', 'utf8');

assert.match(
  patientDetail,
  /sessionSpecialtyPlanCandidates\(scopes, scheduledSessionForPatient\)[\s\S]*?candidates\.length !== 1/,
  'início pela Agenda deve resolver exatamente um plano ativo da especialidade',
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
assert.match(
  migrationV3,
  /ABA_SESSION_SPECIALTY_PLAN_REQUIRED/,
  'agendamento com especialidade reconhecida deve exigir plano explícito e autorizado',
);
assert.match(
  migrationV3,
  /source_payload[\s\S]*?specialty[\s\S]*?service_type[\s\S]*?approach/,
  'especialidade canônica deve ser resolvida de campos clínicos antes de usar abordagem como fallback',
);
assert.doesNotMatch(
  migrationV3,
  /new\.therapeutic_plan_id\s*:=/,
  'o banco não deve inventar vínculo de plano em nome do usuário',
);

console.log('sessionSpecialtyIsolation.test.ts: ok');
