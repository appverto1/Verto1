import { readPatientPlanServerSource } from './helpers/patientPlanReadSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = readPatientPlanServerSource();
const panel = fs.readFileSync('src/components/TherapeuticPlanPanel.tsx', 'utf8');
const caseTeam = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');

assert.match(
  caseTeam,
  /PATIENT_CASE_TEAM_MEMBERSHIP_ROLES[\s\S]*?'therapist'[\s\S]*?'supervisor'[\s\S]*?'coordinator'[\s\S]*?'director'/,
  'the case-team clinical membership roles remain centralized',
);
assert.match(
  server,
  /PATIENT_CASE_TEAM_MEMBERSHIP_ROLES/,
  'therapeutic-plan routes must reuse the same clinical membership authority as the case team',
);

const readStart = server.indexOf("app.get('/api/aba/patients/:patientId/therapeutic-plan'");
const readEnd = server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-plans'", readStart);
const readRoute = server.slice(readStart, readEnd);
assert.match(readRoute, /\.select\('user_id,clinic_id,role,status,specialty'\)/);
assert.match(readRoute, /\.in\('role', Array\.from\(PATIENT_CASE_TEAM_MEMBERSHIP_ROLES\)\)/);
assert.match(readRoute, /linkedMembershipById/);
assert.match(readRoute, /membershipSpecialty = normalizeClinicalSpecialty\(membership\?\.specialty\)/);
assert.match(readRoute, /planEligible =[\s\S]*?hasActiveClinicalMembership[\s\S]*?Boolean\(membershipSpecialty\)[\s\S]*?canWritePlan/);
assert.doesNotMatch(readRoute, /hasActiveTherapistMembership/);

const createStart = server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-plans'");
const createEnd = server.indexOf("app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId'", createStart);
const createRoute = server.slice(createStart, createEnd);
assert.match(
  createRoute,
  /participantProfessionalIds = Array\.from\(new Set\(\[responsibleProfessionalId, \.\.\.requestedParticipants\]\)\)\.filter\(Boolean\)/,
  'the responsible professional must count as a plan participant',
);
assert.match(
  createRoute,
  /\.in\('role', Array\.from\(PATIENT_CASE_TEAM_MEMBERSHIP_ROLES\)\)/,
  'coordinator/director/supervisor clinical memberships must not be rejected as inactive',
);
assert.doesNotMatch(
  createRoute,
  /\.eq\('role', 'therapist'\)/,
  'PTS creation must not hard-code therapist as the only active clinical membership role',
);
assert.match(createRoute, /Todos os participantes precisam ter vínculo clínico ativo nesta clínica\./);

assert.match(panel, /Responsável principal · também participa do plano/);
assert.match(panel, /Equipe participante \(responsável incluído · 2 a 5 profissionais\)/);
assert.match(
  panel,
  /const participantIds = Array\.from\(new Set\(\[[\s\S]*?scopeDraft\.responsibleProfessionalId,[\s\S]*?\.\.\.scopeDraft\.participantProfessionalIds/,
  'frontend validation must count the responsible professional among PTS participants',
);
assert.match(
  panel,
  /O responsável já conta como participante\. Selecione pelo menos mais um profissional/,
  'small clinics must receive a clear minimum-team message',
);

console.log('therapeuticPlanClinicalMembershipHotfix.test.mjs: ok');
