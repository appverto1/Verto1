import assert from 'node:assert/strict';
import {
  canActorReadPatientNote,
  resolvePatientNoteAudience,
  resolvePatientNoteAuthorId,
  toStoredPatientNoteVisibility,
} from '../src/utils/patientNoteVisibility';

assert.equal(toStoredPatientNoteVisibility('professional'), 'shared_clinic');
assert.equal(toStoredPatientNoteVisibility('shared_clinic'), 'shared_clinic');
assert.equal(toStoredPatientNoteVisibility('patient'), 'shared_patient');
assert.equal(toStoredPatientNoteVisibility('family'), 'shared_patient');
assert.equal(toStoredPatientNoteVisibility('private'), 'private');

assert.equal(resolvePatientNoteAudience({ visibility: 'shared_clinic' }), 'professional');
assert.equal(resolvePatientNoteAudience({ portability_scope: 'PROFESSIONALS' }), 'professional');
assert.equal(resolvePatientNoteAudience({ shared_with_professionals: true }), 'professional');
assert.equal(resolvePatientNoteAudience({ visibility: 'shared_patient' }), 'patient');
assert.equal(resolvePatientNoteAudience({ shared_with_patient: true }), 'patient');
assert.equal(resolvePatientNoteAudience({ visibility: 'private' }), 'private');

const authorId = '11111111-1111-4111-8111-111111111111';
const colleagueId = '22222222-2222-4222-8222-222222222222';

const privateNote = { visibility: 'private', created_by: authorId };
assert.equal(resolvePatientNoteAuthorId(privateNote), authorId);
assert.equal(canActorReadPatientNote(privateNote, { actorId: authorId }), true);
assert.equal(canActorReadPatientNote(privateNote, { actorId: colleagueId, isCaseTeamMember: true }), false);

const teamNote = { visibility: 'shared_clinic', original_author_id: authorId };
assert.equal(canActorReadPatientNote(teamNote, { actorId: colleagueId, isCaseTeamMember: true }), true);
assert.equal(canActorReadPatientNote(teamNote, { actorId: colleagueId, isCaseTeamMember: false }), false);
assert.equal(canActorReadPatientNote(teamNote, { actorId: authorId, isCaseTeamMember: false }), true);
assert.equal(canActorReadPatientNote(teamNote, { actorId: colleagueId, isPatientActor: true }), false);

const patientNote = { visibility: 'shared_patient', created_by: authorId };
assert.equal(canActorReadPatientNote(patientNote, { actorId: colleagueId, isPatientActor: true }), true);
assert.equal(canActorReadPatientNote(patientNote, { actorId: colleagueId, isCaseTeamMember: true }), true);
assert.equal(canActorReadPatientNote(patientNote, { actorId: colleagueId, isCaseTeamMember: false }), false);

console.log('patientNoteVisibility.test.ts: ok');
