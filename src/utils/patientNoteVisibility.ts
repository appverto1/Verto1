export type PatientNoteAudience = 'private' | 'patient' | 'professional';

const clean = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function toStoredPatientNoteVisibility(value: unknown): 'private' | 'shared_patient' | 'shared_clinic' {
  const normalized = clean(value);
  if (['professional', 'professionals', 'team', 'shared_clinic', 'clinic'].includes(normalized)) {
    return 'shared_clinic';
  }
  if (['patient', 'shared', 'family', 'shared_patient'].includes(normalized)) {
    return 'shared_patient';
  }
  return 'private';
}

export function resolvePatientNoteAudience(note: any): PatientNoteAudience {
  if (!note || typeof note !== 'object') {
    return toStoredPatientNoteVisibility(note) === 'shared_clinic'
      ? 'professional'
      : toStoredPatientNoteVisibility(note) === 'shared_patient'
        ? 'patient'
        : 'private';
  }

  if (note.shared_with_patient === true) return 'patient';
  if (note.shared_with_professionals === true) return 'professional';

  const visibility = clean(note.visibility);
  if (['patient', 'shared', 'family', 'shared_patient'].includes(visibility)) return 'patient';
  if (['professional', 'professionals', 'team', 'shared_clinic', 'clinic'].includes(visibility)) return 'professional';

  const scope = clean(note.portability_scope);
  if (['patient', 'paciente'].includes(scope)) return 'patient';
  if (['professionals', 'professional', 'profissionais', 'profissional', 'team'].includes(scope)) return 'professional';

  const type = clean(note.type);
  if (['shared', 'patient', 'family', 'shared_patient'].includes(type)) return 'patient';
  if (['professional', 'professionals', 'team', 'shared_clinic'].includes(type)) return 'professional';

  return 'private';
}

export function resolvePatientNoteAuthorId(note: any): string {
  return String(
    note?.created_by
      ?? note?.createdBy
      ?? note?.original_author_id
      ?? note?.originalAuthorId
      ?? note?.therapist_id
      ?? note?.therapistId
      ?? note?.user_id
      ?? note?.userId
      ?? ''
  ).trim();
}

export function canActorReadPatientNote(
  note: any,
  context: {
    actorId?: unknown;
    isPatientActor?: boolean;
    isCaseTeamMember?: boolean;
  }
): boolean {
  const audience = resolvePatientNoteAudience(note);
  if (context.isPatientActor) return audience === 'patient';

  const actorId = String(context.actorId ?? '').trim();
  const isAuthor = Boolean(actorId && resolvePatientNoteAuthorId(note) === actorId);

  if (audience === 'private') return isAuthor;
  return isAuthor || context.isCaseTeamMember === true;
}
