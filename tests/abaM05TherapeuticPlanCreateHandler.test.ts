import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { createTherapeuticPlanCreateHandler } from '../services/therapeuticPlanCreateHandler';

// Negative direct-handler tests complement registration/authorization contract checks.
// These fixtures have synthetic IDs only; no clinical or production data is used.
const clinicId = '11111111-1111-4111-8111-111111111111';
const otherClinicId = '22222222-2222-4222-8222-222222222222';
const patientId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const professionalId = '55555555-5555-4555-8555-555555555555';
const otherProfessionalId = '66666666-6666-4666-8666-666666666666';

type Row = Record<string, any>;
type Fixture = {
  links: Row[];
  memberships: Row[];
  plans: Row[];
  insertions: Row[];
  reads: string[];
};
const fixture = (): Fixture => ({
  links: [
    { organization_id: clinicId, patient_id: patientId, professional_id: actorId, status: 'active', permissions: { write: true } },
    { organization_id: clinicId, patient_id: patientId, professional_id: professionalId, status: 'active', permissions: { write: true } },
  ],
  memberships: [
    { clinic_id: clinicId, user_id: actorId, role: 'therapist', status: 'active', specialty: 'Fonoaudiólogo' },
    { clinic_id: clinicId, user_id: professionalId, role: 'therapist', status: 'active', specialty: 'Terapeuta Ocupacional' },
  ],
  plans: [],
  insertions: [],
  reads: [],
});
const makeSupabase = (f: Fixture) => ({
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let insertion: Row | null = null;
    const rows = () => (table === 'patient_professional_links' ? f.links
      : table === 'clinic_memberships' ? f.memberships
      : table === 'patient_therapeutic_plans' ? f.plans : []);
    const filtered = () => rows().filter((row) => filters.every((check) => check(row)));
    const query = {
      select(_columns: string) { return this; },
      eq(column: string, value: any) { filters.push((row) => row[column] === value); return this; },
      in(column: string, values: any[]) { filters.push((row) => values.includes(row[column])); return this; },
      limit(_value: number) { return this; },
      insert(payload: Row) { insertion = payload; return this; },
      async maybeSingle() { f.reads.push(table); return { data: filtered()[0] || null, error: null }; },
      async single() {
        if (!insertion) throw new Error('unexpected single');
        const row = { ...insertion, id: '77777777-7777-4777-8777-777777777777' };
        f.insertions.push(row);
        f.plans.push(row);
        return { data: row, error: null };
      },
      then(onFulfilled: any, onRejected?: any) {
        f.reads.push(table);
        return Promise.resolve({ data: filtered(), error: null }).then(onFulfilled, onRejected);
      },
    };
    return query;
  },
});
const makeDeps = (f: Fixture) => ({
  enforcePayloadLimit: () => true,
  sanitizeString: (value: any, maxLength = 5000) => String(value == null ? '' : value).trim().slice(0, maxLength),
  currentClinicId: (user: any) => user.clinicId,
  isUuid: (value: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value)),
  supabase: makeSupabase(f),
  PATIENT_CASE_TEAM_MEMBERSHIP_ROLES: ['therapist'],
  normalizeClinicalSpecialty: (value: any) => ['Fonoaudiólogo', 'Terapeuta Ocupacional'].includes(value) ? value : null,
  isTherapeuticPlanManager: (role: any) => ['owner', 'coordinator', 'director', 'admin'].includes(role),
  normalizeTherapeuticSpecialtyObjectives: (raw: any) => raw,
  sanitizeClinicalPayload: (value: any) => value,
  stripPtsTrackingFieldsForDraft: (value: any) => value,
  normalizePtsClinicalPayload: (value: any) => value,
  emptyPtsClinicalPayload: () => ({}),
  ptsLastReviewedAt: () => null,
  crypto,
  PATIENT_THERAPEUTIC_PLAN_SELECT: '*',
  sendRouteDbError: (_res: any, _route: string, error: any) => { throw error; },
});
const makeRequest = (bodyOverrides: Row = {}, role = 'therapist', userId = actorId) => ({
  params: { patientId },
  resolvedPatientId: patientId,
  effectiveClinicRole: role,
  session: { user: { id: userId, clinicId, organizationId: clinicId } },
  body: {
    mode: 'specialty',
    responsibleProfessionalId: actorId,
    participantProfessionalIds: [actorId],
    idempotencyKey: 'same-form-retry-key',
    ...bodyOverrides,
  },
});
const invoke = async (f: Fixture, request: any) => {
  const response = {
    statusCode: 200,
    data: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.data = data; return this; },
  };
  await createTherapeuticPlanCreateHandler(() => makeDeps(f))(request, response);
  return response;
};

{
  const f = fixture();
  const invalid = await invoke(f, makeRequest({ mode: 'patient' }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.data.error, 'THERAPEUTIC_PLAN_SCOPE_INVALID');
  assert.equal(f.reads.length, 0);
  assert.equal(f.insertions.length, 0);
}
{
  const f = fixture();
  const invalid = await invoke(f, makeRequest({ idempotencyKey: '' }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.data.error, 'THERAPEUTIC_PLAN_IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(f.reads.length, 0);
}
{
  const f = fixture();
  const denied = await invoke(f, makeRequest({ mode: 'interdisciplinary', participantProfessionalIds: [actorId, professionalId] }));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.data.error, 'THERAPEUTIC_PLAN_INTERDISCIPLINARY_MANAGEMENT_REQUIRED');
  assert.equal(f.reads.length, 0);
}
{
  const f = fixture();
  const invalid = await invoke(f, makeRequest({ participantProfessionalIds: [otherProfessionalId, 'bad-id'] }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.data.error, 'THERAPEUTIC_PLAN_PROFESSIONAL_INVALID');
  assert.equal(f.reads.length, 0);
}
{
  const f = fixture();
  f.links = f.links.filter((row) => row.professional_id !== actorId);
  const denied = await invoke(f, makeRequest());
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.data.error, 'THERAPEUTIC_PLAN_PROFESSIONAL_NOT_LINKED');
  assert.equal(f.insertions.length, 0);
}
{
  const f = fixture();
  f.memberships = f.memberships.map((row) => ({ ...row, clinic_id: otherClinicId }));
  const denied = await invoke(f, makeRequest());
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.data.error, 'THERAPEUTIC_PLAN_PROFESSIONAL_MEMBERSHIP_INACTIVE');
  assert.equal(f.insertions.length, 0);
}
{
  const f = fixture();
  f.links[0].permissions.write = false;
  const denied = await invoke(f, makeRequest());
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.data.error, 'THERAPEUTIC_PLAN_PARTICIPANT_WRITE_REQUIRED');
  assert.equal(f.insertions.length, 0);
}
{
  const f = fixture();
  const denied = await invoke(f, makeRequest({ responsibleProfessionalId: professionalId, participantProfessionalIds: [professionalId] }));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.data.error, 'THERAPEUTIC_PLAN_RESPONSIBLE_INVALID');
  assert.equal(f.insertions.length, 0);
}
{
  const f = fixture();
  const request = makeRequest({
    clinicId: otherClinicId, organizationId: otherClinicId, specialty: 'Terapeuta Ocupacional',
    specialtyObjectives: { Fonoaudiólogo: [] },
  });
  const created = await invoke(f, request);
  assert.equal(created.statusCode, 201);
  assert.equal(created.data.success, true);
  assert.equal(f.insertions.length, 1);
  assert.equal(f.insertions[0].clinic_id, clinicId, 'clinic identity must be server-derived');
  assert.equal(f.insertions[0].organization_id, clinicId);
  assert.equal(f.insertions[0].specialty, 'Fonoaudiólogo', 'specialty must come from clinic membership');
  assert.equal(f.insertions[0].status, 'active');
  assert.equal(f.insertions[0].idempotency_key, 'same-form-retry-key');
  assert.match(f.insertions[0].request_hash, /^[a-f0-9]{64}$/);
  const retried = await invoke(f, request);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.data.idempotent, true);
  assert.equal(f.insertions.length, 1, 'same form retry cannot insert twice');
  const conflict = await invoke(f, makeRequest({ ...request.body, planLabel: 'Different plan for same key' }));
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.data.error, 'THERAPEUTIC_PLAN_IDEMPOTENCY_CONFLICT');
  assert.equal(f.insertions.length, 1, 'different payload with same key cannot insert');
}
console.log('ABA-M05: runtime handler rejects invalid scope, foreign clinic, unlinked professionals, forbidden writes and duplicate retry');
