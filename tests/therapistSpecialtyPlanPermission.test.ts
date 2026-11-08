import assert from 'node:assert/strict';
import fs from 'node:fs';
import { roleHasDefaultCapability } from '../src/constants/authorizationModel';
import {
  canEditTherapeuticPlanScope,
  filterTherapeuticPlanScopesForActor,
  isTherapeuticPlanManager,
} from '../src/utils/therapeuticPlanAccess';

const clinic = 'clinic-1';
const patient = 'patient-1';
const scopes = [
  { id: 'fono', clinic_id: clinic, patient_id: patient, mode: 'specialty', specialty: 'Fonoaudiólogo', responsible_professional_id: 'fono-id', participant_professional_ids: [] },
  { id: 'to', clinic_id: clinic, patient_id: patient, mode: 'specialty', specialty: 'Terapeuta Ocupacional', responsible_professional_id: 'to-id', participant_professional_ids: [] },
  { id: 'psico', clinic_id: clinic, patient_id: patient, mode: 'specialty', specialty: 'Psicoterapeuta', responsible_professional_id: 'psico-id', participant_professional_ids: [] },
  { id: 'other-case', clinic_id: clinic, patient_id: 'patient-2', mode: 'specialty', specialty: 'Fonoaudiólogo', responsible_professional_id: 'fono-id', participant_professional_ids: [] },
];
const makeLink = (actorId: string, patientId = patient, write = true) => ({
  professional_id: actorId, patient_id: patientId, status: 'active', permissions: { read: true, write },
});
for (const [actorId, expected] of [
  ['fono-id', 'fono'],
  ['to-id', 'to'],
  ['psico-id', 'psico'],
]) {
  const available = filterTherapeuticPlanScopesForActor(scopes.filter(x => x.patient_id === patient), {
    actorId, actorRole: 'therapist', professionalLinks: [makeLink(actorId)],
  });
  assert.deepEqual(available.map(x => x.id), [expected], 'Each specialist sees only their own specialty plan');
  assert.equal(canEditTherapeuticPlanScope(available[0], {
    actorId, actorRole: 'therapist', professionalLinks: [makeLink(actorId)],
  }), true);
  assert.equal(canEditTherapeuticPlanScope(available[0], {
    actorId, actorRole: 'therapist', professionalLinks: [makeLink(actorId, patient, false)],
  }), false);
}
assert.deepEqual(filterTherapeuticPlanScopesForActor(scopes, {
  actorId: 'fono-id', actorRole: 'therapist',
  professionalLinks: [makeLink('fono-id', patient, true)],
}).map(x => x.id), ['fono']);
for (const manager of ['director','coordinator']) {
  assert.equal(isTherapeuticPlanManager(manager), true);
  assert.deepEqual(filterTherapeuticPlanScopesForActor(scopes.filter(x => x.patient_id === patient), {
    actorId: 'manager', actorRole: manager,
  }).map(x => x.id), ['fono', 'to', 'psico']);
}
const supervision = {
  supervisor_user_id: 'supervisor-id', supervised_user_id: 'fono-id',
  patient_id: patient, clinic_id: clinic, status: 'active',
};
assert.equal(isTherapeuticPlanManager('supervisor'), false);
assert.deepEqual(filterTherapeuticPlanScopesForActor(scopes, {
  actorId: 'supervisor-id', actorRole: 'supervisor',
  professionalLinks: [], supervisionLinks: [supervision],
}).map(x => x.id), ['fono', 'to', 'psico'],
  'The supervisor can see all plans for their supervised case, not other cases');
assert.equal(canEditTherapeuticPlanScope(scopes[0], {
  actorId: 'supervisor-id', actorRole: 'supervisor', professionalLinks: [],
  supervisionLinks: [supervision],
}), false, 'Supervision grants read, not mutation');
assert.deepEqual(filterTherapeuticPlanScopesForActor(scopes, {
  actorId: 'supervisor-id', actorRole: 'supervisor',
  supervisionLinks: [{ ...supervision, status: 'ended' }],
}).map(x => x.id), [], 'Ended supervision never grants access');
assert.equal(roleHasDefaultCapability('therapist', 'treatment_plan.create'), true);
assert.equal(roleHasDefaultCapability('therapist', 'treatment_plan.edit'), false,
  'No blanket treatment plan edit capability');
assert.equal(roleHasDefaultCapability('therapist', 'aba.program.edit'), false,
  'No blanket administrative program edit capability');
assert.equal(roleHasDefaultCapability('therapist', 'aba.program.create'), false,
  'The new grant is only for the specialty plan routes');
assert.equal(roleHasDefaultCapability('receptionist', 'treatment_plan.create'), false);

const server = fs.readFileSync('server.ts', 'utf8');
const planCreateHandler = fs.readFileSync('services/therapeuticPlanCreateHandler.ts', 'utf8');
const routes = [
  ["app.patch('/api/aba/patients/:patientId/therapeutic-plans/:planId'", "'treatment_plan.edit', 'treatment_plan.create', 'treatment_plan.view'"],
  ["app.post('/api/aba/patients/:patientId/therapeutic-programs'", "'aba.program.create', 'treatment_plan.create'"],
  ["app.patch('/api/aba/patients/:patientId/therapeutic-programs/:programId/status'", "'aba.program.edit', 'treatment_plan.create'"],
  ["app.patch('/api/aba/patients/:patientId/therapeutic-programs/:programId'", "'aba.program.edit', 'treatment_plan.create'"],
  ["app.post('/api/aba/patients/:patientId/therapeutic-programs/:programId/targets'", "'aba.program.edit', 'treatment_plan.create'"],
];
for (const [endpoint, permission] of routes) {
  assert.ok(server.includes(endpoint), 'Route absent: ' + endpoint);
  const route = server.slice(server.indexOf(endpoint), server.indexOf(endpoint) + 350);
  assert.ok(route.includes(endpoint.includes('therapeutic-plans/:planId') ? "requireScopedTherapeuticPlanCapability('edit')" : "requireAnyClinicCapability(" + permission + ")"), 'Route capability mismatch: ' + endpoint);
  assert.ok(route.includes('checkPatientAccess'), 'Missing backend patient scope: ' + endpoint);
}
assert.match(planCreateHandler, /mode === 'interdisciplinary' && String\(req\.effectiveClinicRole \|\| ''\)\.toLowerCase\(\) === 'therapist'/);
assert.match(planCreateHandler, /if \(!canManageAny && responsibleProfessionalId !== actorId\)/);
assert.match(planCreateHandler, /if \(participantProfessionalIds\.some\(\(id\) => !activeByProfessional\.has\(id\)\)\)/);
assert.match(planCreateHandler, /if \(participantSpecialties\.some\(\(specialty\) => !specialty\)\)/);
assert.match(server, /\/api\/protocol-import-requests\/:requestId\/revoke'[\s\S]{0,180}requireClinicCapability\('aba.program.edit'\)/);
assert.match(server, /\/api\/aba\/patients\/:patientId\/therapeutic-plans\/:planId\/pts-draft'[\s\S]{0,180}requireClinicCapability\('treatment_plan.edit'\)/);

console.log('therapistSpecialtyPlanPermission.test.ts: ok');
